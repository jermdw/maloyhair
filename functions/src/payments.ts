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

/**
 * Cancels whatever the reader is currently doing. No-op if no reader is configured, since
 * nothing could have been pushed to it in that case. When `expectedPaymentIntentId` is given,
 * only cancels if the reader's in-flight action is actually for that PaymentIntent — this
 * guards against a stale `processing` appointment (e.g. one whose webhook was missed) from
 * cancelling a *different*, currently-live charge the reader has since moved on to.
 */
export async function cancelReaderAction(
  db: FirebaseFirestore.Firestore,
  expectedPaymentIntentId?: string,
): Promise<void> {
  const settingsSnap = await db.collection('settings').doc('main').get()
  const readerId = settingsSnap.data()?.stripeReaderId
  if (!readerId) return

  const stripe = new Stripe(stripeSecretKey.value())

  if (expectedPaymentIntentId) {
    const reader = await stripe.terminal.readers.retrieve(readerId)
    const currentPaymentIntentId = 'action' in reader ? reader.action?.process_payment_intent?.payment_intent : undefined
    if (currentPaymentIntentId !== expectedPaymentIntentId) return
  }

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
    if (amountOverride !== undefined && (!Number.isInteger(amountOverride) || amountOverride <= 0)) {
      throw new HttpsError('invalid-argument', 'amount must be a positive integer number of cents.')
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
      const [serviceSnap, clientSnap, settingsSnap] = await Promise.all([
        db.collection('services').doc(appointment.serviceId).get(),
        db.collection('clients').doc(appointment.clientId).get(),
        db.collection('settings').doc('main').get(),
      ])

      const service = serviceSnap.data()
      if (!service) {
        throw new HttpsError('not-found', 'Service not found.')
      }

      const readerId = settingsSnap.data()?.stripeReaderId
      if (!readerId) {
        throw new HttpsError('failed-precondition', 'No Stripe reader configured — set one on the Settings page.')
      }

      const amount = amountOverride ?? Math.round(service.price * 100)
      const client = clientSnap.data()

      const stripe = new Stripe(stripeSecretKey.value())

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        // Stripe's recommended pairing for Terminal PaymentIntents — gives the reader room
        // to fold an on-reader tip into the authorization before it captures, rather than
        // capturing the pre-tip amount and losing the tip.
        payment_method_options: { card_present: { capture_method: 'manual_preferred' } },
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
 * guaranteed to also cancel the PaymentIntent — and marks the appointment accordingly.
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

    let paymentIntentId: string | undefined
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(apptRef)
      const appt = snap.data()
      if (!appt) {
        throw new HttpsError('not-found', 'Appointment not found.')
      }
      if (appt.payment?.status !== 'processing') {
        throw new HttpsError('failed-precondition', 'No charge is currently in progress for this appointment.')
      }
      paymentIntentId = appt.payment?.paymentIntentId
      tx.update(apptRef, {
        'payment.status': 'cancelled',
        'payment.updatedAt': FieldValue.serverTimestamp(),
      })
    })

    try {
      await cancelReaderAction(db, paymentIntentId)
      if (paymentIntentId) {
        const stripe = new Stripe(stripeSecretKey.value())
        await stripe.paymentIntents.cancel(paymentIntentId).catch((err) => {
          // Already succeeded/canceled/etc — nothing more to do; the webhook (if it fires)
          // will reconcile the appointment's payment status to whatever actually happened.
          console.error('PaymentIntent cancel no-op:', err)
        })
      }
    } catch (err) {
      console.error('Failed to cancel reader action:', err)
      throw new HttpsError(
        'internal',
        'Marked as cancelled, but the reader may still be waiting — check it and power-cycle if needed.',
      )
    }

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
          await setPaymentStatus(paymentIntent.metadata.appointmentId, 'paid', paymentIntent)
          break
        }
        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent
          await setPaymentStatus(paymentIntent.metadata.appointmentId, 'failed')
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
              await setPaymentStatus(matches.docs[0].id, 'failed')
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
