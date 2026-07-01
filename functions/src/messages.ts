import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireOwner } from './auth.js'
import { twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid } from './secrets.js'

interface SendMessageRequest {
  clientId: string
  body: string
}

/** Lets the owner text any client directly from the app — not just reply within a reminder thread. */
export const sendMessage = onCall(
  // Region set explicitly (not inherited from index.ts's setGlobalOptions) because this
  // module's top-level onCall() call is evaluated during import resolution, before
  // setGlobalOptions runs in index.ts's body — relying on inheritance here would silently
  // deploy this function to the default region (us-central1) instead of us-east1.
  { region: 'us-east1', secrets: [twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid] },
  async (request) => {
    requireOwner(request)

    const { clientId, body } = (request.data ?? {}) as Partial<SendMessageRequest>
    if (!clientId || !body?.trim()) {
      throw new HttpsError('invalid-argument', 'clientId and body are required.')
    }

    const db = getFirestore()
    const clientSnap = await db.collection('clients').doc(clientId).get()
    const client = clientSnap.data()
    if (!client) {
      throw new HttpsError('not-found', 'Client not found.')
    }

    const twilio = (await import('twilio')).default(twilioAccountSid.value(), twilioAuthToken.value())

    try {
      await twilio.messages.create({
        to: client.phone,
        messagingServiceSid: twilioMessagingServiceSid.value(),
        body,
      })
    } catch {
      throw new HttpsError('internal', 'Failed to send the text message.')
    }

    await db.collection('messages').add({
      clientId,
      direction: 'outbound',
      body,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { success: true }
  },
)
