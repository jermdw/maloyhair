import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateSettings, useSettings } from '@/hooks/useSettings'
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
  const [rows, setRows] = useState<DayRow[]>(toRows(undefined))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) return
    setBusinessName(settings.businessName)
    setBusinessPhone(settings.businessPhone)
    setRows(toRows(settings.businessHours))
  }, [settings])

  function updateRow(day: number, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((row, i) => (i === day ? { ...row, ...patch } : row)))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const businessHours: BusinessHours = {}
      rows.forEach((row, day) => {
        if (row.open) businessHours[day] = { start: row.start, end: row.end }
      })
      await updateSettings({ businessName, businessPhone, businessHours })
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

        <div className="mt-2 flex flex-col gap-2">
          <Label>Business hours</Label>
          {DAYS.map((day, i) => (
            <div key={day} className="flex items-center gap-3">
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

        <Button className="mt-2 self-start" onClick={handleSave} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  )
}
