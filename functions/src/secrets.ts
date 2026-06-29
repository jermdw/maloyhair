import { defineSecret } from 'firebase-functions/params'

// Set with: firebase functions:secrets:set TWILIO_ACCOUNT_SID (etc.)
export const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID')
export const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN')
export const twilioMessagingServiceSid = defineSecret('TWILIO_MESSAGING_SERVICE_SID')
