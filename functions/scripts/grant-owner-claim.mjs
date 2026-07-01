#!/usr/bin/env node
// One-time script: grants the `owner: true` custom claim to a Firebase Auth
// user, which firestore.rules and functions/src/auth.ts both check.
//
// Usage:
//   node functions/scripts/grant-owner-claim.mjs <email> --project=maloyhair
//
// Requires application-default credentials with access to the project
// (e.g. `gcloud auth application-default login` or run from an environment
// already authenticated via the Firebase CLI).
//
// The claim takes effect the next time the user signs in or their ID token
// refreshes (tokens refresh automatically at least once per hour).

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const email = process.argv[2]
const projectArg = process.argv.find((arg) => arg.startsWith('--project='))
const projectId = projectArg?.split('=')[1]

if (!email || !projectId) {
  console.error('Usage: node grant-owner-claim.mjs <email> --project=<firebase-project-id>')
  process.exit(1)
}

initializeApp({ projectId })

const auth = getAuth()
const user = await auth.getUserByEmail(email)
await auth.setCustomUserClaims(user.uid, { owner: true })

console.log(`Granted owner claim to ${email} (uid: ${user.uid}) on project ${projectId}.`)
