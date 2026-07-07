import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { requireOwner } from './auth.js'
import { stripeSecretKey, stripeWebhookSecret } from './secrets.js'

interface CreateCheckoutChargeRequest {
  appointmentId: string
  /** Cents. Overrides the service's list price — lets the stylist adjust the total (add-ons,
   *  discounts) before it goes to the reader. Defaults to the service price when omitted. */
  amount?: number
}

interface CancelCheckoutChargeRequest {
  appointmentId: string
}

/** Sanity ceiling on a manually-entered charge amount — well above any realistic salon
 *  service plus tip, so it only ever catches an input mistake (e.g. "8500" typed instead
 *  of "85.00"), not a legitimate charge. */
const MAX_CHARGE_CENTS = 100_000 // $1,000

/**
 * Cancels whatever the reader is currently doing. No-op if no reader is configured, since
 * nothing could have been pushed to it in that case. Only cancels if the reader's in-flight
 * action is actually for `expectedPaymentIntentId` — this guards against a stale `processing`
 * appointment (e.g. one whose webhook was missed) from cancelling a *different*, currently-live
 * charge the reader has since moved on to. Without a PaymentIntent to match against (the narrow
 * window between claiming the charge and the PaymentIntent actually being created), there's no
 * safe way to verify which action belongs to which appointment, so this no-ops rather than risk
 * cancelling an unrelated charge on the single shared reader.
 */
export async function cancelReaderAction(
  db: FirebaseFirestore.Firestore,
  expectedPaymentIntentId: string | undefined,
): Promise<void> {
  if (!expectedPaymentIntentId) return

  const settingsSnap = await db.collection('settings').doc('main').get()
  const readerId = settingsSnap.data()?.stripeReaderId
  if (!readerId) return

  const stripe = new Stripe(stripeSecretKey.value())

  const reader = await stripe.terminal.readers.retrieve(readerId)
  const currentPaymentIntentId = 'action' in reader ? reader.action?.process_payment_intent?.payment_intent : undefined
  if (currentPaymentIntentId !== expectedPaymentIntentId) return

  await stripe.terminal.readers.cancelAction(readerId)
}

/**
 * Charges the client's card via the salon's Stripe Terminal smart reader (server-driven
 * integration — the reader is WiFi-connected, not paired over Bluetooth, so no
 * client-side Terminal SDK or ConnectionToken is involved). Pushes the charge to the
 * reader and returns immediately; the actual outcome arrives via `stripeWebhook`.
 */
