#!/usr/bin/env node
// One-time (idempotent, safe to re-run) script: imports DaySmart's historical
// service records into Firestore's read-only `/serviceHistory` collection
// (see app/src/types/firestore.ts's ServiceHistoryEntry and firestore.rules —
// this collection is deliberately separate from /appointments and never
// written by the live app).
//
// What it does:
//   1. Reads a TSV export with columns: client_uuid, client_name, client_phone,
//      service_date, start_time, end_time, consolidated_service,
//      addons_included, amount, legacy_ticket_id, legacy_service_id,
//      legacy_service_description
//   2. For each unique client (by normalized E.164 phone), matches an existing
//      /clients doc or creates a new one.
//   3. Writes one /serviceHistory doc per TSV row, keyed by a deterministic ID
//      derived from (legacy_ticket_id, legacy_service_id) so re-running this
//      script never creates duplicates — it just overwrites the same docs.
//
// Usage:
//   node functions/scripts/import-service-history.mjs <path-to-tsv> --project=maloyhair [--dry-run]
//
// Against the local emulator instead of production, first run:
//   firebase emulators:start --only auth,firestore --project maloyhair
// then in another terminal:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node functions/scripts/import-service-history.mjs <path> --project=maloyhair
//
// Against production, this needs Application Default Credentials with access
// to the project (e.g. `gcloud auth application-default login`, or run from
// an environment already authenticated via the Firebase CLI) — same
// requirement as grant-owner-claim.mjs.

import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const tsvPath = args.find((arg) => !arg.startsWith('--'))
const projectArg = args.find((arg) => arg.startsWith('--project='))
const projectId = projectArg?.split('=')[1]
const dryRun = args.includes('--dry-run')

if (!tsvPath || !projectId) {
  console.error('Usage: node import-service-history.mjs <path-to-tsv> --project=<firebase-project-id> [--dry-run]')
  process.exit(1)
}

/** Mirrors app/src/lib/phone.ts normalizePhone() exactly — kept in sync by hand
 *  since this script runs standalone outside the app's Vite/TS build. */
function normalizePhone(input) {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return null
  return `+1${digits}`
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  const header = lines[0].split('\t')
  return lines.slice(1).map((line) => {
    const cells = line.split('\t')
    const row = {}
    header.forEach((key, i) => {
      row[key] = cells[i] ?? ''
    })
    return row
  })
}

async function main() {
  const text = readFileSync(tsvPath, 'utf8')
  const rows = parseTsv(text)
  console.log(`Read ${rows.length} rows from ${tsvPath}.`)

  initializeApp({ projectId })
  const db = getFirestore()

  // --- Pass 1: build client_uuid -> Firestore clientId map ---------------
  const uniqueTsvClients = new Map() // client_uuid -> { name, phone }
  for (const row of rows) {
    if (!uniqueTsvClients.has(row.client_uuid)) {
      uniqueTsvClients.set(row.client_uuid, { name: row.client_name, phone: row.client_phone })
    }
  }
  console.log(`Found ${uniqueTsvClients.size} unique clients in the TSV.`)

  // Fetch all existing clients once and index by normalized phone, since the
  // production /clients collection already has real entries this must match
  // against rather than blindly duplicate.
  const existingClientsSnap = await db.collection('clients').get()
  const clientsByPhone = new Map() // e164 -> clientId
  existingClientsSnap.forEach((doc) => {
    const phone = doc.data().phone
    if (phone) clientsByPhone.set(phone, doc.id)
  })
  console.log(`Loaded ${clientsByPhone.size} existing clients from production for matching.`)

  const tsvClientIdToFirestoreId = new Map()
  let matched = 0
  let created = 0
  let skippedBadPhone = 0

  for (const [tsvClientId, { name, phone }] of uniqueTsvClients) {
    const e164 = normalizePhone(phone)
    if (!e164) {
      console.warn(`  ! Skipping client "${name}" (${phone}) — phone doesn't reduce to a valid US number.`)
      skippedBadPhone++
      continue
    }

    const existingId = clientsByPhone.get(e164)
    if (existingId) {
      tsvClientIdToFirestoreId.set(tsvClientId, existingId)
      matched++
      continue
    }

    if (dryRun) {
      console.log(`  [dry-run] would create client: ${name} (${e164})`)
      tsvClientIdToFirestoreId.set(tsvClientId, `DRY_RUN_${tsvClientId}`)
      created++
      continue
    }

    const ref = await db.collection('clients').add({
      name,
      phone: e164,
      createdAt: Timestamp.now(),
    })
    clientsByPhone.set(e164, ref.id)
    tsvClientIdToFirestoreId.set(tsvClientId, ref.id)
    created++
  }

  console.log(`Clients: ${matched} matched to existing, ${created} created, ${skippedBadPhone} skipped (bad phone).`)

  // --- Pass 2: write /serviceHistory docs, deduped by ticket+service ------
  const seenDocIds = new Set()
  let written = 0
  let skippedNoClient = 0
  let dedupedDuplicateRows = 0

  for (const row of rows) {
    const clientId = tsvClientIdToFirestoreId.get(row.client_uuid)
    if (!clientId) {
      skippedNoClient++
      continue
    }

    let docId = `legacy-${row.legacy_ticket_id}-${row.legacy_service_id}`
    if (seenDocIds.has(docId)) {
      // Genuine duplicate rows in the source export (same ticket+service
      // appearing twice) collapse onto the same doc — this is intentional
      // dedup, not data loss (verified: content is identical for the one
      // known case, DaySmart ticket 5759).
      dedupedDuplicateRows++
      continue
    }
    seenDocIds.add(docId)

    const amountCents = Math.round(parseFloat(row.amount) * 100)

    const data = {
      clientId,
      clientName: row.client_name,
      serviceName: row.consolidated_service,
      date: row.service_date,
      startTime: row.start_time,
      endTime: row.end_time,
      amount: amountCents,
      legacyTicketId: row.legacy_ticket_id,
      legacyServiceId: row.legacy_service_id,
      legacyDescription: row.legacy_service_description,
    }
    if (row.addons_included) data.addonsIncluded = row.addons_included

    if (dryRun) {
      written++
      continue
    }

    await db.collection('serviceHistory').doc(docId).set(data)
    written++
  }

  console.log(`ServiceHistory: ${written} docs written, ${skippedNoClient} skipped (no client match), ${dedupedDuplicateRows} deduped duplicate rows.`)
  if (dryRun) console.log('(dry run — nothing was actually written)')
}

main().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
