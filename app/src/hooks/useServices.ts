import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { servicesCol } from '@/lib/firestore/converters'
import type { Service } from '@/types/firestore'

export function useServices() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(servicesCol(), orderBy('name'))
    return onSnapshot(q, (snap) => {
      setServices(snap.docs.map((d) => d.data()))
      setLoading(false)
    })
  }, [])

  return { services, loading }
}

export interface ServiceInput {
  name: string
  durationMinutes: number
  price: number
}

export async function createService(input: ServiceInput) {
  await addDoc(collection(db, 'services'), input)
}

export async function updateService(id: string, patch: Partial<ServiceInput>) {
  await updateDoc(doc(db, 'services', id), patch)
}

export async function deleteService(id: string) {
  await deleteDoc(doc(db, 'services', id))
}
