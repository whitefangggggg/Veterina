import { describe, expect, it, vi } from 'vitest'
import { createAuthStore } from './authStore'

const sessionFor = (id) => ({ user: { id, email: `${id}@example.org` }, access_token: `token-${id}` })
const profileFor = (id, extra = {}) => ({ id, full_name: 'Test staff', role: 'clinical_staff', is_active: true, ...extra })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
const accountAccess = (extra = {}) => ({ isPlatformAdmin: false, needsRegistration: false, serverNow: new Date().toISOString(), subscription: null, ...extra })

function mockClient(initial = null) {
  const subscriptions = []
  let current = initial
  let profile = initial ? profileFor(initial.user.id) : null
  let profileError = null
  const maybeSingle = vi.fn(async () => ({ data: profile, error: profileError }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const client = {
    rpc: vi.fn(async (name) => ({ data: name === 'account_access' ? accountAccess({ needsRegistration: !profile && current?.user.app_metadata?.providers?.includes('google') === true,
      subscription: profile ? { status: 'active', expiresAt: new Date(Date.now() + 86400000).toISOString() } : null }) : { valid: true, clinicName: 'Test clinic' }, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: { status: 'pending' }, error: null })) },
    from: vi.fn(() => ({ select })),
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        const subscription = { callback, unsubscribe: vi.fn() }
        subscriptions.push(subscription)
        return { data: { subscription } }
      }),
      getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session: current }, error: null })),
      signInWithOAuth: vi.fn(async () => ({ data: { provider: 'google', url: 'https://accounts.google.com/' }, error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      resend: vi.fn(async () => ({ data: {}, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      initialize: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: current?.user ?? null }, error: null })),
      updateUser: vi.fn(async () => ({ data: { user: current?.user ?? null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  }
  return {
    client, subscriptions, maybeSingle, eq, select,
    setProfile(value, error = null) { profile = value; profileError = error },
    emit(session, event = 'SIGNED_IN') { current = session; subscriptions.at(-1).callback(event, session) },
  }
}

describe('Google authentication', () => {
  const googleSession = { ...sessionFor('google-user'), user: { ...sessionFor('google-user').user, app_metadata: { providers: ['google'] } } }

  it('starts Google OAuth with a same-origin callback and a safe return path', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await store.signInWithGoogle({ origin: 'https://veterina.example', returnTo: '/patients?view=all#records' })
    expect(mock.client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: {
      redirectTo: 'https://veterina.example/sign-in?next=%2Fpatients%3Fview%3Dall%23records&auth=google', queryParams: { prompt: 'select_account' },
    } })
    await store.signInWithGoogle({ origin: 'https://veterina.example', returnTo: '//evil.example' })
    expect(mock.client.auth.signInWithOAuth.mock.lastCall[0].options.redirectTo).toContain('next=%2Fdashboard')
    const error = new Error('Google is unavailable')
    mock.client.auth.signInWithOAuth.mockResolvedValueOnce({ error })
    await expect(store.signInWithGoogle({ origin: 'https://veterina.example' })).rejects.toThrow('Google is unavailable')
  })

  it('routes new Google identities into setup without granting clinic access', async () => {
    const mock = mockClient(googleSession)
    mock.setProfile(null)
    mock.client.rpc.mockResolvedValue({ data: accountAccess({ needsRegistration: true }), error: null })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot()).toMatchObject({ access: 'onboarding', profile: null })
    expect(mock.client.rpc).toHaveBeenCalledWith('account_access')
    stop()
  })

  it.each(['pending', 'rejected', 'registered'])('does not reopen setup for a %s registration', async (status) => {
    const mock = mockClient(googleSession)
    mock.setProfile(null)
    mock.client.rpc.mockResolvedValue({ data: accountAccess({ registrationType: status }), error: null })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().access).toBe('pending')
    stop()
  })

  it('fails closed when registration lookup fails and ignores a result after sign-out', async () => {
    const mock = mockClient(googleSession)
    mock.setProfile(null)
    mock.client.rpc.mockResolvedValueOnce({ error: new Error('Network failure') })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().access).toBe('error')
    const lookup = deferred()
    mock.client.rpc.mockReturnValueOnce(lookup.promise)
    const refreshing = store.refreshAccess()
    await settle()
    mock.emit(null, 'SIGNED_OUT')
    lookup.resolve({ data: accountAccess({ needsRegistration: true }), error: null })
    await refreshing
    expect(store.getSnapshot()).toMatchObject({ access: 'signed-out', needsRegistration: false })
    stop()
  })

  it('submits only registration choices and propagates validation failures', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await store.completeGoogleRegistration({ fullName: ' Google Staff ', accountType: 'staff', veterinaCode: 'vet 0123456789abcdef0123' })
    expect(mock.client.functions.invoke).toHaveBeenCalledWith('google-registration', { body: {
      fullName: 'Google Staff', accountType: 'staff', clinicName: '', veterinaCode: 'VET-0123456789ABCDEF0123',
    } })
    const error = new Error('Invalid Veterina Code')
    mock.client.functions.invoke.mockResolvedValueOnce({ error })
    await expect(store.completeGoogleRegistration({ fullName: 'Staff', accountType: 'staff' })).rejects.toThrow('Invalid Veterina Code')
  })
})

