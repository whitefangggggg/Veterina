import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage, safeReturnTo } from '../lib/authAccess'
import AuthLayout from '../components/AuthLayout'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'

export default function AccessPending() {
  const { access, user, checking, refreshAccess, signOut } = useAuth()
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnTo(searchParams.get('next'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)

  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'signed-out') return <Navigate to={`/sign-in?next=${encodeURIComponent(returnTo)}`} replace />
  if (access === 'approved') return <Navigate to={returnTo} replace />

  const run = async (action, rechecking = false) => {
    setError('')
    setBusy(true)
    try { await action(); if (rechecking) setChecked(true) }
    catch (error) { setError(authErrorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <AuthLayout title="Your account is ready" description="Clinic access requires staff approval.">
      <div className="auth-pending-info">
        <p>Signed in as <strong>{user.email}</strong>.</p>
        <p>Ask your clinic administrator to activate your staff profile. If you previously had access, contact them to check your account status.</p>
      </div>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      {checked && <p className="auth-message" role="status">Your account does not have active clinic access yet. Please check with your administrator.</p>}
      <div className="auth-actions">
        <button className="button button-primary" disabled={busy || checking} onClick={() => run(refreshAccess, true)}>{busy || checking ? 'Please wait...' : 'Check access again'}</button>
        <button className="button button-secondary" disabled={busy || checking} onClick={() => run(signOut)}>Sign out</button>
      </div>
    </AuthLayout>
  )
}