export const createCheckoutCharge = onCall(
  // Region set explicitly, same reason as sendMessage in messages.ts — this module's
  // top-level onCall() runs during import resolution, before index.ts's setGlobalOptions.
  { region: 'us-east1', secrets: [stripeSecretKey] },
  async (request) => {
    requireOwner(request)

    const { appointmentId, amount: amountOverride } = (request.data ?? {}) as Partial<CreateCheckoutChargeRequest>
    if (!appointmentId) {
      throw new HttpsError('invalid-argument', 'appointmentId is required.')
    }
    if (
      amountOverride !== undefined &&
      (!Number.isInteger(amountOverride) || amountOverride <= 0 || amountOverride > MAX_CHARGE_CENTS)
    ) {
      throw new HttpsError(
        'invalid-argument',
        `amount must be a positive integer number of cents, no more than $${MAX_CHARGE_CENTS / 100}.`,
      )
    }

    const db = getFirestore()
    const apptRef = db.collection('appointments').doc(appointmentId)

    // Atomically claim the appointment before doing anything else, so two concurrent
    // charge attempts (a double-click, or a retry after a false client-side timeout)
    // can't both pass the "not already paid" check and each push a separate charge to
    // the reader.
    const appointment = await db.runTransaction(async (tx) => {
      const snap = await tx.get(apptRef)
      const appt = snap.data()
      if (!appt) {
        throw new HttpsError('not-found', 'Appointment not found.')
      }
      if (appt.payment?.status === 'paid' || appt.payment?.status === 'processing') {
        throw new HttpsError('failed-precondition', 'A charge is already paid or in progress for this appointment.')
      }
      tx.update(apptRef, {
        'payment.status': 'processing',
        'payment.updatedAt': FieldValue.serverTimestamp(),
      })
      return appt
    })

    try {
      const serviceIds: string[] = appointment.serviceIds ?? []
      if (serviceIds.length === 0 && amountOverride === undefined) {
        throw new HttpsError(
          'failed-precondition',
          'This appointment has no services on file — enter a charge amount manually.',
        )
      }

      const [serviceSnaps, clientSnap, settingsSnap] = await Promise.all([
        Promise.all(serviceIds.map((id: string) => db.collection('services').doc(id).get())),
        db.collection('clients').doc(appointment.clientId).get(),
        db.collection('settings').doc('main').get(),
      ])

      const servicesTotal = serviceSnaps.reduce((sum, snap) => sum + (snap.data()?.price ?? 0), 0)
      if (serviceSnaps.some((snap) => !snap.exists)) {
        throw new HttpsError('not-found', 'One or more services on this appointment no longer exist.')
      }

      const readerId = settingsSnap.data()?.stripeReaderId
      if (!readerId) {
        throw new HttpsError('failed-precondition', 'No Stripe reader configured — set one on the Settings page.')
      }

      const amount = amountOverride ?? Math.round(servicesTotal * 100)
      const client = clientSnap.data()

      const stripe = new Stripe(stripeSecretKey.value())

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method_types: ['card_present'],
        // On-reader tipping resolves the tip *before* the card is presented (the customer
        // picks a tip on the reader, then taps), so by the time this authorizes, `amount`
        // already includes it — plain automatic capture settles that full amount in one
        // step. (card_present.manual_preferred was tried here and reverted: it switches to
        // manual capture, which needs an explicit capture call we weren't making, so the
        // charge sat authorized in `requires_capture` and the app never saw it as paid.)
        capture_method: 'automatic',
        receipt_email: client?.email,
        metadata: { appointmentId },
      })

      await apptRef.update({
        payment: {
          status: 'processing',
          amount,
          paymentIntentId: paymentIntent.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
      })

      // amount_eligible tells the reader to show its on-reader tipping screen, with
      // percentages calculated against the pre-tip service total (configured account-wide
      // in the Stripe Dashboard's Terminal Configuration). Stripe folds any tip the client
      // selects into the PaymentIntent automatically; stripeWebhook records it once paid.
      await stripe.terminal.readers.processPaymentIntent(readerId, {
        payment_intent: paymentIntent.id,
        process_config: { tipping: { amount_eligible: amount } },
      })

      return { success: true }
    } catch (err) {
      await apptRef.update({
        'payment.status': 'failed',
        'payment.updatedAt': FieldValue.serverTimestamp(),
      })
      if (err instanceof HttpsError) throw err
      console.error('Failed to create Stripe Terminal charge:', err)
      throw new HttpsError('internal', 'Failed to reach the card reader. Check that it is powered on and online.')
    }
  },
)

/**
 * Cancels a charge that's currently waiting on the reader (e.g. the stylist backed out, or
 * the reader appears stuck). Tells the reader to stop the current action, then explicitly
 * cancels the underlying PaymentIntent too — cancelling the reader action alone isn't
 * guaranteed to also cancel the PaymentIntent. Only marks the appointment `cancelled` once
 * the PaymentIntent cancellation is actually confirmed: Stripe only allows cancelling a
 * PaymentIntent that hasn't already reached a terminal state, so if the customer's card had
 * already been charged in the moments before this ran, the cancel call fails — in that case
 * this reconciles Firestore to `paid` (the true outcome) instead of claiming a cancellation
 * that didn't happen, and tells the owner so they don't also collect cash for the same visit.
 */
export const cancelCheckoutCharge = onCall(
  { region: 'us-east1', secrets: [stripeSecretKey] },
  async (request) => {
    requireOwner(request)

    const { appointmentId } = (request.data ?? {}) as Partial<CancelCheckoutChargeRequest>
    if (!appointmentId) {
      throw new HttpsError('invalid-argument', 'appointmentId is required.')
    }

    const db = getFirestore()
    const apptRef = db.collection('appointments').doc(appointmentId)

    const apptSnap = await apptRef.get()
    const appt = apptSnap.data()
    if (!appt) {
      throw new HttpsError('not-found', 'Appointment not found.')
    }
    if (appt.payment?.status !== 'processing') {
      throw new HttpsError('failed-precondition', 'No charge is currently in progress for this appointment.')
    }
    const paymentIntentId: string | undefined = appt.payment?.paymentIntentId

    await cancelReaderAction(db, paymentIntentId)

    if (paymentIntentId) {
      const stripe = new Stripe(stripeSecretKey.value())
      try {
        await stripe.paymentIntents.cancel(paymentIntentId)
      } catch (err) {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
        if (pi.status === 'succeeded') {
          await apptRef.update({
            'payment.status': 'paid',
            'payment.amount': pi.amount_received,
            'payment.updatedAt': FieldValue.serverTimestamp(),
          })
          throw new HttpsError('failed-precondition', 'This charge already completed and could not be cancelled.')
        }
        console.error('Failed to cancel PaymentIntent:', err)
        throw new HttpsError(
          'internal',
          'Failed to cancel the charge. Check the reader/Stripe dashboard before retrying.',
        )
      }
    }

    await apptRef.update({
      'payment.status': 'cancelled',
      'payment.updatedAt': FieldValue.serverTimestamp(),
    })

    return { success: true }
  },
)

