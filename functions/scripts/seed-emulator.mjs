#!/usr/bin/env node
// One-time (idempotent, safe to re-run) script: seeds the local Firebase
// emulators with a test owner user + sample data, so the app's UI can be
// built and verified without touching production credentials.
//
// Usage:
//   firebase emulators:start --only auth,firestore,functions --project maloyhair
//   node functions/scripts/seed-emulator.mjs
//
// Points the Admin SDK at the emulator hosts instead of real credentials —
// no gcloud auth or service account key needed for this to work.

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const PROJECT_ID = 'maloyhair'
const TEST_OWNER_EMAIL = 'test-owner@maloyhair.test'
const TEST_OWNER_PASSWORD = 'test-password-123'

initializeApp({ projectId: PROJECT_ID })

const auth = getAuth()
const db = getFirestore()

async function seedOwnerUser() {
  let user
  try {
    user = await auth.getUserByEmail(TEST_OWNER_EMAIL)
  } catch {
    user = await auth.createUser({ email: TEST_OWNER_EMAIL, password: TEST_OWNER_PASSWORD })
  }
  await auth.setCustomUserClaims(user.uid, { owner: true })
  console.log(`Owner test user ready: ${TEST_OWNER_EMAIL} / ${TEST_OWNER_PASSWORD}`)
}

async function seedServices() {
  const services = [
    { name: 'Haircut', durationMinutes: 45, price: 45 },
    { name: 'Color', durationMinutes: 120, price: 150 },
    { name: 'Trim', durationMinutes: 20, price: 25 },
  ]
  const ids = []
  for (const service of services) {
    const ref = await db.collection('services').add(service)
    ids.push(ref.id)
  }
  console.log(`Seeded ${ids.length} services.`)
  return ids
}

async function seedClients() {
  const clients = [
    { name: 'Jane Doe', phone: '+14045551201', email: 'jane@example.com', createdAt: Timestamp.now() },
    { name: 'Sam Rivera', phone: '+14045551202', email: 'sam@example.com', createdAt: Timestamp.now() },
    { name: 'Pat Nguyen', phone: '+14045551203', createdAt: Timestamp.now() },
  ]
  const ids = []
  for (const client of clients) {
    const ref = await db.collection('clients').add(client)
    ids.push(ref.id)
  }
  console.log(`Seeded ${ids.length} clients.`)
  return ids
}

async function seedAppointments(clientIds, serviceIds) {
  const now = Date.now()
  const appointments = [
    {
      clientId: clientIds[0],
      serviceIds: [serviceIds[0]],
      startTime: Timestamp.fromMillis(now + 2 * 24 * 60 * 60 * 1000),
      endTime: Timestamp.fromMillis(now + 2 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
      status: 'booked',
      reminders: { h48: { sent: false, taskName: null }, h2: { sent: false, taskName: null } },
      createdAt: Timestamp.now(),
    },
    {
      clientId: clientIds[1],
      serviceIds: [serviceIds[1]],
      startTime: Timestamp.fromMillis(now - 24 * 60 * 60 * 1000),
      endTime: Timestamp.fromMillis(now - 24 * 60 * 60 * 1000 + 120 * 60 * 1000),
      status: 'completed',
      reminders: { h48: { sent: true, taskName: null }, h2: { sent: true, taskName: null } },
      createdAt: Timestamp.now(),
    },
  ]
  for (const appointment of appointments) {
    await db.collection('appointments').add(appointment)
  }
  console.log(`Seeded ${appointments.length} appointments.`)
}

async function seedSettings() {
  await db.collection('settings').doc('main').set({
    businessName: 'Maloy Hair',
    businessPhone: '+14043941617',
    businessHours: {
      1: { start: '09:00', end: '17:00' },
      2: { start: '09:00', end: '17:00' },
      3: { start: '09:00', end: '17:00' },
      4: { start: '09:00', end: '17:00' },
      5: { start: '09:00', end: '15:00' },
    },
  })
  console.log('Seeded settings.')
}

async function seedMessages(clientIds) {
  const messages = [
    { clientId: clientIds[0], direction: 'inbound', body: 'Can we move to 3pm instead?', read: false, createdAt: Timestamp.now() },
    { clientId: clientIds[0], direction: 'outbound', body: 'Sure, see you at 3pm!', read: true, createdAt: Timestamp.now() },
  ]
  for (const message of messages) {
    await db.collection('messages').add(message)
  }
  console.log(`Seeded ${messages.length} messages.`)
}

const serviceIds = await seedServices()
const clientIds = await seedClients()
await seedAppointments(clientIds, serviceIds)
await seedSettings()
await seedMessages(clientIds)
await seedOwnerUser()

console.log('Emulator seed complete.')
