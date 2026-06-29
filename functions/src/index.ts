import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { scheduleReminder, cancelReminder } from './reminders.js'
import { twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid } from './secrets.js'

initializeApp()
setGlobalOptions({ region: 'us-east1' })

const db = getFirestore()

// Replace with the deployed URL of sendReminder once known (see setup docs).
const SEND_REMINDER_URL = process.env.SEND_REMINDER_URL ?? ''

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

export const onAppointmentDeleted = onDocumentDeleted('appointments/{appointmentId}', async (event) => {
  const appointment = event.data?.data()
  if (!appointment) return

  await Promise.all([
    cancelReminder(appointment.reminders?.h48),
    cancelReminder(appointment.reminders?.h2),
  ])
})

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

    const when = appointment.startTime.toDate().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

    await twilio.messages.create({
      to: client.phone,
      messagingServiceSid: twilioMessagingServiceSid.value(),
      body:
        kind === 'h48'
          ? `Reminder: you have a hair appointment on ${when}. Reply to confirm.`
          : `See you soon! Your appointment is at ${when}.`,
    })

    await apptRef.update({ [`reminders.${kind}.sent`]: true })
    res.status(200).send('sent')
  },
)
