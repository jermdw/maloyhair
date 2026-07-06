import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { scheduleReminder, cancelReminder } from './reminders.js'
import { twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid, stripeSecretKey } from './secrets.js'
import { findClientIdByPhone, findUpcomingAppointmentForPhone, formatAppointmentTime } from './inbound.js'
import { cancelReaderAction } from './payments.js'

export { sendMessage } from './messages.js'
export { createCheckoutCharge, cancelCheckoutCharge, stripeWebhook } from './payments.js'

initializeApp()
setGlobalOptions({ region: 'us-east1' })

const db = getFirestore()

const COMPANY_PHONE = '(404) 394-1617'

// Replace with the deployed URL of sendReminder once known (see setup docs).
const SEND_REMINDER_URL = process.env.SEND_REMINDER_URL ?? ''
// Replace with the deployed URL of handleInboundSms — this must also be set
// as the "A message comes in" webhook on the Twilio Messaging Service.
const HANDLE_INBOUND_SMS_URL = process.env.HANDLE_INBOUND_SMS_URL ?? ''

export const onAppointmentCreated = onDocumentCreated('appointments/{appointmentId}', async (event) => {
  const snap = event.data
  if (!snap) return

  const appointment = snap.data()
  const startTime: Date = appointment.startTime.toDate()

  const [h48, h2] = await Promise.all([
    scheduleReminder(event.params.appointmentId, 'h48', startTime, SEND_REMINDER_URL),
    scheduleReminder(event.params.appointmentId, 'h2', startTime, SEND_REMINDER_URL),
  ])

  await snap.ref.update({ reminders: { h48, h2 } })
})

export const onAppointmentUpdated = onDocumentUpdated('appointments/{appointmentId}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return

  const startTimeChanged = !before.startTime.isEqual(after.startTime)
  const cancelled = after.status === 'cancelled' && before.status !== 'cancelled'

  if (!startTimeChanged && !cancelled) return

  await Promise.all([
    cancelReminder(after.reminders?.h48),
    cancelReminder(after.reminders?.h2),
  ])

  if (cancelled) {
    await event.data!.after.ref.update({
      reminders: {
        h48: { sent: false, taskName: null },
        h2: { sent: false, taskName: null },
      },
    })
    return
  }

  const startTime: Date = after.startTime.toDate()
  const [h48, h2] = await Promise.all([
    scheduleReminder(event.params.appointmentId, 'h48', startTime, SEND_REMINDER_URL),
    scheduleReminder(event.params.appointmentId, 'h2', startTime, SEND_REMINDER_URL),
  ])
  await event.data!.after.ref.update({ reminders: { h48, h2 } })
})

export const onAppointmentDeleted = onDocumentDeleted(
  { document: 'appointments/{appointmentId}', secrets: [stripeSecretKey] },
  async (event) => {
    const appointment = event.data?.data()
    if (!appointment) return

    await Promise.all([
      cancelReminder(appointment.reminders?.h48),
      cancelReminder(appointment.reminders?.h2),
    ])

    if (appointment.payment?.status === 'processing') {
      try {
        await cancelReaderAction(db, appointment.payment?.paymentIntentId)
      } catch (err) {
        // Best-effort — the appointment doc is already gone, so there's no payment state
        // left to reconcile here even if this fails; power-cycle the reader if it's stuck.
        console.error('Failed to cancel reader action for deleted appointment:', err)
      }
    }
  },
)

/** Invoked by Cloud Tasks at the scheduled fire time. Not callable by clients directly. */
export const sendReminder = onRequest(
  { secrets: [twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid] },
  async (req, res) => {
    const { appointmentId, kind } = req.body as { appointmentId: string; kind: 'h48' | 'h2' }

    const apptRef = db.collection('appointments').doc(appointmentId)
    const apptSnap = await apptRef.get()
    const appointment = apptSnap.data()
    if (!appointment || appointment.status === 'cancelled') {
      res.status(200).send('skipped')
      return
    }

    const clientSnap = await db.collection('clients').doc(appointment.clientId).get()
    const client = clientSnap.data()
    if (!client) {
      res.status(200).send('no client')
      return
    }

    const twilio = (await import('twilio')).default(
      twilioAccountSid.value(),
      twilioAuthToken.value(),
    )

    const when = formatAppointmentTime(appointment.startTime.toDate())

    await twilio.messages.create({
      to: client.phone,
      messagingServiceSid: twilioMessagingServiceSid.value(),
      body: `Reminder: appointment with Maloy Hair on ${when}. Text ${COMPANY_PHONE} w/questions. C to confirm / X to cancel. Reply STOP to opt out.`,
    })

    await apptRef.update({ [`reminders.${kind}.sent`]: true })
    res.status(200).send('sent')
  },
)

/**
 * Twilio "A message comes in" webhook. Handles C(onfirm)/X(cancel) replies
 * to appointment reminders — STOP/HELP are intercepted by Twilio's Advanced
 * Opt-Out feature before they ever reach this function, see SETUP.md. Any
 * other free text from a known client is stored as an inbound message for
 * the owner to read and respond to from the app — no auto-reply is sent for
 * that case, since a human will handle it.
 */
export const handleInboundSms = onRequest(
  { secrets: [twilioAuthToken] },
  async (req, res) => {
    const twilio = await import('twilio')

    const signature = req.get('X-Twilio-Signature') ?? ''
    const isValid = twilio.validateRequest(
      twilioAuthToken.value(),
      signature,
      HANDLE_INBOUND_SMS_URL,
      req.body,
    )
    if (!isValid) {
      res.status(403).send('Invalid signature')
      return
    }

    const from = (req.body.From as string) ?? ''
    const body = ((req.body.Body as string) ?? '').trim()
    const bodyUpper = body.toUpperCase()

    const twiml = new twilio.twiml.MessagingResponse()

    if (bodyUpper === 'C' || bodyUpper === 'CONFIRM' || bodyUpper === 'X' || bodyUpper === 'CANCEL') {
      const apptDoc = await findUpcomingAppointmentForPhone(from)

      if (!apptDoc) {
        twiml.message(`We couldn't find an upcoming appointment for this number. Call ${COMPANY_PHONE} for help.`)
        res.type('text/xml').send(twiml.toString())
        return
      }

      const appointment = apptDoc.data()
      const when = formatAppointmentTime(appointment.startTime.toDate())

      if (bodyUpper === 'C' || bodyUpper === 'CONFIRM') {
        await apptDoc.ref.update({ status: 'confirmed' })
        twiml.message('Thank you for confirming your appointment. Reply STOP to opt out.')
      } else {
        await apptDoc.ref.update({ status: 'cancelled' })
        twiml.message(`Your appointment on ${when} was successfully cancelled. Reply STOP to opt out.`)
      }

      res.type('text/xml').send(twiml.toString())
      return
    }

    const clientId = await findClientIdByPhone(from)
    if (clientId) {
      await db.collection('messages').add({
        clientId,
        direction: 'inbound',
        body,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
      // No auto-reply for a known client's free text — the owner responds by hand from the app.
    } else {
      twiml.message(`We couldn't find your number in our system. Please call ${COMPANY_PHONE} for assistance.`)
    }

    res.type('text/xml').send(twiml.toString())
  },
)
