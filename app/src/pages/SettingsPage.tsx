import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateSettings, useSettings } from '@/hooks/useSettings'
import { normalizePhone } from '@/lib/phone'
import type { BusinessHours } from '@/types/firestore'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface DayRow {
  open: boolean
  start: string
  end: string
}

function toRows(hours: BusinessHours | undefined): DayRow[] {
  return DAYS.map((_, day) => {
    const range = hours?.[day]
    return range ? { open: true, start: range.start, end: range.end } : { open: false, start: '09:00', end: '17:00' }
  })
}

export function SettingsPage() {
  const { settings } = useSettings()
  const [businessName, setBusinessName] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [stripeReaderId, setStripeReaderId] = useState('')
  const [rows, setRows] = useState<DayRow[]>(toRows(undefined))
  const [closedDates, setClosedDates] = useState<string[]>([])
  const [newClosedDate, setNewClosedDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) return
    setBusinessName(settings.businessName)
    setBusinessPhone(settings.businessPhone)
    setStripeReaderId(settings.stripeReaderId ?? '')
    setRows(toRows(settings.businessHours))
    setClosedDates(settings.closedDates ?? [])
  }, [settings])

  function updateRow(day: number, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((row, i) => (i === day ? { ...row, ...patch } : row)))
  }

  function addClosedDate() {
    if (!newClosedDate || closedDates.includes(newClosedDate)) return
    setClosedDates((prev) => [...prev, newClosedDate].sort())
    setNewClosedDate('')
  }

  function removeClosedDate(date: string) {
    setClosedDates((prev) => prev.filter((d) => d !== date))
  }

  async function handleSave() {
    if (!businessName.trim()) {
      toast.error('Business name is required.')
      return
    }
    const normalizedPhone = normalizePhone(businessPhone)
    if (!normalizedPhone) {
      toast.error('Enter a valid 10-digit US phone number.')
      return
    }

    setSaving(true)
    try {
      const businessHours: BusinessHours = {}
      rows.forEach((row, day) => {
        if (row.open) businessHours[day] = { start: row.start, end: row.end }
      })
      await updateSettings({
        businessName: businessName.trim(),
        businessPhone: normalizedPhone,
        businessHours,
        stripeReaderId: stripeReaderId.trim() || undefined,
        closedDates,
      })
      toast.success('Settings saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 font-heading text-2xl">Settings</h1>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Business name</Label>
          <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Business phone</Label>
          <Input value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Stripe reader ID</Label>
          <Input
            placeholder="tmr_..."
            value={stripeReaderId}
            onChange={(e) => setStripeReaderId(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            From Stripe Dashboard → Terminal → Readers, after registering the reader (see SETUP.md).
          </p>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <Label>Business hours</Label>
          {DAYS.map((day, i) => (
            <div key={day} className="flex flex-wrap items-center gap-3">
              <label className="flex w-32 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rows[i].open}
                  onChange={(e) => updateRow(i, { open: e.target.checked })}
                />
                {day}
              </label>
              {rows[i].open && (
                <>
                  <input
                    type="time"
                    value={rows[i].start}
                    onChange={(e) => updateRow(i, { start: e.target.value })}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  />
                  <span className="text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={rows[i].end}
                    onChange={(e) => updateRow(i, { end: e.target.value })}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <Label>Closed dates</Label>
          <p className="text-sm text-muted-foreground">
            Holidays or other one-off days the salon is closed. Recurring bookings skip these automatically.
          </p>
          {closedDates.map((date) => (
            <div key={date} className="flex items-center gap-3">
              <span className="text-sm">{date}</span>
              <Button size="sm" variant="ghost" onClick={() => removeClosedDate(date)}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newClosedDate}
              onChange={(e) => setNewClosedDate(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            />
            <Button size="sm" variant="outline" onClick={addClosedDate}>
              Add
            </Button>
          </div>
        </div>

        <Button className="mt-2 self-start" onClick={handleSave} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  )
}