describe('auth session lifecycle', () => {
  it('expires at server time and clears subscription state on account changes', async () => {
    const mock = mockClient(sessionFor('owner-a'))
    const serverNow = Date.now() + 3600000
    mock.client.rpc.mockResolvedValue({ data: accountAccess({ serverNow: new Date(serverNow).toISOString(), subscription: { status: 'active', expiresAt: new Date(serverNow + 1000).toISOString() } }), error: null })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().serverTimeOffset).toBeGreaterThan(3599000)
    const current = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(current + 1100)
    try {
      store.expireSubscription()
      expect(store.getSnapshot().access).toBe('expired')
      mock.emit(sessionFor('owner-b'))
      expect(store.getSnapshot()).toMatchObject({ accountAccess: null, profile: null, access: 'loading' })
    } finally { clock.mockRestore(); stop() }
  })

  it('recognizes a platform administrator without granting a clinic profile', async () => {
    const mock = mockClient(sessionFor('platform-admin'))
    mock.setProfile(null)
    mock.client.rpc.mockResolvedValue({ data: accountAccess({ isPlatformAdmin: true }), error: null })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot()).toMatchObject({ access: 'platform-admin', profile: null })
    stop()
  })

  it('fails closed when an active profile has no subscription response', async () => {
    const mock = mockClient(sessionFor('owner-a'))
    mock.client.rpc.mockResolvedValue({ data: accountAccess(), error: null })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot()).toMatchObject({ access: 'error', profile: null, accountAccess: null })
    stop()
  })

  it('restores an approved session, scopes the profile lookup, and unsubscribes', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const store = createAuthStore(mock.client)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    expect(store.getSnapshot().access).toBe('loading')
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().access).toBe('approved')
    expect(mock.client.from).toHaveBeenCalledWith('profiles')
    expect(mock.eq).toHaveBeenCalledWith('id', 'staff-a')
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    stop()
    expect(mock.subscriptions[0].unsubscribe).toHaveBeenCalledOnce()
  })

  it('requires approval after signup and picks up administrator approval on retry', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().access).toBe('signed-out')
    mock.emit(sessionFor('new-staff'))
    expect(mock.client.from).not.toHaveBeenCalled() // Not inside the auth callback.
    expect(store.getSnapshot().access).toBe('loading')
    await settle()
    expect(store.getSnapshot().access).toBe('pending')
    mock.setProfile(profileFor('new-staff'))
    await store.refreshAccess()
    expect(store.getSnapshot().access).toBe('approved')
    mock.setProfile(profileFor('new-staff', { is_active: false }))
    await store.refreshAccess()
    expect(store.getSnapshot().access).toBe('pending')
    stop()
  })

  it('keeps network failures distinct from missing membership and allows retry', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    mock.setProfile(null, { message: 'Database unavailable' })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().access).toBe('error')
    mock.setProfile(null)
    await store.refreshAccess()
    expect(store.getSnapshot().access).toBe('pending')
    stop()
  })

  it('discards stale profile results after account switching and sign-out', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const oldProfile = deferred()
    mock.maybeSingle.mockReturnValueOnce(oldProfile.promise)
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    mock.emit(sessionFor('staff-b'))
    expect(store.getSnapshot().profile).toBeNull()
    mock.setProfile(null)
    await settle()
    oldProfile.resolve({ data: profileFor('staff-a'), error: null })
    await settle()
    expect(store.getSnapshot().user.id).toBe('staff-b')
    expect(store.getSnapshot().access).toBe('pending')
    mock.emit(null, 'SIGNED_OUT')
    expect(store.getSnapshot()).toMatchObject({ access: 'signed-out', profile: null, user: null })
    stop()
  })

  it('does not let delayed initial hydration replace a newer auth event', async () => {
    const mock = mockClient()
    const hydration = deferred()
    mock.client.auth.getSession.mockReturnValue(hydration.promise)
    const store = createAuthStore(mock.client)
    const stop = store.start()
    mock.emit(sessionFor('staff-b'))
    hydration.resolve({ data: { session: sessionFor('staff-a') }, error: null })
    await settle()
    expect(store.getSnapshot().user.id).toBe('staff-b')
    stop()
  })

  it('preserves approved state during token refresh, then enforces revoked access', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    const profileRead = deferred()
    mock.maybeSingle.mockReturnValueOnce(profileRead.promise)
    mock.emit({ ...sessionFor('staff-a'), access_token: 'refreshed-token' }, 'TOKEN_REFRESHED')
    expect(store.getSnapshot()).toMatchObject({ access: 'approved', checking: true, loading: false })
    await settle()
    profileRead.resolve({ data: null, error: null })
    await settle()
    expect(store.getSnapshot().access).toBe('pending')
    stop()
  })

  it('ignores callbacks and reads from a previous StrictMode lifecycle', async () => {
    const mock = mockClient()
    const oldHydration = deferred()
    mock.client.auth.getSession.mockReturnValueOnce(oldHydration.promise)
    const store = createAuthStore(mock.client)
    const stopFirst = store.start()
    stopFirst()
    const stopSecond = store.start()
    await settle()
    mock.subscriptions[0].callback('SIGNED_IN', sessionFor('stale-user'))
    oldHydration.resolve({ data: { session: sessionFor('stale-user') }, error: null })
    await settle()
    expect(store.getSnapshot().access).toBe('signed-out')
    stopSecond()
  })

  it('fails closed when configuration is missing', async () => {
    const store = createAuthStore(null)
    expect(store.getSnapshot().access).toBe('error')
    const stop = store.start()
    expect(() => stop()).not.toThrow()
    await expect(store.signIn({})).rejects.toThrow('publishable key')
  })

  it('recovers from session restoration failure', async () => {
    const mock = mockClient()
    mock.client.auth.getSession.mockResolvedValueOnce({ data: {}, error: new Error('Network failure') })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().access).toBe('error')
    await store.refreshAccess()
    expect(store.getSnapshot().access).toBe('signed-out')
    stop()
  })
})

