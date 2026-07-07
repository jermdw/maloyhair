import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { updateClient, useClients } from '@/hooks/useClients'
import { useAppointments } from '@/hooks/useAppointments'
import { useServices } from '@/hooks/useServices'
import { useClientServiceHistory } from '@/hooks/useServiceHistory'
import { MessagesThread } from '@/components/MessagesThread'
import { AppointmentDialog } from '@/components/AppointmentDialog'
import { formatCurrency } from '@/lib/utils'

interface HistoryRow {
  id: string
  date: Date
  serviceName: string
  amount: number
  tipAmount?: number
  method?: 'card' | 'cash'
  imported: boolean
}

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { clients } = useClients()
  const { appointments } = useAppointments()
  const { services } = useServices()
  const importedHistory = useClientServiceHistory(clientId)
  const client = clients.find((c) => c.id === clientId)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'messages' ? 'messages' : searchParams.get('tab') === 'history' ? 'history' : 'details'

  const servicesById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const history = useMemo<HistoryRow[]>(() => {
    const live: HistoryRow[] = appointments
      .filter((a) => a.clientId === clientId && a.payment?.status === 'paid')
      .map((a) => ({
        id: a.id,
        date: a.startTime.toDate(),
        serviceName:
          (a.serviceIds ?? []).map((id) => servicesById.get(id)?.name ?? 'Unknown service').join(' + ') ||
          'Unknown service',
        amount: a.payment!.amount,
        tipAmount: a.payment!.tipAmount,
        method: a.payment!.method,
        imported: false,
      }))
    const imported: HistoryRow[] = importedHistory.map((entry) => ({
      id: entry.id,
      date: new Date(`${entry.date}T${entry.startTime}`),
      serviceName: entry.serviceName,
      amount: entry.amount,
      imported: true,
    }))
    return [...live, ...imported].sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [appointments, importedHistory, clientId, servicesById])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [bookingOpen, setBookingOpen] = useState(false)

  useEffect(() => {
    if (!client) return
    setName(client.name)
    setPhone(client.phone)
    setEmail(client.email ?? '')
    setNotes(client.notes ?? '')
  }, [client])

  if (!client) {
    return <p className="text-muted-foreground">Client not found.</p>
  }

  async function handleSave() {
    if (!client) return
    setSaving(true)
    try {
      await updateClient(client.id, { name, phone, email: email || undefined, notes: notes || undefined })
      toast.success('Client updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save client.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Link to="/clients" className="text-sm text-muted-foreground hover:underline">
        ← Back to clients
      </Link>
      <div className="mb-4 mt-1 flex items-center justify-between">
        <h1 className="font-heading text-2xl">{client.name}</h1>
        <Button size="sm" onClick={() => setBookingOpen(true)}>
          New appointment
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setSearchParams(value === 'details' ? {} : { tab: value }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4 flex max-w-md flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="self-start" onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visit history yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-lg border border-input px-3 py-2">
                  <div>
                    <p className="text-sm">
                      {row.serviceName}
                      {row.imported && <span className="ml-2 text-xs text-muted-foreground">(imported)</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(row.date, 'MMM d, yyyy')} at {format(row.date, 'h:mm a')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">
                      {formatCurrency(row.amount / 100)}
                      {row.method === 'cash' && ' (cash)'}
                    </p>
                    {!!row.tipAmount && (
                      <p className="text-sm text-muted-foreground">
                        incl. {formatCurrency(row.tipAmount / 100)} tip
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <MessagesThread clientId={client.id} />
        </TabsContent>
      </Tabs>

      <AppointmentDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        appointment={null}
        defaultClientId={client.id}
        clients={clients}
        services={services}
      />
    </div>
  )
}
