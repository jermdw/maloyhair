import { httpsCallable } from 'firebase/functions'
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { functions } from '@/lib/functions'
import { db } from '@/lib/firebase'
import type { Appointment } from '@/types/firestore'

const createCheckoutChargeCallable = httpsCallable<
  { appointmentId: string; amount?: number },
  { success: boolean }
>(functions, 'createCheckoutCharge')

const cancelCheckoutChargeCallable = httpsCallable<{ appointmentId: string }, { success: boolean }>(
  functions,
  'cancelCheckoutCharge',
)

/** Pushes a charge to the salon's Stripe Terminal reader. `amountCents` overrides the
 *  service's list price when the stylist has adjusted the total; omit to use the service price. */
export async function createCheckoutCharge(appointmentId: string, amountCents?: number) {
  await createCheckoutChargeCallable({ appointmentId, amount: amountCents })
}

/** Cancels a charge that's currently waiting on the reader. */
export async function cancelCheckoutCharge(appointmentId: string) {
  await cancelCheckoutChargeCallable({ appointmentId })
}

/** Records a cash payment directly — no reader/Stripe involved, so this is a plain
 *  Firestore write rather than a callable. Mirrors stripeWebhook's "advance to completed"
 *  logic so cash and card payments behave the same way on the calendar/status. */
export async function recordCashPayment(appointmentId: string, amountCents: number) {
  const apptRef = doc(db, 'appointments', appointmentId)
  const snap = await getDoc(apptRef)
  const appt = snap.data() as Appointment | undefined
  if (!appt) throw new Error('Appointment not found.')

  const patch: Record<string, unknown> = {
    payment: {
      status: 'paid',
      amount: amountCents,
      method: 'cash',
      updatedAt: serverTimestamp(),
    },
  }
  if (appt.status !== 'cancelled' && appt.status !== 'no_show' && appt.startTime.toDate() <= new Date()) {
    patch.status = 'completed'
  }
  await updateDoc(apptRef, patch)
}
