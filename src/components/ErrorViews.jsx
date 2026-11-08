import { Component, useState } from 'react'
import { Link, useRouteError } from 'react-router-dom'
import { ArrowClockwise, Copy, House, MagnifyingGlass, SignOut } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'
import DoctorDino from './DoctorDino'
import { SleepingPatientCat } from './PixelPatients'
import './ErrorViews.css'

export function NotFoundView({ embedded = false }) {
  const Container = embedded ? 'div' : 'main'
  return <Container className="vt-error-page"><section className="vt-error-card">
    <div className="vt-mascot-frame"><svg className="vt-lost-pup" viewBox="0 0 64 64" shapeRendering="crispEdges" role="img" aria-label="A wandering puppy looking for the trail">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="var(--brand-soft)" />
      <path d="M22 36h20v14H22Z" fill="#9b6039" /><path d="M24 38h16v10H24Z" fill="#f1f3e6" />
      <path d="M24 18h16v16H24Z" fill="#a66b39" /><path d="M18 20h6v12h-6ZM40 20h6v12h-6Z" fill="#65412c" />
      <path d="M28 24h3v3h-3ZM35 24h3v3h-3Z" fill="#202c29" /><path d="M29 24h1v1h-1ZM36 24h1v1h-1Z" fill="#ffffff" />
      <path d="M30 28h6v4h-6Z" fill="#e0cbb2" /><path d="M32 28h2v2h-2Z" fill="#30241e" />
      <path d="M24 34l8 6 8-6v3l-8 5-8-5Z" fill="var(--brand-ink)" />
      <path d="M7 45h3v3H7Zm5-5h2v2h-2Zm39 8h3v3h-3Zm5-5h2v2h-2Z" fill="var(--muted)" />
    </svg></div>
    <span className="vt-error-code">404 · Page not found</span><h1>This trail went cold</h1>
    <p>The patient record, file, or page you’re looking for may have moved or been archived.</p>
    <div className="vt-error-actions"><Link className="button button-primary" to="/dashboard"><House size={18} /> Return to Dashboard</Link><Link className="button button-secondary" to="/patients"><MagnifyingGlass size={18} /> Search Clinic Records</Link></div>
  </section></Container>
}

export function ForbiddenView({ message, embedded = false }) {
  const Container = embedded ? 'div' : 'main'
  const { signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Container className="vt-error-page"><section className="vt-error-card">
    <div className="vt-mascot-frame vt-dino-wrap"><DoctorDino /></div>
    <span className="vt-error-code vt-code-amber">403 · Restricted area</span><h1>Authorized paws only</h1>
    <p>{message || 'This clinic zone requires additional permissions. Ask your clinic administrator for access.'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="vt-error-actions"><Link className="button button-primary" to="/dashboard"><House size={18} /> Go to My Workspace</Link><button className="button button-secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await signOut() } catch { setError('Unable to sign out. Please try again.') } finally { setBusy(false) }
    }}><SignOut size={18} /> {busy ? 'Signing out…' : 'Sign Out / Switch'}</button></div>
  </section></Container>
}

function diagnosticCode(error) {
  // A stable support reference without exposing clinical details or stack traces.
  const text = `${error?.name || 'Error'}:${error?.message || error?.status || 'unknown'}`
  let hash = 0
  for (let index = 0; index < text.length; index++) hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0
  return `VT-500-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

export function CrashFallback({ error, resetErrorBoundary }) {
  const [copyStatus, setCopyStatus] = useState('')
  const code = diagnosticCode(error)
  return <main className="vt-error-page"><section className="vt-error-card">
    <div className="vt-mascot-frame vt-catnap-wrap"><SleepingPatientCat /></div>
    <span className="vt-error-code">500 · Unexpected interruption</span><h1>Taking a quick catnap</h1>
    <p>The clinic engine ran into an unexpected hiccup. Reload to reconnect, then check whether your last change was saved.</p>
    <code className="vt-diagnostic-code">{code}</code>
    <div className="vt-error-actions"><button className="button button-primary" onClick={resetErrorBoundary || (() => window.location.reload())}><ArrowClockwise size={18} /> Recheck Vitals (Reload)</button><button className="button button-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(code); setCopyStatus('Diagnostic code copied.') } catch { setCopyStatus(`Copy this code: ${code}`) }
    }}><Copy size={18} /> Copy Diagnostic Code</button></div>
    <p role="status">{copyStatus}</p><a className="text-link" href="/dashboard">Back to dashboard</a>
  </section></main>
}

export function RouteErrorView() {
  const error = useRouteError()
  return <CrashFallback error={error} />
}

export class AppErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <CrashFallback error={this.state.error} /> : this.props.children }
}
