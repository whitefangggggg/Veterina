import { useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { authErrorMessage, safeReturnTo } from '../lib/authAccess'
import AuthLayout from '../components/AuthLayout'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'
import SignInVerification from '../components/SignInVerification'

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
  const [showPassword, setShowPassword] = useState(false)
  const callbackFailed = searchParams.has('error') || new URLSearchParams(location.hash.slice(1)).has('error')

  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'approved') return <SignInVerification returnTo={returnTo} />
  if (access === 'pending') return <Navigate to={`/access-pending${nextQuery}`} replace />

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    const fullName = String(form.get('fullName') || '').trim()
    setError('')
    if (creating && !fullName) { setError('Please enter your full name.'); return }
    if (creating && password !== form.get('confirmPassword')) { setError('Your passwords do not match.'); return }
    setBusy(true)
    try {
      if (creating) {
        const data = await signUp({ fullName, email, password,
          emailRedirectTo: `${window.location.origin}/sign-in${nextQuery}` })
        if (!data.session) setConfirmation(true)
      } else {
        await signIn({ email, password })
      }
    } catch (error) {
      setError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={creating ? 'Create your account' : 'Welcome back'} description={creating
      ? 'Create your login, then ask your clinic administrator to approve staff access.'
      : 'Sign in to your Veterina clinic workspace.'}>
      {confirmation ? (
        <div className="auth-confirmation" role="status">
          <h2>Check your email</h2>
          <p>If confirmation is required, follow the link in your email to finish creating your account. If you already have an account, sign in below.</p>
          <Link to={`/sign-in${nextQuery}`} className="button button-primary">Back to sign in</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} aria-busy={busy}>
          {(error || callbackFailed) && <p className="auth-message auth-error" role="alert">{error || 'This confirmation link is invalid or has expired. Please sign in or contact your clinic administrator.'}</p>}
          <fieldset disabled={busy || !isSupabaseConfigured}>
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
      {!creating && <p className="auth-switch"><Link to={`/forgot-password${nextQuery}`}>Forgot your password?</Link></p>}
      <p className="auth-switch">{creating ? 'Already have an account? ' : 'New to Veterina? '}<Link to={`${creating ? '/sign-in' : '/create-account'}${nextQuery}`}>{creating ? 'Sign in' : 'Create an account'}</Link></p>
    </AuthLayout>
  )
}
