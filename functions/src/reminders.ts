import { scheduleReminderTask, deleteReminderTask, type ReminderKind } from './tasks.js'

const REMINDER_DAYS_BEFORE: Record<ReminderKind, number> = {
  d3: 3,
  d1: 1,
}

const REMINDER_HOUR_LOCAL = 7 // 7:00 AM
const REMINDER_TIMEZONE = 'America/New_York'

export interface ReminderState {
  sent: boolean
  taskName: string | null
}

/**
 * Converts a wall-clock date/time in `timeZone` to the UTC instant it represents,
 * correctly across DST — a fixed millisecond offset can't do this since the zone's
 * UTC offset itself changes twice a year. Standard "guess and correct" technique:
 * build a UTC instant from the field values, ask Intl what wall-clock time that
 * instant reads as in the target zone, then correct by the difference.
 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0))

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  const readAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  const driftMs = readAsUtc - guess.getTime()

  return new Date(guess.getTime() - driftMs)
}

/** The appointment's calendar date (in REMINDER_TIMEZONE) minus `daysBefore` days, at 7:00 AM local. */
function reminderFireTime(appointmentStart: Date, daysBefore: number): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REMINDER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(appointmentStart)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  // Plain calendar-field subtraction (not a real instant), so this is DST-safe by construction.
  const targetDateUtcFields = new Date(Date.UTC(get('year'), get('month') - 1, get('day') - daysBefore))

  return zonedTimeToUtc(
    targetDateUtcFields.getUTCFullYear(),
    targetDateUtcFields.getUTCMonth() + 1,
    targetDateUtcFields.getUTCDate(),
    REMINDER_HOUR_LOCAL,
    REMINDER_TIMEZONE,
  )
}

/**
 * Schedules a Cloud Task for one reminder kind, unless its fire time has
 * already passed (e.g. booking an appointment less than `daysBefore` days out).
 * In that case it's marked sent:false with no task — the UI can show it was
 * skipped rather than silently dropping it.
 */
export async function scheduleReminder(
  appointmentId: string,
  kind: ReminderKind,
  startTime: Date,
  sendReminderUrl: string,
): Promise<ReminderState> {
  const fireAt = reminderFireTime(startTime, REMINDER_DAYS_BEFORE[kind])

  if (fireAt.getTime() <= Date.now()) {
    return { sent: false, taskName: null }
  }

  const taskName = await scheduleReminderTask(appointmentId, kind, fireAt, sendReminderUrl)
  return { sent: false, taskName }
}

export async function cancelReminder(state: ReminderState | undefined): Promise<void> {
  if (state?.taskName) {
    await deleteReminderTask(state.taskName)
  }
}
