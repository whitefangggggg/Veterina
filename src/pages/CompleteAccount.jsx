import { useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage, safeReturnTo } from '../lib/authAccess'
import { readGoogleRegistrationDraft, saveGoogleRegistrationDraft } from '../lib/googleRegistration'
import AuthLayout from '../components/AuthLayout'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'
import ClinicRegistrationFields from '../components/ClinicRegistrationFields'
import { invokeSubscription } from '../lib/subscriptions'
import { supabase } from '../lib/supabaseClient'

export default function CompleteAccount() {
  const { access, accountAccess, user, completeGoogleRegistration, refreshAccess, signOut } = useAuth()
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnTo(searchParams.get('next'))
  const nextQuery = `?next=${encodeURIComponent(returnTo)}`
  const [draft] = useState(readGoogleRegistrationDraft)
  const lockedOwner = accountAccess?.registrationType === 'owner'
  const [accountType, setAccountType] = useState(lockedOwner ? 'owner' : draft.accountType)
  const [clinicName, setClinicName] = useState(draft.clinicName || user?.user_metadata?.clinic_name || '')
  const [veterinaCode, setVeterinaCode] = useState(draft.veterinaCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activationCode, setActivationCode] = useState('')
  const activationRequest = useRef(null)

  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'signed-out') return <Navigate to={`/sign-in${nextQuery}`} replace />
  if (access === 'approved') return <Navigate to={returnTo} replace />
  if (access === 'expired') return <Navigate to="/subscription" replace />
  if (access === 'platform-admin') return <Navigate to="/admin" replace />
  if (access === 'pending') return <Navigate to={`/access-pending${nextQuery}`} replace />

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const fullName = String(new FormData(event.currentTarget).get('fullName') || '').trim()
    setError('')
    if (!fullName) { setError('Please enter your full name.'); return }
    setBusy(true)
    try {
      if (accountType === 'owner') {
        const details = { fullName, clinicName, code: activationCode.trim().toUpperCase() }
        const fingerprint = JSON.stringify(details)
        if (activationRequest.current?.fingerprint !== fingerprint) activationRequest.current = { fingerprint, id: crypto.randomUUID() }
        await invokeSubscription(supabase, 'clinic-activation', { ...details, requestId: activationRequest.current.id, renew: false })
        activationRequest.current = null
      } else await completeGoogleRegistration({ fullName, accountType, clinicName, veterinaCode })
      saveGoogleRegistrationDraft(null)
      await refreshAccess()
    } catch (failure) { setError(authErrorMessage(failure)) }
    finally { setBusy(false) }
  }
  const leave = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await signOut(); saveGoogleRegistrationDraft(null) }
    catch (failure) { setError(authErrorMessage(failure)) }
    finally { setBusy(false) }
  }

  return <AuthLayout title="Finish setting up your account" description="Your account is connected. Activate a clinic subscription or join your shop to continue.">
    <p className="auth-pending-info">Signed in as <strong>{user.email}</strong>.</p>
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <ClinicRegistrationFields {...{ accountType, setAccountType, clinicName, setClinicName, veterinaCode, setVeterinaCode }} lockedAccountType={lockedOwner} />
        {accountType === 'owner' && <><label>Subscription activation code<input name="activationCode" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} autoComplete="off" spellCheck={false} required maxLength={100} placeholder="VET-ACCESS-…" /></label><p className="auth-hint">Get an activation code from the website administrator. Your subscription starts when the clinic is created.</p></>}
        <label htmlFor="full-name">Full name<input id="full-name" name="fullName" autoComplete="name" required maxLength={120} defaultValue={user.user_metadata?.full_name || user.user_metadata?.name || ''} /></label>
        <button type="submit" className="button button-primary auth-submit">{busy ? 'Saving...' : accountType === 'owner' ? 'Create clinic' : 'Request clinic access'}</button>
        <button type="button" className="button button-secondary" onClick={leave}>Sign out</button>
      </fieldset>
    </form>
  </AuthLayout>
}
