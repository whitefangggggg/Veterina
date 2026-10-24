import { supabase } from './supabaseClient'
import { prescriptionMedications } from './prescriptions'

export async function invokeClinicFunction(name, body, includeResponse = false) {
  const { data, error, response } = await supabase.functions.invoke(name, { body })
  if (error) {
    let code = ''
    try { code = (await error.context?.json())?.error || '' } catch { /* Transport failures have no JSON response. */ }
    const messages = { MFA_REQUIRED: 'Verify with your authenticator before managing staff.', FORBIDDEN: 'Only an active clinic owner can perform this action.', PROVIDER_NOT_CONFIGURED: 'Email invitations are not configured. Ask the person to register, then approve their account.', UNAUTHENTICATED: 'Your session has expired. Please sign in again.' }
    throw new Error(messages[code] || code || error.message)
  }
  return includeResponse ? { data, response } : data
}

export async function fetchReport(report, patientId, filters = {}) {
  const { rows } = await invokeClinicFunction('export-report', { report, patient_id: patientId, filters })
  return rows
}

export async function downloadReport(name, filters = {}) {
  const { data, response } = await invokeClinicFunction('export-report', { report: name, filters, format: 'csv' }, true)
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `veterina-${name}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return Number(response.headers.get('X-Row-Count') || 0)
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

export function historyHtml(history, { clinic, profiles = [] } = {}) {
  const name = (id) => profiles.find((profile) => profile.id === id)?.full_name || 'Clinic staff'
  const date = (value) => value ? escapeHtml(String(value).replace('T', ' ').replace(/\\+00:00$|Z$/, ' UTC')) : '—'
  const details = (fields) => fields.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => '<p><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(value) + '</p>').join('')
  const section = (heading, rows, fields) => '<section><h2>' + heading + '</h2>' + (rows?.length ? rows.map((row) => '<article>' + details(fields(row)) + '</article>').join('') : '<p>No records.</p>') + '</section>'
  const patient = history.patient
  const owner = history.owner
  const byDate = (rows, field) => [...(rows || [])].sort((a, b) => (b[field] || '').localeCompare(a[field] || ''))
  const content = section('Patient identity', [patient], (row) => [['Record number', row.record_number], ['Species', row.species], ['Breed', row.breed], ['Sex', row.sex], ['Reproductive status', row.reproductive_status], ['Birth date', row.birth_date], ['Birth date estimated', row.birth_date_estimated ? 'Yes' : 'No'], ['Diet / feeding notes', row.diet], ['Microchip', row.microchip_number], ['Status', row.status]])
    + section('Owner', owner ? [owner] : [], (row) => [['Name', row.full_name], ['Phone', row.phone], ['Email', row.email], ['Address', row.address], ['Emergency contact', row.emergency_contact]])
    + section('Care alerts', history.alerts, (row) => [['Category', row.alert_type], ['Description', row.description], ['Severity', row.severity], ['Status', row.is_active ? 'Active' : 'Resolved']])
    + section('Clinical encounters', byDate(history.visits, 'visited_at'), (row) => [['Time of care', row.visited_at], ['Visit type', row.visit_type], ['Veterinarian', row.attending_veterinarian_name || name(row.attending_veterinarian_id)], ['Chief complaint', row.chief_complaint || row.complaint], ['Subjective', row.subjective], ['Objective', row.objective], ['Assessment', row.assessment], ['Plan', row.plan], ['Diagnosis', row.diagnosis_summary], ['Follow-up date', row.follow_up_date], ['Status', row.finalized_at ? 'Finalized' : 'Open']])
    + section('Vitals', byDate(history.vitals, 'measured_at'), (row) => [['Measured at', row.measured_at], ['Weight (kg)', row.weight_kg ?? row.weight], ['Temperature (°C)', row.temperature_c], ['Heart rate (bpm)', row.heart_rate_bpm], ['Respiratory rate', row.respiratory_rate_rpm], [`Body condition (1–${row.body_condition_scale || 9})`, row.body_condition_score], ['Hydration', row.hydration], ['Measured by', name(row.measured_by)]])
    + section('Vaccinations', byDate(history.vaccinations, 'administered_at'), (row) => [['Vaccine', row.vaccine_name], ['Brand', row.brand], ['Date administered', row.administered_at], ['Next due date', row.next_due_at], ['Historical batch / lot', row.lot_number], ['Dose', row.dose], ['Veterinarian', row.administered_by_name || name(row.administered_by)]])
    + section('Maintenance services', byDate(history.maintenance, 'arrived_at'), (row) => [['Service', row.service_name], ['Queue date', row.queue_date], ['Status', row.status], ['Completed at', row.finished_at], ['Staff', name(row.veterinarian_id)], ['Work performed', row.service_notes]])
    + section('Prescriptions', history.prescriptions, (row) => [['Prescribed at', row.prescribed_at], ['Prescribed by', row.prescribed_by_name || name(row.prescribed_by)], ...prescriptionMedications(row).flatMap((medication, index) => [[`Medication ${index + 1}`, medication.medicationName], ['Dose', medication.dose], ['Frequency', medication.frequency], ['Duration', medication.duration], ['Instructions', medication.instructions]])])
    + section('Corrections', byDate(history.corrections, 'created_at'), (row) => [['Recorded at', row.created_at], ['Reason', row.reason], ['Correction', row.correction], ['Recorded by', name(row.recorded_by)]])
    + section('Reminders', byDate(history.reminders, 'due_at'), (row) => [['Title', row.title], ['Due at', row.due_at], ['Status', row.status], ['Notes', row.notes], ['Outcome', row.outcome]])
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Patient history · ' + escapeHtml(patient.name) + '</title><style>body{font:13px/1.5 system-ui;color:#182c24;margin:30px}h1{font-size:24px}h2{font-size:17px;border-bottom:1px solid #ccc}article{break-inside:avoid;border-bottom:1px solid #eee;padding:8px 0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}@page{margin:18mm}</style></head><body>' + (clinic ? '<p><strong>' + escapeHtml(clinic.clinic_name) + '</strong><br>' + escapeHtml(clinic.address) + '<br>' + escapeHtml(clinic.phone) + '</p>' : '') + '<h1>Complete patient history · ' + escapeHtml(patient.name) + '</h1><p>Prepared ' + date(new Date().toISOString()) + '</p>' + content + '</body></html>'
}

export function printPatientHistory(history, context) {
  const frame = document.createElement('iframe')
  frame.title = 'Complete patient history'
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0'
  document.body.appendChild(frame)
  frame.contentDocument.open()
  frame.contentDocument.write(historyHtml(history, context))
  frame.contentDocument.close()
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print() }, 250)
}
