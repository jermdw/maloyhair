import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAppointment, deleteAppointment, updateAppointment, useAppointments } from '@/hooks/useAppointments'
import { cancelCheckoutCharge, createCheckoutCharge, recordCashPayment } from '@/hooks/usePayments'
import { useSettings } from '@/hooks/useSettings'
import { useClientServiceHistory } from '@/hooks/useServiceHistory'
import { formatCurrency } from '@/lib/utils'
import { generateRecurringDates, occurrencesUntil, MAX_RECURRING_OCCURRENCES } from '@/lib/scheduling'
import type { Appointment, AppointmentStatus, Client, Service, Settings } from '@/types/firestore'

const STATUS_OPTIONS: AppointmentStatus[] = ['booked', 'confirmed', 'cancelled', 'completed', 'no_show']

interface AppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  /** The same appointment, re-derived fresh from the live appointments list on every render
   *  (unlike `appointment`, which is snapshotted once when the dialog opens) — so the checkout
   *  UI updates as soon as the Stripe webhook reports an outcome, and a status change made
   *  elsewhere (e.g. a client texting "X" to cancel) can be surfaced without clobbering
   *  whatever the owner may be mid-editing in the form. */
  liveAppointment?: Appointment | null
  defaultStart?: Date
  /** Pre-selects a client when creating (e.g. booking from that client's profile page). */
  defaultClientId?: string
  clients: Client[]
  services: Service[]
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Clicking a day in month view gives a start time of exactly midnight (no time was actually
 *  picked), which otherwise leaves the time input defaulted to 00:00. */
function isMidnight(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0
}

function workdayStart(date: Date, settings: Settings | null): string {
  return settings?.businessHours?.[date.getDay()]?.start ?? '09:00'
}

