export type ReminderKind = 'd3' | 'd1'

export const REMINDER_DAYS_BEFORE: Record<ReminderKind, number> = {
  d3: 3,
  d1: 1,
}

export const REMINDER_TIMEZONE = 'America/New_York'

export interface ReminderState {
  sent: boolean
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

/**
 * The UTC instant range [start, end) covering the whole REMINDER_TIMEZONE calendar
 * day that is `daysAhead` days after `now`'s date in that zone. Used by the daily
 * sweep to ask "which appointments fall on that day?" as a Firestore startTime
 * range query. DST-safe: day boundaries come from zonedTimeToUtc, so a 23- or
 * 25-hour day around a transition is still covered exactly.
 */
export function upcomingDayRangeUtc(daysAhead: number, now: Date = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REMINDER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  // Plain calendar-field addition (not a real instant), so this is DST-safe by construction.
  const target = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + daysAhead))
  const next = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + daysAhead + 1))

  return {
    start: zonedTimeToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 0, REMINDER_TIMEZONE),
    end: zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, REMINDER_TIMEZONE),
  }
}
