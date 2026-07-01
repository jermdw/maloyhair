import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

/** Mirrors firestore.rules' isOwner() check — every callable must call this. */
export function requireOwner(request: CallableRequest): void {
  if (request.auth?.token.owner !== true) {
    throw new HttpsError('permission-denied', 'Not authorized.')
  }
}
