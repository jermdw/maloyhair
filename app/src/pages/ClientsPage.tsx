import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ClientDialog } from '@/components/ClientDialog'
import { deleteClient, useClients } from '@/hooks/useClients'
import { formatPhoneDisplay } from '@/lib/phone'
import type { Client } from '@/types/firestore'

const PAGE_SIZE = 10

export function ClientsPage() {
  const { clients } = useClients()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return clients
    return clients.filter(
      (c) => c.name.toLowerCase().includes(term) || c.phone.includes(term) || formatPhoneDisplay(c.phone).includes(term),
    )
  }, [clients, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  async function handleDelete(client: Client) {
    try {
      await deleteClient(client.id)
      toast.success('Client deleted.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete client.')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Clients</h1>
        <Button
          onClick={() => {
            setEditingClient(null)
            setDialogOpen(true)
          }}
        >
          Add client
        </Button>
      </div>

      <Input
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(0)
        }}
        className="mb-4 max-w-sm"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map((client) => (
            <TableRow key={client.id}>
              <TableCell>
                <Link to={`/clients/${client.id}`} className="hover:underline">
                  {client.name}
                </Link>
              </TableCell>
              <TableCell>{formatPhoneDisplay(client.phone)}</TableCell>
              <TableCell>{client.email ?? '—'}</TableCell>
              <TableCell className="max-w-48 truncate">{client.notes ?? '—'}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingClient(client)
                    setDialogOpen(true)
                  }}
                >
                  Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Delete</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {client.name}?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(client)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <ClientDialog open={dialogOpen} onOpenChange={setDialogOpen} client={editingClient} />
    </div>
  )
}
