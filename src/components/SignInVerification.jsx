import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { authErrorMessage } from '../lib/authAccess'
import { useAuth } from '../context/AuthContext'
import AuthLayout from './AuthLayout'
import { AuthLoading } from './AuthStatus'
import { AsyncForm } from './RecordForm'

// Preserve the upstream authenticator challenge for accounts with enrolled MFA.
export default function SignInVerification({ returnTo }) {
  const { session, signOut } = useAuth()
  const [check, setCheck] = useState(null)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]).then(([assurance, factors]) => {
      if (!alive) return
      if (assurance.error || factors.error) throw assurance.error || factors.error
      const factor = assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2'
        ? factors.data.totp.find((entry) => entry.status === 'verified') : null
      if (assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2' && !factor) throw new Error('Your verification method is unavailable. Please contact your clinic administrator.')
      setCheck({ token: session.access_token, factor })
    }).catch((error) => { if (alive) setError(authErrorMessage(error)) })
    return () => { alive = false }
  }, [session.access_token, retry])

  if (error) return <AuthLayout title="Unable to verify sign-in" description="Please try again to continue.">
    <p className="auth-message auth-error" role="alert">{error}</p>
    <div className="auth-actions"><button className="button button-primary" onClick={() => { setError(''); setRetry((value) => value + 1) }}>Try again</button><button className="button button-secondary" onClick={() => void signOut().catch((error) => setError(authErrorMessage(error)))}>Sign out</button></div>
  </AuthLayout>
  if (check?.token !== session.access_token) return <AuthLoading />
  if (!check.factor) return <Navigate to={returnTo} replace />
  return <AuthLayout title="Verify your sign-in" description="Enter the six-digit code from your authenticator app.">
    <AsyncForm submitLabel="Verify and continue" onSave={async ({ code }) => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: check.factor.id, code })
      if (error) throw new Error(authErrorMessage(error), { cause: error })
      setRetry((value) => value + 1)
    }}><label className="field"><span>Authenticator code</span><input name="code" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" /></label></AsyncForm>
  </AuthLayout>
}
