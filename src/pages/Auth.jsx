import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { normalizeVeterinaCode } from '../lib/clinicAccess'
import ClinicQrScanner from '../components/ClinicQrScanner'
import { QrCode } from '@phosphor-icons/react'
import { authErrorMessage, safeReturnTo } from '../lib/authAccess'
import AuthLayout from '../components/AuthLayout'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'
import ConfirmationEmailActions from '../components/ConfirmationEmailActions'

export default function Auth({ mode = 'sign-in' }) {
  const creating = mode === 'create-account'
  const { access, signIn, signUp } = useAuth()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const returnTo = safeReturnTo(searchParams.get('next'))
  const nextQuery = `?next=${encodeURIComponent(returnTo)}`
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const confirmationHeading = useRef(null)
  useEffect(() => { if (confirmation) confirmationHeading.current?.focus() }, [confirmation])
  const [showPassword, setShowPassword] = useState(false)
  const [accountType, setAccountType] = useState('staff')
  const [clinicName, setClinicName] = useState('')
  const [veterinaCode, setVeterinaCode] = useState(() => normalizeVeterinaCode(searchParams.get('code')) || searchParams.get('code') || '')
  const [clinicInfo, setClinicInfo] = useState(null)
  const [scan, setScan] = useState(false)
  useEffect(() => {
    let alive = true
    const code = normalizeVeterinaCode(veterinaCode)
    const timer = setTimeout(async () => {
      if (!creating || accountType !== 'staff' || !isSupabaseConfigured || !code) { if (alive) setClinicInfo(null); return }
      try {
        const { data, error } = await supabase.rpc('veterina_code_info', { p_code: code })
        if (alive) setClinicInfo(error ? null : data)
      } catch { if (alive) setClinicInfo(null) }
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [creating, accountType, veterinaCode])
  const callbackFailed = searchParams.has('error') || new URLSearchParams(location.hash.slice(1)).has('error')

  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'approved') return <Navigate to={returnTo} replace />
  if (access === 'pending') return <Navigate to={`/access-pending${nextQuery}`} replace />

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
    <AuthLayout title={creating ? 'Create your account' : 'Welcome back'} description={creating
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
          {(error || callbackFailed) && <p className="auth-message auth-error" role="alert">{error || 'This confirmation link is invalid or has expired. Please sign in or contact your clinic administrator.'}</p>}
          <fieldset disabled={busy || !isSupabaseConfigured}>
            {creating && <div className="account-type-field"><label htmlFor="account-type">Create account as</label><select id="account-type" name="accountType" value={accountType} onChange={(event) => { setAccountType(event.target.value); setError(''); setScan(false) }} aria-describedby="account-type-help"><option value="owner">Owner</option><option value="staff">Staff</option></select><p className="account-type-help" id="account-type-help">{accountType === 'owner' ? 'Start a new clinic and share your Veterina Code with your staff.' : 'Join an existing clinic after your shop owner approves your account.'}</p></div>}
            {creating && accountType === 'owner' && <label htmlFor="clinic-name">Clinic name<input id="clinic-name" name="clinicName" autoComplete="organization" required maxLength={160} value={clinicName} onChange={(event) => setClinicName(event.target.value)} placeholder="Your clinic name" /></label>}
            {creating && accountType === 'staff' && <div className="registration-code-field">
              <label htmlFor="veterina-code">Veterina Code<input id="veterina-code" name="veterinaCode" required maxLength={60} value={veterinaCode} onChange={(event) => { setVeterinaCode(event.target.value); setClinicInfo(null) }} autoComplete="off" spellCheck={false} placeholder="VET-…" aria-describedby="clinic-code-help" /></label>
              <button type="button" className="button button-secondary" onClick={() => setScan(true)}><QrCode size={18} />Scan QR code</button>
              <small id="clinic-code-help">Get this code or QR from your shop owner.</small>
              {clinicInfo?.valid && <p className="registration-clinic-name" role="status">Joining <strong>{clinicInfo.clinicName}</strong> · Owner approval required</p>}
              {clinicInfo && !clinicInfo.valid && <p className="auth-message auth-error" role="status">Code not found. Check the code with your shop owner.</p>}
            </div>}
            {creating && <label htmlFor="full-name">Full name<input id="full-name" name="fullName" autoComplete="name" required maxLength={120} placeholder="Your full name" /></label>}
            <label htmlFor="email">Email address<input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@clinic.com" /></label>
            <label htmlFor="password">Password<input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 8 : undefined} aria-describedby={creating ? 'password-help' : undefined} /></label>
            {creating && <p className="auth-hint" id="password-help">Use at least 8 characters.</p>}
            {creating && <label htmlFor="confirm-password">Confirm password<input id="confirm-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} /></label>}
            <label className="auth-show-password"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />Show {creating ? 'passwords' : 'password'}</label>
            <button className="button button-primary auth-submit" type="submit">{busy ? (creating ? 'Creating account...' : 'Signing in...') : (creating ? 'Create account' : 'Sign in')}</button>
          </fieldset>
        </form>
      )}
      {!confirmation && confirmationEmail && <ConfirmationEmailActions key={confirmationEmail} email={confirmationEmail} emailRedirectTo={`${window.location.origin}/sign-in${nextQuery}`} />}
      {scan && <ClinicQrScanner onCode={(code) => { setVeterinaCode(code); setClinicInfo(null); setScan(false) }} onClose={() => setScan(false)} />}
      {!creating && <p className="auth-switch"><Link to={`/forgot-password${nextQuery}`}>Forgot your password?</Link></p>}
      <p className="auth-switch">{creating ? 'Already have an account? ' : 'New to Veterina? '}<Link to={`${creating ? '/sign-in' : '/create-account'}${nextQuery}`}>{creating ? 'Sign in' : 'Create an account'}</Link></p>
    </AuthLayout>
  )
}
