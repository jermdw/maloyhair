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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTimeBlock, deleteAppointment, updateTimeBlock } from '@/hooks/useAppointments'
import { useSettings } from '@/hooks/useSettings'
import type { Appointment, Settings } from '@/types/firestore'

interface BlockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing block to edit, or null to create a new one. */
  block: Appointment | null
  defaultStart?: Date
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The salon's open/close for the given date's weekday. Days without configured hours
 *  (weekends) fall back to the same 9–5 span the open days use, so an all-day block on
 *  a normally-closed day still marks the day visibly and round-trips as "all day". */
function businessDaySpan(dateValue: string, settings: Settings | null): { start: string; end: string } {
  const date = new Date(`${dateValue}T12:00`)
  const hours = settings?.businessHours?.[date.getDay()]
  return { start: hours?.start ?? '09:00', end: hours?.end ?? '17:00' }
}

export function BlockDialog({ open, onOpenChange, block, defaultStart }: BlockDialogProps) {
  const isEditing = block != null
  const { settings } = useSettings()

  const [label, setLabel] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [startValue, setStartValue] = useState('09:00')
  const [endValue, setEndValue] = useState('18:00')
  const [allDay, setAllDay] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return

    if (block) {
      const start = block.startTime.toDate()
      const end = block.endTime.toDate()
      const span = businessDaySpan(toDateInputValue(start), settings)
      setLabel(block.label ?? '')
      setDateValue(toDateInputValue(start))
      setStartValue(toTimeInputValue(start))
      setEndValue(toTimeInputValue(end))
      setAllDay(toTimeInputValue(start) === span.start && toTimeInputValue(end) === span.end)
    } else {
      const seed = defaultStart ?? new Date()
      const date = toDateInputValue(seed)
      const span = businessDaySpan(date, settings)
      setLabel('')
      setDateValue(date)
      setStartValue(span.start)
      setEndValue(span.end)
      setAllDay(true)
    }
  }, [open, block, defaultStart, settings])

  // "All day" tracks the selected date's business hours, so flipping the date while
  // all-day is checked keeps the span correct for that weekday.
  useEffect(() => {
    if (!allDay || !dateValue) return
    const span = businessDaySpan(dateValue, settings)
    setStartValue(span.start)
    setEndValue(span.end)
  }, [allDay, dateValue, settings])

  async function handleSubmit() {
    if (!label.trim() || !dateValue || !startValue || !endValue) {
      toast.error('Please fill in a label, date, and time range.')
      return
    }
    const startTime = new Date(`${dateValue}T${startValue}`)
    const endTime = new Date(`${dateValue}T${endValue}`)
    if (endTime <= startTime) {
      toast.error('End time must be after start time.')
      return
    }

    setSaving(true)
    try {
      if (isEditing && block) {
        await updateTimeBlock(block.id, { label: label.trim(), startTime, endTime })
        toast.success('Block updated.')
      } else {
        await createTimeBlock({ label: label.trim(), startTime, endTime })
        toast.success('Time blocked.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the block.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!block) return
    try {
      await deleteAppointment(block.id)
      toast.success('Block removed.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove the block.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit blocked time' : 'Block time'}</DialogTitle>
          <DialogDescription>
            Mark time you're unavailable — it shows on the calendar but sends no reminders.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Vacation, dentist, school event"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Date</Label>
            <input
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day (business hours)
          </label>

          {!allDay && (
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>From</Label>
                <input
                  type="time"
                  value={startValue}
                  onChange={(e) => setStartValue(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Until</Label>
                <input
                  type="time"
                  value={endValue}
                  onChange={(e) => setEndValue(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {isEditing && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" />}>Delete</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this blocked time?</AlertDialogTitle>
                  <AlertDialogDescription>The time becomes bookable again.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button onClick={handleSubmit} disabled={saving}>
            {isEditing ? 'Save' : 'Block time'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
