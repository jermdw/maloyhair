import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { sendMessage, useMessages } from '@/hooks/useMessages'
import { cn } from '@/lib/utils'

interface MessagesThreadProps {
  clientId: string
}

export function MessagesThread({ clientId }: MessagesThreadProps) {
  const { messages, loading } = useMessages(clientId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!draft.trim()) return
    setSending(true)
    try {
      await sendMessage(clientId, draft.trim())
      setDraft('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
        {loading && <p className="text-muted-foreground">Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-muted-foreground">No messages yet.</p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'max-w-[80%] rounded-lg px-3 py-2 text-sm',
              message.direction === 'outbound'
                ? 'self-end bg-primary text-primary-foreground'
                : 'self-start bg-muted text-foreground',
            )}
          >
            {message.body}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
        />
        <Button className="self-end" onClick={handleSend} disabled={sending || !draft.trim()}>
          Send
        </Button>
      </div>
    </div>
  )
}
