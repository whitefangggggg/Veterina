import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
export const requiresPasswordSetup = /type=(invite|recovery)/.test(globalThis.location?.hash || '')
let invitePending = new URLSearchParams(globalThis.location?.hash?.slice(1) || '').get('type') === 'invite'

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

// Capture recovery before React mounts: Supabase can finish the URL exchange
// before the provider subscribes. This observer lives with the shared client.
let recoveryUserId = null
const recoverySubscription = supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' || (invitePending && event === 'SIGNED_IN')) {
    recoveryUserId = session?.user.id ?? null
    invitePending = false
  }
  else if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || (recoveryUserId && session?.user.id !== recoveryUserId)) recoveryUserId = null
}).data.subscription

export const isPasswordRecoverySession = (user) => Boolean(user && recoveryUserId === user.id)

if (import.meta.hot) import.meta.hot.dispose(() => recoverySubscription?.unsubscribe())
