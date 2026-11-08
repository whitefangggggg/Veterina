import VeterinaCheckbox from '../components/VeterinaCheckbox'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { normalizeVeterinaCode } from '../lib/clinicAccess'
import ClinicRegistrationFields from '../components/ClinicRegistrationFields'
import GoogleAuthButton from '../components/GoogleAuthButton'
import { saveGoogleRegistrationDraft } from '../lib/googleRegistration'
import { authErrorMessage, safeAuthReturnTo } from '../lib/authAccess'
import AuthLayout from '../components/AuthLayout'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'
import ConfirmationEmailActions from '../components/ConfirmationEmailActions'

export default function Auth({ mode = 'sign-in' }) {
  const creating = mode === 'create-account'
  const platform = mode === 'admin'
  const { access, accountAccess, user, signOut, signIn, signInWithGoogle, signUp } = useAuth()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const returnTo = safeAuthReturnTo(platform ? '/admin' : searchParams.get('next'))
  const nextQuery = `?next=${encodeURIComponent(returnTo)}`
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const confirmationHeading = useRef(null)
  useEffect(() => { if (confirmation) confirmationHeading.current?.focus() }, [confirmation])
  const [showPassword, setShowPassword] = useState(false)
  const [accountType, setAccountType] = useState('staff')
  const [clinicName, setClinicName] = useState('')
  const [veterinaCode, setVeterinaCode] = useState(() => normalizeVeterinaCode(searchParams.get('code')) || searchParams.get('code') || '')
  const callbackFailed = searchParams.has('error') || new URLSearchParams(location.hash.slice(1)).has('error')

  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (platform && user && !accountAccess?.isPlatformAdmin) return <AuthLayout title="Administrator access required" description="This account does not have website administrator access."><p className="auth-message">Signed in as {user.email}. Clinic owner permissions do not grant platform administration.</p><button className="button button-secondary" onClick={() => void signOut().catch((failure) => setError(failure.message))}>Sign out to switch accounts</button>{error && <p role="alert" className="auth-message auth-error">{error}</p>}<p className="auth-switch"><Link to="/dashboard">Return to my clinic</Link></p></AuthLayout>
  if (accountAccess?.isPlatformAdmin && (platform || returnTo === '/admin' || access === 'platform-admin')) return <Navigate to="/admin" replace />
  if (access === 'expired') return <Navigate to="/subscription" replace />
  if (access === 'approved') return <Navigate to={returnTo} replace />
  if (access === 'onboarding') return <Navigate to={`/complete-account${nextQuery}`} replace />
  if (access === 'pending') return <Navigate to={`/access-pending${nextQuery}`} replace />

  const continueWithGoogle = async () => {
    if (busy) return
    setBusy(true); setGoogleBusy(true); setError('')
    saveGoogleRegistrationDraft(creating ? { accountType, clinicName, veterinaCode } : null)
    try { await signInWithGoogle({ origin: window.location.origin, returnTo }) }
    catch (failure) { setError(authErrorMessage(failure)); setBusy(false); setGoogleBusy(false) }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    const fullName = String(form.get('fullName') || '').trim()
    setError('')
    setConfirmationEmail('')
    if (creating && !fullName) { setError('Please enter your full name.'); return }
    if (creating && password !== form.get('confirmPassword')) { setError('Your passwords do not match.'); return }
    setBusy(true)
    try {
      if (creating) {
        const data = await signUp({ fullName, email, password, veterinaCode, accountType, clinicName,
          emailRedirectTo: `${window.location.origin}/sign-in${nextQuery}` })
        if (!data.session) { setConfirmationEmail(email); setConfirmation(true) }
      } else {
        await signIn({ email, password })
      }
    } catch (error) {
      setError(authErrorMessage(error))
      if (error?.code === 'email_not_confirmed') setConfirmationEmail(email)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={platform ? 'Website admin sign in' : creating ? 'Create your account' : 'Welcome back'} description={platform ? 'Manage clinic subscriptions and activation codes.' : creating
      ? (accountType === 'owner' ? 'Create your own clinic workspace. Confirm your email to get started.' : 'Join your vetshop with its Veterina Code. Your shop owner approves access after registration.')
      : 'Sign in to your Veterina clinic workspace.'}>
      {confirmation ? (
        <div className="auth-confirmation" role="region" aria-label="Email confirmation">
          <h2 ref={confirmationHeading} tabIndex={-1}>Check your email</h2>
          <ConfirmationEmailActions email={confirmationEmail} emailRedirectTo={`${window.location.origin}/sign-in${nextQuery}`} initialWait={60} />
          <p>If you already have an account, sign in below.</p>
          <Link to={`/sign-in${nextQuery}`} className="button button-primary">Back to sign in</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} aria-busy={busy}>
          {(error || callbackFailed) && <p className="auth-message auth-error" role="alert">{error || (searchParams.get('auth') === 'google' ? 'Google sign-in was cancelled or could not be completed. Please try again.' : 'This confirmation link is invalid or has expired. Please sign in or contact your clinic administrator.')}</p>}
          <fieldset disabled={busy || !isSupabaseConfigured}>
            <GoogleAuthButton busy={googleBusy} onClick={continueWithGoogle} />
            <div className="auth-divider"><span>or continue with email</span></div>
            {creating && <ClinicRegistrationFields {...{ accountType, setAccountType, clinicName, setClinicName, veterinaCode, setVeterinaCode }} />}
            {creating && <label htmlFor="full-name">Full name<input id="full-name" name="fullName" autoComplete="name" required maxLength={120} placeholder="Your full name" /></label>}
            <label htmlFor="email">Email address<input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@clinic.com" /></label>
            <label htmlFor="password">Password<input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 8 : undefined} aria-describedby={creating ? 'password-help' : undefined} /></label>
            {creating && <p className="auth-hint" id="password-help">Use at least 8 characters.</p>}
            {creating && <label htmlFor="confirm-password">Confirm password<input id="confirm-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} /></label>}
            <VeterinaCheckbox className="auth-show-password" checked={showPassword} onChange={setShowPassword} label={`Show ${creating ? 'passwords' : 'password'}`} />
            <button className="button button-primary auth-submit" type="submit">{busy && !googleBusy ? (creating ? 'Creating account...' : 'Signing in...') : (creating ? 'Create account' : 'Sign in')}</button>
          </fieldset>
        </form>
      )}
      {!confirmation && confirmationEmail && <ConfirmationEmailActions key={confirmationEmail} email={confirmationEmail} emailRedirectTo={`${window.location.origin}/sign-in${nextQuery}`} />}
      {!creating && <p className="auth-switch"><Link to={`/forgot-password${nextQuery}`}>Forgot your password?</Link></p>}
      {!platform && <p className="auth-switch">{creating ? 'Already have an account? ' : 'New to Veterina? '}<Link to={`${creating ? '/sign-in' : '/create-account'}${nextQuery}`}>{creating ? 'Sign in' : 'Create an account'}</Link></p>}
    </AuthLayout>
  )
}
