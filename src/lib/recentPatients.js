const empty = Object.freeze([])
export const recentPatientsKey = (actorId, clinicId) => actorId && clinicId
  ? `vt_recent_patients:${encodeURIComponent(clinicId)}:${encodeURIComponent(actorId)}` : null

const ids = (value) => Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(0, 5) : []

export function createRecentPatientsStore(storage = () => globalThis.localStorage) {
  const snapshots = new Map(), listeners = new Set()
  const read = (key) => {
    let value
    try { value = storage().getItem(key) } catch { return null }
    try { return ids(JSON.parse(value)) } catch { return [] }
  }
  const notify = () => listeners.forEach((listener) => listener())
  const getSnapshot = (key) => {
    if (!key) return empty
    if (!snapshots.has(key)) snapshots.set(key, read(key) || empty)
    return snapshots.get(key)
  }
  return {
    getSnapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    record(key, id) {
      if (!key || ids([id]).length === 0 || getSnapshot(key)[0] === id) return
      const next = ids([id, ...getSnapshot(key).filter((old) => old !== id)])
      snapshots.set(key, next)
      try { storage().setItem(key, JSON.stringify(next)) } catch { /* Session context still works when storage is blocked. */ }
      notify()
    },
    refresh(key) {
      if (!key) return
      const next = read(key)
      if (next === null) return
      if (JSON.stringify(next) === JSON.stringify(getSnapshot(key))) return
      snapshots.set(key, next); notify()
    },
    clear(key) {
      if (!key) return
      snapshots.set(key, empty)
      try { storage().removeItem(key) } catch { /* Clear in-memory context too. */ }
      notify()
    },
  }
}

export const recentPatientsStore = createRecentPatientsStore()
