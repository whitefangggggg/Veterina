import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { invokeSubscription, remainingTime, subscriptionDate } from '../lib/subscriptions'
import AuthLayout from '../components/AuthLayout'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'
import './PlatformAdmin.css'

export default function Subscription() {
  const { access, accountAccess, serverTimeOffset, profile, refreshAccess, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  const request = useRef(null)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const subscription = accountAccess?.subscription
  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'signed-out') return <Navigate to="/sign-in?next=%2Fsubscription" replace />
  if (!subscription) return <Navigate to={access === 'platform-admin' ? '/admin' : access === 'onboarding' ? '/complete-account' : '/access-pending'} replace />
  const active = subscription.status === 'active'
  const owner = profile?.role === 'owner' && profile.is_active && subscription.status !== 'disabled'
  const renew = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    const value = code.trim().toUpperCase()
    if (request.current?.code !== value) request.current = { code: value, id: crypto.randomUUID() }
    try {
      await invokeSubscription(supabase, 'clinic-activation', { code: value, renew: true, requestId: request.current.id })
      request.current = null; setCode(''); setMessage('Your clinic subscription has been renewed.')
      await refreshAccess()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const run = async (action) => { if (busy) return; setBusy(true); setError(''); try { await action() } catch (failure) { setError(failure.message) } finally { setBusy(false) } }
  return <AuthLayout title={active ? 'Your clinic subscription' : subscription.status === 'disabled' ? 'Clinic access is unavailable' : 'Your clinic subscription has expired'} description={`${subscription.clinicName || 'Your clinic'} · Subscription and renewal`}>
    <div className="subscription-summary"><span className={`badge ${active ? 'badge-success' : 'badge-warning'}`}>{active ? 'Active' : subscription.status === 'disabled' ? 'Unavailable' : 'Expired'}</span><strong>{remainingTime(subscription.expiresAt, now + serverTimeOffset)}</strong><p>Expires {subscriptionDate(subscription.expiresAt, subscription.timezone)} ({subscription.timezone})</p></div>
    {!active && <p className="auth-message">Clinic records are preserved. {owner ? 'Renew with a different activation code or contact your administrator to add time.' : 'Ask your clinic owner or administrator to restore access.'}</p>}
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    {message && <p className="auth-message" role="status">{message}</p>}
    {owner && <form className="auth-form" onSubmit={renew}><fieldset disabled={busy}><label>Subscription activation code<input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={100} autoComplete="off" spellCheck={false} placeholder="VET-ACCESS-…" /></label><p className="auth-hint">This is different from the Veterina Code used to invite staff. Each activation code works once per clinic.</p><button type="submit" className="button button-primary">{busy ? 'Renewing...' : 'Renew subscription'}</button></fieldset></form>}
    <div className="auth-actions">{active && <Link to="/dashboard" className="button button-primary">Open clinic</Link>}<button className="button button-secondary" disabled={busy} onClick={() => void run(refreshAccess)}>Check access again</button><button className="button button-secondary" disabled={busy} onClick={() => void run(signOut)}>Sign out</button>{accountAccess.isPlatformAdmin && <Link to="/admin" className="text-link">Platform admin</Link>}</div>
  </AuthLayout>
}
