import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { admissionStatuses, clinicalConditions, vitalLabels } from '../lib/admissions'
import { trackingTime } from '../lib/admissionTracking'
import { ClipboardText, Clock, Heartbeat } from '@phosphor-icons/react'
import VeterinaSelect from './VeterinaSelect'

const activityLabels = { admitted: 'Admitted', status: 'Status changed', discharged: 'Discharged', transfer: 'Accommodation transfer', care_order: 'Care order created or revised', order_stopped: 'Care order stopped' }
const statusLabel = value => admissionStatuses[value] || clinicalConditions[value] || value?.replaceAll('_', ' ')
const measurements = values => Object.entries(values || {}).map(([key, value]) => `${vitalLabels[key] || key}: ${clinicalConditions[value] || value}`).join(' · ')

export default function PublicAdmissionClinical({ clinical, timezone, onMore, loading }) {
  const [metric, setMetric] = useState('temperatureC')
  const rows = name => clinical[name]?.items || []
  const more = name => clinical[name]?.cursor && <button className="button button-secondary" disabled={!!loading} onClick={() => onMore(name)}>{loading === name ? 'Loading…' : `Load more ${name === 'resolvedTasks' ? 'resolved tasks' : name}`}</button>
  const time = value => trackingTime(value, timezone)
  const attribution = row => <p className="public-clinical-attribution"><time dateTime={row.occurredAt || row.createdAt}>{time(row.occurredAt || row.createdAt)}</time>{row.author && <> · {row.author}</>}</p>
  const current = rows('monitoring').filter(row => row.isCurrent)
  const trend = current.filter(row => row.values?.[metric] != null).map(row => ({ at: Date.parse(row.occurredAt), value: Number(row.values[metric]) })).sort((a, b) => a.at - b.at)
  const task = row => <article className="public-clinical-entry" key={row.key}><h4>{row.title}</h4><p><strong>{statusLabel(row.status)}</strong> · Due {time(row.dueAt)}</p>{row.originalDueAt !== row.dueAt && <p>Originally due {time(row.originalDueAt)}</p>}</article>
  return <div className="public-clinical-sections">
    <section className="public-admission-card public-clinical-activity" aria-labelledby="public-admission-activity">
      <h2 id="public-admission-activity"><Clock size={22} weight="duotone" aria-hidden="true" />Admission activity</h2>
      <div className="public-clinical-activity-grid">
      {rows('activity').map(row => <article className="public-clinical-entry" key={row.key}><h3>{activityLabels[row.type]}</h3>{attribution(row)}{row.toStatus && <p>{statusLabel(row.fromStatus)} → {statusLabel(row.toStatus)}</p>}{row.condition && <p>Condition: {statusLabel(row.condition)}</p>}{row.reason && <p className="public-admission-prose">{row.reason}</p>}</article>)}
      {!rows('activity').length && <p>No admission activity recorded.</p>}</div>{more('activity')}
    </section>
    <section className="public-admission-card public-clinical-monitoring" aria-labelledby="public-admission-monitoring">
      <h2 id="public-admission-monitoring"><Heartbeat size={22} weight="duotone" aria-hidden="true" />Monitoring & notes</h2>
      <h3>Vital trends</h3>
      <div className="public-clinical-metric"><label htmlFor="public-trend-metric">Measurement</label><VeterinaSelect id="public-trend-metric" ariaLabel="Measurement" value={metric} onChange={setMetric} options={Object.entries(vitalLabels).filter(([key]) => !['condition', 'hydration'].includes(key)).map(([value, label]) => ({ value, label }))} /></div>
      <p className="public-clinical-attribution">Trends show current measurements from the loaded entries. Load more notes to include earlier measurements.</p>
      {trend.length > 0 ? <div className="public-clinical-trend" role="img" aria-label={`${vitalLabels[metric]} trend with ${trend.length} measurements`}><ResponsiveContainer width="100%" height={220}><LineChart data={trend} margin={{ right: 12 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} tickFormatter={value => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(new Date(value))} /><YAxis /><Tooltip labelFormatter={time} /><Line dataKey="value" name={vitalLabels[metric]} stroke="var(--brand-ink)" isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p>No current measurements for this trend.</p>}
      {current.some(row => Object.keys(row.values || {}).length) && <div className="public-clinical-table"><table><caption>Current measurements from loaded entries</caption><thead><tr><th scope="col">Observed</th><th scope="col">Recorded by</th><th scope="col">Measurements</th></tr></thead><tbody>{current.filter(row => Object.keys(row.values || {}).length).map(row => <tr key={row.key}><td>{time(row.occurredAt)}</td><td>{row.author}</td><td>{measurements(row.values)}</td></tr>)}</tbody></table></div>}
      <h3>Monitoring and progress notes</h3>
      {rows('monitoring').map(row => <article className={`public-clinical-entry${row.isCurrent ? '' : ' public-clinical-superseded'}`} key={row.key}><h4>{row.kind === 'note' ? 'Progress note' : statusLabel(row.kind)}{row.correction && <span> · Correction</span>}{!row.isCurrent && <span> · Superseded</span>}</h4>{attribution(row)}<p className="public-admission-prose">{row.note}</p>{Object.keys(row.values || {}).length > 0 && <p>{measurements(row.values)}</p>}<small>Recorded {time(row.recordedAt)}</small>{row.correctionReason && <p className="public-admission-prose">Correction reason: {row.correctionReason}</p>}</article>)}
      {!rows('monitoring').length && <p>No monitoring or progress notes recorded.</p>}{more('monitoring')}
    </section>
    <section className="public-admission-card public-clinical-care" aria-labelledby="public-admission-care">
      <h2 id="public-admission-care"><ClipboardText size={22} weight="duotone" aria-hidden="true" />Care board</h2>
      <h3>Open care tasks</h3>{rows('tasks').map(task)}{!rows('tasks').length && <p>No open care tasks.</p>}{more('tasks')}
      <h3>Resolved care tasks</h3>{rows('resolvedTasks').map(task)}{!rows('resolvedTasks').length && <p>No resolved care tasks.</p>}{more('resolvedTasks')}
      <h3>Treatment and medication orders</h3>
      {rows('orders').map(row => <article className="public-clinical-entry" key={row.key}><h4>{row.title} · {statusLabel(row.status)}</h4>{attribution(row)}{row.revised && <p>Revised order</p>}<p className="public-admission-prose">{row.instructions}</p><p>{time(row.startsAt)} – {time(row.endsAt)}{row.intervalHours ? ` · Every ${row.intervalHours} hours` : ' · One-off'}</p>{row.medication && <div className="public-clinical-medication"><p>{row.medication.name}</p><dl>{[['Dose', 'dose'], ['Route', 'route'], ['Frequency', 'frequency'], ['Duration', 'duration']].map(([label, key]) => row.medication[key] && <div key={key}><dt>{label}</dt><dd>{row.medication[key]}</dd></div>)}</dl>{row.medication.instructions !== row.instructions && <p className="public-admission-prose">{row.medication.instructions}</p>}</div>}</article>)}
      {!rows('orders').length && <p>No treatment or medication orders recorded.</p>}{more('orders')}
      <h3>Administration history</h3>
      {rows('administrations').map(row => <article className={`public-clinical-entry${row.isCurrent ? '' : ' public-clinical-superseded'}`} key={row.key}><h4>{row.title} · {statusLabel(row.outcome)}{row.correction && <span> · Correction</span>}{!row.isCurrent && <span> · Superseded</span>}</h4>{attribution(row)}<p className="public-admission-prose">{row.reason}</p>{row.deferredUntil && <p>Deferred until {time(row.deferredUntil)}</p>}<small>Recorded {time(row.recordedAt)}</small></article>)}
      {!rows('administrations').length && <p>No administration events recorded.</p>}{more('administrations')}
    </section>
  </div>
}
