import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { serviceHistoryCol } from '@/lib/firestore/converters'
import type { ServiceHistoryEntry } from '@/types/firestore'

/** Imported DaySmart history for one client. Sorted client-side rather than via a
 *  server-side orderBy, since that would need a composite index for no real benefit
 *  on a per-client result set this small. */
export function useClientServiceHistory(clientId: string | undefined) {
  const [entries, setEntries] = useState<ServiceHistoryEntry[]>([])

  useEffect(() => {
    if (!clientId) {
      setEntries([])
      return
    }
    const q = query(serviceHistoryCol(), where('clientId', '==', clientId))
    return onSnapshot(q, (snap) => setEntries(snap.docs.map((d) => d.data())))
  }, [clientId])

  return entries
}
