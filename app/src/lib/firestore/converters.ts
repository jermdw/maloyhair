import {
  collection,
  doc,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Client, Service, Appointment, Settings, Message } from '@/types/firestore'

function withIdConverter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: T) {
      const { id: _id, ...rest } = data
      return rest
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions) {
      return { id: snapshot.id, ...snapshot.data(options) } as T
    },
  }
}

export const clientConverter = withIdConverter<Client>()
export const serviceConverter = withIdConverter<Service>()
export const appointmentConverter = withIdConverter<Appointment>()
export const messageConverter = withIdConverter<Message>()

export const settingsConverter: FirestoreDataConverter<Settings> = {
  toFirestore(data: Settings) {
    return data
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions) {
    return snapshot.data(options) as Settings
  },
}

export const clientsCol = () => collection(db, 'clients').withConverter(clientConverter)
export const servicesCol = () => collection(db, 'services').withConverter(serviceConverter)
export const appointmentsCol = () => collection(db, 'appointments').withConverter(appointmentConverter)
export const messagesCol = () => collection(db, 'messages').withConverter(messageConverter)

/** Settings is a single fixed document — there is only ever one business to configure. */
export const settingsDoc = () => doc(db, 'settings', 'main').withConverter(settingsConverter)
