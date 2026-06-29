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
}
