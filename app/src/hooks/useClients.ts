import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { clientsCol } from '@/lib/firestore/converters'
import { normalizePhone } from '@/lib/phone'
import type { Client } from '@/types/firestore'

export function useClients() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(clientsCol(), orderBy('name'))
    return onSnapshot(q, (snap) => {
      setClients(snap.docs.map((d) => d.data()))
      setLoading(false)
    })
  }, [])

  return { clients, loading }
}

export interface ClientInput {
  name: string
  phone: string
  email?: string
  notes?: string
}

/** Throws if the phone number doesn't reduce to a valid US E.164 number. */
export async function createClient(input: ClientInput) {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new Error('Invalid phone number')

  await addDoc(collection(db, 'clients'), {
    name: input.name,
    phone,
    email: input.email,
    notes: input.notes,
    createdAt: serverTimestamp(),
  })
}

export async function updateClient(id: string, patch: Partial<ClientInput>) {
  const data: Record<string, unknown> = { ...patch }
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone)
    if (!phone) throw new Error('Invalid phone number')
    data.phone = phone
  }
  await updateDoc(doc(db, 'clients', id), data)
}

export async function deleteClient(id: string) {
  await deleteDoc(doc(db, 'clients', id))
}
