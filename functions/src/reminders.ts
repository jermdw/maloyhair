import { scheduleReminderTask, deleteReminderTask, type ReminderKind } from './tasks.js'

const REMINDER_OFFSETS_MS: Record<ReminderKind, number> = {
  h48: 48 * 60 * 60 * 1000,
  h2: 2 * 60 * 60 * 1000,
}

export interface ReminderState {
  sent: boolean
  taskName: string | null
}

/**
 * Schedules a Cloud Task for one reminder kind, unless its fire time has
 * already passed (e.g. booking a same-day appointment less than 48hrs out).
 * In that case it's marked sent:false with no task — the UI can show it was
 * skipped rather than silently dropping it.
 */
export async function scheduleReminder(
  appointmentId: string,
  kind: ReminderKind,
  startTime: Date,
  sendReminderUrl: string,
): Promise<ReminderState> {
  const fireAt = new Date(startTime.getTime() - REMINDER_OFFSETS_MS[kind])

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
