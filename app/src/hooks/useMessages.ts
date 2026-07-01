import { useEffect, useState } from 'react'
import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { messagesCol } from '@/lib/firestore/converters'
import { functions } from '@/lib/functions'
import type { Message } from '@/types/firestore'

export function useMessages(clientId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(messagesCol(), where('clientId', '==', clientId), orderBy('createdAt'))
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => d.data()))
      setLoading(false)
    })
  }, [clientId])

  return { messages, loading }
}

const sendMessageCallable = httpsCallable<{ clientId: string; body: string }, { success: boolean }>(
  functions,
  'sendMessage',
)

export async function sendMessage(clientId: string, body: string) {
  await sendMessageCallable({ clientId, body })
}
