import { useMemo, useState } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, getDay, parse, startOfWeek } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { useAppointments } from '@/hooks/useAppointments'
import { useClients } from '@/hooks/useClients'
import { useServices } from '@/hooks/useServices'
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

  const [view, setView] = useState<View>('month')
  const [date, setDate] = useState(new Date())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [prefillStart, setPrefillStart] = useState<Date | undefined>(undefined)

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const servicesById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const events = useMemo<CalendarEvent[]>(
    () =>
      appointments.map((appt) => {
        const client = clientsById.get(appt.clientId)
        const service = servicesById.get(appt.serviceId)
        return {
          id: appt.id,
          title: `${client?.name ?? 'Unknown client'} — ${service?.name ?? 'Unknown service'}`,
          start: appt.startTime.toDate(),
          end: appt.endTime.toDate(),
          resource: appt,
        }
      }),
    [appointments, clientsById, servicesById],
  )

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
        views={['month', 'week']}
        style={{ height: 700 }}
        onSelectSlot={(slotInfo) => openCreateDialog(slotInfo.start)}
        onSelectEvent={(event) => openEditDialog((event as CalendarEvent).resource)}
        eventPropGetter={(event) => ({
          style: { backgroundColor: STATUS_COLORS[(event as CalendarEvent).resource.status] },
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
