import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle, ClipboardText, Package, Phone } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { patientSource, reminderSource, STOCK_EXPIRY_WARNING_DAYS, stockExpiryAlerts } from '../lib/dailyWorkflow'
import { Badge } from './ui'
import PetSticker from './PetSticker'
import VeterinaCheckbox from './VeterinaCheckbox'
import { SleepingPatientCat } from './PixelPatients'

function RadarCard({ title, icon: Icon, children, action, className = '' }) {
  return <section className={`radar-card ${className}`} aria-label={title}>
    <header><h2><Icon size={17} aria-hidden="true" />{title}</h2>{action}</header>
    <div className="radar-card-body">{children}</div>
  </section>
}

export function LiveClinicFloor({ work, onOpen, onWalkIn }) {
  const { getPet, getOwner } = useClinicData()
  const count = work.waiting.length + work.inCare.length + work.ready.length
  const lanes = [{ title: 'Waiting in lobby', rows: work.waiting, type: 'waiting' },
    { title: 'In consultation', rows: work.inCare, type: 'in_progress' }, { title: 'Ready for discharge', rows: work.ready, type: 'ready' }]
  return <section className="clinic-floor" aria-labelledby="clinic-floor-title">
    <header className="command-card-header"><div><span className="eyebrow">Live clinic floor</span><h2 id="clinic-floor-title">Care in motion</h2></div><Link className="text-link" to="/queue">Open queue <ArrowRight size={14} aria-hidden="true" /></Link></header>
    {!count ? <div className="floor-zero"><SleepingPatientCat /><h3>All quiet on the clinic floor!</h3><p>Ready for today’s walk-ins or scheduled check-ins.</p><button className="button button-primary small-button" onClick={onWalkIn}>Check-in a Walk-in Patient</button></div>
      : <div className="floor-lanes">{lanes.map(({ title, rows, type }) => <section className={`floor-lane lane-${type}`} key={type} aria-label={title}>
        <h3>{title}{rows.length > 0 && <span>{rows.length}</span>}</h3>
        <div className="floor-lane-body">{rows.map((entry) => {
          const pet = getPet(entry.petId), owner = getOwner(pet?.ownerId)
          return <article className="floor-patient" key={entry.id}>
            <div className="command-patient"><PetSticker pet={pet} size="small" /><div><Link to={patientSource(entry.petId)}>{pet?.name || 'Patient unavailable'}</Link><small>{owner?.fullName || 'Owner not recorded'}</small></div></div>
            <p>{entry.service || entry.reason || 'Hospitalization'}</p>
            <small>{entry.queueNumber ? `${entry.queueNumber} · ` : ''}{type === 'waiting' ? Number.isFinite(entry.waitMinutes) ? `Waiting ${entry.waitMinutes} min` : 'Arrival time unavailable' : entry.veterinarian || entry.veterinarianName || 'Unassigned'}</small>
            {type === 'ready' ? <Link className="text-link" to={`/admissions/${encodeURIComponent(entry.id)}`}>Review discharge</Link>
              : <button className="button button-secondary small-button" onClick={() => onOpen({ type: type === 'waiting' ? 'start' : 'care', entry })}>{type === 'waiting' ? 'Start care' : entry.draftSavedAt ? 'Resume draft' : 'Resume care'}</button>}
          </article>
        })}{!rows.length && <p className="command-empty">{type === 'waiting' ? 'No one waiting.' : type === 'in_progress' ? 'No consultations in progress.' : 'No admissions awaiting discharge.'}</p>}</div>
      </section>)}</div>}
  </section>
}

export function IncompleteChartsCard({ charts, onOpen }) {
  const { getPet, timezone } = useClinicData()
  return <RadarCard title="Incomplete charts & drafts" icon={ClipboardText} action={<Link to="/patients" className="text-link">Patients</Link>} className="charts-radar">
    {!charts.length && <p className="command-empty"><CheckCircle size={18} aria-hidden="true" />Charts are up to date.</p>}
    {charts.map((chart) => <article className="radar-row chart-row" key={chart.id}>
      <div><Link to={patientSource(chart.petId)} title={chart.mine ? 'Assigned to you' : chart.entry?.veterinarian || chart.visit?.veterinarian || 'Clinic care'}>{getPet(chart.petId)?.name || 'Patient unavailable'}{chart.mine && <span className="chart-assignee"> · Yours</span>}</Link><small>{chart.description || 'Clinical notes'} · {chart.at && Number.isFinite(Date.parse(chart.at)) ? new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(chart.at)) : 'Date unavailable'}</small></div>
      <button className="text-link" onClick={() => onOpen(chart.entry ? { type: chart.entry.status === 'waiting' ? 'start' : 'care', entry: chart.entry } : { type: 'chart', visit: chart.visit })}>{chart.entry?.status === 'waiting' ? 'Start care' : chart.draft ? 'Resume draft' : 'Edit SOAP'}</button>
    </article>)}
  </RadarCard>
}

