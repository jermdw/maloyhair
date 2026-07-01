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
import { createService, updateService } from '@/hooks/useServices'
import type { Service } from '@/types/firestore'

interface ServiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null
}

export function ServiceDialog({ open, onOpenChange, service }: ServiceDialogProps) {
  const isEditing = service != null

  const [name, setName] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(service?.name ?? '')
    setDurationMinutes(service ? String(service.durationMinutes) : '')
    setPrice(service ? String(service.price) : '')
  }, [open, service])

  async function handleSubmit() {
    const duration = Number(durationMinutes)
    const priceValue = Number(price)
    if (!name.trim() || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(priceValue) || priceValue < 0) {
      toast.error('Enter a name, a positive duration, and a valid price.')
      return
    }

    setSaving(true)
    try {
      if (isEditing && service) {
        await updateService(service.id, { name, durationMinutes: duration, price: priceValue })
        toast.success('Service updated.')
      } else {
        await createService({ name, durationMinutes: duration, price: priceValue })
        toast.success('Service added.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save service.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit service' : 'Add service'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update this service.' : 'Add a new service.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Duration (minutes)</Label>
            <Input type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Price (USD)</Label>
            <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {isEditing ? 'Save' : 'Add service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
