import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useClinicData } from '../context/ClinicDataContext'
import { buildPatientTimeline, isClinicDate } from '../lib/dailyWorkflow'
import { Badge, EmptyState, SectionCard } from './ui'

export default function PatientTimeline({ patientId }) {
  const data = useClinicData()
  const events = useMemo(() => buildPatientTimeline(data, patientId), [data, patientId])
  const [kind, setKind] = useState('All')
  const [limit, setLimit] = useState(25)
  const visible = events.filter((event) => kind === 'All' || event.kind === kind)
  return <SectionCard className="patient-timeline" title="Care timeline" description="Appointments, arrivals, care and follow-up activity in one view. Latest dates appear first.">
    <div className="list-toolbar compact"><label>Activity <select aria-label="Timeline activity" value={kind} onChange={(event) => { setKind(event.target.value); setLimit(25) }}><option>All</option>{[...new Set(events.map((event) => event.kind))].sort().map((value) => <option key={value}>{value}</option>)}</select></label><span>{visible.length} activities · {data.timezone}</span></div>
    <ol className="care-event-list">{visible.slice(0, limit).map((event) => <li key={event.id} className="care-event">
      <time dateTime={event.at}>{new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${event.date}T00:00:00Z`))}{!isClinicDate(event.at) && <small>{new Intl.DateTimeFormat('en-PH', { timeZone: data.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(event.at))}</small>}</time>
      <div><div className="care-event-tags"><Badge tone="blue">{event.kind}</Badge><Badge tone={['Cancelled', 'Overdue'].includes(event.status) ? 'danger' : ['Completed', 'Finalized'].includes(event.status) ? 'success' : 'neutral'}>{event.status}</Badge></div><h3>{event.title}</h3>{event.detail && <p>{event.detail}</p>}<Link className="text-link" to={event.href}>View source</Link></div>
    </li>)}</ol>
    {!visible.length && <EmptyState title="No care activity yet" description="Saved appointments, care records and reminders will appear here." />}
    {visible.length > limit && <button className="button button-secondary" onClick={() => setLimit((current) => current + 25)}>Show more activity</button>}
  </SectionCard>
}
