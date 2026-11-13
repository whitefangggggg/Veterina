import { prescriptionMedications } from './prescriptions'

const encoded = (value) => encodeURIComponent(value)
const terminalReminder = (status) => ['Completed', 'Cancelled'].includes(status)
const dateFormatters = new Map()
export const isClinicDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export const patientSource = (id, tab = 'history', fragment = '') => `/patients/${encoded(id)}?tab=${tab}${fragment ? '#' + encoded(fragment) : ''}`
export const appointmentSource = (appointment) => `/appointments?date=${encoded(appointment.date)}#appointment-${encoded(appointment.id)}`
export const reminderSource = (id) => `/appointments?view=tasks&status=All#reminder-${encoded(id)}`
export const queueSource = (entry) => `/queue?status=All&date=${encoded(entry.finishedDate || entry.queueDate)}#queue-${encoded(entry.id)}`

export function dateInClinic(value, timezone) {
  if (isClinicDate(value)) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return ''
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return ''
  if (!dateFormatters.has(timezone)) dateFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }))
  return dateFormatters.get(timezone).format(time)
}

export function buildPatientTimeline(data, patientId) {
  const events = []
  const add = (kind, id, at, title, status, detail, href, visitType) => {
    const date = at ? dateInClinic(at, data.timezone || 'Asia/Manila') : ''
    if (!date) return
    events.push({ id: `${kind}-${id}`, sourceId: id, visitType, kind, at, date, title, status, detail: detail || '', href })
  }
  for (const appointment of data.appointments || []) {
    if (appointment.petId === patientId) add('Appointment', appointment.id, appointment.starts_at || appointment.date, appointment.service, appointment.status, appointment.veterinarian, appointmentSource(appointment))
  }
  for (const entry of data.queueEntries || []) {
    if (entry.petId !== patientId) continue
    const status = { waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[entry.status]
    add('Arrival', entry.id, entry.arrivedAt, entry.service, status, [entry.queueNumber, entry.veterinarian].filter(Boolean).join(' · '), queueSource(entry))
    if (entry.draftSavedAt) add('Care draft', entry.id, entry.draftSavedAt, `${entry.service} draft saved`, status, entry.draftSavedBy, queueSource(entry))
    if (entry.finished_at) add('Queue outcome', entry.id, entry.finished_at, `${entry.service} ${status?.toLowerCase() || 'finished'}`, status, entry.serviceNotes || entry.notes, queueSource(entry))
  }
  for (const visit of data.visits || []) {
    if (visit.petId !== patientId) continue
    if (visit.admissionId) continue
    add('Checkup', visit.id, visit.visitedAt, visit.type, visit.finalizedAt ? 'Finalized' : visit.careStatus || 'Recorded', visit.diagnosis || visit.complaint, patientSource(patientId, 'history', visit.id), visit.type)
    for (const prescription of visit.prescriptions || []) {
      const medicationNames = prescriptionMedications(prescription).map((medication) => medication.medicationName).filter(Boolean).join(', ')
      add('Prescription', prescription.id, prescription.prescribed_at || visit.visitedAt, 'Prescription recorded', visit.finalizedAt ? 'Finalized' : 'Recorded', [medicationNames, prescription.prescribed_by_name || visit.veterinarian].filter(Boolean).join(' · '), patientSource(patientId, 'history', `prescription-${prescription.id}`), visit.type)
    }
    for (const correction of visit.corrections || []) {
      add('Correction', correction.id, correction.created_at, 'Clinical correction appended', 'Recorded', correction.reason, patientSource(patientId, 'history', visit.id), visit.type)
    }
  }
  for (const admission of data.admissions || []) {
    if ((admission.petId || admission.pet_id) !== patientId) continue
    const href = `/admissions/${encoded(admission.id)}`
    add('Admission', admission.id, admission.admitted_at, admission.is_historical ? 'Historical hospitalization' : 'Patient admitted', admission.is_historical ? 'Record only' : 'Admitted', admission.reason, href)
    if (admission.closed_at) add(admission.status === 'cancelled' ? 'Admission cancellation' : 'Discharge', admission.id, admission.closed_at, admission.status === 'cancelled' ? 'Admission cancelled' : 'Patient discharged', admission.status === 'cancelled' ? 'Cancelled' : 'Discharged', admission.reason, href)
  }
  for (const service of data.serviceRecords || []) {
    if (service.petId === patientId) add('Service', service.id, service.arrivedAt, service.service, 'Record only', service.serviceNotes, patientSource(patientId, 'history', `service-${service.id}`))
  }
  for (const record of data.preventiveCare || []) {
    if (record.petId === patientId) {
      const vitals = record.vitals || {}
      const measurements = [vitals.weightKg && `${vitals.weightKg} kg`, vitals.temperatureC && `${vitals.temperatureC} °C`,
        vitals.heartRate && `${vitals.heartRate} bpm`, vitals.respiratoryRate && `${vitals.respiratoryRate} breaths/minute`,
        vitals.bodyConditionScore && `Body condition ${vitals.bodyConditionScore}/5`, vitals.hydration].filter(Boolean)
      add(record.kind === 'deworming' ? 'Deworming' : 'Vaccination', record.id, record.administeredAt, record.vaccine,
        record.recordingPurpose === 'record_only' ? 'Record only' : record.careStatus,
        [record.items.map((item) => item.vaccine).join(', '), ...measurements].filter(Boolean).join(' · '),
        patientSource(patientId, 'vaccines', `preventive-${record.id}`))
    }
  }
  for (const vaccine of data.vaccinations || []) {
    if (data.preventiveCare?.some((record) => record.items.some((item) => item.id === vaccine.id))) continue
    if (vaccine.petId === patientId) add('Vaccination', vaccine.id, vaccine.administeredAt, vaccine.vaccine, vaccine.recordingPurpose === 'record_only' ? 'Record only' : vaccine.careStatus || 'Recorded', [vaccine.brand, vaccine.nextDueAt ? `Next dose: ${vaccine.nextDueAt}` : ''].filter(Boolean).join(' · '), patientSource(patientId, 'vaccines', `vaccination-${vaccine.id}`))
  }
  for (const reminder of data.reminders || []) {
    if (reminder.petId !== patientId) continue
    const at = reminder.status === 'Completed' && reminder.completed_at ? reminder.completed_at : reminder.due_at || reminder.dueDate
    add('Reminder', reminder.id, at, reminder.title, reminder.status, [`Due: ${reminder.dueDate}`, reminder.outcome || reminder.notes].filter(Boolean).join(' · '), reminderSource(reminder.id))
    for (const activity of reminder.activity || []) {
      add('Reminder activity', activity.id, activity.created_at, `${reminder.title}: ${activity.action.replaceAll('_', ' ')}`, 'Recorded', activity.note, reminderSource(reminder.id))
    }
  }
  // Compare clinic dates first: a date-only vaccination must not shift a day when
  // displayed alongside timestamps. Timestamp events sort within their clinic day.
  const timestamp = (event) => isClinicDate(event.at) ? 0 : new Date(event.at).getTime()
  return events.sort((a, b) => b.date.localeCompare(a.date) || timestamp(b) - timestamp(a) || a.id.localeCompare(b.id))
}

export function buildDailyWork(data, now = new Date()) {
  const active = (data.queueEntries || []).filter((entry) => ['waiting', 'in_progress'].includes(entry.status))
  const oldestFirst = (a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.id.localeCompare(b.id)
  const care = [...active].sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || oldestFirst(a, b))
    .map((entry) => ({ ...entry, waitMinutes: Math.max(0, Math.floor((now.getTime() - new Date(entry.arrivedAt).getTime()) / 60000)), href: queueSource(entry) }))
  const checkins = (data.appointments || []).filter((appointment) => appointment.date === data.today && ['Pending', 'Confirmed'].includes(appointment.status)
    && (data.pets || []).some((pet) => pet.id === appointment.petId && pet.status === 'Active')
    && !(data.queueEntries || []).some((entry) => entry.appointmentId === appointment.id))
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
  const calls = (data.reminders || []).filter((reminder) => !terminalReminder(reminder.status) && reminder.dueDate <= data.today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
  return { care, checkins, calls }
}

export const STOCK_EXPIRY_WARNING_DAYS = 30

export function stockAttention(inventory, today, days = STOCK_EXPIRY_WARNING_DAYS) {
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() + days)
  const lastDate = cutoff.toISOString().slice(0, 10)
  return inventory.filter((item) => item.isActive).map((item) => {
    const stocked = (item.batches || []).filter((batch) => batch.quantity > 0 && isClinicDate(batch.expiration_date))
    const expired = stocked.filter((batch) => batch.expiration_date < today).sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
    const expiring = stocked.filter((batch) => batch.expiration_date >= today && batch.expiration_date <= lastDate).sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
    const lowStock = item.quantity <= item.minimumStock
    return { item, expired, expiring, lowStock, priority: expired.length ? 0 : lowStock ? 1 : 2, href: `/inventory#inventory-${encoded(item.id)}` }
  }).filter((entry) => entry.lowStock || entry.expired.length || entry.expiring.length)
    .sort((a, b) => a.priority - b.priority || a.item.name.localeCompare(b.item.name))
}

// Every stocked lot matters, including later expiries behind an expired lot.
// Date-only arithmetic follows the clinic date without DST or browser offsets.
export function stockExpiryAlerts(inventory, today) {
  return stockAttention(inventory, today).flatMap(({ item, expired, expiring }) => [...expired, ...expiring].map((batch) => {
    const days = Math.round((Date.parse(`${batch.expiration_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
    const status = days < 0 ? 'expired' : 'expiring'
    const label = days < 0 ? `Expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`
    return { item, batch, days, status, label,
      href: `/inventory?attention=${status}#inventory-batch-${encoded(batch.id)}` }
  })).sort((a, b) => a.batch.expiration_date.localeCompare(b.batch.expiration_date) || a.item.name.localeCompare(b.item.name) || String(a.batch.id).localeCompare(String(b.batch.id)))
}
