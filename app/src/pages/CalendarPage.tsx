import { useMemo, useState } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, getDay, parse, startOfWeek } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { useAppointments } from '@/hooks/useAppointments'
import { useClients } from '@/hooks/useClients'
import { useServices } from '@/hooks/useServices'
import { useSettings } from '@/hooks/useSettings'
import { AppointmentDialog } from '@/components/AppointmentDialog'
import type { Appointment, AppointmentStatus } from '@/types/firestore'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { locale: enUS }),
  getDay,
  locales: { 'en-US': enUS },
})

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  booked: '#2E1B0E',
  confirmed: '#6B8C42',
  cancelled: '#B2452F',
  completed: '#8FA85E',
  no_show: '#B2452F',
}

/** A paid/closed-out charge gets its own color regardless of scheduling status, since
 *  "confirmed" and "completed" otherwise both read as similar greens on the calendar. */
const PAID_COLOR = '#7A5A3A'

/** Paid, but the appointment was later cancelled or marked no-show — distinct from a plain
 *  "paid" block, since this combination usually means a refund or follow-up is owed and is
 *  easy to miss if it just reads as any other paid visit. */
const PAID_BUT_CANCELLED_COLOR = '#C08A2E'

function eventColor(appointment: Appointment): string {
  const isPaid = appointment.payment?.status === 'paid'
  const isCancelledOrNoShow = appointment.status === 'cancelled' || appointment.status === 'no_show'
  if (isPaid && isCancelledOrNoShow) return PAID_BUT_CANCELLED_COLOR
  if (isPaid) return PAID_COLOR
  return STATUS_COLORS[appointment.status]
}

/** RBC's min/max only care about the time-of-day component, so any date works here. */
function timeToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(1970, 0, 1, h, m)
}

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  resource: Appointment
}

export function CalendarPage() {
  const { appointments } = useAppointments()
  const { clients } = useClients()
  const { services } = useServices()
  const { settings } = useSettings()

  // A 7-column month grid (or even 5-column work week) is unreadably cramped on a phone —
  // default to a single day's worth of full-width time slots there instead. Just an initial
  // guess at mount, not a live media query — the view toggle still lets it be changed either way.
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'day' : 'month'))
  const [date, setDate] = useState(new Date())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [prefillStart, setPrefillStart] = useState<Date | undefined>(undefined)

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const servicesById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const events = useMemo<CalendarEvent[]>(
    () =>
      appointments.flatMap((appt) => {
        const client = clientsById.get(appt.clientId)
        const serviceNames =
          (appt.serviceIds ?? []).map((id) => servicesById.get(id)?.name ?? 'Unknown service').join(' + ') ||
          'Unknown service'
        const title = `${client?.name ?? 'Unknown client'} — ${serviceNames}`

        // A segmented appointment (e.g. color setup / processing gap / finish) renders as two
        // separate blocks on the calendar, both pointing at the same underlying appointment —
        // clicking either opens the same edit dialog. The gap itself isn't a block; it's just
        // free time between them, bookable like any other slot.
        if (appt.segments && appt.segments.length > 0) {
          return appt.segments.map((seg, i) => ({
            id: `${appt.id}-${i}`,
            title: `${title} (${seg.label})`,
            start: seg.startTime.toDate(),
            end: seg.endTime.toDate(),
            resource: appt,
          }))
        }
        return [
          {
            id: appt.id,
            title,
            start: appt.startTime.toDate(),
            end: appt.endTime.toDate(),
            resource: appt,
          },
        ]
      }),
    [appointments, clientsById, servicesById],
  )

  const [minTime, maxTime] = useMemo(() => {
    const ranges = Object.values(settings?.businessHours ?? {})
    if (ranges.length === 0) return [timeToDate('09:00'), timeToDate('20:00')]
    const starts = ranges.map((r) => r.start).sort()
    const ends = ranges.map((r) => r.end).sort()
    return [timeToDate(starts[0]), timeToDate(ends[ends.length - 1])]
  }, [settings])

  function openCreateDialog(start: Date) {
    setEditingAppointment(null)
    setPrefillStart(start)
    setDialogOpen(true)
  }

  function openEditDialog(appointment: Appointment) {
    setEditingAppointment(appointment)
    setPrefillStart(undefined)
    setDialogOpen(true)
  }

  return (
    <div>
      <h1 className="mb-4 font-heading text-2xl">Calendar</h1>
      <BigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        selectable
        view={view}
        onView={setView}
        date={date}
        onNavigate={setDate}
        views={['month', 'work_week', 'day']}
        min={minTime}
        max={maxTime}
        style={{ height: 700 }}
        onSelectSlot={(slotInfo) => openCreateDialog(slotInfo.start)}
        onSelectEvent={(event) => openEditDialog((event as CalendarEvent).resource)}
        eventPropGetter={(event) => ({
          style: { backgroundColor: eventColor((event as CalendarEvent).resource) },
        })}
      />
      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        appointment={editingAppointment}
        liveAppointment={appointments.find((a) => a.id === editingAppointment?.id) ?? null}
        defaultStart={prefillStart}
        clients={clients}
        services={services}
      />
    </div>
  )
}
