import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../context/AuthContext'
import { recentPatientsKey, recentPatientsStore as store } from './recentPatients'

export function useRecentPatients() {
  const { user, profile, accountAccess } = useAuth()
  const key = recentPatientsKey(user?.id, profile?.clinic_id || accountAccess?.subscription?.clinicId)
  const ids = useSyncExternalStore(store.subscribe, () => store.getSnapshot(key), () => store.getSnapshot(null))
  useEffect(() => {
    store.refresh(key)
    const changed = (event) => { if (event.key === key || event.key === null) store.refresh(key) }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [key])
  const record = useCallback((id) => store.record(key, id), [key])
  const clear = useCallback(() => store.clear(key), [key])
  return { ids, record, clear }
}
