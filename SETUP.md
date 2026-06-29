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

Note: Firebase Auth itself doesn't let you restrict Google sign-in to one email at the provider level — that's enforced in this app by `firestore.rules` and `functions/src/auth.ts`, both checking for `alexmwarren13@gmail.com`. If she ever needs a different Google account, update the email in both places.

### 2. Get the web app config
In the Firebase console → Project settings → Your apps → add a **Web app** (if one doesn't exist yet), copy the config values into `app/.env.local` (copy from `app/.env.example`).

### 3. Enable Cloud Tasks
```
gcloud services enable cloudtasks.googleapis.com --project=maloyhair
gcloud tasks queues create sms-reminders --location=us-east1 --project=maloyhair
```
The queue name (`sms-reminders`) and location (`us-east1`) must match `functions/src/tasks.ts`.

### 4. Twilio
- Create a [Messaging Service](https://console.twilio.com/us1/develop/sms/services) and add a sender (phone number or alphanumeric sender ID, depending on what your carrier supports).
- Grab your Account SID, Auth Token, and the Messaging Service SID.
- Set them as Firebase secrets (never commit these):
```
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project=maloyhair
firebase functions:secrets:set TWILIO_AUTH_TOKEN --project=maloyhair
firebase functions:secrets:set TWILIO_MESSAGING_SERVICE_SID --project=maloyhair
```

### 5. Deploy functions once, then wire up the reminder URL
```
cd functions && npm run build
firebase deploy --only functions --project=maloyhair
```
Copy the deployed `sendReminder` HTTPS URL from the output, put it in `functions/.env` as `SEND_REMINDER_URL=<url>` (copy from `functions/.env.example`), then redeploy functions so the trigger picks it up.

Do the same for `handleInboundSms`: copy its deployed URL into `functions/.env` as `HANDLE_INBOUND_SMS_URL=<url>`, then redeploy. This value is also used inside the function itself to validate Twilio's request signature, so it must exactly match the URL Twilio is configured to POST to (step 6).

### 6. Wire up the inbound webhook + STOP/HELP
In the [Twilio console](https://console.twilio.com/us1/develop/sms/services) → your Messaging Service → **Integration**:
- Set "A message comes in" to **Webhook**, pointed at the deployed `handleInboundSms` URL, HTTP POST.
- Enable **Advanced Opt-Out** (under the Messaging Service's compliance/opt-out settings) so Twilio auto-handles STOP/START/HELP keywords before they reach our function — no code needed for that path.

### 7. Deploy everything
```
firebase deploy --project=maloyhair
```

### 8. (Optional) Custom domain for the app
In Hosting → `maloyhair-app` site → Add custom domain (e.g. `app.maloy.hair`), separate from the marketing site's domain.
