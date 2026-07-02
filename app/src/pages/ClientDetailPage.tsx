import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { updateClient, useClients } from '@/hooks/useClients'
import { MessagesThread } from '@/components/MessagesThread'

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { clients } = useClients()
  const client = clients.find((c) => c.id === clientId)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'messages' ? 'messages' : 'details'

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
        onValueChange={(value) => setSearchParams(value === 'messages' ? { tab: 'messages' } : {}, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
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

        <TabsContent value="messages" className="mt-4">
          <MessagesThread clientId={client.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
