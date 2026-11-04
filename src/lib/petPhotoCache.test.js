import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPetPhotoCache } from './petPhotoCache'

describe('private session photo cache', () => {
  let cache, revoke, create, load
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    let id = 0
    revoke = vi.fn(); create = vi.fn(() => `blob:photo-${++id}`)
    load = vi.fn(async () => new Blob(['123']))
    cache = createPetPhotoCache({ ttlMs: 1000, maxBytes: 5, createUrl: create, revokeUrl: revoke })
  })
  afterEach(() => { cache.clear(); vi.useRealTimers() })
  it('coalesces concurrent reads and reuses the URL across navigation', async () => {
    const one = cache.acquire('staff', 'pet', 1, load), two = cache.acquire('staff', 'pet', 1, load)
    expect(await one.promise).toBe(await two.promise)
    one.release(); two.release()
    expect(revoke).not.toHaveBeenCalled()
    const back = cache.acquire('staff', 'pet', 1, load)
    expect(back.url).toBe('blob:photo-1')
    expect(load).toHaveBeenCalledTimes(1)
    back.release()
  })
  it('expires idle photos and revokes their URLs', async () => {
    const first = cache.acquire('staff', 'pet', 1, load)
    await first.promise; first.release()
    await vi.advanceTimersByTimeAsync(1001)
    expect(revoke).toHaveBeenCalledWith('blob:photo-1')
    const next = cache.acquire('staff', 'pet', 1, load)
    await next.promise
    expect(load).toHaveBeenCalledTimes(2); next.release()
  })
  it('evicts idle photos under the byte budget and keeps revisions separate', async () => {
    const old = cache.acquire('staff', 'pet', 1, load); await old.promise; old.release()
    const fresh = cache.acquire('staff', 'pet', 2, load); await fresh.promise; fresh.release()
    expect(revoke).toHaveBeenCalledWith('blob:photo-1')
    expect(cache.peek('staff', 'pet', 2)).toBe('blob:photo-2')
    expect(cache.peek('staff', 'pet', 1)).toBeNull()
  })
  it('clears other accounts and discards late responses after sign-out', async () => {
    let finish
    const pending = cache.acquire('staff', 'pet', 1, () => new Promise((resolve) => { finish = resolve }))
    await Promise.resolve(); cache.clear(); finish(new Blob(['123']))
    expect(await pending.promise).toBeNull(); pending.release()
    const one = cache.acquire('staff', 'pet', 1, load); await one.promise
    const two = cache.acquire('other', 'pet', 1, load); await two.promise
    expect(revoke).toHaveBeenCalledWith('blob:photo-1')
    expect(cache.peek('staff', 'pet', 1)).toBeNull()
    one.release(); two.release()
  })
  it('retries failed reads and invalidates replaced/removed photos', async () => {
    const failed = cache.acquire('staff', 'pet', 1, async () => { throw Error('offline') })
    expect(await failed.promise).toBeNull(); failed.release()
    const good = cache.acquire('staff', 'pet', 1, load); await good.promise
    cache.invalidate('pet')
    expect(cache.peek('staff', 'pet', 1)).toBeNull()
    good.release(); expect(revoke).toHaveBeenCalledWith('blob:photo-1')
  })
})