export function CallsDueCard({ calls }) {
  const { getPet, getOwner, completeReminder } = useClinicData()
  const [states, setStates] = useState({}), [message, setMessage] = useState('')
  const inFlight = useRef(new Set())
  const keyFor = (task) => `${task.id}:${task.dueDate}`
  const complete = async (task) => {
    const key = keyFor(task)
    if (inFlight.current.has(key) || states[key]?.phase === 'saved') return
    inFlight.current.add(key)
    setStates((current) => ({ ...current, [key]: { phase: 'pending' } }))
    setMessage('')
    try {
      await completeReminder(task.id, 'Completed')
      setStates((current) => ({ ...current, [key]: { phase: 'saved' } }))
      setMessage(`${task.title} marked done.`)
    } catch (error) {
      setStates((current) => ({ ...current, [key]: { phase: 'error', error: error.message || 'Could not complete this follow-up. Try again.' } }))
    } finally { inFlight.current.delete(key) }
  }
  const remaining = calls.filter((task) => states[keyFor(task)]?.phase !== 'saved')
  return <RadarCard title="Calls due" icon={Phone} action={<Link className="text-link" to="/appointments?view=tasks">All tasks</Link>} className="calls-radar">
    <p className="command-feedback" role="status">{message}</p>
    {!remaining.length && <p className="command-empty"><CheckCircle size={18} aria-hidden="true" />Follow-up calls are up to date.</p>}
    {remaining.slice(0, 3).map((task) => {
      const pet = getPet(task.petId), owner = getOwner(pet?.ownerId)
      const phone = (owner?.normalizedPhone || owner?.phone || '').replace(/[^+\d]/g, '')
      const state = states[keyFor(task)], pending = state?.phase === 'pending'
      return <article className={`radar-row call-row ${pending ? 'is-pending' : ''}`} key={task.id} aria-busy={pending}>
        <div><Link to={reminderSource(task.id)}>{task.title}</Link><small>{pet?.name || 'Patient unavailable'} · {task.status} · {task.dueDate}</small>
          {state?.error && <p className="command-inline-error" role="alert">{state.error}</p>}</div>
        <div className="radar-inline-actions">{phone ? <a className="text-link" href={`tel:${phone}`} aria-label={`Call ${owner?.fullName || 'owner'} about ${task.title}`}>Call</a> : <small>No phone</small>}
          <VeterinaCheckbox label={pending ? 'Saving…' : state?.phase === 'error' ? 'Retry' : 'Done'} aria-label={`Mark ${task.title} done`} checked={pending} disabled={pending} onChange={(checked) => { if (checked) void complete(task) }} /></div>
      </article>
    })}
  </RadarCard>
}

export function StockWatchCard({ stock }) {
  const { suppliers, inventory, today } = useClinicData()
  const expiries = stockExpiryAlerts(inventory, today)
  const expired = expiries.filter((alert) => alert.status === 'expired').length
  const expiring = expiries.length - expired
  return <RadarCard title="Stock & vaccine watch" icon={Package} action={<Link className="text-link" to="/inventory?attention=all">Inventory</Link>} className="stock-radar">
    {expiries.length > 0 && <p className="stock-expiry-summary" role="status" aria-label="Stock expiry warnings">
      {expired > 0 && <Link to="/inventory?attention=expired">{expired} expired batch{expired === 1 ? '' : 'es'}</Link>}
      {expiring > 0 && <Link to="/inventory?attention=expiring">{expiring} batch{expiring === 1 ? '' : 'es'} expiring within {STOCK_EXPIRY_WARNING_DAYS} days</Link>}
    </p>}
    {!stock.length && <p className="command-empty"><CheckCircle size={18} aria-hidden="true" />Stock is ready for care.</p>}
    {stock.slice(0, 2).map(({ item, href, expired, expiring, lowStock }) => {
      const supplier = suppliers.find((row) => row.id === item.supplierId && row.isActive)
      return <article className="radar-row stock-watch-row" key={item.id}>
        <div><Link to={href}>{item.name}</Link><small>{item.quantity} {item.unit} on hand · {[item.quantity <= 0 ? 'Out of stock' : lowStock ? `Minimum ${item.minimumStock}` : '', expired.length ? `${expired.length} expired batch${expired.length === 1 ? '' : 'es'}` : '', expiring.length ? `${expiring.length} expiring soon` : ''].filter(Boolean).join(' · ')}</small></div>
        <div className="radar-stock-action"><Badge tone={expired.length || item.quantity <= 0 ? 'danger' : 'warning'}>{expired.length ? 'Expired' : item.quantity <= 0 ? 'Stockout' : lowStock ? 'Low stock' : 'Expiring'}</Badge><Link className="text-link" to={supplier ? `/suppliers#${encodeURIComponent(supplier.id)}` : href}>{supplier ? 'Order from supplier' : 'Review stock'}</Link></div>
      </article>
    })}
  </RadarCard>
}

export function ActionRadar({ work, onOpen }) {
  return <aside className="action-radar" aria-label="Clinic action radar"><IncompleteChartsCard charts={work.charts} onOpen={onOpen} /><CallsDueCard calls={work.calls} /><StockWatchCard stock={work.stock} /></aside>
}
