import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useClinicData } from '../context/ClinicDataContext'
import { dateInClinic, isClinicDate } from '../lib/dailyWorkflow'
import { prescriptionMedications } from '../lib/prescriptions'
import { Badge } from './ui'
import { useAuth } from '../context/AuthContext'
import { calendarEditActions } from '../lib/calendarRecordEditing'

const statusName = (value) => ({ waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })[value] || value
const dayLabel = (value, timezone) => { const date = dateInClinic(value, timezone); return date ? format(parseISO(date), 'd MMM yyyy') : 'Not recorded' }
const timeLabel = (value, timezone) => !value || !dateInClinic(value, timezone) ? 'Not recorded' : isClinicDate(value) ? dayLabel(value, timezone)
  : new Intl.DateTimeFormat('en-PH', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const display = (value) => value == null || value === '' ? '—' : String(value)

function Fields({ rows }) {
  return <dl className="calendar-preview-fields">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>
}

function PrescriptionDetails({ prescription, visit, onEdit }) {
  return <section className="calendar-preview-section"><h4>Prescription</h4><ol className="prescription-items">{prescriptionMedications(prescription).map((medication, index) => <li key={index}>
    <strong>{medication.medicationName}</strong><p>{[medication.dose, medication.frequency, medication.duration].filter(Boolean).join(' · ')}</p>{medication.instructions && <p>{medication.instructions}</p>}
  </li>)}</ol>{onEdit && !visit.finalizedAt && <button type="button" className="text-link" onClick={() => onEdit({ type: 'prescription', label: 'Edit prescription', record: prescription, petId: visit.petId })}>Edit prescription</button>}</section>
}

function CheckupDetails({ visit, data, onEdit }) {
  return <>
    <Fields rows={[
      ['Checkup', visit.type], ['Veterinarian', visit.veterinarian], ['Date and time', timeLabel(visit.visitedAt, data.timezone)],
      ['Care status', visit.careStatus || 'Recorded'], ['Record status', visit.finalizedAt ? 'Finalized' : 'Unfinalized'],
      ['Queue', visit.careQueue?.queueNumber], ['Chief complaint', visit.complaint], ['Diagnosis', visit.diagnosis],
      ['Weight', visit.weightKg != null ? `${visit.weightKg} kg` : ''], ['Temperature', visit.temperatureC != null ? `${visit.temperatureC} °C` : ''],
      ['Heart rate', visit.heartRate != null ? `${visit.heartRate} bpm` : ''], ['Respiratory rate', visit.respiratoryRate != null ? `${visit.respiratoryRate} rpm` : ''],
      ['Body condition', visit.bodyConditionScore != null ? `${visit.bodyConditionScore}/${visit.bodyConditionScale}` : ''], ['Hydration', visit.hydration],
      ['Follow-up date', visit.followUpDate ? dayLabel(visit.followUpDate, data.timezone) : 'Not scheduled'],
    ]} />
    <div className="soap-grid">{[['S · Subjective', visit.subjective], ['O · Objective', visit.objective], ['A · Assessment', visit.assessment], ['P · Plan', visit.plan]].map(([label, value]) => <div key={label}><strong>{label}</strong><p>{display(value)}</p></div>)}</div>
    {(visit.prescriptions || []).map((prescription) => <PrescriptionDetails key={prescription.id} prescription={prescription} visit={visit} onEdit={onEdit} />)}
    {(visit.corrections || []).map((correction) => <section className="calendar-preview-section" key={correction.id}><h4>Correction · {correction.reason}</h4><p>{correction.correction}</p>{correction.created_at && <small>{timeLabel(correction.created_at, data.timezone)}</small>}</section>)}
  </>
}

function VaccineDetails({ vaccine, data }) {
  const veterinarian = vaccine.administered_by_name || data.profiles.find((profile) => profile.id === vaccine.veterinarianId)?.full_name || 'Clinic staff'
  return <Fields rows={[
    ['Vaccine', vaccine.vaccine], ['Recorded date', dayLabel(vaccine.administeredAt, data.timezone)], ['Brand', vaccine.brand], ['Dose', vaccine.dose],
    ['Historical lot', vaccine.lotNumber], ['Veterinarian', veterinarian], ['Care status', vaccine.careStatus || 'Recorded'], ['Queue', vaccine.careQueue?.queueNumber],
    ['Next due', vaccine.nextDueAt ? dayLabel(vaccine.nextDueAt, data.timezone) : 'Not scheduled'], ['Next dose status', vaccine.nextDoseStatus],
  ]} />
}

function QueueDetails({ entry, data, onEdit }) {
  const visit = data.visits.find((visit) => visit.id === entry.visit_id)
  const vaccine = data.vaccinations.find((vaccine) => vaccine.id === entry.vaccination_id)
  const draftLabels = { complaint: 'Chief complaint', diagnosis: 'Diagnosis', subjective: 'Subjective', objective: 'Objective', assessment: 'Assessment', plan: 'Plan',
    weightKg: 'Weight (kg)', temperatureC: 'Temperature (°C)', heartRate: 'Heart rate (bpm)', respiratoryRate: 'Respiratory rate (rpm)', bodyConditionScore: 'Body condition', hydration: 'Hydration',
    followUpDate: 'Follow-up date', serviceNotes: 'Service notes', dose: 'Dose', administeredAt: 'Vaccination date', nextDueAt: 'Next due date' }
  const draft = Object.entries(entry.careDraft || {}).filter(([key, value]) => draftLabels[key] && value != null && value !== '').map(([key, value]) => [draftLabels[key], value])
  return <>
    <Fields rows={[
      ['Service', entry.service], ['Queue', entry.queueNumber], ['Queue date', entry.queueDate ? dayLabel(entry.queueDate, data.timezone) : ''], ['Status', statusName(entry.status)],
      ['Veterinarian', entry.veterinarian], ['Arrived', timeLabel(entry.arrivedAt, data.timezone)], ['Finished', timeLabel(entry.finished_at, data.timezone)],
      ['Source', entry.source?.replaceAll('_', ' ')], ['Notes', entry.notes], ['Service notes', entry.serviceNotes],
    ]} />
    {draft.length > 0 && <section className="calendar-preview-section"><h4>Saved care draft</h4><Fields rows={draft} /><small>Saved {timeLabel(entry.draftSavedAt, data.timezone)}{entry.draftSavedBy && ` · ${entry.draftSavedBy}`}</small></section>}
    {visit && <CheckupDetails visit={visit} data={data} onEdit={onEdit} />}
    {vaccine && <VaccineDetails vaccine={vaccine} data={data} />}
  </>
}

function ReminderDetails({ reminder, data }) {
  return <>
    <Fields rows={[
      ['Reminder', reminder.title], ['Type', reminder.type], ['Status', reminder.status], ['Due', dayLabel(reminder.dueDate, data.timezone)],
      ['Assigned to', reminder.assignedTo], ['Priority', reminder.priority], ['Notes', reminder.notes], ['Outcome', reminder.outcome],
      ['Completed', reminder.completed_at ? timeLabel(reminder.completed_at, data.timezone) : ''],
    ]} />
    {(reminder.activity || []).map((activity) => <section className="calendar-preview-section" key={activity.id}><h4>{activity.action.replaceAll('_', ' ')}</h4><p>{activity.note}</p><small>{timeLabel(activity.created_at, data.timezone)}</small></section>)}
  </>
}

function TimelineDetails({ event, data, onEdit }) {
  const id = event.sourceId
  if (['Checkup', 'Prescription', 'Correction'].includes(event.kind)) {
    const visit = data.visits.find((visit) => event.kind === 'Checkup' ? visit.id === id : event.kind === 'Prescription'
      ? visit.prescriptions.some((prescription) => prescription.id === id) : visit.corrections.some((correction) => correction.id === id))
    if (visit) return <CheckupDetails visit={visit} data={data} onEdit={event.kind === 'Prescription' ? undefined : onEdit} />
  }
  if (event.kind === 'Vaccination') {
    const vaccine = data.vaccinations.find((vaccine) => vaccine.id === id)
    if (vaccine) return <VaccineDetails vaccine={vaccine} data={data} />
  }
  if (['Arrival', 'Care draft', 'Queue outcome'].includes(event.kind)) {
    const entry = data.queueEntries.find((entry) => entry.id === id)
    if (entry) return <QueueDetails entry={entry} data={data} onEdit={onEdit} />
  }
  if (event.kind === 'Appointment') {
    const appointment = data.appointments.find((appointment) => appointment.id === id)
    if (appointment) return <Fields rows={[
      ['Service', appointment.service], ['Status', appointment.status], ['Starts', timeLabel(appointment.starts_at, data.timezone)],
      ['Ends', timeLabel(appointment.ends_at, data.timezone)], ['Veterinarian', appointment.veterinarian], ['Duration', `${appointment.durationMinutes} minutes`], ['Notes', appointment.notes],
    ]} />
  }
  if (['Reminder', 'Reminder activity'].includes(event.kind)) {
    const reminder = data.reminders.find((reminder) => event.kind === 'Reminder' ? reminder.id === id : reminder.activity.some((activity) => activity.id === id))
    if (reminder) return <ReminderDetails reminder={reminder} data={data} />
  }
  return <p>{event.detail || 'No additional details recorded.'}</p>
}

export default function CalendarRecordDetails({ records, kind, onEdit }) {
  const data = useClinicData()
  const { profile } = useAuth()
  return records.map((record) => <article className="calendar-preview-record" key={record.id} style={kind === 'checkup' && record.cardColor ? { '--preview-color': record.cardColor } : undefined}>
    <header><h3>{kind === 'checkup' ? record.diagnosis || record.complaint || record.type : kind === 'vaccination' ? record.vaccine : kind === 'service' ? record.service : record.title}</h3>
      {kind === 'timeline' && <Badge tone="blue">{record.kind} · {record.status}</Badge>}
    </header>
    {onEdit && <div className="calendar-preview-actions">{calendarEditActions(kind, record, data, profile.role).map((action) => <button key={action.type} type="button" className="button button-secondary small-button" onClick={() => onEdit(action)}>{action.label}</button>)}</div>}
    {kind === 'checkup' && <CheckupDetails visit={record} data={data} onEdit={onEdit} />}
    {kind === 'vaccination' && <VaccineDetails vaccine={record} data={data} />}
    {kind === 'service' && <QueueDetails entry={record} data={data} onEdit={onEdit} />}
    {kind === 'timeline' && <><Fields rows={[["Activity date", timeLabel(record.at, data.timezone)], ['Summary', record.detail]]} /><TimelineDetails event={record} data={data} onEdit={onEdit} /></>}
    {kind === 'timeline' && <Link className="text-link calendar-preview-source" to={record.href}>View source</Link>}
  </article>)
}
