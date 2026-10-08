/* oxlint-disable react/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
const AuthContext = createContext(null)
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setDemo] = useState(false)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let alive = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) { setSession(next); setLoading(false) }
    })
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setSession(data.session); setLoading(false) }
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])
  const signOut = async () => {
    setDemo(false)
    if (supabase) { const { error } = await supabase.auth.signOut(); if (error) throw error }
    setSession(null)
  }
  return <AuthContext.Provider value={{ session, loading, isDemo, setDemo, signOut }}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)
