import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage } from '../lib/authAccess'

export default function ConfirmationEmailActions({ email, emailRedirectTo, initialWait = 0 }) {
  const { resendConfirmation } = useAuth()
  const [retryAt, setRetryAt] = useState(() => Date.now() + initialWait * 1000)
  const [now, setNow] = useState(() => Date.now())
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    if (Date.now() >= retryAt) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= retryAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  const cooldown = () => { const current = Date.now(); setNow(current); setRetryAt(current + 60000) }
  const resend = async () => {
    if (busy || remaining) return
    setBusy(true); setError(''); setRequested(false)
    try {
      await resendConfirmation({ email, emailRedirectTo })
      setRequested(true); cooldown()
    } catch (failure) {
      setError(authErrorMessage(failure))
      if (['over_request_rate_limit', 'over_email_send_rate_limit'].includes(failure?.code)) cooldown()
    } finally { setBusy(false) }
  }
  return <div className="confirmation-email-actions">
    <p>Check the inbox and spam folder for <strong>{email}</strong>. Your shop owner can approve access after your email is confirmed.</p>
    {requested && <p className="auth-message" role="status">Confirmation email requested. If this account still needs confirmation, a new link will be sent.</p>}
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <button type="button" className="button button-secondary" disabled={busy || remaining > 0} onClick={resend}>{busy ? 'Requesting email...' : remaining ? `Resend in ${remaining}s` : 'Resend confirmation email'}</button>
  </div>
}
