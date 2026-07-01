# Maloy Hair

Two-part Firebase project for Alex Warren's hair salon business (operates as "Maloy Hair" — Maloy is her maiden name, used only in the `alex@maloy.hair` email; she goes by Alex Warren).

1. **Marketing site** (`/public`) — static HTML/CSS, live at https://maloy.hair
2. **Booking app** (`/app`) — React/Vite/Tailwind/shadcn client + Cloud Functions backend, for Alex's own appointment management (single-user, not client-facing)

Business location: Tilted Halo salon studio, 113 Lexington Circle, Peachtree City, GA 30269. Phone: (404) 394-1617.

## Why this project exists

Originally built to fix a rejected Twilio A2P 10DLC campaign registration (carriers require a real privacy policy, terms page, and visible business description before approving SMS sending). That grew into a full booking app with automated SMS appointment reminders via Twilio.

## Repo layout

```
public/          Static marketing site (deployed as Firebase Hosting target "site")
  index.html       Homepage — business description, contact, phone
  privacy.html     Privacy policy (required for Twilio A2P registration)
  terms.html       SMS terms & opt-in/opt-out language (required for Twilio A2P registration)
  style.css        Shared theme (light beige/brown/sage, see Design system below)
  legal.css        Styling for privacy/terms pages

app/             React booking app (deployed as Firebase Hosting target "app")
  src/components/   UI components (shadcn/ui based)
  src/lib/          Firebase client init, helpers
  Stack: Vite + React 19 + Tailwind v4 + shadcn/ui + react-big-calendar + react-router-dom

functions/       Cloud Functions v2 (Node 20, TypeScript)
  src/auth.ts       Restricts access to the single owner Google account
  src/reminders.ts  Appointment reminder scheduling logic
  src/tasks.ts      Cloud Tasks queue wiring (queue: sms-reminders, region: us-east1)
  src/inbound.ts    Inbound SMS webhook — handles C/X replies, signature validation
  src/secrets.ts    Firebase secret bindings (Twilio credentials)
  src/index.ts      Function exports

firestore.rules         Locked to single owner email (alexmwarren13@gmail.com)
firestore.indexes.json
.firebaserc              Hosting targets: "site" -> maloyhair, "app" -> maloyhair-app
firebase.json             public/ -> target site, app/dist -> target app (SPA rewrite)
SETUP.md                  One-time manual setup steps (Firebase Auth, Twilio, secrets, Cloud Tasks)
```

## Single-owner security model

This app has exactly one real user: Alex. Both `firestore.rules` and `functions/src/auth.ts` independently check `request.auth.token.email == 'alexmwarren13@gmail.com'`. This is enforced server-side via the verified Google OAuth token claim, not a client-side gate. **If her Google account ever changes, update the email in both places** — they don't share a single source of truth.

## Deploys (GitHub Actions)

Two independent workflows, each scoped to its own path so a change to one half never redeploys the other:

- `.github/workflows/deploy-site.yml` — triggers on `public/**` pushes to `main`, deploys Hosting target `site`. Uses `continue-on-error: true` on the deploy step plus a separate `curl https://maloy.hair` HTTP-200 check as the real pass/fail gate.
- `.github/workflows/deploy-app.yml` — triggers on `app/**` pushes to `main`, runs `npm ci && npm run build` in `app/`, deploys Hosting target `app`.

Both use secret `FIREBASE_SERVICE_ACCOUNT_MALOYHAIR`.

**Known Firebase Hosting quirk:** deploying byte-identical content to what's already live returns an HTTP 400 "is the current active version" error in the Action. This is a benign no-op, not a real failure — it happens when a manual `firebase deploy` already pushed the same content before CI ran. Always verify via the live `curl` check (or just `curl -s https://maloy.hair`) rather than trusting the Action's red/green status alone.

## Design system (public/ site)

- Colors: light beige/cream background (`--ground: #F4EEE4`), espresso-brown text (`--text: #2E1B0E`), sage-green accent (`--accent: #6B8C42`)
- Fonts: Bodoni Moda (serif, brand name) + Barlow Condensed (small-caps labels) + Lato (body paragraphs, chosen for legibility over the original condensed font)
- Mobile breakpoint at `max-width: 500px` in both `style.css` and `legal.css`

## Local preview

`.claude/launch.json` defines a `site` config: `npx serve public` on port 3000 (autoPort enabled) — use Claude Code's preview tools against this for static-site changes, not the booking app (which needs `npm run dev` in `app/` plus Firebase emulators for a real backend).

## Twilio A2P 10DLC context

- Brand Registration: `BNd6af1fe6f63bc6f0435b238b0ac37962`
- Campaign: `CM0c3b30364f77b1d7a63f652c4d153a06` (use case: LOW_VOLUME)
- Messaging Service: `MGf7e5de851d04d22c11a15d1f896e055c`
- The Twilio Console campaign submission itself (Description / opt-in message text) is managed directly by Alex/Jeremy in the console — not something this repo automates. The repo's job is making sure the *evidence* (privacy policy, terms, visible business description, real opt-in flow) actually exists and is live at maloy.hair to back up whatever is submitted.
- Enable **Advanced Opt-Out** on the Messaging Service so Twilio handles STOP/START/HELP automatically before hitting `handleInboundSms`.

## Setup steps not yet automated

See [SETUP.md](SETUP.md) for the manual console/CLI steps still required (Firebase Auth provider, web app config, Cloud Tasks queue creation, Twilio secrets, webhook wiring). These require credentials that can't be scripted from this repo.
