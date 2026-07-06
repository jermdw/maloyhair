import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { appointmentsCol } from '@/lib/firestore/converters'
import type { Appointment, AppointmentStatus } from '@/types/firestore'

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
  /** Sum of the selected services' durationMinutes, used to compute endTime. */
  durationMinutes: number
  notes?: string
}

export async function createAppointment(input: AppointmentCreateInput) {
  const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000)

  await addDoc(collection(db, 'appointments'), {
    clientId: input.clientId,
    serviceIds: input.serviceIds,
    startTime: Timestamp.fromDate(input.startTime),
    endTime: Timestamp.fromDate(endTime),
    status: 'booked' as AppointmentStatus,
    notes: input.notes,
    reminders: {
      h48: { sent: false, taskName: null },
      h2: { sent: false, taskName: null },
    },
    createdAt: serverTimestamp(),
  })
}

export interface AppointmentUpdateInput {
  clientId?: string
  serviceIds?: string[]
  startTime?: Date
  /** Required alongside startTime (or when serviceIds changes) to recompute endTime. */
  durationMinutes?: number
  status?: AppointmentStatus
  notes?: string
}

export async function updateAppointment(id: string, patch: AppointmentUpdateInput) {
  const data: Record<string, unknown> = {}
  if (patch.clientId !== undefined) data.clientId = patch.clientId
  if (patch.serviceIds !== undefined) data.serviceIds = patch.serviceIds
  if (patch.status !== undefined) data.status = patch.status
  if (patch.notes !== undefined) data.notes = patch.notes
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
