import { getFirestore } from 'firebase-admin/firestore'

/** Looks up a client's document id by their phone number, or null if unknown. */
export async function findClientIdByPhone(phone: string): Promise<string | null> {
  const db = getFirestore()
  const clientSnap = await db.collection('clients').where('phone', '==', phone).limit(1).get()
  if (clientSnap.empty) return null
  return clientSnap.docs[0].id
}

/**
 * Finds the soonest upcoming, still-booked appointment for a client by phone.
 * This is the appointment a reply like "C" or "X" is assumed to refer to —
 * correct for a single-stylist business where a client rarely has more than
 * one active appointment at a time.
 */
export async function findUpcomingAppointmentForPhone(phone: string) {
  const db = getFirestore()

  const clientId = await findClientIdByPhone(phone)
  if (!clientId) return null

  const apptSnap = await db
    .collection('appointments')
    .where('clientId', '==', clientId)
    .where('status', '==', 'booked')
    .where('startTime', '>=', new Date())
    .orderBy('startTime', 'asc')
    .limit(1)
    .get()

  if (apptSnap.empty) return null
  return apptSnap.docs[0]
}

export function formatAppointmentTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
