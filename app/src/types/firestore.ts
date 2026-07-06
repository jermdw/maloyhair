import type { Timestamp } from 'firebase/firestore'

/** Phone numbers are always stored E.164 (e.g. "+14045551234") so they can be passed straight to Twilio. */
export type E164Phone = string

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'

export interface Client {
  id: string
  name: string
  phone: E164Phone
  email?: string
  notes?: string
  createdAt: Timestamp
}

export interface Service {
  id: string
  name: string
  durationMinutes: number
  price: number
}

/**
 * Tracks one scheduled Cloud Task per reminder. `taskName` is the full Cloud Tasks
 * task resource name, stored so the task can be deleted if the appointment is
 * rescheduled or cancelled before it fires.
 */
export interface ReminderState {
  sent: boolean
  taskName: string | null
}

export type PaymentStatus = 'unpaid' | 'processing' | 'paid' | 'failed' | 'cancelled'

/** Tracks a Stripe Terminal checkout charge, separate from the appointment's scheduling `status`. */
export interface AppointmentPayment {
  status: PaymentStatus
  /** Cents. Total amount charged, including any tip the client added on the reader. */
  amount: number
  /** Cents. Portion of `amount` that was a tip, reported by Stripe once paid. */
  tipAmount?: number
  paymentIntentId?: string
  updatedAt: Timestamp
}

export interface Appointment {
  id: string
  clientId: string
  serviceId: string
  startTime: Timestamp
  endTime: Timestamp
  status: AppointmentStatus
  notes?: string
  reminders: {
    h48: ReminderState
    h2: ReminderState
  }
  payment?: AppointmentPayment
  createdAt: Timestamp
}

export interface BusinessHours {
  /** 0 = Sunday ... 6 = Saturday. Closed days are omitted. */
  [dayOfWeek: number]: { start: string; end: string } // "HH:mm" 24-hour
}

export interface Settings {
  businessName: string
  businessPhone: E164Phone
  businessHours: BusinessHours
  /** Stripe Terminal reader ID (tmr_...), registered one-time via the Stripe Dashboard. */
  stripeReaderId?: string
  /** One-off closed dates (holidays, vacation days), as "YYYY-MM-DD". Checked by recurring
   *  appointment generation in addition to the weekly businessHours. */
  closedDates?: string[]
}

/** Read-only reference data imported from the salon's prior DaySmart history. Never
 *  written by the app itself, and deliberately kept out of /appointments — see import notes. */
export interface ServiceHistoryEntry {
  id: string
  clientId: string
  clientName: string
  serviceName: string
  date: string // "YYYY-MM-DD"
  startTime: string // "HH:mm"
  endTime: string
  /** Cents. */
  amount: number
  addonsIncluded?: string
  legacyTicketId: string
  legacyServiceId: string
  legacyDescription: string
}

export type MessageDirection = 'inbound' | 'outbound'

export interface Message {
  id: string
  clientId: string
  direction: MessageDirection
  body: string
  /** Whether the owner has seen this message. Outbound messages are always read (she sent it). */
  read: boolean
  createdAt: Timestamp
}
