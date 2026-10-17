import { describe, expect, it } from 'vitest'
import { validateNewPassword } from './passwordRecovery'
import { authErrorMessage, safeReturnTo } from './authAccess'

describe('new password validation', () => {
  it('requires at least eight characters and matching confirmation without trimming passwords', () => {
    expect(validateNewPassword('', '')).toContain('8 characters')
    expect(validateNewPassword('short', 'short')).toContain('8 characters')
    expect(validateNewPassword('password123', 'Password123')).toContain('do not match')
    expect(validateNewPassword(' password123 ', 'password123')).toContain('do not match')
    expect(validateNewPassword('password123', 'password123')).toBe('')
  })

  it('provides actionable messages for expired links, missing sessions, and password policies', () => {
    expect(authErrorMessage({ name: 'AuthSessionMissingError' })).toContain('reset link')
    expect(authErrorMessage({ name: 'AuthImplicitGrantRedirectError', message: 'URL error' })).toContain('invalid or has expired')
    expect(authErrorMessage({ code: 'otp_expired' })).toContain('new link')
    expect(authErrorMessage({ code: 'same_password' })).toContain('different')
    expect(authErrorMessage({ code: 'weak_password' })).toContain('stronger password')
    expect(authErrorMessage({ code: 'reauthentication_needed' })).toContain('verify your identity')
  })

  it.each(['/forgot-password', '/reset-password', '/reset-password?next=https://evil.example'])('cannot return to recovery page %s', (path) => {
    expect(safeReturnTo(path)).toBe('/dashboard')
  })
})
