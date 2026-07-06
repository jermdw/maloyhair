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
import { MessagesThread } from '@/components/MessagesThread'
import { formatCurrency } from '@/lib/utils'

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { clients } = useClients()
  const { appointments } = useAppointments()
  const { services } = useServices()
  const client = clients.find((c) => c.id === clientId)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'messages' ? 'messages' : searchParams.get('tab') === 'history' ? 'history' : 'details'

  const servicesById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const history = useMemo(
    () =>
      appointments
        .filter((a) => a.clientId === clientId && a.payment?.status === 'paid')
        .sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis()),
    [appointments, clientId],
  )

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

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
      <h1 className="mb-4 mt-1 font-heading text-2xl">{client.name}</h1>

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
            <p className="text-sm text-muted-foreground">No paid appointments yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((appt) => {
                const service = servicesById.get(appt.serviceId)
                const payment = appt.payment!
                const start = appt.startTime.toDate()
                return (
                  <div key={appt.id} className="flex items-center justify-between rounded-lg border border-input px-3 py-2">
                    <div>
                      <p className="text-sm">{service?.name ?? 'Unknown service'}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(start, 'MMM d, yyyy')} at {format(start, 'h:mm a')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm">{formatCurrency(payment.amount / 100)}</p>
                      {!!payment.tipAmount && (
                        <p className="text-sm text-muted-foreground">
                          incl. {formatCurrency(payment.tipAmount / 100)} tip
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <MessagesThread clientId={client.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
