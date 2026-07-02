import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { requireOwner } from './auth.js'
import { stripeSecretKey, stripeWebhookSecret } from './secrets.js'

interface CreateCheckoutChargeRequest {
  appointmentId: string
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

    const { appointmentId } = (request.data ?? {}) as Partial<CreateCheckoutChargeRequest>
    if (!appointmentId) {
      throw new HttpsError('invalid-argument', 'appointmentId is required.')
    }

    const db = getFirestore()

    const apptRef = db.collection('appointments').doc(appointmentId)
    const apptSnap = await apptRef.get()
    const appointment = apptSnap.data()
    if (!appointment) {
      throw new HttpsError('not-found', 'Appointment not found.')
    }
    if (appointment.payment?.status === 'paid') {
      throw new HttpsError('failed-precondition', 'This appointment is already paid.')
    }

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

    const amount = Math.round(service.price * 100)
    const client = clientSnap.data()

    const stripe = new Stripe(stripeSecretKey.value())

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method_types: ['card_present'],
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

    try {
      await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: paymentIntent.id })
    } catch (err) {
      console.error('Failed to push charge to Stripe Terminal reader:', err)
      await apptRef.update({
        'payment.status': 'failed',
        'payment.updatedAt': FieldValue.serverTimestamp(),
      })
      throw new HttpsError('internal', 'Failed to reach the card reader. Check that it is powered on and online.')
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

    async function setPaymentStatus(appointmentId: string | undefined, status: 'paid' | 'failed') {
      if (!appointmentId) return
      const patch: Record<string, unknown> = {
        'payment.status': status,
        'payment.updatedAt': FieldValue.serverTimestamp(),
      }
      if (status === 'paid') patch.status = 'completed'
      await db.collection('appointments').doc(appointmentId).update(patch)
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        await setPaymentStatus(paymentIntent.metadata.appointmentId, 'paid')
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

    res.status(200).send('ok')
  },
)
