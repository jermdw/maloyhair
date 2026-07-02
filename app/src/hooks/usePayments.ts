import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/functions'

const createCheckoutChargeCallable = httpsCallable<{ appointmentId: string }, { success: boolean }>(
  functions,
  'createCheckoutCharge',
)

/** Pushes a charge for the appointment's service price to the salon's Stripe Terminal reader. */
export async function createCheckoutCharge(appointmentId: string) {
  await createCheckoutChargeCallable({ appointmentId })
}
