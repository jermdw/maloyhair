import { addDays, addWeeks, format } from 'date-fns'
import type { BusinessHours } from '@/types/firestore'

/** Safety valve against a fat-fingered range (e.g. "every 1 week until 10 years from now")
 *  generating an unreasonable number of appointments in one submit. */
export const MAX_RECURRING_OCCURRENCES = 52

function isOpenDay(date: Date, businessHours: BusinessHours, closedDates: string[]): boolean {
  if (closedDates.includes(format(date, 'yyyy-MM-dd'))) return false
  return businessHours[date.getDay()] !== undefined
}

/** Advances a date forward, day by day, until it lands on a day the salon is actually open. */
function nextOpenDate(date: Date, businessHours: BusinessHours, closedDates: string[]): Date {
  let candidate = date
  while (!isOpenDay(candidate, businessHours, closedDates)) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}

/**
 * Generates the follow-up occurrences for a recurring booking (the first occurrence is
 * whatever the owner already picked in the form, so it's not included here). Each occurrence
 * lands `intervalWeeks` after the previous one, keeping the same time of day, and shifts
 * forward day-by-day past any closed weekday or one-off closed date.
 */
export function generateRecurringDates(
  firstStart: Date,
  intervalWeeks: number,
  additionalCount: number,
  businessHours: BusinessHours,
  closedDates: string[],
): Date[] {
  const dates: Date[] = []
  const hour = firstStart.getHours()
  const minute = firstStart.getMinutes()
  // Each occurrence is anchored to the original first date (not the previous occurrence),
  // so a one-time shift around a holiday doesn't permanently drag the whole series onto a
  // different weekday.
  for (let i = 1; i <= additionalCount; i++) {
    const scheduled = nextOpenDate(addWeeks(firstStart, intervalWeeks * i), businessHours, closedDates)
    scheduled.setHours(hour, minute, 0, 0)
    dates.push(scheduled)
  }
  return dates
}

/** For "repeat until date X" mode — how many additional occurrences fit between the first
 *  occurrence and the end date, at the given interval. */
export function occurrencesUntil(firstStart: Date, intervalWeeks: number, endDate: Date): number {
  const msPerOccurrence = intervalWeeks * 7 * 24 * 60 * 60 * 1000
  const span = endDate.getTime() - firstStart.getTime()
  if (span <= 0) return 0
  return Math.floor(span / msPerOccurrence)
}
