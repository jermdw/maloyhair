import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

const ALLOWED_EMAIL = 'alexmwarren13@gmail.com'

/** Mirrors firestore.rules' isOwner() check — every callable must call this. */
export function requireOwner(request: CallableRequest): void {
  if (request.auth?.token.email !== ALLOWED_EMAIL) {
    throw new HttpsError('permission-denied', 'Not authorized.')
  }
}
