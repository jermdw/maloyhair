import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/functions'

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
