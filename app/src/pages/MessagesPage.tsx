import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConversations } from '@/hooks/useMessages'
import { useClients } from '@/hooks/useClients'

export function MessagesPage() {
  const { conversations, loading } = useConversations()
  const { clients } = useClients()

  const clientsById = new Map(clients.map((c) => [c.id, c]))

  const sorted = [...conversations].sort(
    (a, b) => b.lastMessage.createdAt.toMillis() - a.lastMessage.createdAt.toMillis(),
  )

  return (
    <div>
      <h1 className="mb-4 font-heading text-2xl">Messages</h1>

      {!loading && sorted.length === 0 && <p className="text-muted-foreground">No conversations yet.</p>}

      {sorted.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Last message</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((conversation) => {
              const client = clientsById.get(conversation.clientId)
              return (
                <TableRow key={conversation.clientId}>
                  <TableCell>
                    <Link
                      to={`/clients/${conversation.clientId}?tab=messages`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      {conversation.unreadCount > 0 && (
                        <span className="inline-block h-2 w-2 rounded-full bg-ring" aria-label="Unread" />
                      )}
                      <span className={conversation.unreadCount > 0 ? 'font-semibold' : undefined}>
                        {client?.name ?? 'Unknown client'}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {conversation.lastMessage.direction === 'outbound' && 'You: '}
                    {conversation.lastMessage.body}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDistanceToNow(conversation.lastMessage.createdAt.toDate(), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
