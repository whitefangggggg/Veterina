/* oxlint-disable react/only-export-components */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { supabase, isPasswordRecoverySession } from '../lib/supabaseClient'
import { createAuthStore } from '../lib/authStore'
import { petPhotoCache } from '../lib/petPhotoCache'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [store] = useState(() => createAuthStore(supabase, { isPasswordRecoverySession }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => store.start(), [store])
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') petPhotoCache.clear() }).data.subscription
    return () => { subscription?.unsubscribe(); petPhotoCache.clear() }
  }, [])
  useEffect(() => { petPhotoCache.setAccount(state.access === 'approved' ? state.user?.id || null : null) }, [state.user?.id, state.access])
  useEffect(() => {
    if (!state.user) return
    const check = () => { store.expireSubscription(); void store.refreshAccess() }
    const interval = setInterval(check, 60000)
    window.addEventListener('focus', check)
    const remaining = Date.parse(state.accountAccess?.subscription?.expiresAt) - (Date.now() + state.serverTimeOffset)
    const deadline = remaining > 0 && remaining <= 2147483647 ? setTimeout(() => { store.expireSubscription(); void store.refreshAccess() }, remaining + 10) : null
    return () => { clearInterval(interval); clearTimeout(deadline); window.removeEventListener('focus', check) }
  }, [store, state.user, state.accountAccess, state.serverTimeOffset])
  return <AuthContext.Provider value={{ ...state, signIn: store.signIn, signInWithGoogle: store.signInWithGoogle, completeGoogleRegistration: store.completeGoogleRegistration, signUp: store.signUp, signOut: store.signOut, refreshAccess: store.refreshAccess,
    resendConfirmation: store.resendConfirmation, requestPasswordReset: store.requestPasswordReset, verifyPasswordResetSession: store.verifyPasswordResetSession, updatePassword: store.updatePassword }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
