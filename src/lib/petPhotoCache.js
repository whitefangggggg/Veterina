// Session-only photo URLs survive navigation. Never write images to browser
// storage; purge them on sign-out/account changes and after five idle minutes.
export function createPetPhotoCache({ now = Date.now, ttlMs = 300_000, maxBytes = 12 * 1024 * 1024, maxEntries = 100,
  createUrl = (blob) => URL.createObjectURL(blob), revokeUrl = (url) => URL.revokeObjectURL(url) } = {}) {
  let account = null, bytes = 0
  const entries = new Map()
  const keyFor = (petId, revision) => JSON.stringify([petId, revision])
  const discard = (key, entry) => {
    if (entries.get(key) === entry) { entries.delete(key); bytes -= entry.bytes }
    clearTimeout(entry.timer); entry.discarded = true
    if (!entry.users && entry.url) { revokeUrl(entry.url); entry.url = null }
  }
  const trim = () => {
    for (const [key, entry] of entries) {
      if (!entry.users && (entry.expires <= now() || bytes > maxBytes || entries.size > maxEntries)) discard(key, entry)
    }
  }
  const cache = {
    setAccount(next) {
      if (next === account) return
      cache.clear(); account = next
    },
    clear() {
      for (const [key, entry] of entries) {
        if (entry.url) { revokeUrl(entry.url); entry.url = null }
        discard(key, entry)
      }
      account = null
    },
    invalidate(petId) { for (const [key, entry] of entries) if (entry.petId === petId) discard(key, entry) },
    peek(userId, petId, revision) {
      if (userId !== account) return null
      const entry = entries.get(keyFor(petId, revision))
      return entry && !entry.discarded && (entry.users || entry.expires > now()) ? entry.url : null
    },
    acquire(userId, petId, revision, load) {
      cache.setAccount(userId)
      trim()
      const key = keyFor(petId, revision)
      let entry = entries.get(key)
      if (!entry) {
        entry = { petId, users: 0, bytes: 0, url: null, expires: Infinity, discarded: false }
        entries.set(key, entry)
        entry.promise = Promise.resolve().then(load).then((blob) => {
          if (!(blob instanceof Blob) || !blob.size) throw new Error('Invalid photo response')
          if (entry.discarded || entries.get(key) !== entry) return null
          entry.url = createUrl(blob); entry.bytes = blob.size; bytes += blob.size
          entry.expires = now() + ttlMs
          trim()
          return entry.url
        }).catch(() => { discard(key, entry); return null })
      }
      clearTimeout(entry.timer)
      entry.users++
      // Refresh LRU position without changing the in-flight promise.
      entries.delete(key); entries.set(key, entry)
      let released = false
      return { url: entry.url, promise: entry.promise, release() {
        if (released) return
        released = true; entry.users--
        if (entry.discarded) { if (!entry.users && entry.url) { revokeUrl(entry.url); entry.url = null }; return }
        entry.expires = now() + ttlMs
        entry.timer = setTimeout(() => { if (!entry.users) discard(key, entry) }, ttlMs)
        trim()
      } }
    },
  }
  return cache
}

export const petPhotoCache = createPetPhotoCache()
