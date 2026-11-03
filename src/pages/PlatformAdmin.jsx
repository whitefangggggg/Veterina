import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowsClockwise, ClipboardText, ClockCountdown, FirstAidKit, Key, Plus, SignOut } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { invokeSubscription, remainingTime, subscriptionDate } from '../lib/subscriptions'
import { AuthAccessError, AuthLoading } from '../components/AuthStatus'
import { Badge, Modal } from '../components/ui'
import './PlatformAdmin.css'

export function DurationField({ label, value, onChange }) {
  const preset = [30, 90, 365].includes(Number(value)) ? String(value) : 'custom'
  const [custom, setCustom] = useState(preset === 'custom')
  return <label className="platform-field">{label}<select aria-label={label} value={custom ? 'custom' : preset} onChange={(event) => { setCustom(event.target.value === 'custom'); onChange(event.target.value === 'custom' ? 1 : Number(event.target.value)) }}><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option><option value="custom">Custom days</option></select>{custom && <input aria-label={`${label} in days`} type="number" min="1" max="3650" step="1" required value={value} onChange={(event) => onChange(event.target.value)} />}</label>
}

export default function PlatformAdmin() {
  const { access, accountAccess, profile, user, signOut } = useAuth()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('clinics')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [offset, setOffset] = useState(0)
  const [label, setLabel] = useState('')
  const [windowDays, setWindowDays] = useState(30)
  const [termDays, setTermDays] = useState(30)
  const [issuedCode, setIssuedCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [modal, setModal] = useState(null)
  const [extensionDays, setExtensionDays] = useState(30)
  const [note, setNote] = useState('')
  const [history, setHistory] = useState(null)
  const request = useRef(null)
  const generation = useRef(0)
  const allowed = accountAccess?.isPlatformAdmin === true

  const reload = useCallback(async () => {
    const id = ++generation.current
    setRefreshing(true)
    try {
      const result = await invokeSubscription(supabase, 'platform-admin', { action: 'list' })
      if (generation.current !== id) return
      setData(result); setOffset(Date.parse(result.serverNow) - Date.now()); setNow(Date.now()); setError('')
    } catch (failure) { if (generation.current === id) setError(failure.message) }
    finally { if (generation.current === id) setRefreshing(false) }
  }, [])
  useEffect(() => {
    if (!allowed) return
    void reload()
    const timer = setInterval(() => { setNow(Date.now()); void reload() }, 60000)
    const focus = () => void reload()
    window.addEventListener('focus', focus)
    return () => {
      // Invalidate the counter, not a DOM ref, so late requests cannot publish.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      clearInterval(timer); window.removeEventListener('focus', focus)
    }
  }, [allowed, reload])

  if (access === 'loading') return <AuthLoading />
  if (access === 'error') return <AuthAccessError />
  if (access === 'signed-out') return <Navigate to="/admin/sign-in" replace />
  if (!allowed) return <Navigate to="/admin/sign-in" replace />

  const currentTime = now + offset
  const isSoon = (clinic) => clinic.status === 'active' && Date.parse(clinic.expiresAt) - currentTime <= 7 * 86400000
  const clinics = (data?.clinics || []).filter((clinic) => [clinic.clinicName, ...clinic.owners.flatMap((owner) => [owner.name, owner.email])].join(' ').toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'soon' ? isSoon(clinic) : filter === clinic.status)))
  const codes = (data?.codes || []).filter((code) => `${code.label} ${code.suffix}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === code.status))
  const mutate = async (action, payload, done) => {
    if (busy) return
    setBusy(true); setError('')
    const fingerprint = JSON.stringify({ action, payload })
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() }
    try {
      const result = await invokeSubscription(supabase, 'platform-admin', { action, data: payload, requestId: request.current.id })
      request.current = null; done?.(result); await reload()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const openHistory = async (clinic) => {
    setModal({ type: 'history', clinic }); setHistory(null); setError('')
    try { const result = await invokeSubscription(supabase, 'platform-admin', { action: 'history', data: { clinicId: clinic.id } }); setHistory(result.events) }
    catch (failure) { setError(failure.message) }
  }
  const signout = async () => { if (busy) return; setBusy(true); try { await signOut() } catch (failure) { setError(failure.message) } finally { setBusy(false) } }
  return <div className="platform-shell">
    <header className="platform-header"><Link to="/admin" className="platform-brand"><FirstAidKit size={28} weight="duotone" /><span><strong>Veterina</strong><small>Platform administration</small></span></Link><div>{profile && <Link className="text-link" to={access === 'expired' ? '/subscription' : '/dashboard'}>My clinic</Link>}<span>{user.email}</span><button className="icon-button" disabled={busy} onClick={signout} aria-label="Sign out"><SignOut size={21} /></button></div></header>
    <main className="platform-content"><div className="platform-heading"><div><span className="eyebrow">WEBSITE ADMIN</span><h1>Every clinic, in good hands.</h1><p>Manage access codes and subscription time across Veterina.</p></div><button className="button button-secondary" onClick={() => void reload()} disabled={refreshing}><ArrowsClockwise size={17} />{refreshing ? 'Refreshing...' : 'Refresh'}</button></div>
      <div className="platform-stats"><article><FirstAidKit size={23} /><strong>{data?.clinics.length ?? '—'}</strong><span>Clinics</span></article><article><ClockCountdown size={23} /><strong>{data?.clinics.filter((c) => c.status === 'active').length ?? '—'}</strong><span>Active subscriptions</span></article><article><ClockCountdown size={23} /><strong>{data?.clinics.filter(isSoon).length ?? '—'}</strong><span>Expire within 7 days</span></article><article><Key size={23} /><strong>{data?.codes.filter((c) => ['active', 'unused'].includes(c.status)).length ?? '—'}</strong><span>Available codes</span></article></div>
      {error && !modal && <p className="auth-message auth-error" role="alert">{error}</p>}
      <div className="platform-tabs" role="tablist" aria-label="Platform administration">{[['clinics', 'Clinics'], ['codes', 'Activation codes']].map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setFilter('all'); setQuery('') }}>{name}</button>)}</div>
      {tab === 'codes' && <section className="platform-panel"><h2>Generate an activation code</h2><p>Reusable by different clinics. Its availability window starts on the first successful redemption.</p><form className="platform-generate" onSubmit={(event) => { event.preventDefault(); void mutate('generate', { label, windowDays: Number(windowDays), termDays: Number(termDays) }, (result) => { setIssuedCode(result.code); setCopied(false) }) }}><fieldset disabled={busy}><label className="platform-field">Code label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} placeholder="e.g. November clinic partners" /></label><DurationField label="Code availability window" value={windowDays} onChange={setWindowDays} /><DurationField label="Subscription per clinic" value={termDays} onChange={setTermDays} /><button className="button button-primary" type="submit"><Plus size={17} />{busy ? 'Generating...' : 'Generate code'}</button></fieldset></form>{issuedCode && <div className="platform-issued" role="status"><strong>Copy this code before leaving. It can only be viewed now.</strong><code>{issuedCode}</code><button className="button button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(issuedCode); setCopied(true) } catch { setError('Copy the displayed code manually; clipboard access is unavailable.') } }}><ClipboardText size={16} />{copied ? 'Copied' : 'Copy code'}</button></div>}</section>}
      <section className="platform-panel"><div className="platform-list-heading"><h2>{tab === 'clinics' ? 'Clinic subscriptions' : 'Issued activation codes'}</h2><div><input type="search" aria-label={tab === 'clinics' ? 'Search clinics and owners' : 'Search activation codes'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'clinics' ? 'Search clinic or owner...' : 'Search label or code suffix...'} /><select aria-label="Filter subscription status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{(tab === 'clinics' ? ['active','soon','expired','disabled'] : ['unused','active','expired','revoked']).map((status) => <option key={status} value={status}>{status === 'soon' ? 'Expiring soon' : status.charAt(0).toUpperCase() + status.slice(1)}</option>)}</select></div></div>
        {!data ? <p role="status">{error ? 'Unable to load platform data. Use Refresh to retry.' : 'Loading subscriptions...'}</p> : tab === 'clinics' ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Clinic / owner</th><th>Status</th><th>Time remaining</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{clinics.map((clinic) => <tr key={clinic.id}><td><strong>{clinic.clinicName}</strong>{clinic.owners.map((owner) => <small key={owner.email}>{owner.name} · {owner.email}</small>)}{clinic.transition && <small>30-day transition grant</small>}</td><td><Badge tone={clinic.status === 'active' ? 'success' : 'warning'}>{clinic.status}</Badge></td><td><strong>{remainingTime(clinic.expiresAt, currentTime)}</strong></td><td>{subscriptionDate(clinic.expiresAt, clinic.timezone)}<small>{clinic.timezone}</small></td><td><div className="platform-row-actions"><button className="button button-secondary small-button" onClick={() => { setExtensionDays(30); setNote(''); setError(''); setModal({ type: 'extend', clinic }) }}>Add time</button><button className="text-link" onClick={() => void openHistory(clinic)}>History</button></div></td></tr>)}</tbody></table>{!clinics.length && <p className="platform-empty">No clinics match these filters.</p>}</div> : <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Code</th><th>Status / uses</th><th>Terms</th><th>Availability</th><th>Actions</th></tr></thead><tbody>{codes.map((code) => <tr key={code.id}><td><strong>{code.label || 'Activation code'}</strong><code>•••• {code.suffix}</code></td><td><Badge tone={['active','unused'].includes(code.status) ? 'success' : 'warning'}>{code.status}</Badge><small>{code.redemptions} clinic redemptions</small></td><td>{code.termDays} days per clinic<small>{code.windowDays}-day activation window</small></td><td>{code.firstUsedAt ? <>{subscriptionDate(code.expiresAt, 'UTC')}<small>First used {subscriptionDate(code.firstUsedAt, 'UTC')} UTC</small></> : 'Starts with first redemption'}</td><td>{['unused','active'].includes(code.status) && <button className="text-link danger-text" onClick={() => { setError(''); setModal({ type: 'revoke', code }) }}>Revoke</button>}</td></tr>)}</tbody></table>{!codes.length && <p className="platform-empty">No activation codes match these filters.</p>}</div>}
      </section>
    </main>
    {modal && <Modal title={modal.type === 'extend' ? `Add subscription time · ${modal.clinic.clinicName}` : modal.type === 'revoke' ? 'Revoke this activation code?' : `Subscription history · ${modal.clinic.clinicName}`} onClose={() => { if (!busy) { setModal(null); setError('') } }}>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      {modal.type === 'extend' ? <form onSubmit={(event) => { event.preventDefault(); void mutate('extend', { clinicId: modal.clinic.id, days: Number(extensionDays), note }, () => setModal(null)) }} aria-busy={busy}><fieldset className="record-fieldset platform-modal-fields" disabled={busy}><p>Added to the remaining term, or started from now if the subscription has expired.</p><DurationField label="Add subscription time" value={extensionDays} onChange={setExtensionDays} /><label className="platform-field">Admin note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional payment or renewal reference" /></label><button className="button button-primary" type="submit">{busy ? 'Saving...' : 'Add time'}</button></fieldset></form> : modal.type === 'revoke' ? <form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void mutate('revoke', { codeId: modal.code.id }, () => setModal(null)) }}><p>New redemptions will stop. Subscriptions already granted with this code keep their full term.</p><button disabled={busy} type="submit" className="button button-primary">{busy ? 'Revoking...' : 'Revoke code'}</button></form> : history ? <div className="platform-history">{history.map((event) => <article key={event.id}><strong>{event.action.replaceAll('_', ' ')}</strong><small>{subscriptionDate(event.created_at, modal.clinic.timezone)}</small>{event.days && <p>{event.days} days · New expiry: {subscriptionDate(event.expires_at, modal.clinic.timezone)}</p>}{event.note && <p>{event.note}</p>}</article>)}{!history.length && <p>No subscription changes recorded.</p>}</div> : <p role="status">Loading history...</p>}
    </Modal>}
  </div>
}
