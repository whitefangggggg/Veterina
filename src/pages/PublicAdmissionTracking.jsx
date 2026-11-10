import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowClockwise, PawPrint } from '@phosphor-icons/react'
import { admissionTrackingUrl, lookupPublicAdmission, publicAdmissionStatuses, trackingTime, validTrackingCode } from '../lib/admissionTracking'
import './PublicAdmissionTracking.css'
import PublicAdmissionClinical from '../components/PublicAdmissionClinical'
import { clinicalConditions } from '../lib/admissions'

export default function PublicAdmissionTracking() {
  const location = useLocation()
  const navigate = useNavigate()
  const code = location.hash.slice(1)
  const [input, setInput] = useState(code)
  const [validation, setValidation] = useState('')
  const [result, setResult] = useState({ status: 'idle' })
  const [retry, setRetry] = useState(0)
  const codeInput = useRef(null)
  const generation = useRef(0)
  const moreRequest = useRef(null)
  const [loadingSection, setLoadingSection] = useState('')
  useEffect(() => {
    const tags = [['robots', 'noindex, nofollow, noarchive'], ['referrer', 'no-referrer']].map(([name, content]) => {
      const meta = document.createElement('meta'); meta.name = name; meta.content = content; document.head.appendChild(meta); return meta
    })
    return () => tags.forEach(tag => tag.remove())
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    generation.current++
    moreRequest.current?.abort()
    setLoadingSection('')
    setInput(code); setValidation('')
    if (!code) { setResult({ status: 'idle' }); return () => controller.abort() }
    if (!validTrackingCode(code)) { setResult({ status: 'idle' }); setValidation('Enter exactly 13 letters and numbers. Uppercase and lowercase matter.'); return () => controller.abort() }
    setResult({ status: 'loading', code })
    lookupPublicAdmission(code, { signal: controller.signal }).then(next => {
      if (!controller.signal.aborted) setResult({ ...next, code })
    }).catch(() => { if (!controller.signal.aborted) setResult({ status: 'error', code }) })
    return () => { controller.abort(); moreRequest.current?.abort() }
  }, [code, retry])
  useEffect(() => {
    if (result.status !== 'ready' || result.code !== code || result.history || loadingSection) return
    const timer = setInterval(() => { if (!document.hidden) setRetry(value => value + 1) }, 30000)
    return () => clearInterval(timer)
  }, [result.status, result.code, result.history, code, loadingSection])
  // Clear a prior patient's result immediately when the URL changes.
  const visible = result.code === code ? result : { status: 'idle' }
  const a = visible.admission
  const loadMore = async section => {
    if (loadingSection || !a?.clinical?.[section]?.cursor) return
    const currentGeneration = generation.current
    const controller = new AbortController()
    moreRequest.current = controller
    setLoadingSection(section)
    try {
      const next = await lookupPublicAdmission(code, { section, cursor: a.clinical[section].cursor, signal: controller.signal })
      if (controller.signal.aborted || currentGeneration !== generation.current) return
      if (next.status !== 'ready') { setResult({ ...next, code }); return }
      setResult(current => ({ ...current, history: true, admission: { ...current.admission, clinical: { ...current.admission.clinical, [section]: {
        ...next.page, items: [...new Map([...current.admission.clinical[section].items, ...next.page.items].map(row => [row.key, row])).values()],
      } } } }))
    } catch { if (!controller.signal.aborted && currentGeneration === generation.current) setResult({ status: 'error', code }) }
    finally { if (!controller.signal.aborted && currentGeneration === generation.current) setLoadingSection('') }
  }
  const submit = (event) => {
    event.preventDefault()
    const next = input.trim()
    if (!validTrackingCode(next)) { setValidation('Enter exactly 13 letters and numbers. Uppercase and lowercase matter.'); codeInput.current?.focus(); return }
    setValidation('')
    if (next === code) setRetry(value => value + 1)
    else navigate(new URL(admissionTrackingUrl(next)).pathname + '#' + next, { replace: true })
  }
  return <main className="public-admission">
    <header className="public-admission-brand"><Link to="/" aria-label="Veterina home"><img src="/brand/veterina-logo.png" alt="Veterina" width="156" height="52" /></Link><Link className="text-link" to="/sign-in">Clinic sign in</Link></header>
    <div className="public-admission-topbar">
    <div className="public-admission-intro"><span className="public-admission-icon"><PawPrint size={28} weight="duotone" aria-hidden="true" /></span><div><span className="eyebrow">An update from your clinic</span><h1>Track admission</h1><p>See the updates your pet’s care team has shared with you.</p></div></div>
    <section className="public-admission-card public-admission-lookup" aria-label="Find your pet’s admission">
      <form onSubmit={submit} noValidate>
        <label htmlFor="tracking-code">13-character tracking code</label>
        <div className="public-tracking-entry"><input ref={codeInput} id="tracking-code" value={input} onChange={event => { setInput(event.target.value); setValidation('') }} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!validation} aria-describedby="tracking-help tracking-validation" /><button className="button button-primary" disabled={visible.status === 'loading'}>Track</button></div>
        <p id="tracking-help">Codes are case-sensitive. Use the code or QR card provided by your clinic.</p>
        <p id="tracking-validation" role={validation ? 'alert' : undefined}>{validation}</p>
      </form>
      {visible.status === 'loading' && <p role="status">Looking up the admission…</p>}
      {visible.status === 'unavailable' && <div role="status"><h2>Tracking is not available</h2><p>Check your code or contact the clinic. The link may have expired, been replaced, or had sharing turned off.</p></div>}
      {['error', 'limited'].includes(visible.status) && <div role="alert"><h2>{visible.status === 'limited' ? 'Please wait a moment' : 'Temporarily unavailable'}</h2><p>{visible.status === 'limited' ? 'There have been too many lookups. Wait a minute before trying again.' : 'We couldn’t load the admission. Please try again.'}</p><button className="button button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    </section>
    </div>
    {a && <section className="public-admission-card public-admission-result" aria-label="Shared admission status" aria-live="polite">
      <div className="public-admission-summary-grid"><div>
      <div className="public-admission-result-heading"><div><span className="eyebrow">{a.clinicName}</span><h2>{a.petName}</h2>{a.species && <p>{a.species}</p>}</div><span className="public-admission-status">{publicAdmissionStatuses[a.status]}</span></div>
      <p className="public-admission-caption">Admission workflow status. For a medical assessment or urgent concerns, contact your clinic.</p>
      <dl className="public-admission-facts">
        {a.clinicalEnabled && <div><dt>Clinical condition</dt><dd>{clinicalConditions[a.condition] || a.condition}</dd></div>}
        {a.admittedAt && <div><dt>Admitted</dt><dd>{trackingTime(a.admittedAt, a.timezone)}</dd></div>}
        {a.clinicContact && <div><dt>Clinic contact</dt><dd className="public-admission-prose">{a.clinicContact}</dd></div>}
        {a.reference && <div><dt>Admission reference</dt><dd>{a.reference}</dd></div>}
        {a.reason && <div><dt>Admission reason</dt><dd className="public-admission-prose">{a.reason}</dd></div>}
      </dl></div>
      <div className="public-admission-update"><h3>Latest clinic update</h3>{a.latestUpdate ? <><p className="public-admission-prose">{a.latestUpdate}</p><p><time dateTime={a.publishedAt}>{trackingTime(a.publishedAt, a.timezone)}</time></p></> : <p>The clinic hasn’t published an update yet.</p>}</div>
      </div>
      <footer><small>Last updated <time dateTime={a.updatedAt}>{trackingTime(a.updatedAt, a.timezone)}</time></small><button className="button button-secondary" onClick={() => setRetry(value => value + 1)}><ArrowClockwise size={18} aria-hidden="true" />Refresh status</button></footer>
      {a.clinicalEnabled && <p className="public-admission-caption">{visible.history ? 'Automatic refresh is paused while you view older records. Refresh status to return to the latest entries.' : 'Updates refresh every 30 seconds while this page is visible.'}</p>}
    </section>}
    {a?.clinicalEnabled && a.clinical && <PublicAdmissionClinical clinical={a.clinical} timezone={a.timezone} onMore={loadMore} loading={loadingSection} />}
    <p className="public-admission-privacy">Keep your code private. Anyone with your code or QR link can view these shared updates. No sign-in is required.</p>
  </main>
}
