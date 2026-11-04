import { describe, expect, it, vi } from 'vitest'
import { invokeSubscription, remainingTime, subscriptionError } from './subscriptions'
import { getAccessState, safeAuthReturnTo } from './authAccess'

describe('subscription access and timers', () => {
  const user = { id: 'owner' }, profile = { id: 'owner', is_active: true, role: 'owner' }
  it('separates expiry, disabled accounts, platform administration and owner setup', () => {
    expect(getAccessState({ user, profile, accountAccess: { subscription: { status: 'expired' } } })).toBe('expired')
    expect(getAccessState({ user, profile, accountAccess: { subscription: { status: 'disabled' } } })).toBe('pending')
    expect(getAccessState({ user, accountAccess: { isPlatformAdmin: true } })).toBe('platform-admin')
    expect(getAccessState({ user, needsRegistration: true })).toBe('onboarding')
    expect(getAccessState({ user: { ...user, user_metadata: { isPlatformAdmin: true } } })).toBe('pending')
  })
  it('counts down to expiry without negative time and preserves safe admin returns', () => {
    const now = Date.parse('2026-11-03T00:00:00Z')
    expect(remainingTime('2026-11-04T02:03:00Z', now)).toBe('1d 2h 3m')
    expect(remainingTime('2026-11-03T00:00:00Z', now)).toBe('Expired')
    expect(remainingTime(null, now)).toBe('Not activated')
    expect(safeAuthReturnTo('/admin')).toBe('/admin')
    expect(safeAuthReturnTo('//bad.example/admin')).toBe('/dashboard')
  })
  it('translates activation failures returned by verified-auth functions', async () => {
    const client = { functions: { invoke: vi.fn(async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'ACTIVATION_CODE_USED' }), { status: 400 }) } })) } }
    await expect(invokeSubscription(client, 'clinic-activation', {})).rejects.toThrow('already used')
    expect(subscriptionError({ message: 'ACTIVATION_CODE_EXPIRED' })).toContain('expired')
  })
})
