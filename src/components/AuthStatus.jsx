import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage } from '../lib/authAccess'
import AuthLayout from './AuthLayout'

export function AuthLoading() {
  return <div className="page-loader" role="status"><span aria-hidden="true" /><p>Checking your clinic access...</p></div>
}

export function AuthAccessError() {
  const { error, checking, loading, refreshAccess, user, signOut } = useAuth()
  const [actionError, setActionError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const busy = checking || loading || signingOut
  const handleSignOut = async () => {
    setSigningOut(true)
    setActionError('')
    try { await signOut() } catch (error) { setActionError(authErrorMessage(error)) }
    finally { setSigningOut(false) }
  }
  return (
    <AuthLayout title="We couldn’t check your access" description="Please try again to continue to your clinic workspace.">
      <p className="auth-message auth-error" role="alert">{actionError || error}</p>
      <div className="auth-actions">
        <button className="button button-primary" disabled={busy} onClick={() => void refreshAccess().catch((error) => setActionError(authErrorMessage(error)))}>Try again</button>
        {user && <button className="button button-secondary" disabled={busy} onClick={handleSignOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button>}
      </div>
    </AuthLayout>
  )
}
