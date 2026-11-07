import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Badge } from './ui'
import { dateInClinic } from '../lib/dailyWorkflow'
import { serviceStatus } from '../lib/clinicalHistory'
import { visitDateTime } from '../lib/patientVitals'

export default function ServiceHistoryCard({ record, timezone, onEdit }) {
  const day = dateInClinic(record.arrivedAt, timezone)
  const date = day ? parseISO(day) : null
  const status = record.recordingPurpose === 'record_only' ? 'Record only' : serviceStatus(record.status)
  const tone = { Waiting: 'warning', 'In progress': 'blue', Completed: 'success', Cancelled: 'danger' }[status] || 'neutral'
  return <article className="visit-card section-card service-history-card" id={`service-${record.id}`}>
    <div className="visit-date">{date ? <><span>{format(date, 'MMM')}</span><strong>{format(date, 'dd')}</strong><small>{format(date, 'yyyy')}</small></> : <small>Not recorded</small>}</div>
    <div className="visit-content">
      <div className="visit-heading"><div><Badge>Service</Badge><Badge tone={tone}>{status}</Badge><h2>{record.service}</h2><p>{visitDateTime(record.arrivedAt, timezone)}{record.queueNumber ? ` · ${record.queueNumber}` : ''}</p></div><span>{record.veterinarian || 'Not recorded'}</span></div>
      <div className="service-history-notes"><strong>Service notes</strong><p className="service-notes">{record.serviceNotes || 'Not recorded'}</p>
        {record.notes && record.notes !== record.serviceNotes && <><strong>Arrival notes</strong><p className="service-notes">{record.notes}</p></>}
      </div>
      <div className="record-actions">{record.recordingPurpose === 'record_only' && <button className="button button-secondary small-button" onClick={() => onEdit(record)}>Edit service record</button>}
        {['waiting', 'in_progress'].includes(record.status) && <Link className="button button-secondary small-button" to="/queue">Open queue</Link>}</div>
    </div>
  </article>
}
