import { describe, expect, it, vi } from 'vitest'
import { admissionTrackingHandler, trackingClientHash } from './admissionTracking'
import { clinicalCursorCodec } from './admissionTrackingCursor'

describe('admission tracking Edge handler', () => {
  const request = (body: unknown) => new Request('https://api.example/admission-tracking', { method: 'POST', body: JSON.stringify(body) })
  const build = (lookup = vi.fn(async () => null as Record<string, unknown> | null)) => ({ lookup, handler: admissionTrackingHandler({ lookup, clientHash: async () => 'a'.repeat(64), origin: 'https://clinic.example' }) })
  it('hashes addresses with a keyed digest', async () => {
    const hash = await trackingClientHash('127.0.0.1', 'server-only')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(await trackingClientHash('127.0.0.1', 'different')).not.toBe(hash)
  })
  it('bounds input, throttles malformed requests and never returns error detail', async () => {
    const { lookup, handler } = build()
    for (const body of [{ token: 'bad' }, { token: 'x'.repeat(2500) }, null]) {
      const response = await handler(request(body))
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'NOT_AVAILABLE' })
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
    }
    expect(lookup).toHaveBeenCalledTimes(3)
    expect(lookup).toHaveBeenLastCalledWith('', 'a'.repeat(64))
  })
  it('accepts no writes or GET token queries and handles shared rate limits and outages', async () => {
    const { lookup, handler } = build()
    expect((await handler(new Request('https://api.example/?token=Aa0Zz91234567'))).status).toBe(405)
    expect(lookup).not.toHaveBeenCalled()
    lookup.mockResolvedValue({ limited: true })
    const limited = await handler(request({ token: 'Aa0Zz91234567' }))
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60')
    lookup.mockRejectedValue(new Error('SECRET database detail'))
    const failed = await handler(request({ token: 'Aa0Zz91234567' }))
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('SECRET')
  })
  it('returns only the allowlisted database DTO on anonymous POST', async () => {
    const { lookup, handler } = build()
    lookup.mockResolvedValue({ petName: 'Mochi', status: 'admitted' })
    const response = await handler(request({ token: 'Aa0Zz91234567', admissionId: 'ignored', action: 'write' }))
    expect(await response.json()).toEqual({ petName: 'Mochi', status: 'admitted' })
    expect(lookup).toHaveBeenCalledWith('Aa0Zz91234567', 'a'.repeat(64))
  })
  it('encrypts continuation points and rejects forged or cross-section cursors while consuming a lookup', async () => {
    const next = { at: '2026-11-09T01:00:00Z', id: '12345678-1234-1234-1234-123456789abc' }
    const lookup = vi.fn(async (..._args: unknown[]) => ({ section: 'monitoring', page: { items: [{ note: 'Clinical note' }], next } }) as Record<string, unknown> | null)
    const handler = admissionTrackingHandler({ lookup, clientHash: async () => 'a'.repeat(64), origin: '*', cursors: clinicalCursorCodec('server-secret') })
    const first = await handler(request({ token: 'Aa0Zz91234567', section: 'monitoring' }))
    const body = await first.json()
    expect(JSON.stringify(body)).not.toContain(next.id)
    expect(body.page.next).toBeUndefined()
    expect(typeof body.page.cursor).toBe('string')
    await handler(request({ token: 'Aa0Zz91234567', section: 'monitoring', cursor: body.page.cursor }))
    expect(lookup).toHaveBeenLastCalledWith('Aa0Zz91234567', 'a'.repeat(64), { section: 'monitoring', cursor: next })
    lookup.mockResolvedValue(null)
    const invalid = await handler(request({ token: 'Aa0Zz91234567', section: 'orders', cursor: body.page.cursor }))
    expect(invalid.status).toBe(404)
    expect(lookup).toHaveBeenLastCalledWith('', 'a'.repeat(64), { section: 'orders', cursor: null })
  })
})
