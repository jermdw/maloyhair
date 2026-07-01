import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient, updateClient } from '@/hooks/useClients'
import { normalizePhone } from '@/lib/phone'
import type { Client } from '@/types/firestore'

interface ClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: Client | null
}

export function ClientDialog({ open, onOpenChange, client }: ClientDialogProps) {
  const isEditing = client != null

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(client?.name ?? '')
    setPhone(client?.phone ?? '')
    setEmail(client?.email ?? '')
    setNotes(client?.notes ?? '')
    setPhoneError(null)
  }, [open, client])

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Name is required.')
      return
    }
    if (!normalizePhone(phone)) {
      setPhoneError('Enter a valid 10-digit US phone number.')
      return
    }
    setPhoneError(null)

    setSaving(true)
    try {
      if (isEditing && client) {
        await updateClient(client.id, { name, phone, email: email || undefined, notes: notes || undefined })
        toast.success('Client updated.')
      } else {
        await createClient({ name, phone, email: email || undefined, notes: notes || undefined })
        toast.success('Client added.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save client.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit client' : 'Add client'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update this client’s details.' : 'Add a new client.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={phoneError != null}
              placeholder="(404) 555-1234"
            />
            {phoneError && <p className="text-sm text-destructive">{phoneError}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {isEditing ? 'Save' : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
