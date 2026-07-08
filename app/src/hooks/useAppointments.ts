import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { appointmentsCol } from '@/lib/firestore/converters'
import type { Appointment, AppointmentStatus } from '@/types/firestore'

export interface SegmentInput {
  startTime: Date
  endTime: Date
  label: string
}

function toSegmentFields(segments: SegmentInput[]) {
  return segments.map((s) => ({
    startTime: Timestamp.fromDate(s.startTime),
    endTime: Timestamp.fromDate(s.endTime),
    label: s.label,
  }))
}

export function useAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(appointmentsCol(), orderBy('startTime'))
    return onSnapshot(q, (snap) => {
      setAppointments(snap.docs.map((d) => d.data()))
      setLoading(false)
    })
  }, [])

  return { appointments, loading }
}

export interface AppointmentCreateInput {
  clientId: string
  serviceIds: string[]
  startTime: Date
  /** Total span from startTime to endTime, in minutes — for a segmented appointment this
   *  includes the gap, since it's a single continuous booking on the calendar's timeline. */
  durationMinutes: number
  notes?: string
  /** Exactly 2 (Setup, Finish) when the service has a processing gap. Omit for a normal,
   *  single-block appointment. */
  segments?: SegmentInput[]
}

export async function createAppointment(input: AppointmentCreateInput) {
  const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000)

  await addDoc(collection(db, 'appointments'), {
    clientId: input.clientId,
    serviceIds: input.serviceIds,
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(endTime),
    ...(input.segments ? { segments: toSegmentFields(input.segments) } : {}),
    status: 'booked' as AppointmentStatus,
    notes: input.notes,
    reminders: {
      d3: { sent: false },
      d1: { sent: false },
    },
    createdAt: serverTimestamp(),
  })
}

export interface AppointmentUpdateInput {
  clientId?: string
  serviceIds?: string[]
  startTime?: Date
  /** Required alongside startTime (or when serviceIds/segments changes) to recompute endTime. */
  durationMinutes?: number
  status?: AppointmentStatus
  notes?: string
  /** Pass an array to set/replace segments, or null to remove them (going back to a normal
   *  single-block appointment). Omit entirely to leave segments untouched. */
  segments?: SegmentInput[] | null
}

export async function updateAppointment(id: string, patch: AppointmentUpdateInput) {
  const data: Record<string, unknown> = {}
  if (patch.clientId !== undefined) data.clientId = patch.clientId
  if (patch.serviceIds !== undefined) data.serviceIds = patch.serviceIds
  if (patch.status !== undefined) data.status = patch.status
  if (patch.notes !== undefined) data.notes = patch.notes
  if (patch.segments !== undefined) {
    data.segments = patch.segments === null ? deleteField() : toSegmentFields(patch.segments)
  }
  if (patch.startTime !== undefined) {
    data.startTime = Timestamp.fromDate(patch.startTime)
    if (patch.durationMinutes !== undefined) {
      data.endTime = Timestamp.fromDate(new Date(patch.startTime.getTime() + patch.durationMinutes * 60_000))
    }
  }
  await updateDoc(doc(db, 'appointments', id), data)
}

export async function deleteAppointment(id: string) {
  await deleteDoc(doc(db, 'appointments', id))
}

export interface TimeBlockInput {
  label: string
  startTime: Date
  endTime: Date
}

/** Blocks share /appointments (same calendar query, same rules) but carry type: 'block',
 *  a label instead of client/services, and no reminders — the daily reminder sweep and the
 *  reschedule trigger both skip them explicitly. Status is fixed at 'booked' so date-range
 *  views that filter on active statuses naturally include them as occupied time. */
export async function createTimeBlock(input: TimeBlockInput) {
  await addDoc(collection(db, 'appointments'), {
    type: 'block',
    label: input.label,
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(input.endTime),
    status: 'booked' as AppointmentStatus,
    createdAt: serverTimestamp(),
  })
}

export async function updateTimeBlock(id: string, input: TimeBlockInput) {
  await updateDoc(doc(db, 'appointments', id), {
    label: input.label,
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(input.endTime),
  })
}