/**
 * Stripe webhook — reports the outcome of a processed charge asynchronously (the reader
 * itself takes a few seconds while the customer taps/inserts their card). Verified via
 * signature, same shape as handleInboundSms's Twilio signature check in index.ts.
 */
export const stripeWebhook = onRequest(
  // Region set explicitly, same reason as createCheckoutCharge above.
  { region: 'us-east1', secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    const stripe = new Stripe(stripeSecretKey.value())

    const signature = req.get('stripe-signature') ?? ''
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret.value())
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err)
      res.status(400).send('Invalid signature')
      return
    }

    const db = getFirestore()

    async function setPaymentStatus(
      appointmentId: string | undefined,
      status: 'paid' | 'failed',
      eventPaymentIntentId: string | undefined,
      paymentIntent?: Stripe.PaymentIntent,
    ) {
      if (!appointmentId) return

      const apptRef = db.collection('appointments').doc(appointmentId)
      const snap = await apptRef.get()
      const appt = snap.data()
      if (!appt) {
        // Appointment was deleted between the charge being pushed to the reader and
        // this webhook arriving — nothing to update, and there's no point letting
        // Stripe retry a precondition that can never become true again.
        console.error(`Stripe webhook: appointment ${appointmentId} no longer exists.`)
        return
      }

      // A cancel-then-retry can leave an appointment with a newer PaymentIntent than the
      // one this event is about (e.g. a delayed/out-of-order webhook delivery for an
      // earlier attempt). Don't let a stale event overwrite the outcome of a fresher charge.
      if (
        eventPaymentIntentId &&
        appt.payment?.paymentIntentId &&
        appt.payment.paymentIntentId !== eventPaymentIntentId
      ) {
        console.log(
          `Stripe webhook: ignoring stale event for superseded PaymentIntent ${eventPaymentIntentId} on appointment ${appointmentId}.`,
        )
        return
      }

      const patch: Record<string, unknown> = {
        'payment.status': status,
        'payment.updatedAt': FieldValue.serverTimestamp(),
      }
      // On success, record the actual total charged (which may include an on-reader tip
      // the client added, folded into the PaymentIntent by Stripe) and the tip portion.
      if (status === 'paid' && paymentIntent) {
        patch['payment.amount'] = paymentIntent.amount_received
        const tipAmount = paymentIntent.amount_details?.tip?.amount
        if (tipAmount) patch['payment.tipAmount'] = tipAmount
      }
      // Only advance the scheduling status on success, and only if the appointment
      // hasn't been cancelled/marked no-show elsewhere in the meantime, and isn't
      // still in the future (a pre-paid appointment shouldn't read as completed
      // before it's actually happened).
      if (
        status === 'paid' &&
        appt.status !== 'cancelled' &&
        appt.status !== 'no_show' &&
        appt.startTime.toDate() <= new Date()
      ) {
        patch.status = 'completed'
      }

      await apptRef.update(patch)
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent
          await setPaymentStatus(paymentIntent.metadata.appointmentId, 'paid', paymentIntent.id, paymentIntent)
          break
        }
        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent
          await setPaymentStatus(paymentIntent.metadata.appointmentId, 'failed', paymentIntent.id)
          break
        }
        case 'terminal.reader.action_failed': {
          const reader = event.data.object as Stripe.Terminal.Reader
          const paymentIntentId = reader.action?.process_payment_intent?.payment_intent
          if (typeof paymentIntentId === 'string') {
            const matches = await db
              .collection('appointments')
              .where('payment.paymentIntentId', '==', paymentIntentId)
              .limit(1)
              .get()
            if (!matches.empty) {
              await setPaymentStatus(matches.docs[0].id, 'failed', paymentIntentId)
            }
          }
          break
        }
      }
    } catch (err) {
      // Acknowledge anyway — an endless Stripe retry storm doesn't help if the update
      // keeps failing for a reason a retry can't fix.
      console.error('Stripe webhook: failed to update appointment payment status:', err)
    }

    res.status(200).send('ok')
  },
)
