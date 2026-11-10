import { describe, expect, it, vi } from 'vitest'
import { admissionTrackingQr, admissionTrackingUrl, lookupPublicAdmission, sharingState, trackingTime, validTrackingCode } from './admissionTracking'

describe('public admission tracking', () => {
  it('validates a case-sensitive 13-character alphanumeric capability without coercion', () => {
    expect(validTrackingCode('Aa0Zz91234567')).toBe(true)
    for (const value of [null, 1234567890123, '', 'a'.repeat(12), 'a'.repeat(14), 'Aa0Zz9123456_', ' Aa0Zz91234567']) expect(validTrackingCode(value)).toBe(false)
    expect(admissionTrackingUrl('Aa0Zz91234567', 'https://clinic.example/a?b')).toBe('https://clinic.example/track-admission#Aa0Zz91234567')
    expect(admissionTrackingUrl('Aa0Zz91234567', 'https://user:pass@clinic.example')).toBe('')
    expect(admissionTrackingUrl('Aa0Zz91234567', 'javascript:alert(1)')).toBe('')
  })
  it('generates QR locally and keeps the secret out of request URLs, cookies and caches', async () => {
    const qr = await admissionTrackingQr('Aa0Zz91234567', 'https://clinic.example')
    expect(qr.image).toMatch(/^data:image\/png;base64,/)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'admitted', petName: 'Mochi' })))
    expect((await lookupPublicAdmission('Aa0Zz91234567', { fetcher, baseUrl: 'https://api.example' })).admission.petName).toBe('Mochi')
    expect(fetcher).toHaveBeenCalledWith('https://api.example/functions/v1/admission-tracking', expect.objectContaining({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', body: '{"token":"Aa0Zz91234567"}' }))
    fetcher.mockClear()
    expect(await lookupPublicAdmission('bad', { fetcher })).toEqual({ status: 'unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('distinguishes unavailable, throttled and temporary errors', async () => {
    for (const [status, state] of [[404, 'unavailable'], [429, 'limited']]) expect(await lookupPublicAdmission('Aa0Zz91234567', { fetcher: async () => new Response('', { status }) })).toEqual({ status: state })
    await expect(lookupPublicAdmission('Aa0Zz91234567', { fetcher: async () => new Response('', { status: 503 }) })).rejects.toThrow('temporarily unavailable')
  })
  it('formats clinic timezone and reflects expiry and closure independently of clinical condition', () => {
    expect(trackingTime('2026-11-09T00:00:00Z', 'Asia/Singapore')).toContain('08:00 (Asia/Singapore)')
    const now = Date.parse('2026-11-09T00:00:00Z')
    const sharing = { enabled: true, expires_at: '2026-12-01T00:00:00Z' }
    expect(sharingState(sharing, { status: 'admitted', condition: 'critical' }, now)).toBe('Enabled')
    expect(sharingState(sharing, { status: 'cancelled' }, now)).toBe('Unavailable')
    expect(sharingState(sharing, { status: 'discharged', closed_at: '2026-11-02T00:00:00Z' }, now)).toBe('Expired')
  })
})
