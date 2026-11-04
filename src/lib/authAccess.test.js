import { describe, expect, it } from 'vitest'
import { authErrorMessage, getAccessState, safeReturnTo } from './authAccess'

describe('clinic access decisions', () => {
  const user = { id: 'staff-a' }
  const profile = { id: user.id, role: 'clinical_staff', is_active: true }

  it('waits for authentication and profile checks before allowing access', () => {
    expect(getAccessState({ loading: true, user, profile })).toBe('loading')
    expect(getAccessState({ error: 'Network failure', user, profile })).toBe('error')
    expect(getAccessState({ user: null })).toBe('signed-out')
  })

  it('requires an active supported staff profile belonging to the current user', () => {
    expect(getAccessState({ user, profile })).toBe('approved')
    expect(getAccessState({ user, profile: { ...profile, role: 'owner' } })).toBe('approved')
    for (const invalid of [null, { ...profile, is_active: false }, { ...profile, role: 'admin' }, { ...profile, id: 'other-user' }]) {
      expect(getAccessState({ user, profile: invalid })).toBe('pending')
    }
  })

  it('does not authorize users through editable metadata', () => {
    expect(getAccessState({ user: { ...user, user_metadata: { role: 'owner', is_active: true } } })).toBe('pending')
  })
})

describe('sign-in return destinations', () => {
  it.each(['/dashboard', '/queue', '/patients/pet-1', '/appointments?date=2026-10-17#agenda', '/inventory', '/settings', '/knowledge#document-1'])('preserves clinic path %s', (path) => {
    expect(safeReturnTo(path)).toBe(path)
  })

  it.each([null, undefined, '', 'https://evil.example/patients', '//evil.example/patients', '/\\evil.example/patients', '/sign-in', '/create-account', '/access-pending', '/dashboard-other', '/patients/../../sign-in', '/patients/%2e%2e/%2e%2e/sign-in', '/patients/%2f%2fevil.example', '/patients//evil', '/patients\n', 'javascript:alert(1)'])('rejects unsafe or looping return path %s', (path) => {
    expect(safeReturnTo(path)).toBe('/dashboard')
  })
})

describe('auth error messages', () => {
  it('explains invalid credentials, unconfirmed email, and request limits', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toContain('email or password is incorrect')
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toContain('confirm your email')
    expect(authErrorMessage({ code: 'over_email_send_rate_limit' })).toContain('Too many attempts')
    expect(authErrorMessage({ code: 'email_address_not_authorized' })).toContain('Email delivery is not available')
    expect(authErrorMessage({ message: 'Password is too weak' })).toBe('Password is too weak')
    expect(authErrorMessage(null)).toContain('Please try again')
  })
})
