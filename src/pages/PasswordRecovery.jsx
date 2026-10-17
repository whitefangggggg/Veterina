import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage, safeReturnTo } from '../lib/authAccess'
import { validateNewPassword } from '../lib/passwordRecovery'
import { isSupabaseConfigured } from '../lib/supabaseClient'

export default function PasswordRecovery({ mode = 'request' }) {
  const resetting = mode === 'reset'
  const { requestPasswordReset, verifyPasswordResetSession, updatePassword, recoveringPassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnTo(searchParams.get('next'))
  const nextQuery = `?next=${encodeURIComponent(returnTo)}`
  const [verifying, setVerifying] = useState(resetting)
  const [verifiedUser, setVerifiedUser] = useState(null)
  const [verificationError, setVerificationError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!resetting) return
    let cancelled = false
    void verifyPasswordResetSession().then((user) => {
      if (!cancelled) setVerifiedUser(user)
    }).catch((error) => {
      if (!cancelled) setVerificationError(authErrorMessage(error))
    }).finally(() => {
      if (!cancelled) setVerifying(false)
    })
    return () => { cancelled = true }
  }, [resetting, verifyPasswordResetSession])

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setError('')
    const password = String(form.get('password') || '')
    if (resetting) {
      const validation = validateNewPassword(password, String(form.get('confirmPassword') || ''))
      if (validation) { setError(validation); return }
    }
    setBusy(true)
    try {
      if (resetting) await updatePassword(password, verifiedUser.id)
      else await requestPasswordReset({ email: String(form.get('email')).trim(),
        redirectTo: `${window.location.origin}/reset-password${nextQuery}` })
      setDone(true)
    } catch (error) {
      setError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const backToSignIn = async (event) => {
    if (!recoveringPassword) return
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await signOut()
      navigate(`/sign-in${nextQuery}`, { replace: true })
    } catch (error) {
      setError(authErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={resetting ? 'Choose a new password' : 'Forgot your password?'} description={resetting
      ? 'Set a new password for your Veterina account.'
      : 'Enter your account email and we’ll send you a password reset link.'}>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      {done ? (
        <div className="auth-confirmation" role="status">
          <h2>{resetting ? 'Password updated' : 'Check your email'}</h2>
          <p>{resetting ? 'Your new password is saved. You can use it the next time you sign in.'
            : 'If an account exists for this email, you’ll receive a reset link. Check your spam folder too. Use the most recent link to choose your new password.'}</p>
          <Link className="button button-primary" to={resetting ? returnTo : `/sign-in${nextQuery}`} onClick={resetting ? undefined : backToSignIn}>{resetting ? 'Continue to clinic' : 'Back to sign in'}</Link>
          {!resetting && <p className="auth-switch"><button className="auth-text-button" type="button" onClick={() => setDone(false)}>Use a different email or try again</button></p>}
        </div>
      ) : verifying ? (
        <p className="auth-message" role="status">Checking your reset link...</p>
      ) : verificationError ? (
        <>
          <p className="auth-message auth-error" role="alert">{verificationError}</p>
          <p className="auth-switch"><Link to={`/forgot-password${nextQuery}`}>Request a new reset link</Link></p>
        </>
      ) : (
        <form className="auth-form" onSubmit={submit} aria-busy={busy}>
          {resetting && verifiedUser && <p className="auth-message">Updating the password for <strong>{verifiedUser.email}</strong>.</p>}
          <fieldset disabled={busy || !isSupabaseConfigured || (resetting && !verifiedUser)}>
            {resetting ? (
              <>
                <label htmlFor="new-password">New password<input id="new-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} aria-describedby="reset-password-help" /></label>
                <p className="auth-hint" id="reset-password-help">Use at least 8 characters.</p>
                <label htmlFor="confirm-new-password">Confirm new password<input id="confirm-new-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} /></label>
                <label className="auth-show-password"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />Show passwords</label>
              </>
            ) : (
              <label htmlFor="reset-email">Email address<input id="reset-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@clinic.com" /></label>
            )}
            <button className="button button-primary auth-submit" type="submit">{busy ? (resetting ? 'Saving password...' : 'Sending link...') : (resetting ? 'Save new password' : 'Send reset link')}</button>
          </fieldset>
          {!isSupabaseConfigured && <p className="auth-message auth-error" role="alert">Password recovery is unavailable. Please configure the Supabase project URL and publishable key.</p>}
          {resetting && <p className="auth-switch"><Link to={`/forgot-password${nextQuery}`}>Request a new reset link</Link></p>}
        </form>
      )}
      {!done && <p className="auth-switch"><Link to={`/sign-in${nextQuery}`} onClick={backToSignIn}>{recoveringPassword ? 'Cancel reset and sign out' : 'Back to sign in'}</Link></p>}
    </AuthLayout>
  )
}
