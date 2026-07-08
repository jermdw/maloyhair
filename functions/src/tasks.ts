import { CloudTasksClient } from '@google-cloud/tasks'

const client = new CloudTasksClient()

const PROJECT = process.env.GCLOUD_PROJECT ?? ''
const LOCATION = 'us-east1' // must match the region the queue + functions are deployed in
const QUEUE = 'sms-reminders'

export type ReminderKind = 'd3' | 'd1'

/**
 * Schedules a Cloud Task that POSTs to the sendReminder function at `scheduleTime`.
 * Returns the created task's resource name so it can be deleted later if the
 * appointment is rescheduled or cancelled.
 */
export async function scheduleReminderTask(
  appointmentId: string,
  kind: ReminderKind,
  scheduleTime: Date,
  sendReminderUrl: string,
): Promise<string> {
  const parent = client.queuePath(PROJECT, LOCATION, QUEUE)

  const [task] = await client.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: sendReminderUrl,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ appointmentId, kind })).toString('base64'),
        oidcToken: {
          serviceAccountEmail: `${PROJECT}@appspot.gserviceaccount.com`,
        },
      },
      scheduleTime: { seconds: Math.floor(scheduleTime.getTime() / 1000) },
    },
  })

  return task.name ?? ''
}

export async function deleteReminderTask(taskName: string | null): Promise<void> {
  if (!taskName) return
  try {
    await client.deleteTask({ name: taskName })
  } catch {
    // Task already ran or was already deleted — nothing to do.
  }
}
