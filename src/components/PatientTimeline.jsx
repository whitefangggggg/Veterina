import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useClinicData } from '../context/ClinicDataContext'
import { buildPatientTimeline, isClinicDate } from '../lib/dailyWorkflow'
import { Badge, SectionCard } from './ui'
import PatientRecordBrowser from './PatientRecordBrowser'
import { recordHistoryFields, timelineHistoryRecords } from '../lib/patientRecordHistory'

export default function PatientTimeline({ patientId }) {
  const data = useClinicData()
  const events = useMemo(() => buildPatientTimeline(data, patientId), [data, patientId])
  const records = timelineHistoryRecords(events)
  const fields = recordHistoryFields(records, [['kind', 'Activity', 'All activities', 'Timeline activity'], ['status', 'Activity status', 'All statuses']])
  return <SectionCard className="patient-timeline" title="Care timeline" description="Appointments, arrivals, care and follow-up activity in one view. Latest dates appear first.">
    <PatientRecordBrowser records={records} scope="timeline" label="Care timeline" itemName="activity" itemPlural="activities" fields={fields} dateLabel="Activity date" placeholder="Search activity, notes or medicines…" pageSize={25} moreLabel="Show more activity" emptyTitle="No care activity yet" emptyDescription="Saved appointments, care records and reminders will appear here." previewKind="timeline">
    {(visible) => <ol className="care-event-list">{visible.map((event) => <li key={event.id} className="care-event">
      <time dateTime={event.at}>{new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${event.date}T00:00:00Z`))}{!isClinicDate(event.at) && <small>{new Intl.DateTimeFormat('en-PH', { timeZone: data.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(event.at))}</small>}</time>
      <div><div className="care-event-tags"><Badge tone="blue">{event.kind}</Badge><Badge tone={['Cancelled', 'Overdue'].includes(event.status) ? 'danger' : ['Completed', 'Finalized'].includes(event.status) ? 'success' : 'neutral'}>{event.status}</Badge></div><h3>{event.title}</h3>{event.detail && <p>{event.detail}</p>}<Link className="text-link" to={event.href}>View source</Link></div>
    </li>)}</ol>}
    </PatientRecordBrowser>
  </SectionCard>
}
