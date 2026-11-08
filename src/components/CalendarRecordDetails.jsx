import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useClinicData } from '../context/ClinicDataContext'
import { dateInClinic, isClinicDate } from '../lib/dailyWorkflow'
import { prescriptionMedications } from '../lib/prescriptions'
import { Badge } from './ui'
import { useAuth } from '../context/AuthContext'
import { calendarEditActions } from '../lib/calendarRecordEditing'
import PrescriptionActions from './PrescriptionActions'
import PreventiveCareCard from './PreventiveCareCard'
import { clinicalAssessmentText, clinicalObservationRows } from '../lib/clinicalObservations'
import { HospitalizationDetails } from './HospitalizationHistoryCard'

const statusName = (value) => ({ waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })[value] || value
const dayLabel = (value, timezone) => { const date = dateInClinic(value, timezone); return date ? format(parseISO(date), 'd MMM yyyy') : 'Not recorded' }
const timeLabel = (value, timezone) => !value || !dateInClinic(value, timezone) ? 'Not recorded' : isClinicDate(value) ? dayLabel(value, timezone)
  : new Intl.DateTimeFormat('en-PH', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const display = (value) => value == null || value === '' ? '—' : String(value)

function Fields({ rows }) {
  return <dl className="calendar-preview-fields">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>
}

function PrescriptionDetails({ prescription, visit, onEdit }) {
  const data = useClinicData()
  const pet = data.getPet(visit.petId)
  return <section className="calendar-preview-section"><h4>{prescription.is_historical ? 'Historical prescription record' : 'Prescription'}</h4><ol className="prescription-items">{prescriptionMedications(prescription).map((medication, index) => <li key={index}>
    <strong>{medication.medicationName}</strong><p>{[medication.dose, `Route: ${medication.route || 'Not recorded'}`, medication.frequency, medication.duration].filter(Boolean).join(' · ')}</p>{medication.instructions && <p>{medication.instructions}</p>}
  </li>)}</ol>{pet && <PrescriptionActions context={{ prescription, pet, visit, clinic: data.settings, profiles: data.profiles, owner: data.getOwner(pet.ownerId) }} />}{onEdit && !visit.finalizedAt && <button type="button" className="text-link" onClick={() => onEdit({ type: 'prescription', label: 'Edit prescription', record: prescription, petId: visit.petId })}>Edit prescription</button>}</section>
}

function CheckupDetails({ visit, data, onEdit }) {
  return <>
    <Fields rows={[
      ['Service', visit.serviceName], ['Checkup', visit.type], ['Veterinarian', visit.veterinarian], ['Date and time', timeLabel(visit.visitedAt, data.timezone)],
      ['Care status', visit.recordingPurpose === 'record_only' ? 'Record only' : visit.careStatus || 'Recorded'], ['Record status', visit.finalizedAt ? 'Finalized' : 'Unfinalized'],
      ['Queue', visit.careQueue?.queueNumber], ['Chief complaint', visit.complaint], ['Diagnosis', visit.diagnosis],
      ['Weight', visit.weightKg != null ? `${visit.weightKg} kg` : 'Not recorded'], ['Temperature', visit.temperatureC != null ? `${visit.temperatureC} °C` : ''],
      ['Heart rate', visit.heartRate != null ? `${visit.heartRate} bpm` : ''], ['Respiratory rate', visit.respiratoryRate != null ? `${visit.respiratoryRate} rpm` : ''],
      ['Body condition', visit.bodyConditionScore != null ? `${visit.bodyConditionScore}/${visit.bodyConditionScale}` : ''], ['Hydration', visit.hydration],
      ['Follow-up date', visit.followUpDate ? dayLabel(visit.followUpDate, data.timezone) : 'Not scheduled'],
    ]} />
    <div className="soap-grid">{clinicalObservationRows(visit).map(([label, value]) => <div key={label}><strong>{label}</strong><p>{display(value)}</p></div>)}</div>
    {visit.clinicalNotes && <div className="service-notes"><strong>Clinical notes</strong><p>{visit.clinicalNotes}</p></div>}
    {(visit.prescriptions || []).map((prescription) => <PrescriptionDetails key={prescription.id} prescription={prescription} visit={visit} onEdit={onEdit} />)}
    {(visit.corrections || []).map((correction) => <section className="calendar-preview-section" key={correction.id}><h4>Correction · {correction.reason}</h4><p>{correction.correction}</p>{correction.created_at && <small>{timeLabel(correction.created_at, data.timezone)}</small>}</section>)}
  </>
}

function VaccineDetails({ vaccine, data }) {
  const veterinarian = vaccine.administered_by_name || data.profiles.find((profile) => profile.id === vaccine.veterinarianId)?.full_name || 'Not recorded'
  return <Fields rows={[
    ['Recording purpose', vaccine.recordingPurpose === 'record_only' ? 'Record only' : 'Queue processing'], ['Vaccine', vaccine.vaccine], ['Recorded date', dayLabel(vaccine.administeredAt, data.timezone)], ['Brand', vaccine.brand], ['Dose', vaccine.dose],
    ['Historical lot', vaccine.lotNumber], ['Veterinarian', veterinarian], ['Care status', vaccine.careStatus || 'Recorded'], ['Queue', vaccine.careQueue?.queueNumber],
    ['Next due', vaccine.nextDueAt ? dayLabel(vaccine.nextDueAt, data.timezone) : 'Not scheduled'], ['Next dose status', vaccine.nextDoseStatus],
  ]} />
}

function QueueDetails({ entry, data, onEdit }) {
  if (entry.recordingPurpose === 'record_only') return <Fields rows={[
    ['Service', entry.service], ['Recording purpose', 'Record only'], ['Service date', timeLabel(entry.arrivedAt, data.timezone)],
    ['Performed by', entry.veterinarian], ['Service notes', entry.serviceNotes],
  ]} />
  const visit = data.visits.find((visit) => visit.id === entry.visit_id)
  const vaccine = data.vaccinations.find((vaccine) => vaccine.id === entry.vaccination_id)
  const preventive = data.preventiveCare.find((record) => record.id === entry.preventive_record_id)
  const draftLabels = { clinicalNotes: 'Clinical notes', complaint: 'Chief complaint', diagnosis: 'Diagnosis', subjective: 'History', objective: 'Clinical Assessment', plan: 'Treatment Plan',
    weightKg: 'Weight (kg)', temperatureC: 'Temperature (°C)', heartRate: 'Heart rate (bpm)', respiratoryRate: 'Respiratory rate (rpm)', bodyConditionScore: 'Body condition', hydration: 'Hydration',
    followUpDate: 'Follow-up date', serviceNotes: 'Service notes', dose: 'Dose', administeredAt: 'Vaccination date', nextDueAt: 'Next due date' }
  const draftValues = { ...entry.careDraft, objective: clinicalAssessmentText(entry.careDraft || {}) }
  const draft = Object.entries(draftValues).filter(([key, value]) => draftLabels[key] && value != null && value !== '').map(([key, value]) => [draftLabels[key], value])
  const draftItems = entry.careDraft?.kind === 'deworming' ? [entry.careDraft.deworming].filter(Boolean) : entry.careDraft?.vaccines || []
  return <>
    <Fields rows={[
      ['Service', entry.service], ['Queue', entry.queueNumber], ['Queue date', entry.queueDate ? dayLabel(entry.queueDate, data.timezone) : ''], ['Status', statusName(entry.status)],
      ['Veterinarian', entry.veterinarian], ['Arrived', timeLabel(entry.arrivedAt, data.timezone)], ['Finished', timeLabel(entry.finished_at, data.timezone)],
      ['Source', entry.source?.replaceAll('_', ' ')], ['Notes', entry.notes], ['Service notes', entry.serviceNotes],
    ]} />
    {(draft.length > 0 || draftItems.length > 0) && <section className="calendar-preview-section"><h4>Saved care draft</h4><Fields rows={draft} />{draftItems.map((item, index) => {
      const product = data.inventory.find((product) => product.id === item.inventoryItemId)
      return <Fields key={item.id || index} rows={[[entry.careDraft.kind === 'deworming' ? 'Deworming product' : `Vaccine ${index + 1}`, product?.name || item.vaccine], ['Brand', item.brand || product?.brand], ['Batch', product?.batches.find((batch) => batch.id === item.batchId)?.lot_number || item.lotNumber], ['Stock quantity', item.dispenseQuantity != null ? `${item.dispenseQuantity} ${product?.unit || ''}` : ''], ['Dose', item.dose], ['Next due', item.nextDueAt]]} />
    })}<small>Saved {timeLabel(entry.draftSavedAt, data.timezone)}{entry.draftSavedBy && ` · ${entry.draftSavedBy}`}</small></section>}
    {visit && <CheckupDetails visit={visit} data={data} onEdit={onEdit} />}
    {preventive ? <PreventiveCareCard record={preventive} /> : vaccine && <VaccineDetails vaccine={vaccine} data={data} />}
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
  if (['Vaccination','Deworming'].includes(event.kind)) {
    const preventive = data.preventiveCare.find((entry) => entry.id === id)
    if (preventive) return <PreventiveCareCard record={preventive} />
    const vaccine = data.vaccinations.find((vaccine) => vaccine.id === id)
    if (vaccine) return <VaccineDetails vaccine={vaccine} data={data} />
  }
  if (['Arrival', 'Care draft', 'Queue outcome'].includes(event.kind)) {
    const entry = data.queueEntries.find((entry) => entry.id === id)
    if (entry) return <QueueDetails entry={entry} data={data} onEdit={onEdit} />
  }
  if (event.kind === 'Service') {
    const service = (data.serviceRecords || []).find((entry) => entry.id === id)
    if (service) return <QueueDetails entry={service} data={data} onEdit={onEdit} />
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
  if (kind === 'clinical') return records.map((record) => <CalendarRecordDetails key={record.historyKey} records={[record.sourceRecord]} kind={record.historyKind} onEdit={onEdit} />)
  if (kind === 'preventive') return records.map((record) => <div className="calendar-preview-record" key={record.id}><PreventiveCareCard record={record} onEdit={onEdit ? (record) => onEdit({ type: 'vaccine', record, petId: record.petId }) : undefined} /></div>)
  if (kind === 'hospitalization') return records.map((record) => {
    const encounter = data.visits.find((visit) => visit.id === record.visit_id)
    return <article className="calendar-preview-record" key={record.id}><header><h3>Hospitalization</h3></header><HospitalizationDetails record={record} timezone={data.timezone} />{encounter && <CheckupDetails visit={encounter} data={data} />}</article>
  })
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
