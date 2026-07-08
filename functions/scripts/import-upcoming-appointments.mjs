#!/usr/bin/env node
// One-time (idempotent, safe to re-run) script: imports DaySmart's still-open
// (and recently-closed) appointments into the LIVE /appointments collection —
// unlike import-service-history.mjs, these become real bookings the app's
// reminder/payment system will act on, so it needs correct /clients and
// /services references, not just denormalized text.
//
// What it does:
//   1. Reads a TSV with columns: legacy_appt_id, status, client_name,
//      client_phone, date, start_time, end_time, consolidated_service,
//      addons_included, duration_minutes, raw_service_text
//      (produced by mapping DaySmart's raw Appointment List service text
//      onto the salon's consolidated menu — see MAPPING NOTES below)
//   2. Matches/creates /clients docs by normalized E.164 phone (same as
//      import-service-history.mjs).
//   3. Matches /services docs by exact name (consolidated_service, plus one
//      per addon in addons_included) — FAILS LOUD if a service name isn't
//      found in production, rather than guessing, since a wrong duration
//      can double-book the calendar.
//   4. Writes one /appointments doc per row, keyed by a deterministic ID
//      (legacy-appt-<legacy_appt_id>) so re-running never duplicates.
//
// Status mapping: DaySmart "Open" -> booked, "Closed" -> completed (with a
// best-effort payment record — amount/method only, no real Stripe
// paymentIntentId since it was charged through DaySmart, not Stripe),
// "Canceled" -> cancelled.
//
// MAPPING NOTES (for review before running):
// DaySmart's Appointment List shows raw per-ticket text ("Color and
// Haircut", "family color", etc.) instead of the cleaned-up consolidated
// menu names. Each raw phrase below was mapped by matching it against the
// same salon's already-resolved historical export (Maloy_Hair_Client_
// Service_History.tsv's legacy_service_description -> consolidated_service
// mapping) — i.e. reusing precedent this business already established,
// not a fresh guess. Spot-check a few against the app before trusting it
// for the full run:
//   Color and Blow Dry              -> All-Over Color + Blow Dry add-on
//   Color and Haircut               -> All-Over Color + Haircut add-on
//   Color mini Highlight and Haircut -> Partial Highlight + Haircut add-on
//   Color mini highlight and blow dry -> Partial Highlight + Blow Dry add-on
//   Color, Partial Highlight, and Blow Dry -> Partial Highlight + Blow Dry add-on
//   Color, Partial Highlight, and Cut -> Partial Highlight + Haircut add-on
//   Full Highlight and Haircut      -> Full Highlight + Haircut add-on
//   Full head balayage and Haircut  -> Balayage + Haircut add-on
//   On scalp bleach and Haircut     -> Bleach & Tone (on-scalp) + Haircut add-on
//   Partial Highlight and Blow Dry  -> Partial Highlight + Blow Dry add-on
//   Partial Highlight and haircut   -> Partial Highlight + Haircut add-on
//   family color                    -> All-Over Color (no add-on)
//   Color Fullhead Highlight Leave Wet / Full Head Highlight. Leave Wet -> Full Highlight (no add-on)
//   Mini Highlight leave wet / color leave wet -> Partial Highlight or All-Over Color (no add-on)
//   Everything else (Bang Trim, Kids/Men's/Women's Haircut, Glaze and
//   Haircut, Child's Haircut) matched the menu or history directly.
//
// NOT included in this TSV / this script: 19 DaySmart "Time Block" entries
// (things like "Cruise", "Auburn weekend", "ALEXIS WEDDING WEEKEND!") —
// those are Alexandria's personal unavailability, not client appointments.
// The app's Appointment schema has no generic block-time concept; add
// full-day ones to Settings.closedDates by hand, or extend the schema if
// partial-day blocking matters.
//
// Usage:
//   node functions/scripts/import-upcoming-appointments.mjs <path-to-tsv> --project=maloyhair [--dry-run]
//
// Same credential requirements as import-service-history.mjs (Application
// Default Credentials with access to the project).

import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const tsvPath = args.find((arg) => !arg.startsWith('--'))
const projectArg = args.find((arg) => arg.startsWith('--project='))
const projectId = projectArg?.split('=')[1]
const dryRun = args.includes('--dry-run')

if (!tsvPath || !projectId) {
  console.error('Usage: node import-upcoming-appointments.mjs <path-to-tsv> --project=<firebase-project-id> [--dry-run]')
  process.exit(1)
}

