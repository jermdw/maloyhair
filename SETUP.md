# Setup steps

What's already scaffolded vs. what you need to do by hand in a console
(these need your Google/Twilio credentials, so they can't be automated here).

## Already done
- `/app` — React + Vite + Tailwind + shadcn/ui client
- `/functions` — Cloud Functions v2 skeleton (reminder scheduling, Twilio send, inbound C/X reply handling)
- `firestore.rules`, `firestore.indexes.json` — locked to a single Google account
- Second Firebase Hosting site `maloyhair-app` created and wired into `firebase.json` / `.firebaserc`
- Privacy policy (`/privacy`) and terms (`/terms`) pages, live at maloy.hair, for Twilio A2P registration

## You need to do

### 1. Firebase Auth
In the [Firebase console](https://console.firebase.google.com/project/maloyhair/authentication/providers):
- Enable the **Google** sign-in provider.
- Under Authentication → Settings → Authorized domains, add `maloyhair-app.web.app` (and your custom domain once mapped).

Note: Firebase Auth itself doesn't let you restrict Google sign-in to one account at the provider level — anyone with a Google account can complete sign-in. Access is actually enforced by an `owner: true` custom claim, checked independently by `firestore.rules` and `functions/src/auth.ts`. After enabling the provider, grant the claim once:
```
node functions/scripts/grant-owner-claim.mjs <owner-email> --project=maloyhair
```
The claim takes effect on the owner's next sign-in or token refresh. If she ever switches Google accounts, re-run this script for the new account.

### 2. Get the web app config
In the Firebase console → Project settings → Your apps → add a **Web app** (if one doesn't exist yet), copy the config values into `app/.env.local` (copy from `app/.env.example`).

### 3. Reminder scheduling (nothing to set up)
Appointment reminders are sent by the `sendDailyReminders` function, a Cloud
Scheduler cron (7:00 AM America/New_York daily) that `firebase deploy`
provisions automatically — no queue or manual scheduling infrastructure.
(The old per-appointment Cloud Tasks queue `sms-reminders` is obsolete and can
be deleted if it still exists: `gcloud tasks queues delete sms-reminders
--location=us-east1 --project=maloyhair`.)

### 4. Twilio
- Create a [Messaging Service](https://console.twilio.com/us1/develop/sms/services) and add a sender (phone number or alphanumeric sender ID, depending on what your carrier supports).
- Grab your Account SID, Auth Token, and the Messaging Service SID.
- Set them as Firebase secrets (never commit these):
```
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project=maloyhair
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project=maloyhair
firebase functions:secrets:set TWILIO_MESSAGING_SERVICE_SID --project=maloyhair
```

### 5. Deploy functions once, then wire up the inbound webhook URL
```
cd functions && npm run build
firebase deploy --only functions --project=maloyhair
```
Copy the deployed `handleInboundSms` URL from the output into `functions/.env` as `HANDLE_INBOUND_SMS_URL=<url>` (copy from `functions/.env.example`), then redeploy. This value is used inside the function itself to validate Twilio's request signature, so it must exactly match the URL Twilio is configured to POST to (step 6).

### 6. Wire up the inbound webhook + STOP/HELP
In the [Twilio console](https://console.twilio.com/us1/develop/sms/services) → your Messaging Service → **Integration**:
- Set "A message comes in" to **Webhook**, pointed at the deployed `handleInboundSms` URL, HTTP POST.
- Enable **Advanced Opt-Out** (under the Messaging Service's compliance/opt-out settings) so Twilio auto-handles STOP/START/HELP keywords before they reach our function — no code needed for that path.

### 7. Stripe Terminal checkout
Checkout uses a WiFi-connected Stripe "smart reader" (BBPOS WisePOS E or Stripe Reader S700) via the
[server-driven Terminal integration](https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=server-driven) —
no client-side Terminal SDK, no ConnectionToken. **Not** a Bluetooth mobile reader (BBPOS Chipper 2X BT /
WisePad 3 / Stripe M2) — those only pair with a native iOS/Android app, which this project doesn't have.

1. Order/exchange for a smart reader at [dashboard.stripe.com/terminal/shop](https://dashboard.stripe.com/terminal/shop).
2. In the Stripe Dashboard → Terminal → Locations, create a Location for the salon.
3. Power on the reader, connect it to the salon WiFi, then register it to that Location: Dashboard → Terminal → Readers → Register, using the pairing code shown on the reader's screen. Copy the resulting reader ID (`tmr_...`).
4. Paste that reader ID into the app's Settings page ("Stripe reader ID" field).
5. Create a **restricted API key** (not the full secret key) at Dashboard → Developers → API keys → Create restricted key, scoped to PaymentIntents (write) and Terminal (write) only. Set it as a secret:
```
firebase functions:secrets:set STRIPE_SECRET_KEY --project=maloyhair
```
6. Deploy functions (see step 5 above) so `stripeWebhook` gets a live URL, then in Stripe Dashboard → Developers → Webhooks, add an endpoint pointed at that URL, subscribed to `payment_intent.succeeded`, `payment_intent.payment_failed`, and `terminal.reader.action_failed`. Copy the webhook's signing secret:
```
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project=maloyhair
```
7. Redeploy functions once more so both secrets are picked up.

### 8. Deploy everything
```
firebase deploy --project=maloyhair
```

### 9. (Optional) Custom domain for the app
In Hosting → `maloyhair-app` site → Add custom domain (e.g. `app.maloy.hair`), separate from the marketing site's domain.
