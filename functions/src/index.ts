import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import {
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { setGlobalOptions } from 'firebase-functions/v2'
import Stripe from 'stripe'
import {
  REMINDER_DAYS_BEFORE,
  REMINDER_TIMEZONE,
  upcomingDayRangeUtc,
  type ReminderKind,
} from './reminders.js'
import { twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid, stripeSecretKey } from './secrets.js'
import { findClientIdByPhone, findUpcomingAppointmentForPhone, formatAppointmentTime } from './inbound.js'
import { cancelReaderAction } from './payments.js'
import { createTwilioClient, loadTwilio } from './twilioClient.js'

export { sendMessage } from './messages.js'
export { createCheckoutCharge, cancelCheckoutCharge, stripeWebhook } from './payments.js'

initializeApp()
setGlobalOptions({ region: 'us-east1' })

const db = getFirestore()

const COMPANY_PHONE = '(404) 394-1617'

// Replace with the deployed URL of handleInboundSms — this must also be set
// as the "A message comes in" webhook on the Twilio Messaging Service.
const HANDLE_INBOUND_SMS_URL = process.env.HANDLE_INBOUND_SMS_URL ?? ''

/**
 * Reminders are found by the daily sendDailyReminders sweep, not scheduled per
 * appointment — the only per-appointment bookkeeping is the `reminders.{d3,d1}.sent`
 * dedupe flags. A rescheduled appointment must have them reset so it's eligible
 * for fresh reminders on its new date (the sweep's status filter already handles
 * cancellation, so a cancelled appointment needs no flag changes).
 */
export const onAppointmentUpdated = onDocumentUpdated('appointments/{appointmentId}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return

  if (before.startTime.isEqual(after.startTime)) return

  await event.data!.after.ref.update({
    reminders: {
      d3: { sent: false },
      d1: { sent: false },
    },
  })
})

export const onAppointmentDeleted = onDocumentDeleted(
  { document: 'appointments/{appointmentId}', secrets: [stripeSecretKey] },
  async (event) => {
    const appointment = event.data?.data()
    if (!appointment) return

    if (appointment.payment?.status === 'processing') {
      const paymentIntentId: string | undefined = appointment.payment?.paymentIntentId

      try {
        await cancelReaderAction(db, paymentIntentId)
      } catch (err) {
        // Best-effort — the appointment doc is already gone, so there's no payment state
        // left to reconcile here even if this fails; power-cycle the reader if it's stuck.
        console.error('Failed to cancel reader action for deleted appointment:', err)
      }

      if (paymentIntentId) {
        try {
          const stripe = new Stripe(stripeSecretKey.value())
          await stripe.paymentIntents.cancel(paymentIntentId)
        } catch (err) {
          // Most likely means the charge already succeeded before the cancel landed. The
          // appointment doc is gone, so there's nowhere left in the app to reconcile this —
          // log loudly with the PaymentIntent ID so it can be found and refunded manually
          // in the Stripe Dashboard if needed.
          console.error(
            `Deleted appointment ${event.params.appointmentId} had an in-flight PaymentIntent ` +
              `${paymentIntentId} that could not be cancelled — check the Stripe Dashboard for a ` +
              'possible uncancelled charge:',
            err,
          )
        }
      }
    }
  },
)

/**
 * Daily reminder sweep, run by Cloud Scheduler at 7:00 AM Eastern. Pull model:
 * instead of scheduling a future send per appointment at booking time (which
 * hits Cloud Tasks' 30-day scheduling ceiling and needs cancel/reschedule
 * bookkeeping), each morning it queries for appointments whose calendar date
 * is exactly 3 days or 1 day out and texts whichever haven't been reminded
 * yet, using reminders.{d3,d1}.sent as the dedupe flag.
 */
export const sendDailyReminders = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: REMINDER_TIMEZONE,
    secrets: [twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid],
  },
  async () => {
    const twilio = await createTwilioClient(twilioAccountSid.value(), twilioAuthToken.value())

    for (const [kind, daysAhead] of Object.entries(REMINDER_DAYS_BEFORE) as [ReminderKind, number][]) {
      const { start, end } = upcomingDayRangeUtc(daysAhead)

      // "confirmed" is included deliberately: a client who confirmed off the
      // 3-day reminder should still get the 1-day one.
      const snap = await db
        .collection('appointments')
        .where('status', 'in', ['booked', 'confirmed'])
        .where('startTime', '>=', start)
        .where('startTime', '<', end)
        .get()

      for (const apptDoc of snap.docs) {
        const appointment = apptDoc.data()
        if (appointment.reminders?.[kind]?.sent) continue

        const clientSnap = await db.collection('clients').doc(appointment.clientId).get()
        const client = clientSnap.data()
        if (!client) {
          console.error(`Appointment ${apptDoc.id} has no client ${appointment.clientId} — skipping reminder.`)
          continue
        }

        const when = formatAppointmentTime(appointment.startTime.toDate())

        try {
          await twilio.messages.create({
            to: client.phone,
            messagingServiceSid: twilioMessagingServiceSid.value(),
            body: `Reminder: appointment with Maloy Hair on ${when}. Text ${COMPANY_PHONE} w/questions. C to confirm / X to cancel. Reply STOP to opt out.`,
          })
        } catch (err) {
          // A failed send is NOT marked sent. It won't retry tomorrow (the appointment
          // will no longer be exactly daysAhead out), but the unset flag plus this log
          // keeps the miss visible instead of silently swallowed.
          console.error(`Failed to send ${kind} reminder for appointment ${apptDoc.id}:`, err)
          continue
        }

        await apptDoc.ref.update({ [`reminders.${kind}.sent`]: true })
      }
    }
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
    const twilio = await loadTwilio()

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