describe('auth actions', () => {
  it('validates the clinic code and submits only pending staff application metadata', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await expect(store.signUp({ fullName: ' Test Staff ', email: ' staff@example.org ', password: 'password123', veterinaCode: 'VET-1234567890ABCDEF1234', emailRedirectTo: 'https://clinic.example/sign-in' })).resolves.toEqual({ session: null })
    expect(mock.client.auth.signUp).toHaveBeenCalledWith({
      email: 'staff@example.org', password: 'password123',
      options: { data: { full_name: 'Test Staff', application: 'veterina', account_type: 'staff', veterina_code: 'VET-1234567890ABCDEF1234' }, emailRedirectTo: 'https://clinic.example/sign-in' },
    })
    expect(mock.client.from).not.toHaveBeenCalled()
  })
  it('rejects invalid or rotated codes before creating an Auth account', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await expect(store.signUp({ fullName: 'Staff', email: 'staff@example.org', password: 'password123', veterinaCode: 'invalid' })).rejects.toThrow('Veterina Code')
    mock.client.rpc.mockResolvedValue({ data: { valid: false }, error: null })
    await expect(store.signUp({ fullName: 'Staff', email: 'staff@example.org', password: 'password123', veterinaCode: 'VET-1234567890ABCDEF1234' })).rejects.toThrow('invalid or has changed')
    expect(mock.client.auth.signUp).not.toHaveBeenCalled()
  })

  it('registers a new clinic owner without looking up a staff code', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await store.signUp({ fullName: ' New Owner ', email: ' owner@example.org ', password: 'password123', accountType: 'owner', clinicName: ' New clinic ', veterinaCode: 'ignored', emailRedirectTo: 'https://clinic.example/sign-in' })
    expect(mock.client.rpc).not.toHaveBeenCalled()
    expect(mock.client.auth.signUp).toHaveBeenCalledWith({
      email: 'owner@example.org', password: 'password123',
      options: { data: { full_name: 'New Owner', application: 'veterina', account_type: 'owner', clinic_name: 'New clinic' }, emailRedirectTo: 'https://clinic.example/sign-in' },
    })
    expect(mock.client.from).not.toHaveBeenCalled()
  })

  it('rejects missing clinic names and unsupported account types before signup', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    const details = { fullName: 'Owner', email: 'owner@example.org', password: 'password123', accountType: 'owner' }
    await expect(store.signUp({ ...details, clinicName: ' ' })).rejects.toThrow('clinic name')
    await expect(store.signUp({ ...details, clinicName: 'a'.repeat(161) })).rejects.toThrow('clinic name')
    await expect(store.signUp({ ...details, accountType: 'admin' })).rejects.toThrow('Choose Owner or Staff')
    expect(mock.client.auth.signUp).not.toHaveBeenCalled()
  })

  it('propagates invalid credentials and signs out locally without leaving access behind', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    const error = { code: 'invalid_credentials', message: 'Invalid login credentials' }
    mock.client.auth.signInWithPassword.mockResolvedValue({ data: {}, error })
    await expect(store.signIn({ email: ' staff@example.org ', password: 'incorrect' })).rejects.toEqual(error)
    expect(mock.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'staff@example.org', password: 'incorrect' })
    mock.client.auth.signOut.mockResolvedValueOnce({ error: new Error('Network failure') })
    await expect(store.signOut()).rejects.toThrow('Network failure')
    expect(store.getSnapshot().access).toBe('approved')
    await store.signOut()
    expect(mock.client.auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' })
    expect(store.getSnapshot()).toMatchObject({ access: 'signed-out', session: null, user: null, profile: null })
    stop()
  })
})

