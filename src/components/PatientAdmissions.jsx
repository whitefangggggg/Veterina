import { Link } from 'react-router-dom'
import { useClinicData } from '../context/ClinicDataContext'
import { admissionSource, admissionStatuses, clinicalConditions, displayAdmissionTime } from '../lib/admissions'
import { buildPatientTimeline } from '../lib/dailyWorkflow'
import { Badge, SectionCard } from './ui'
import './PatientAdmissions.css'

export default function PatientAdmissions({ patientId }) {
  const data = useClinicData()
  const stays = data.admissions.filter((a) => a.petId === patientId).sort((a, b) => b.admitted_at.localeCompare(a.admitted_at))
  if (!stays.length) return null
  const events = buildPatientTimeline(data, patientId).filter((e) => ['Admission', 'Discharge', 'Admission cancellation'].includes(e.kind))
  return <SectionCard className="patient-hospitalization-history" title="Hospitalization history" description="Active and completed stays retain their care records and discharge evidence.">
    <div className="patient-hospitalization-content">
      <div className="patient-hospitalization-stays">{stays.map((a) => <article key={a.id} className="patient-hospitalization-stay">
        <h3><Link className="text-link" to={admissionSource(a.id)}>{a.reference}</Link></h3>
        <div className="patient-hospitalization-badges"><Badge tone={a.condition === 'critical' ? 'danger' : 'neutral'}>{clinicalConditions[a.condition]}</Badge><Badge>{admissionStatuses[a.status]}</Badge>{a.is_historical && <Badge>Historical</Badge>}</div>
        {a.reason && <p>{a.reason}</p>}
        <p className="patient-hospitalization-meta">{displayAdmissionTime(a.admitted_at, data.timezone)}{a.veterinarianName && <> · {a.veterinarianName}</>}</p>
        <Link className="text-link" to={`${admissionSource(a.id)}?view=monitoring`}>View monitoring and notes</Link>
      </article>)}</div>
      <ol className="patient-hospitalization-timeline" aria-label="Hospitalization timeline">{events.map((event) => <li key={event.id}><time dateTime={event.at}>{displayAdmissionTime(event.at, data.timezone)}</time> · <Link className="text-link" to={event.href}>{event.title}</Link></li>)}</ol>
    </div>
  </SectionCard>
}
