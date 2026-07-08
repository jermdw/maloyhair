import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format, isSameDay, isToday, isTomorrow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppointments } from '@/hooks/useAppointments'
import { useClients } from '@/hooks/useClients'
import { useServices } from '@/hooks/useServices'
import { cn } from '@/lib/utils'
import { isTimeBlock, type Appointment } from '@/types/firestore'

/** Client appointments that occupy calendar time and may still happen — what "your day"
 *  actually looks like. Cancelled/no-show stay visible on the Calendar page for recordkeeping
 *  but would only be noise at a glance. */
function isActive(appt: Appointment): boolean {
  return appt.status === 'booked' || appt.status === 'confirmed' || appt.status === 'completed'
}

function StatusBadge({ appointment }: { appointment: Appointment }) {
  if (appointment.payment?.status === 'paid') {
    return <span className="rounded-full bg-[#7A5A3A] px-2 py-0.5 text-xs font-medium text-white">Paid</span>
  }
  switch (appointment.status) {
    case 'confirmed':
      return <span className="rounded-full bg-[#6B8C42] px-2 py-0.5 text-xs font-medium text-white">Confirmed</span>
    case 'completed':
      return <span className="rounded-full bg-[#8FA85E] px-2 py-0.5 text-xs font-medium text-white">Done</span>
    default:
      return (
        <span className="rounded-full border border-[#C08A2E] px-2 py-0.5 text-xs font-medium text-[#9A6D1F]">
          Unconfirmed
        </span>
      )
  }
}

interface DayEntries {
  appointments: Appointment[]
  blocks: Appointment[]
}

function entriesForDay(appointments: Appointment[], day: Date): DayEntries {
  const onDay = appointments.filter((a) => isSameDay(a.startTime.toDate(), day))
  return {
    appointments: onDay.filter((a) => !isTimeBlock(a) && isActive(a)),
    blocks: onDay.filter(isTimeBlock),
  }
}

export function DashboardPage() {
  const { appointments, loading } = useAppointments()
  const { clients } = useClients()
  const { services } = useServices()

  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const servicesById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const now = new Date()
  const today = useMemo(() => entriesForDay(appointments, now), [appointments]) // eslint-disable-line react-hooks/exhaustive-deps

  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const day = addDays(now, i)
        return { day, ...entriesForDay(appointments, day) }
      }),
    [appointments], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const confirmedToday = today.appointments.filter((a) => a.status === 'confirmed' || a.status === 'completed').length

  function describeServices(appt: Appointment): string {
    return (
      (appt.serviceIds ?? []).map((id) => servicesById.get(id)?.name ?? 'Unknown service').join(' + ') ||
      'Unknown service'
    )
  }

  function clientName(appt: Appointment): string {
    return (appt.clientId && clientsById.get(appt.clientId)?.name) || 'Unknown client'
  }

  function dayLabel(day: Date): string {
    if (isToday(day)) return 'Today'
    if (isTomorrow(day)) return 'Tomorrow'
    return format(day, 'EEEE')
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-heading text-2xl">Dashboard</h1>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between">
          <CardTitle className="font-heading text-lg">Your Day — {format(now, 'EEEE, MMMM d')}</CardTitle>
          {today.appointments.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {today.appointments.length} {today.appointments.length === 1 ? 'appointment' : 'appointments'} ·{' '}
              {confirmedToday} confirmed
            </span>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!loading && today.appointments.length === 0 && today.blocks.length === 0 && (
            <p className="text-muted-foreground">Nothing on the books today.</p>
          )}

          {today.blocks.map((block) => (
            <div
              key={block.id}
              className="flex items-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            >
              <span className="w-28 shrink-0">
                {format(block.startTime.toDate(), 'h:mm a')}–{format(block.endTime.toDate(), 'h:mm a')}
              </span>
              <span>Blocked — {block.label ?? 'unavailable'}</span>
            </div>
          ))}

          {today.appointments.map((appt) => (
            <div key={appt.id} className="flex items-center gap-3 rounded-lg border border-input px-3 py-2">
              <span className="w-28 shrink-0 text-sm">
                {format(appt.startTime.toDate(), 'h:mm a')}–{format(appt.endTime.toDate(), 'h:mm a')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{clientName(appt)}</p>
                <p className="truncate text-sm text-muted-foreground">{describeServices(appt)}</p>
              </div>
              <StatusBadge appointment={appt} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Your Week</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          {week.map(({ day, appointments: dayAppts, blocks }) => {
            const confirmed = dayAppts.filter((a) => a.status === 'confirmed' || a.status === 'completed').length
            const empty = dayAppts.length === 0 && blocks.length === 0
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'flex items-baseline gap-3 border-b border-border py-2.5 last:border-b-0',
                  empty && 'opacity-50',
                )}
              >
                <span className="w-24 shrink-0 text-sm font-medium">{dayLabel(day)}</span>
                <span className="w-14 shrink-0 text-sm text-muted-foreground">{format(day, 'MMM d')}</span>
                <div className="min-w-0 flex-1 text-sm">
                  {empty && <span className="text-muted-foreground">Free</span>}
                  {dayAppts.length > 0 && (
                    <span>
                      {dayAppts.length} {dayAppts.length === 1 ? 'appt' : 'appts'}
                      <span
                        className={cn(
                          'ml-1.5',
                          confirmed === dayAppts.length ? 'text-[#6B8C42]' : 'text-[#9A6D1F]',
                        )}
                      >
                        ({confirmed}/{dayAppts.length} confirmed)
                      </span>
                      <span className="ml-1.5 text-muted-foreground">
                        {format(dayAppts[0].startTime.toDate(), 'h:mm a')}–
                        {format(dayAppts[dayAppts.length - 1].endTime.toDate(), 'h:mm a')}
                      </span>
                    </span>
                  )}
                  {blocks.length > 0 && (
                    <span className={cn('text-muted-foreground', dayAppts.length > 0 && 'ml-1.5')}>
                      {dayAppts.length > 0 && '· '}Blocked: {blocks.map((b) => b.label ?? 'unavailable').join(', ')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          <Link to="/calendar" className="pt-3 text-sm text-muted-foreground hover:underline">
            Open full calendar →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
