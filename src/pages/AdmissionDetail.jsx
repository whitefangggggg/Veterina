import VeterinaSelect from '../components/VeterinaSelect'
import VeterinaCheckbox from '../components/VeterinaCheckbox'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bed, CheckCircle, ClipboardText, Clock, Heartbeat, PawPrint, Plus, UserCircle } from '@phosphor-icons/react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { supabase } from '../lib/supabaseClient'
import { clinicErrorMessage } from '../lib/clinicRepository'
import { admissionSource, admissionStatuses, clinicalConditions, displayAdmissionTime, effectiveObservations, fetchAdmissionDetail, fetchAdmissionPage, openAdmission, openTask, overdueTask, printAdmissionSummary, stayDuration, vitalLabels } from '../lib/admissions'
import { Badge, Field, SectionCard } from '../components/ui'
import { AdmissionActionDialog } from '../components/AdmissionDialogs'
import './Admissions.css'

export default function AdmissionDetail() {
  const { admissionId } = useParams()
  const [params] = useSearchParams()
  const clinic = useClinicData()
  const { profile } = useAuth()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState(params.get('view') === 'monitoring' ? 'monitoring' : 'care')
  const [showClosedTasks, setShowClosedTasks] = useState(false)
  const [metric, setMetric] = useState('weightKg')
  const request = useRef(0)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    const generation = ++request.current
    try {
      const next = await fetchAdmissionDetail(supabase, admissionId)
      if (!mounted.current || generation !== request.current) return false
      setDetail(next); setError(''); return true
    } catch (e) { if (mounted.current && generation === request.current) setError(clinicErrorMessage(e)); return false }
  }, [admissionId])
  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { if (mounted.current) void load() })
    const focus = () => { if (!document.hidden) void load() }
    const timer = setInterval(focus, 30000)
    window.addEventListener('focus', focus)
    const requests = request
    return () => { mounted.current = false; requests.current++; clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [load])
  const more = async (kind) => {
    const generation = request.current
    setLoading(true)
    try {
      const page = await fetchAdmissionPage(supabase, admissionId, kind, { cursor: detail[kind].cursor })
      if (!mounted.current || generation !== request.current) return
      setDetail((current) => current.admission.id === admissionId ? ({ ...current, [kind]: { ...page, count: current[kind].count, rows: [...new Map([...current[kind].rows, ...page.rows].map((r) => [r.id, r])).values()] } }) : current)
    } catch (e) { setError(clinicErrorMessage(e)) } finally { setLoading(false) }
  }
  const save = async (action, payload) => {
    try { await clinic.execute(action, payload) }
    catch (e) { await load(); throw e }
    const refreshed = await load()
    setNotice(refreshed ? 'Saved.' : 'Your change was saved. Retry refresh to load the updated admission.')
  }
  if (!detail || detail.admission.id !== admissionId) return <div className="page admissions-page"><SectionCard title="Admission"><div className="admission-empty"><PawPrint size={36} weight="duotone" aria-hidden="true" /><p role={error ? 'alert' : 'status'}>{error || 'Loading the patient’s stay…'}</p><div className="admission-actions"><button className="button button-secondary" onClick={load}>Retry loading</button><Link className="text-link" to="/admissions">Back to admissions</Link></div></div></SectionCard></div>
  const a = { ...clinic.admissions.find((row) => row.id === admissionId), ...detail.admission }
  const visit = clinic.visits.find((v) => v.id === a.visit_id)
  const live = openAdmission(a)
  const data = { ...clinic, orders: detail.orders.rows }
  const rows = (kind) => detail[kind].rows
  const currentObservations = effectiveObservations(rows('observations'))
  const trend = currentObservations.filter((o) => o.values?.[metric] != null).map((o) => ({ id: o.id, at: Date.parse(o.occurred_at), value: Number(o.values[metric]) }))
  const showMore = (kind) => detail[kind].hasMore && <button className="button button-secondary" disabled={loading} onClick={() => more(kind)}>Load more {kind}</button>
  const open = (type, target) => setModal({ type, target, admissionId })
  const print = async () => {
    setLoading(true)
    try {
      // Printing includes every post-discharge correction, even beyond UI pages.
      const all = {}
      for (const kind of ['observations', 'administrations']) {
        let page = detail[kind], entries = [...page.rows]
        while (page.hasMore) { page = await fetchAdmissionPage(supabase, admissionId, kind, { cursor: page.cursor }); entries.push(...page.rows) }
        all[kind] = entries
      }
      await printAdmissionSummary(detail.summary.snapshot, all)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  return <div className="page admissions-page">
    <Link className="text-link admission-back" to="/admissions"><ArrowLeft size={17} aria-hidden="true" />Admissions</Link>
    <div className="page-header"><div><span className="eyebrow">{a.reference}</span><h1>{a.patientName || 'Patient hospitalization'}</h1><div className="admission-badges"><Badge tone={a.condition === 'critical' ? 'danger' : 'neutral'}>{clinicalConditions[a.condition]}</Badge><Badge>{admissionStatuses[a.status]}</Badge>{a.is_historical && <Badge>Historical record</Badge>}</div></div><Link className="button button-secondary" to={`/patients/${a.pet_id}`}>Patient profile</Link></div>
    {error && <p role="alert" className="auth-message auth-error">{error} <button className="text-link" onClick={load}>Retry refresh</button></p>}
    {notice && <p role="status" className="auth-message">{notice}</p>}
    <SectionCard title="Admission overview" className="admission-overview-card"><p className="admission-intake-reason">{visit?.complaint || a.reason}</p><dl className="admission-overview">{[[UserCircle, 'Attending veterinarian', visit?.veterinarian || a.veterinarianName], [Clock, 'Admitted', displayAdmissionTime(a.admitted_at, clinic.timezone)], [ClipboardText, 'Length of stay', stayDuration(a)], [Bed, 'Location', a.unitName || 'Unassigned']].map(([Icon, label, value]) => <div key={label}><dt><Icon size={18} aria-hidden="true" />{label}</dt><dd>{value}</dd></div>)}</dl>
      {a.status !== 'cancelled' && <ol className="admission-progression" aria-label="Admission progression">{['admitted', 'under_treatment', 'ready_for_discharge', 'discharged'].map((status) => <li key={status} aria-current={status === a.status ? 'step' : undefined}><span aria-hidden="true">{status === a.status ? <Heartbeat size={15} /> : <span />}</span>{admissionStatuses[status]}</li>)}</ol>}
      <div className="admission-actions">{live && <><button className="button button-secondary" onClick={() => open('transfer')}>Assign / transfer</button><button className="button button-secondary" onClick={() => open('transition')}>{a.status === 'ready_for_discharge' ? 'Resume treatment' : 'Change status'}</button>{a.status === 'ready_for_discharge' && <button className="button button-primary" onClick={() => open('discharge')}>Discharge patient</button>}{profile.role === 'owner' && a.status === 'admitted' && <button className="text-link danger-text" onClick={() => open('cancel')}>Cancel mistaken admission</button>}</>}{detail.summary && <button className="button button-primary" disabled={loading} onClick={print}>Print / Save PDF summary</button>}</div>
    </SectionCard>
    <div className="admission-tabs" role="group" aria-label="Admission workspace">{[['care', 'Care board', ClipboardText], ['monitoring', 'Monitoring & notes', Heartbeat], ['history', 'Activity & summary', Clock]].map(([key, label, Icon]) => <button key={key} className="button" aria-pressed={tab === key} onClick={() => setTab(key)}><Icon size={18} aria-hidden="true" />{label}</button>)}</div>
    <div key={tab} className="admission-workspace">
    {tab === 'care' && <>
      <SectionCard title="Care tasks" description="Overdue tasks remain open until a staff member records an outcome. No stock is deducted for held, missed or delayed care.">
        <div className="admission-actions">{live && <><button className="button button-primary" disabled={a.status === 'ready_for_discharge'} onClick={() => open('order')}><Plus size={17} aria-hidden="true" />Add care order</button><button className="button button-secondary" onClick={() => open('unscheduled')}>Record unscheduled care</button></>}<VeterinaCheckbox label="Show resolved tasks" checked={showClosedTasks} onChange={setShowClosedTasks} /></div>
        <p className="admission-task-count"><strong>{detail.tasks.count}</strong> open tasks <span>· Due tasks appear first</span></p>
        <div className="admission-grid">{[...rows('tasks'), ...(showClosedTasks ? rows('resolvedTasks') : [])].map((task) => <article key={task.id} className={`admission-card admission-task-card ${overdueTask(task) ? 'admission-overdue' : ''}`}>
          <Badge tone={overdueTask(task) ? 'warning' : openTask(task) ? 'blue' : 'success'}>{overdueTask(task) ? 'Overdue' : task.status.replaceAll('_', ' ')}</Badge><h3>{task.order?.title || rows('orders').find((o) => o.id === task.order_id)?.title || 'Care task'}</h3><p className="admission-task-due"><Clock size={16} aria-hidden="true" />Due {displayAdmissionTime(task.due_at, clinic.timezone)}</p>{task.original_due_at !== task.due_at && <p>Originally {displayAdmissionTime(task.original_due_at, clinic.timezone)}</p>}{live && openTask(task) && <button className="button button-secondary small-button" onClick={() => open('task', task)}>Record outcome</button>}
        </article>)}</div>{!rows('tasks').length && <div className="admission-empty admission-empty-compact"><CheckCircle size={30} weight="duotone" aria-hidden="true" /><p>No open scheduled tasks.</p></div>}{showMore('tasks')}{showClosedTasks && showMore('resolvedTasks')}
      </SectionCard>
      <SectionCard title="Treatment and medication orders" description="Medication orders are linked to prescriptions. Inventory is consumed per recorded dose.">
        {rows('orders').map((order) => <article className="admission-entry" key={order.id}><h3>{order.title} <Badge>{order.status}</Badge></h3><p>{order.instructions}</p><p>{order.author_name} · {displayAdmissionTime(order.starts_at, clinic.timezone)}{order.interval_hours ? ` · Every ${order.interval_hours} hours until ${displayAdmissionTime(order.ends_at, clinic.timezone)}` : ' · One-off'}</p>
          {visit?.prescriptions?.filter((rx) => rx.id === order.prescription_id).flatMap((rx) => rx.medications || []).map((m) => <p key={m.medicationId}>{m.dose} · {m.route} · {m.frequency} · {m.duration}</p>)}
          {live && order.status === 'active' && <div className="admission-actions"><button className="text-link" onClick={() => open('unscheduled', order)}>Record unscheduled dose / care</button><button className="text-link" disabled={a.status === 'ready_for_discharge'} onClick={() => open('revise', order)}>Revise order</button><button className="text-link danger-text" onClick={() => open('stop', order)}>Stop order</button></div>}
        </article>)}{!rows('orders').length && <p>No care orders.</p>}{showMore('orders')}
      </SectionCard>
      <SectionCard title="Administration history">{rows('administrations').map((entry) => <article className="admission-entry" key={entry.id}><h3>{entry.title} <Badge>{entry.outcome}</Badge></h3><p>{entry.reason}</p><p>{displayAdmissionTime(entry.occurred_at, clinic.timezone)} · {entry.author_name}</p><small>Recorded {displayAdmissionTime(entry.recorded_at, clinic.timezone)}</small>{entry.stock_quantity && <p>Consumed {entry.stock_quantity} {entry.stock_unit} · movement {entry.movement_id}</p>}{entry.corrects_id && <p>Correction to {entry.corrects_id}. Stock ledger retained.</p>}{profile.role === 'owner' && !rows('administrations').some((x) => x.corrects_id === entry.id) && <button className="text-link" onClick={() => open('correctCare', entry)}>Append care correction</button>}</article>)}{!rows('administrations').length && <p>No administration events.</p>}{showMore('administrations')}</SectionCard>
    </>}
    {tab === 'monitoring' && <>
      <SectionCard title="Vital trends" description="Only current, uncorrected measurements are plotted. All loaded values are also shown in the table below.">
        <div className="admission-trend-controls"><Field label="Trend measurement"><VeterinaSelect value={metric} onChange={setMetric}>{Object.entries(vitalLabels).filter(([k]) => !['condition', 'hydration'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</VeterinaSelect></Field></div>
        {trend.length ? <div className="admission-trend" role="img" aria-label={`${vitalLabels[metric]} trend with ${trend.length} measurements`}><ResponsiveContainer width="100%" height={260}><LineChart data={trend} margin={{ left: 0, right: 16 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(x) => new Intl.DateTimeFormat('en-GB', { timeZone: clinic.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(x))} /><YAxis /><Tooltip labelFormatter={(x) => displayAdmissionTime(x, clinic.timezone)} /><Line dataKey="value" name={vitalLabels[metric]} stroke="var(--brand-ink)" isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p>No recorded measurements for this trend.</p>}
        <div className="admission-table-scroll" role="region" aria-label="Current monitoring measurements" tabIndex={0}><table><caption>Current measurements and attribution</caption><thead><tr><th scope="col">Observed</th><th scope="col">Recorded by</th><th scope="col">Measurements</th></tr></thead><tbody>{currentObservations.map((entry) => <tr key={entry.id}><td>{displayAdmissionTime(entry.occurred_at, clinic.timezone)}</td><td>{entry.author_name}</td><td>{Object.entries(entry.values).map(([k, v]) => `${vitalLabels[k] || k}: ${clinicalConditions[v] || v}`).join(' · ') || entry.note}</td></tr>)}</tbody></table></div>
      </SectionCard>
      <SectionCard title="Monitoring and progress notes"><div className="admission-actions">{live && <><button className="button button-primary" onClick={() => open('observe')}>Record monitoring</button><button className="button button-secondary" onClick={() => open('note')}>Add progress note</button></>}</div>
        {rows('observations').map((entry) => <article className="admission-entry" key={entry.id}><h3>{entry.kind} {entry.corrects_id && <Badge>Correction</Badge>}{(entry.is_current === false || rows('observations').some((x) => x.corrects_id === entry.id)) && <Badge>Superseded</Badge>}</h3><p>{entry.note}</p><p>{Object.entries(entry.values).map(([k, v]) => `${vitalLabels[k] || k}: ${clinicalConditions[v] || v}`).join(' · ')}</p><p>{displayAdmissionTime(entry.occurred_at, clinic.timezone)} · {entry.author_name}</p><small>Recorded {displayAdmissionTime(entry.recorded_at, clinic.timezone)}</small>{entry.corrects_id && <p>Corrects {entry.corrects_id}: {entry.correction_reason}</p>}{profile.role === 'owner' && entry.is_current !== false && !rows('observations').some((x) => x.corrects_id === entry.id) && <button className="text-link" onClick={() => open('correct', entry)}>Append observation correction</button>}</article>)}{showMore('observations')}
      </SectionCard>
    </>}
    {tab === 'history' && <>
      {detail.summary && <SectionCard title="Discharge summary"><p>{detail.summary.snapshot.assessment}</p><h3>Instructions</h3><p className="admission-prose">{detail.summary.snapshot.instructions || 'Not recorded'}</p><h3>Follow-up recommendation</h3><p>{detail.summary.snapshot.followUp || 'Not recorded'}</p><p>Authorized by {detail.summary.snapshot.authorizedBy} · {displayAdmissionTime(detail.summary.created_at, clinic.timezone)}</p><button className="button button-secondary" onClick={print} disabled={loading}>Print / Save PDF summary</button></SectionCard>}
      {a.is_historical && <SectionCard title="Historical medications">{visit?.prescriptions?.flatMap((rx) => rx.medications || []).map((m) => <p key={m.medicationId}>{[m.medicationName, m.dose, m.route, m.frequency, m.duration, m.instructions].filter(Boolean).join(' · ')}</p>)}</SectionCard>}
      <SectionCard title="Admission activity">{rows('events').map((entry) => <article className="admission-entry" key={entry.id}><h3>{entry.event_type.replaceAll('_', ' ')}</h3><p>{displayAdmissionTime(entry.occurred_at, clinic.timezone)} · {entry.author_name}</p>{entry.details?.reason && <p>{entry.details.reason}</p>}{entry.details?.to && <p>{admissionStatuses[entry.details.to]}</p>}</article>)}{showMore('events')}</SectionCard>
      <SectionCard title="Accommodation history">{rows('occupancy').map((entry) => <p key={entry.id}>{clinic.admissionUnits.find((u) => u.id === entry.unit_id)?.name || entry.unit_id} · {displayAdmissionTime(entry.assigned_at, clinic.timezone)} – {entry.released_at ? displayAdmissionTime(entry.released_at, clinic.timezone) : 'Currently occupied'}</p>)}{!rows('occupancy').length && <p>No accommodation assigned.</p>}{showMore('occupancy')}</SectionCard>
    </>}
    </div>
    {modal?.admissionId === admissionId && <AdmissionActionDialog key={`${admissionId}:${modal.type}:${modal.target?.id || ''}`} type={modal.type} target={modal.target} admission={a} data={data} onSave={save} onClose={() => setModal(null)} />}
    <small><Link to={admissionSource(a.id)}>Permanent admission link</Link></small>
  </div>
}