/** Mirrors app/src/lib/phone.ts normalizePhone() exactly. */
function normalizePhone(input) {
  let digits = (input || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return null
  return `+1${digits}`
}

const STATUS_MAP = { Open: 'booked', Closed: 'completed', Canceled: 'cancelled' }

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

/** date "MM/DD/YYYY" + time "HH:mm" (24h) -> Timestamp, assuming America/New_York local time. */
function toTimestamp(date, time) {
  const [month, day, year] = date.split('/').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  // Construct as a naive local Date; Cloud Functions/Admin SDK store this as
  // an absolute instant, so this is only correct if the machine running the
  // script is in America/New_York (same as the salon) — verify TZ before a
  // real run, e.g. `TZ=America/New_York node import-upcoming-appointments.mjs ...`.
  return Timestamp.fromDate(new Date(year, month - 1, day, hour, minute))
}

async function main() {
  const text = readFileSync(tsvPath, 'utf8')
  const rows = parseTsv(text)
  console.log(`Read ${rows.length} rows from ${tsvPath}.`)

  initializeApp({ projectId })
  const db = getFirestore()

  // --- Load existing /services, indexed by exact name ----------------------
  const servicesSnap = await db.collection('services').get()
  const serviceIdByName = new Map()
  servicesSnap.forEach((doc) => serviceIdByName.set(doc.data().name, doc.id))
  console.log(`Loaded ${serviceIdByName.size} existing services.`)

  const missingServiceNames = new Set()
  for (const row of rows) {
    if (!serviceIdByName.has(row.consolidated_service)) missingServiceNames.add(row.consolidated_service)
    for (const addon of row.addons_included.split(';').map((a) => a.trim()).filter(Boolean)) {
      const addonName = `+ ${addon} Add-On`
      if (!serviceIdByName.has(addonName)) missingServiceNames.add(addonName)
    }
  }
  if (missingServiceNames.size > 0) {
    console.error('ABORTING — these service names are not found in production /services (create them first, or fix the name mismatch):')
    missingServiceNames.forEach((n) => console.error(`  - "${n}"`))
    process.exit(1)
  }

  // --- Match/create /clients by phone, same as import-service-history.mjs -
  const existingClientsSnap = await db.collection('clients').get()
  const clientsByPhone = new Map()
  existingClientsSnap.forEach((doc) => {
    const phone = doc.data().phone
    if (phone) clientsByPhone.set(phone, doc.id)
  })
  console.log(`Loaded ${clientsByPhone.size} existing clients.`)

  const uniqueClients = new Map() // name+phone -> firestore id (once resolved)
  let clientsCreated = 0
  let clientsSkippedNoPhone = 0

  async function resolveClientId(name, rawPhone) {
    const cacheKey = `${name}|${rawPhone}`
    if (uniqueClients.has(cacheKey)) return uniqueClients.get(cacheKey)

    const e164 = normalizePhone(rawPhone)
    if (!e164) {
      clientsSkippedNoPhone++
      return null
    }
    let id = clientsByPhone.get(e164)
    if (!id) {
      if (dryRun) {
        id = `DRY_RUN_${cacheKey}`
      } else {
        const ref = await db.collection('clients').add({ name, phone: e164, createdAt: Timestamp.now() })
        id = ref.id
        clientsByPhone.set(e164, id)
      }
      clientsCreated++
    }
    uniqueClients.set(cacheKey, id)
    return id
  }

  // --- Write /appointments --------------------------------------------------
  let written = 0
  let skippedNoClient = 0
  let skippedBadStatus = 0

  for (const row of rows) {
    const clientId = await resolveClientId(row.client_name, row.client_phone)
    if (!clientId) {
      console.warn(`  ! Skipping appt ${row.legacy_appt_id} (${row.client_name}) — no valid phone to match/create a client.`)
      skippedNoClient++
      continue
    }

    const status = STATUS_MAP[row.status]
    if (!status) {
      console.warn(`  ! Skipping appt ${row.legacy_appt_id} — unrecognized status "${row.status}".`)
      skippedBadStatus++
      continue
    }

    const serviceIds = [serviceIdByName.get(row.consolidated_service)]
    for (const addon of row.addons_included.split(';').map((a) => a.trim()).filter(Boolean)) {
      serviceIds.push(serviceIdByName.get(`+ ${addon} Add-On`))
    }

    const data = {
      clientId,
      serviceIds,
      startTime: toTimestamp(row.date, row.start_time),
      endTime: toTimestamp(row.date, row.end_time),
      status,
      reminders: {
        d3: { sent: status !== 'booked' },
        d1: { sent: status !== 'booked' },
      },
      createdAt: Timestamp.now(),
    }

    if (status === 'completed') {
      const amountCents = Math.round(parseFloat(row.total || '0') * 100)
      if (amountCents > 0) {
        data.payment = { status: 'paid', amount: amountCents, method: 'card', updatedAt: Timestamp.now() }
      }
    }

    const docId = `legacy-appt-${row.legacy_appt_id}`
    if (dryRun) {
      written++
      continue
    }
    await db.collection('appointments').doc(docId).set(data)
    written++
  }

  console.log(`\nAppointments: ${written} written, ${skippedNoClient} skipped (no client), ${skippedBadStatus} skipped (bad status).`)
  console.log(`Clients: ${clientsCreated} created, ${clientsSkippedNoPhone} rows skipped (no valid phone).`)
  if (dryRun) console.log('(dry run — nothing was actually written)')
}

main().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
