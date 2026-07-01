import { useEffect, useState } from 'react'
import { onSnapshot, setDoc } from 'firebase/firestore'
import { settingsDoc } from '@/lib/firestore/converters'
import type { Settings } from '@/types/firestore'

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onSnapshot(settingsDoc(), (snap) => {
      setSettings(snap.exists() ? snap.data() : null)
      setLoading(false)
    })
  }, [])

  return { settings, loading }
}

export async function updateSettings(patch: Partial<Settings>) {
  await setDoc(settingsDoc(), patch, { merge: true })
}
