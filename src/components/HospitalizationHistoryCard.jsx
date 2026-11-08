import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { admissionSource, admissionStatuses, clinicalConditions, displayAdmissionTime } from '../lib/admissions'
import { dateInClinic } from '../lib/dailyWorkflow'
import { Badge } from './ui'
import './PatientAdmissions.css'

export function HospitalizationDetails({ record, timezone }) {
  return <div className="hospitalization-record-details">
    <div className="patient-hospitalization-badges"><Badge tone={record.condition === 'critical' ? 'danger' : 'neutral'}>{clinicalConditions[record.condition]}</Badge><Badge>{admissionStatuses[record.status]}</Badge>{record.is_historical && <Badge>Historical</Badge>}</div>
    <p className="service-notes">{record.reason || 'Reason not recorded'}</p>
    <dl className="calendar-preview-fields">{[
      ['Admission reference', record.reference], ['Admitted', displayAdmissionTime(record.admitted_at, timezone)],
      ['Veterinarian', record.veterinarianName || 'Not recorded'], ['Accommodation', record.unitName || 'Unassigned'],
      ...(record.closed_at ? [[record.status === 'cancelled' ? 'Cancelled' : 'Discharged', displayAdmissionTime(record.closed_at, timezone)]] : []),
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="record-actions"><Link className="button button-secondary small-button" to={admissionSource(record.id)}>View admission</Link><Link className="text-link" to={`${admissionSource(record.id)}?view=monitoring`}>View monitoring and notes</Link><Link className="text-link" to={`${admissionSource(record.id)}?view=history`}>Activity &amp; discharge summary</Link></div>
  </div>
}

export default function HospitalizationHistoryCard({ record, timezone }) {
  const day = dateInClinic(record.admitted_at, timezone)
  const date = day ? parseISO(day) : null
  return <article className="visit-card section-card hospitalization-history-card" id={`hospitalization-${record.id}`}>
    <div className="visit-date">{date ? <><span>{format(date, 'MMM')}</span><strong>{format(date, 'dd')}</strong><small>{format(date, 'yyyy')}</small></> : <small>Not recorded</small>}</div>
    <div className="visit-content"><div className="visit-heading"><h2>Hospitalization</h2><span>{record.veterinarianName || 'Not recorded'}</span></div><HospitalizationDetails record={record} timezone={timezone} /></div>
  </article>
}
