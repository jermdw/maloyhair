import { defineSecret } from 'firebase-functions/params'

// Set with: firebase functions:secrets:set TWILIO_ACCOUNT_SID (etc.)
export const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID')
export const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN')
export const twilioMessagingServiceSid = defineSecret('TWILIO_MESSAGING_SERVICE_SID')

// Set with: firebase functions:secrets:set STRIPE_SECRET_KEY (etc.)
// STRIPE_SECRET_KEY should be a restricted key (rk_...), not the full account secret key.
export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')
export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET')