export function AppointmentDialog({
  open,
  onOpenChange,
  appointment,
  liveAppointment,
  defaultStart,
  defaultClientId,
  clients,
  services,
}: AppointmentDialogProps) {
  const isEditing = appointment != null
  const payment = liveAppointment?.payment ?? appointment?.payment
  const liveStatusChanged =
    isEditing && liveAppointment != null && appointment != null && liveAppointment.status !== appointment.status

  const { appointments } = useAppointments()
  const { settings } = useSettings()

  const [clientId, setClientId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<AppointmentStatus>('booked')
  const [saving, setSaving] = useState(false)
  const [charging, setCharging] = useState(false)
  const [chargeAmount, setChargeAmount] = useState('')

  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatIntervalWeeks, setRepeatIntervalWeeks] = useState('6')
  const [repeatMode, setRepeatMode] = useState<'count' | 'until'>('count')
  const [repeatCount, setRepeatCount] = useState('6')
  const [repeatUntilDate, setRepeatUntilDate] = useState('')

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
      setClientId(defaultClientId ?? '')
      setServiceId('')
      setDateValue(toDateInputValue(start))
      setTimeValue(isMidnight(start) ? workdayStart(start, settings) : toTimeInputValue(start))
      setNotes('')
      setStatus('booked')
    }
    setRepeatEnabled(false)
    setRepeatIntervalWeeks('6')
    setRepeatMode('count')
    setRepeatCount('6')
    setRepeatUntilDate('')
  }, [open, appointment, defaultStart, defaultClientId, settings])

  const selectedService = services.find((s) => s.id === serviceId)
  const serviceChanged = isEditing && appointment != null && serviceId !== appointment.serviceId
  const selectedClient = clients.find((c) => c.id === clientId)

  const importedHistory = useClientServiceHistory(clientId || undefined)

  const recentVisits = useMemo(() => {
    const live = appointments
      .filter((a) => a.clientId === clientId && a.id !== appointment?.id && a.payment?.status === 'paid')
      .map((a) => ({
        id: a.id,
        date: a.startTime.toDate(),
        serviceName: services.find((s) => s.id === a.serviceId)?.name ?? 'Unknown service',
        amount: a.payment!.amount,
      }))
    const imported = importedHistory.map((entry) => ({
      id: entry.id,
      date: new Date(`${entry.date}T${entry.startTime}`),
      serviceName: entry.serviceName,
      amount: entry.amount,
    }))
    return [...live, ...imported].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 3)
  }, [appointments, importedHistory, clientId, appointment?.id, services])

  useEffect(() => {
    if (selectedService) setChargeAmount(selectedService.price.toFixed(2))
  }, [selectedService?.id])
  const startTime = dateValue && timeValue ? new Date(`${dateValue}T${timeValue}`) : null
  const endTime =
    startTime && selectedService ? new Date(startTime.getTime() + selectedService.durationMinutes * 60_000) : null

  async function handleSubmit() {
    if (!clientId || !serviceId || !startTime || !selectedService) {
      toast.error('Please fill in client, service, date, and time.')
      return
    }

    let additionalDates: Date[] = []
    if (!isEditing && repeatEnabled) {
      const intervalWeeks = parseInt(repeatIntervalWeeks, 10)
      if (!Number.isInteger(intervalWeeks) || intervalWeeks <= 0) {
        toast.error('Enter a valid repeat interval in weeks.')
        return
      }

      let additionalCount: number
      if (repeatMode === 'count') {
        const totalCount = parseInt(repeatCount, 10)
        if (!Number.isInteger(totalCount) || totalCount <= 0) {
          toast.error('Enter a valid number of occurrences.')
          return
        }
        additionalCount = totalCount - 1
      } else {
        const untilDate = repeatUntilDate ? new Date(`${repeatUntilDate}T23:59`) : null
        if (!untilDate || untilDate <= startTime) {
          toast.error('Enter an end date after the first appointment.')
          return
        }
        additionalCount = occurrencesUntil(startTime, intervalWeeks, untilDate)
      }

      if (additionalCount + 1 > MAX_RECURRING_OCCURRENCES) {
        toast.error(`That range creates too many appointments at once (max ${MAX_RECURRING_OCCURRENCES}). Shorten it.`)
        return
      }

      additionalDates = generateRecurringDates(
        startTime,
        intervalWeeks,
        additionalCount,
        settings?.businessHours ?? {},
        settings?.closedDates ?? [],
      )
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
        for (const date of additionalDates) {
          await createAppointment({
            clientId,
            serviceId,
            startTime: date,
            durationMinutes: selectedService.durationMinutes,
            notes: notes || undefined,
          })
        }
        toast.success(
          additionalDates.length > 0
            ? `Created ${additionalDates.length + 1} appointments.`
            : 'Appointment created.',
        )
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

  function parseChargeAmountCents(input: string): number | null {
    const dollars = parseFloat(input)
    if (!Number.isFinite(dollars) || dollars <= 0) return null
    return Math.round(dollars * 100)
  }

  async function handleCharge() {
    if (!appointment) return
    const amountCents = parseChargeAmountCents(chargeAmount)
    if (amountCents == null) {
      toast.error('Enter a valid charge amount.')
      return
    }
    setCharging(true)
    try {
      await createCheckoutCharge(appointment.id, amountCents)
      toast.success('Charge sent to the reader.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start the charge.')
    } finally {
      setCharging(false)
    }
  }

  async function handleCashPayment() {
    if (!appointment) return
    const amountCents = parseChargeAmountCents(chargeAmount)
    if (amountCents == null) {
      toast.error('Enter a valid charge amount.')
      return
    }
    setCharging(true)
    try {
      await recordCashPayment(appointment.id, amountCents)
      toast.success('Marked as paid (cash).')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record the cash payment.')
    } finally {
      setCharging(false)
    }
  }

  async function handleCancelCharge() {
    if (!appointment) return
    setCharging(true)
    try {
      await cancelCheckoutCharge(appointment.id)
      toast.success('Charge cancelled.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel the charge.')
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
            <div className="flex items-center justify-between">
              <Label>Client</Label>
              {selectedClient && (
                <Link
                  to={`/clients/${selectedClient.id}`}
                  onClick={() => onOpenChange(false)}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  View profile →
                </Link>
              )}
            </div>
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

          {recentVisits.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-input px-3 py-2">
              <p className="text-sm text-muted-foreground">Recent visits</p>
              {recentVisits.map((visit) => (
                <div key={visit.id} className="flex items-center justify-between text-sm">
                  <span>
                    {format(visit.date, 'MMM d, yyyy')} — {visit.serviceName}
                  </span>
                  <span>{formatCurrency(visit.amount / 100)}</span>
                </div>
              ))}
            </div>
          )}

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

          {!isEditing && (
            <div className="flex flex-col gap-2 rounded-lg border border-input px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={repeatEnabled}
                  onChange={(e) => setRepeatEnabled(e.target.checked)}
                />
                Repeat this appointment
              </label>
              {repeatEnabled && (
                <div className="flex flex-col gap-2 pl-6">
                  <div className="flex items-center gap-2 text-sm">
                    Every
                    <Input
                      type="number"
                      min="1"
                      value={repeatIntervalWeeks}
                      onChange={(e) => setRepeatIntervalWeeks(e.target.value)}
                      className="h-8 w-16"
                    />
                    weeks
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        checked={repeatMode === 'count'}
                        onChange={() => setRepeatMode('count')}
                      />
                      For
                    </label>
                    <Input
                      type="number"
                      min="1"
                      value={repeatCount}
                      onChange={(e) => setRepeatCount(e.target.value)}
                      disabled={repeatMode !== 'count'}
                      className="h-8 w-16"
                    />
                    occurrences
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        checked={repeatMode === 'until'}
                        onChange={() => setRepeatMode('until')}
                      />
                      Until
                    </label>
                    <input
                      type="date"
                      value={repeatUntilDate}
                      onChange={(e) => setRepeatUntilDate(e.target.value)}
                      disabled={repeatMode !== 'until'}
                      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-50"
                    />
                  </div>
                </div>
              )}
            </div>
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
              {liveStatusChanged && (
                <p className="text-sm text-destructive">
                  Status changed to "{liveAppointment!.status.replace('_', ' ')}" elsewhere — reopen to pick it up.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {isEditing && selectedService && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-input px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">
                  {payment?.status === 'paid' &&
                    `Paid ${formatCurrency(payment.amount / 100)}${payment.method === 'cash' ? ' (cash)' : ''}${
                      payment.tipAmount ? ` (incl. ${formatCurrency(payment.tipAmount / 100)} tip)` : ''
                    }`}
                  {payment?.status === 'processing' && 'Waiting for card on reader…'}
                  {payment?.status === 'failed' && 'Payment failed'}
                  {payment?.status === 'cancelled' && 'Charge cancelled'}
                  {(!payment || payment.status === 'unpaid') && 'Not charged yet'}
                </span>
                {payment?.status === 'processing' && (
                  <Button size="sm" variant="outline" onClick={handleCancelCharge} disabled={charging}>
                    Cancel charge
                  </Button>
                )}
              </div>
              {payment?.status !== 'paid' && payment?.status !== 'processing' && !serviceChanged && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                    className="h-8 w-24"
                  />
                  <Button size="sm" variant="outline" onClick={handleCharge} disabled={charging}>
                    {payment?.status === 'failed' || payment?.status === 'cancelled' ? 'Retry charge' : 'Charge'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCashPayment} disabled={charging}>
                    Cash
                  </Button>
                </div>
              )}
              {serviceChanged && (
                <p className="text-sm text-muted-foreground">Save your change to the service before charging.</p>
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
                  <AlertDialogDescription>
                    {payment?.status === 'processing'
                      ? 'This cannot be undone. A charge is currently waiting on the reader — deleting will cancel it there too.'
                      : 'This cannot be undone.'}
                  </AlertDialogDescription>
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
