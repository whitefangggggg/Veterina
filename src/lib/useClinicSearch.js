import { useEffect, useState } from 'react'
import { fetchClinicSearch, normalizeSearch, searchValidation } from './clinicSearch'

export function useClinicSearch({ query, kind = '', limit = 25, cursor = null, revision = 0, debounce = 250 }) {
  const normalized = normalizeSearch(query)
  const key = JSON.stringify([normalized, kind, limit, cursor, revision])
  const [state, setState] = useState({ key: '', status: 'idle' })
  useEffect(() => {
    if (searchValidation(normalized)) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setState({ key, status: 'loading' })
      try {
        const result = await fetchClinicSearch(normalized, { kind, limit, cursor, signal: controller.signal })
        if (!controller.signal.aborted) setState({ key, status: 'ready', ...result })
      } catch { if (!controller.signal.aborted) setState({ key, status: 'error' }) }
    }, debounce)
    return () => { clearTimeout(timer); controller.abort() }
    // key serializes the cursor to avoid refetching equivalent objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, normalized, kind, limit, revision, debounce])
  if (searchValidation(normalized)) return { status: 'idle', records: [], total: 0, groups: {} }
  return state.key === key ? state : { status: 'loading', records: [], total: 0, groups: {} }
}