describe('confirmation email resend', () => {
  it('requests a signup link for the trimmed email with the sign-in redirect and never creates another account', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await store.resendConfirmation({ email: ' staff@example.org ', emailRedirectTo: 'https://clinic.example.org/sign-in?next=%2Fpatients' })
    expect(mock.client.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'staff@example.org', options: { emailRedirectTo: 'https://clinic.example.org/sign-in?next=%2Fpatients' } })
    expect(mock.client.auth.signUp).not.toHaveBeenCalled()
    expect(mock.client.from).not.toHaveBeenCalled()
  })

  it('rejects missing addresses and propagates provider and rate limit errors', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await expect(store.resendConfirmation({ email: '  ' })).rejects.toThrow('Enter your email address')
    expect(mock.client.auth.resend).not.toHaveBeenCalled()
    const error = { code: 'over_email_send_rate_limit' }
    mock.client.auth.resend.mockResolvedValueOnce({ error })
    await expect(store.resendConfirmation({ email: 'staff@example.org' })).rejects.toEqual(error)
  })
})

describe('password recovery', () => {
  it('sends a trimmed email and the application callback, and propagates send limits', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    await store.requestPasswordReset({ email: ' staff@example.org ', redirectTo: 'http://localhost:5173/reset-password?next=%2Fpatients' })
    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledWith('staff@example.org', { redirectTo: 'http://localhost:5173/reset-password?next=%2Fpatients' })
    const error = { code: 'over_email_send_rate_limit' }
    mock.client.auth.resetPasswordForEmail.mockResolvedValue({ error })
    await expect(store.requestPasswordReset({ email: 'staff@example.org' })).rejects.toEqual(error)
    expect(mock.client.from).not.toHaveBeenCalled()
  })

  it('keeps recovery active through token refresh and profile failures, then clears it on sign-out', async () => {
    const mock = mockClient()
    mock.setProfile(null, { message: 'Profile unavailable' })
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    mock.emit(sessionFor('staff-a'), 'PASSWORD_RECOVERY')
    expect(store.getSnapshot().recoveringPassword).toBe(true)
    await settle()
    expect(store.getSnapshot()).toMatchObject({ access: 'error', recoveringPassword: true })
    await expect(store.verifyPasswordResetSession()).resolves.toEqual(sessionFor('staff-a').user)
    mock.emit(sessionFor('staff-a'), 'TOKEN_REFRESHED')
    expect(store.getSnapshot().recoveringPassword).toBe(true)
    mock.emit(null, 'SIGNED_OUT')
    expect(store.getSnapshot().recoveringPassword).toBe(false)
    stop()
  })

  it('recognizes a recovery exchange that finished before the provider subscribed', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const store = createAuthStore(mock.client, { isPasswordRecoverySession: (user) => user.id === 'staff-a' })
    const stop = store.start()
    await settle()
    expect(store.getSnapshot().recoveringPassword).toBe(true)
    mock.emit(sessionFor('staff-b'))
    expect(store.getSnapshot().recoveringPassword).toBe(false)
    stop()
  })

  it('rejects expired callbacks even if another session is already saved', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const error = { name: 'AuthImplicitGrantRedirectError', details: { code: 'otp_expired' } }
    mock.client.auth.initialize.mockResolvedValue({ error })
    const store = createAuthStore(mock.client)
    await expect(store.verifyPasswordResetSession()).rejects.toEqual(error)
    expect(mock.client.auth.getUser).not.toHaveBeenCalled()
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('requires an Auth-verified user rather than trusting a saved session', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const store = createAuthStore(mock.client)
    const error = { code: 'session_not_found' }
    mock.client.auth.getUser.mockResolvedValueOnce({ data: {}, error })
    await expect(store.verifyPasswordResetSession()).rejects.toEqual(error)
    mock.client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    await expect(store.verifyPasswordResetSession()).rejects.toThrow('Open the password reset link')
  })

  it('updates a pending account password without granting staff access and clears recovery only on success', async () => {
    const mock = mockClient()
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    mock.emit(sessionFor('new-staff'), 'PASSWORD_RECOVERY')
    await settle()
    expect(store.getSnapshot()).toMatchObject({ access: 'pending', recoveringPassword: true })
    const error = { code: 'same_password' }
    mock.client.auth.updateUser.mockResolvedValueOnce({ data: {}, error })
    await expect(store.updatePassword('new-password123', 'new-staff')).rejects.toEqual(error)
    expect(store.getSnapshot().recoveringPassword).toBe(true)
    await store.updatePassword('new-password123', 'new-staff')
    expect(mock.client.auth.updateUser).toHaveBeenCalledWith({ password: 'new-password123' })
    expect(store.getSnapshot()).toMatchObject({ access: 'pending', recoveringPassword: false })
    stop()
  })

  it('refuses to update a different account after an account switch', async () => {
    const mock = mockClient(sessionFor('staff-a'))
    const store = createAuthStore(mock.client)
    const stop = store.start()
    await settle()
    mock.emit(sessionFor('staff-b'))
    await expect(store.updatePassword('new-password123', 'staff-a')).rejects.toThrow('account changed')
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled()
    stop()
  })
})
