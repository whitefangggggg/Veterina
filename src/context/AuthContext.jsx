/* oxlint-disable react/only-export-components */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { supabase, isPasswordRecoverySession } from '../lib/supabaseClient'
import { createAuthStore } from '../lib/authStore'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [store] = useState(() => createAuthStore(supabase, { isPasswordRecoverySession }))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => store.start(), [store])
  return <AuthContext.Provider value={{ ...state, signIn: store.signIn, signUp: store.signUp, signOut: store.signOut, refreshAccess: store.refreshAccess,
    requestPasswordReset: store.requestPasswordReset, verifyPasswordResetSession: store.verifyPasswordResetSession, updatePassword: store.updatePassword }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
