import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, orderBy, query, where, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '@/lib/firebase'
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

export interface Conversation {
  clientId: string
  lastMessage: Message
  unreadCount: number
}

/** One row per client, most-recently-active first — powers the Messages inbox. */
export function useConversations() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(messagesCol(), orderBy('createdAt', 'desc'))
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => d.data()))
      setLoading(false)
    })
  }, [])

  const conversations = useMemo(() => {
    const byClient = new Map<string, Conversation>()
    for (const message of messages) {
      const unread = message.direction === 'inbound' && !message.read ? 1 : 0
      const existing = byClient.get(message.clientId)
      if (!existing) {
        byClient.set(message.clientId, { clientId: message.clientId, lastMessage: message, unreadCount: unread })
      } else {
        existing.unreadCount += unread
      }
    }
    return [...byClient.values()]
  }, [messages])

  const unreadTotal = useMemo(() => conversations.reduce((sum, c) => sum + c.unreadCount, 0), [conversations])

  return { conversations, unreadTotal, loading }
}

/** Marks any unread inbound messages already loaded (e.g. by useMessages) as read. */
export async function markThreadRead(messages: Message[]) {
  const unread = messages.filter((m) => m.direction === 'inbound' && !m.read)
  if (unread.length === 0) return

  const batch = writeBatch(db)
  for (const message of unread) {
    batch.update(doc(db, 'messages', message.id), { read: true })
  }
  await batch.commit()
}

const sendMessageCallable = httpsCallable<{ clientId: string; body: string }, { success: boolean }>(
  functions,
  'sendMessage',
)

export async function sendMessage(clientId: string, body: string) {
  await sendMessageCallable({ clientId, body })
}
