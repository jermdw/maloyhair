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
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAppointment, deleteAppointment, updateAppointment } from '@/hooks/useAppointments'
import { createCheckoutCharge } from '@/hooks/usePayments'
import type { Appointment, AppointmentPayment, AppointmentStatus, Client, Service } from '@/types/firestore'

const STATUS_OPTIONS: AppointmentStatus[] = ['booked', 'confirmed', 'cancelled', 'completed', 'no_show']

interface AppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  /** The same appointment's payment field, re-derived fresh from the live appointments list on
   *  every render (unlike `appointment`, which is snapshotted once when the dialog opens) — so
   *  the checkout UI updates as soon as the Stripe webhook reports an outcome. */
  livePayment?: AppointmentPayment
  defaultStart?: Date
  clients: Client[]
  services: Service[]
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function AppointmentDialog({
  open,
  onOpenChange,
  appointment,
  livePayment,
  defaultStart,
  clients,
  services,
}: AppointmentDialogProps) {
  const isEditing = appointment != null
  const payment = livePayment ?? appointment?.payment

  const [clientId, setClientId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<AppointmentStatus>('booked')
  const [saving, setSaving] = useState(false)
  const [charging, setCharging] = useState(false)

  useEffect(() => {
    if (!open) return

    if (appointment) {
      const start = appointment.startTime.toDate()
      setClientId(appointment.clientId)
      setServiceId(appointment.serviceId)
      setDateValue(toDateInputValue(start))
      setTimeValue(toTimeInputValue(start))
      setNotes(appointment.notes ?? '')
      setStatus(appointment.status)
    } else {
      const start = defaultStart ?? new Date()
      setClientId('')
      setServiceId('')
      setDateValue(toDateInputValue(start))
      setTimeValue(toTimeInputValue(start))
      setNotes('')
      setStatus('booked')
    }
  }, [open, appointment, defaultStart])

  const selectedService = services.find((s) => s.id === serviceId)
  const startTime = dateValue && timeValue ? new Date(`${dateValue}T${timeValue}`) : null
  const endTime =
    startTime && selectedService ? new Date(startTime.getTime() + selectedService.durationMinutes * 60_000) : null

  async function handleSubmit() {
    if (!clientId || !serviceId || !startTime || !selectedService) {
      toast.error('Please fill in client, service, date, and time.')
      return
    }

    setSaving(true)
    try {
      if (isEditing && appointment) {
        await updateAppointment(appointment.id, {
          clientId,
          serviceId,
          startTime,
          durationMinutes: selectedService.durationMinutes,
          status,
          notes: notes || undefined,
        })
        toast.success('Appointment updated.')
      } else {
        await createAppointment({
          clientId,
          serviceId,
          startTime,
          durationMinutes: selectedService.durationMinutes,
          notes: notes || undefined,
        })
        toast.success('Appointment created.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save appointment.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!appointment) return
    try {
      await deleteAppointment(appointment.id)
      toast.success('Appointment deleted.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete appointment.')
    }
  }

  async function handleCharge() {
    if (!appointment) return
    setCharging(true)
    try {
      await createCheckoutCharge(appointment.id)
      toast.success('Charge sent to the reader.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start the charge.')
    } finally {
      setCharging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit appointment' : 'New appointment'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the details for this appointment.' : 'Book a new appointment.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a client">
                  {(value: string | null) => (value ? clients.find((c) => c.id === value)?.name : 'Select a client')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={(v) => setServiceId(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a service">
                  {(value: string | null) => {
                    const service = services.find((s) => s.id === value)
                    return service ? `${service.name} (${service.durationMinutes} min)` : 'Select a service'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name} ({service.durationMinutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Date</Label>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Time</Label>
              <input
                type="time"
                value={timeValue}
                onChange={(e) => setTimeValue(e.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              />
            </div>
          </div>

          {endTime && (
            <p className="text-sm text-muted-foreground">Ends at {toTimeInputValue(endTime)}</p>
          )}

          {isEditing && (
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as AppointmentStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: AppointmentStatus) => value.replace('_', ' ')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {isEditing && selectedService && (
            <div className="flex items-center justify-between rounded-lg border border-input px-3 py-2">
              <span className="text-sm">
                {payment?.status === 'paid' && `Paid $${(payment.amount / 100).toFixed(2)}`}
                {payment?.status === 'processing' && 'Waiting for card on reader…'}
                {payment?.status === 'failed' && 'Payment failed'}
                {(!payment || payment.status === 'unpaid') && 'Not charged yet'}
              </span>
              {payment?.status !== 'paid' && payment?.status !== 'processing' && (
                <Button size="sm" variant="outline" onClick={handleCharge} disabled={charging}>
                  {payment?.status === 'failed' ? 'Retry charge' : `Charge $${selectedService.price.toFixed(2)}`}
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {isEditing && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" />}>Delete</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this appointment?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button onClick={handleSubmit} disabled={saving}>
            {isEditing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
