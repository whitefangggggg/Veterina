import { clinicDate, clinicTime, clinicTimestamp, unwrap } from './clinicRepository'
import { escapeHtml } from './prescriptions'

export const admissionStatuses = { admitted: 'Admitted', under_treatment: 'Under Treatment', ready_for_discharge: 'Ready for Discharge', discharged: 'Discharged', cancelled: 'Cancelled' }
export const clinicalConditions = { stable: 'Stable', critical: 'Critical', improving: 'Improving', under_observation: 'Under Observation' }
export const unitStates = { available: 'Available', occupied: 'Occupied', cleaning_required: 'Cleaning required', maintenance: 'Maintenance' }
export const admissionSource = (id) => `/admissions/${encodeURIComponent(id)}`
export const openAdmission = (a) => !['discharged', 'cancelled'].includes(a.status)
export const openTask = (task) => ['pending', 'delayed'].includes(task.status)
export const overdueTask = (task, now = new Date()) => openTask(task) && Date.parse(task.due_at) <= now.getTime()
export function stayDuration(admission, now = new Date()) {
  const minutes = Math.max(0, Math.floor((Date.parse(admission.closed_at || now.toISOString()) - Date.parse(admission.admitted_at)) / 60000))
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
export const admissionLocalTime = (time, timezone) => `${clinicDate(new Date(time), timezone)}T${clinicTime(time, timezone)}`
export function admissionTimestamp(value, timezone) {
  if (!value) return undefined
  const [date, time] = value.split('T')
  return clinicTimestamp(date, time, timezone)
}
export const displayAdmissionTime = (value, timezone = 'Asia/Manila') => value ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded'

export function observationValues(values) {
  return { ...Object.fromEntries(['weightKg', 'temperatureC', 'heartRate', 'respiratoryRate', 'bodyConditionScore'].filter((key) => values[key] !== '' && values[key] != null).map((key) => [key, Number(values[key])])), ...(values.hydration ? { hydration: values.hydration } : {}) }
}
export function effectiveObservations(rows) {
  const corrected = new Set(rows.map((row) => row.corrects_id).filter(Boolean))
  return rows.filter((row) => row.is_current !== false && !corrected.has(row.id)).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
}
export function filterAdmissions(admissions, { query = '', status = '', condition = '', veterinarian = '', unit = '', history = false } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return admissions.filter((a) => (history || openAdmission(a)) && (!status || a.status === status) && (!condition || a.condition === condition)
    && (!veterinarian || a.veterinarianId === veterinarian) && (!unit || (unit === 'unassigned' ? !a.unitId : a.unitId === unit))
    && terms.every((term) => [a.reference, a.patientName, a.ownerName, a.reason, a.veterinarianName, a.unitName].join(' ').toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.condition === 'critical' && openAdmission(b)) - Number(a.condition === 'critical' && openAdmission(a)) || b.admitted_at.localeCompare(a.admitted_at) || a.id.localeCompare(b.id))
}

const detailTables = { observations: ['admission_observations', 'recorded_at'], events: ['admission_events', 'occurred_at'], orders: ['admission_orders', 'created_at'], tasks: ['admission_tasks', 'due_at'], resolvedTasks: ['admission_tasks', 'due_at'], administrations: ['admission_administrations', 'recorded_at'], occupancy: ['admission_occupancy', 'assigned_at'] }
export async function fetchAdmissionPage(client, id, kind, { cursor, limit = 100 } = {}) {
  if (!detailTables[kind]) throw new Error('Unknown admission detail type')
  const [table, column] = detailTables[kind]
  const taskPage = ['tasks', 'resolvedTasks'].includes(kind)
  let query = client.from(kind === 'observations' ? 'admission_observation_history' : table).select(taskPage ? '*,order:admission_orders(*)' : '*', { count: 'exact' }).eq('admission_id', id).order(column).order('id').limit(Math.min(100, Math.max(1, limit)))
  if (kind === 'tasks') query = query.in('status', ['pending', 'delayed'])
  if (kind === 'resolvedTasks') query = query.not('status', 'in', '(pending,delayed)')
  if (cursor) query = query.or(`${column}.gt.${cursor[column]},and(${column}.eq.${cursor[column]},id.gt.${cursor.id})`)
  const { data, count, error } = await query
  if (error) throw error
  return { rows: data, count, cursor: data.length ? data.at(-1) : null, hasMore: count > data.length }
}
export async function fetchAdmissionDetail(client, id) {
  const admission = unwrap(await client.from('admissions').select('*').eq('id', id).single())
  const parts = await Promise.all(Object.keys(detailTables).map(async (kind) => [kind, await fetchAdmissionPage(client, id, kind)]))
  const summary = unwrap(await client.from('admission_discharge_summaries').select('*').eq('admission_id', id).maybeSingle())
  return { admission, summary, ...Object.fromEntries(parts) }
}

export const vitalLabels = { weightKg: 'Weight (kg)', temperatureC: 'Temperature (°C)', heartRate: 'Heart rate (bpm)', respiratoryRate: 'Respiratory rate (rpm)', bodyConditionScore: 'Body condition (1–9)', hydration: 'Hydration', condition: 'Clinical condition' }
export function admissionSummaryContent(snapshot, { observations = [], administrations = [] } = {}) {
  if (!snapshot || snapshot.version !== 1) throw new Error('Unsupported admission summary version')
  const s = snapshot, a = s.admission, timezone = s.clinic?.timezone || 'Asia/Manila'
  const time = (value) => escapeHtml(displayAdmissionTime(value, timezone))
  const paragraph = (label, value) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value || 'Not recorded')}</p>`
  const rows = (items, render) => items?.length ? items.map((item) => `<article>${render(item)}</article>`).join('') : '<p>No entries.</p>'
  const clinical = (entry) => paragraph('Entry', `${entry.kind} · ${displayAdmissionTime(entry.occurred_at, timezone)} · ${entry.author_name}`)
    + Object.entries(entry.values || {}).map(([key, value]) => paragraph(vitalLabels[key] || key, clinicalConditions[value] || String(value))).join('')
    + paragraph('Notes', entry.note) + (entry.corrects_id ? paragraph('Correction reason', entry.correction_reason) : '')
  const event = (entry) => paragraph('Care', `${entry.title} · ${entry.outcome} · ${displayAdmissionTime(entry.occurred_at, timezone)} · ${entry.author_name}`)
    + paragraph('Reason / notes', entry.reason) + (entry.stock_quantity ? paragraph('Stock consumed', `${entry.stock_quantity} ${entry.stock_unit}`) : '')
  const obsAddenda = observations.filter((x) => x.corrects_id && !(s.observations || []).some((old) => old.id === x.id))
  const adminAddenda = administrations.filter((x) => x.corrects_id && !(s.administrations || []).some((old) => old.id === x.id))
  return `<h1>${a.is_historical ? 'Historical hospitalization' : a.closed_at ? 'Discharge summary' : 'Hospitalization record'} · ${escapeHtml(a.reference)}</h1>`
    + paragraph('Clinic', s.clinic?.clinic_name) + paragraph('Patient', `${s.patient?.name || ''} · ${s.patient?.record_number || ''}`)
    + paragraph('Owner', s.owner?.full_name) + paragraph('Attending veterinarian', s.encounter?.attending_veterinarian_name)
    + `<p><b>Admitted:</b> ${time(a.admitted_at)} · <b>Closed:</b> ${a.closed_at ? time(a.closed_at) : 'Active stay'}</p>`
    + paragraph('Reason', s.encounter?.chief_complaint) + paragraph('Status', admissionStatuses[a.status]) + paragraph('Final condition', clinicalConditions[a.condition])
    + paragraph('Assessment', s.assessment) + paragraph('Instructions', s.instructions) + paragraph('Follow-up recommendation', s.followUp)
    + '<h2>Monitoring and notes</h2>' + rows(s.observations, clinical)
    + '<h2>Medication orders / historical medicines</h2>' + rows(s.prescriptions, (rx) => (rx.medications || []).map((m) => paragraph('Medication', [m.medicationName, m.dose, m.route, m.frequency, m.duration, m.instructions].filter(Boolean).join(' · '))).join(''))
    + '<h2>Care orders</h2>' + rows(s.orders, (o) => paragraph(o.title, o.instructions) + paragraph('Schedule', `${displayAdmissionTime(o.starts_at, timezone)} – ${displayAdmissionTime(o.ends_at, timezone)}`))
    + '<h2>Care outcomes</h2>' + rows(s.administrations, event)
    + '<h2>Accommodation history</h2>' + rows(s.occupancy, (o) => paragraph(`${o.wardName} / ${o.unitName}`, `${displayAdmissionTime(o.assigned_at, timezone)} – ${o.released_at ? displayAdmissionTime(o.released_at, timezone) : 'Occupied'}`))
    + paragraph('Authorized by', s.authorizedBy) + paragraph('Authorized at', displayAdmissionTime(s.authorizedAt, timezone))
    + (obsAddenda.length || adminAddenda.length ? '<h2>Subsequent correction addenda</h2>' + rows(obsAddenda, clinical) + rows(adminAddenda, event) : '')
}
export function admissionSummaryHtml(snapshot, addenda) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hospitalization summary</title><style>html{color-scheme:light}body{background:white;color:#182c24;font:13px/1.5 system-ui;margin:24px}h1{font-size:22px}h2{font-size:17px;border-bottom:1px solid #ccc}article{break-inside:avoid;border-bottom:1px solid #ddd;padding:8px 0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}@page{size:A4;margin:16mm}</style></head><body>${admissionSummaryContent(snapshot, addenda)}</body></html>`
}
export async function printAdmissionSummary(snapshot, addenda) {
  const frame = document.createElement('iframe')
  frame.title = 'Discharge summary'
  frame.style.cssText = 'position:fixed;left:-10000px;width:800px;height:1000px;border:0'
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { frame.remove(); reject(new Error('Summary preparation timed out.')) }, 15000)
    frame.onload = async () => {
      try {
        await frame.contentDocument.fonts.ready
        clearTimeout(timer)
        frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
        frame.contentWindow.focus(); frame.contentWindow.print(); resolve()
      } catch (error) { clearTimeout(timer); frame.remove(); reject(error) }
    }
    frame.srcdoc = admissionSummaryHtml(snapshot, addenda)
    document.body.appendChild(frame)
  })
}
