import { getAccessState } from './authAccess'
import { normalizeVeterinaCode } from './clinicAccess'

const configurationError = 'Sign-in is unavailable. Please configure the Supabase project URL and publishable key.'

// Kept independent of React so session races and access transitions can be tested.
export function createAuthStore(client, { isPasswordRecoverySession = () => false } = {}) {
  let state = {
    session: null, user: null, profile: null,
    loading: Boolean(client), checking: false, error: client ? null : configurationError,
    recoveringPassword: false,
  }
  let active = false
  let lifecycle = 0
  let request = 0
  const listeners = new Set()
  const publish = (next) => {
    state = { ...next, access: getAccessState(next) }
    listeners.forEach((listener) => listener())
  }
  publish(state)

  async function loadProfile(session, requestId, generation) {
    try {
      const { data, error } = await client.from('profiles')
        .select('id, full_name, role, job_title, is_active, clinic_id')
        .eq('id', session.user.id).maybeSingle()
      if (!active || generation !== lifecycle || requestId !== request) return
      if (error) throw error
      publish({ ...state, profile: data, loading: false, checking: false, error: null })
    } catch {
      if (!active || generation !== lifecycle || requestId !== request) return
      publish({ ...state, profile: null, loading: false, checking: false,
        error: 'We could not check your clinic access. Please try again.' })
    }
  }

  function acceptSession(session, event) {
    const requestId = ++request
    const generation = lifecycle
    const user = session?.user ?? null
    const profile = user?.id === state.user?.id ? state.profile : null
    const recoveringPassword = Boolean(user && (event === 'PASSWORD_RECOVERY'
      || isPasswordRecoverySession(user) || (state.recoveringPassword && user.id === state.user?.id)))
    publish({ session, user, profile, loading: Boolean(user && !profile), checking: Boolean(user), error: null, recoveringPassword })
    // Supabase calls auth listeners while holding its auth lock. Start queries
    // after the callback returns to avoid deadlocking the client.
    if (user) queueMicrotask(() => {
      if (active && generation === lifecycle && requestId === request) {
        void loadProfile(session, requestId, generation)
      }
    })
  }

  function start() {
    if (!client) return () => {}
    active = true
    const generation = ++lifecycle
    let authEvents = 0
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active || generation !== lifecycle) return
      authEvents += 1
      acceptSession(session, event)
    })
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || generation !== lifecycle || authEvents > 0) return
      if (error) throw error
      acceptSession(data.session)
    }).catch(() => {
      if (!active || generation !== lifecycle || authEvents > 0) return
      publish({ ...state, profile: null, loading: false, checking: false,
        error: 'We could not restore your session. Please try again.' })
    })
    return () => {
      active = false
      lifecycle += 1
      request += 1
      subscription.unsubscribe()
    }
  }

  function requireClient() {
    if (!client) throw new Error(configurationError)
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    start,
    async refreshAccess() {
      requireClient()
      if (state.session) {
        const requestId = ++request
        publish({ ...state, loading: !state.profile, checking: true, error: null })
        await loadProfile(state.session, requestId, lifecycle)
      } else {
        const requestId = ++request
        const generation = lifecycle
        publish({ ...state, loading: true, error: null })
        try {
          const { data, error } = await client.auth.getSession()
          if (error) throw error
          if (active && generation === lifecycle && requestId === request) acceptSession(data.session)
        } catch {
          if (active && generation === lifecycle && requestId === request) publish({ ...state, loading: false, error: 'We could not restore your session. Please try again.' })
        }
      }
    },
    async signIn({ email, password }) {
      requireClient()
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      return data
    },
    async signUp({ fullName, email, password, emailRedirectTo, veterinaCode, accountType = 'staff', clinicName }) {
      requireClient()
      if (!['owner', 'staff'].includes(accountType)) throw new Error('Choose Owner or Staff to create your account.')
      const metadata = { full_name: fullName.trim(), application: 'veterina', account_type: accountType }
      if (accountType === 'owner') {
        const name = String(clinicName || '').trim()
        if (!name || name.length > 160) throw new Error('Enter your clinic name (up to 160 characters).')
        metadata.clinic_name = name
      } else {
        const code = normalizeVeterinaCode(veterinaCode)
        if (!code) throw new Error('Enter the Veterina Code provided by your shop owner.')
        const { data: clinic, error: codeError } = await client.rpc('veterina_code_info', { p_code: code })
        if (codeError) throw new Error('We could not verify the Veterina Code. Please try again.')
        if (!clinic?.valid) throw new Error('This Veterina Code is invalid or has changed. Ask your shop owner for the current code.')
        metadata.veterina_code = code
      }
      const { data, error } = await client.auth.signUp({
        email: email.trim(), password,
        options: { data: metadata, emailRedirectTo },
      })
      if (error) throw error
      return data
    },
    async requestPasswordReset({ email, redirectTo }) {
      requireClient()
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) throw error
    },
    async resendConfirmation({ email, emailRedirectTo }) {
      requireClient()
      const address = String(email || '').trim()
      if (!address) throw new Error('Enter your email address to request a confirmation link.')
      const { error } = await client.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo } })
      if (error) throw error
    },
    async verifyPasswordResetSession() {
      requireClient()
      // Unlike getSession, initialize reports invalid/expired URL exchanges,
      // even when another account already has a saved session in this browser.
      const { error: callbackError } = await client.auth.initialize()
      if (callbackError) throw callbackError
      const { data, error } = await client.auth.getUser()
      if (error) throw error
      if (!data.user) throw new Error('Open the password reset link from your email to choose a new password.')
      return data.user
    },
    async updatePassword(password, expectedUserId) {
      requireClient()
      // A different tab may have switched accounts since the form was opened.
      const { data: current, error: sessionError } = await client.auth.getUser()
      if (sessionError) throw sessionError
      if (!expectedUserId || current.user?.id !== expectedUserId || state.user?.id !== expectedUserId) {
        throw new Error('Your signed-in account changed. Reload this page or open a new password reset link before continuing.')
      }
      const { data, error } = await client.auth.updateUser({ password })
      if (error) throw error
      if (active && data.user?.id === state.user?.id) publish({ ...state, recoveringPassword: false })
      return data
    },
    async signOut() {
      requireClient()
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
      if (active) acceptSession(null)
    },
  }
}
