import { dateInClinic, isClinicDate } from './dailyWorkflow'
import { prescriptionMedications } from './prescriptions'

export const clinicalHistoryParams = {
  query: 'historySearch', kind: 'historyKind', type: 'historyType', status: 'historyStatus',
  veterinarian: 'historyVet', details: 'historyDetails', from: 'historyFrom', to: 'historyTo',
}

const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

export const serviceStatus = (status) => ({ waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', record_only: 'Record only' })[status] || status || 'Recorded'

export function combinedClinicalHistory(visits, services, preventive = []) {
  const records = [...visits.map((visit) => ({ ...visit, historyKind: 'checkup', historyKey: `checkup:${visit.id}`, sourceRecord: visit })),
    ...preventive.map((record) => ({ ...record, historyKind: 'preventive', historyKey: `preventive:${record.id}`, sourceRecord: record, visitedAt: record.administeredAt, type: record.kind === 'deworming' ? 'Deworming' : 'Vaccination', veterinarian: record.veterinarianName || 'Not recorded', clinicalNotes: record.items.map((item) => [item.vaccine,item.brand,item.dose,item.lotNumber].filter(Boolean).join(' ')).join(' ') })),
    ...services.map((service) => ({ ...service, historyKind: 'service', historyKey: `service:${service.id}`, sourceRecord: service,
      visitedAt: service.arrivedAt, type: service.service, careStatus: serviceStatus(service.status),
      veterinarian: service.veterinarian || 'Not recorded' }))]
  return [...new Map(records.map((record) => [record.historyKey, record])).values()]
    .sort((a, b) => (Date.parse(b.visitedAt) || 0) - (Date.parse(a.visitedAt) || 0) || a.historyKey.localeCompare(b.historyKey))
}

export function normalizePatientHistoryParams(params) {
  const tab = params.get('tab')
  if (!['services', 'timeline'].includes(tab)) return null
  const next = new URLSearchParams(params)
  next.set('tab', 'history')
  if (tab === 'services') {
    const mapping = { Query: 'Search', Service: 'Type', Status: 'Status', Veterinarian: 'Vet', From: 'From', To: 'To', View: 'View', Day: 'Day', Month: 'Month' }
    for (const [old, current] of Object.entries(mapping)) if (params.has(`service${old}`) && !next.has(`history${current}`)) next.set(`history${current}`, params.get(`service${old}`))
    if (!next.has('historyKind')) next.set('historyKind', 'service')
    if (params.get('serviceNotes') && !next.has('historyDetails')) next.set('historyDetails', params.get('serviceNotes') === 'With service notes' ? 'service-notes' : 'no-service-notes')
  }
  for (const key of [...next.keys()]) if (key.startsWith('service') || key.startsWith('timeline')) next.delete(key)
  return next
}

export function filterClinicalHistory(visits, filters = {}, timezone = 'Asia/Manila') {
  const terms = normalize(filters.query).trim().split(/\s+/).filter(Boolean)
  return visits.filter((visit) => {
    const kind = visit.historyKind || 'checkup'
    if (filters.kind && kind !== filters.kind) return false
    if (filters.type && visit.type !== filters.type) return false
    const status = visit.recordingPurpose === 'record_only' ? 'Record only' : visit.careStatus || 'Recorded'
    if (filters.status && status !== filters.status) return false
    if (filters.veterinarian && visit.veterinarian !== filters.veterinarian) return false
    const date = dateInClinic(visit.visitedAt, timezone)
    if (isClinicDate(filters.from) && (!date || date < filters.from)) return false
    if (isClinicDate(filters.to) && (!date || date > filters.to)) return false
    if (filters.details && kind === 'service' && !['service-notes', 'no-service-notes'].includes(filters.details)) return false
    if (['service-notes', 'no-service-notes'].includes(filters.details) && (kind !== 'service' || Boolean(visit.serviceNotes?.trim()) !== (filters.details === 'service-notes'))) return false
    if (filters.details === 'prescription' && !visit.prescriptions?.length) return false
    if (filters.details === 'follow-up' && !visit.followUpDate) return false
    if (filters.details === 'correction' && !visit.corrections?.length) return false
    if (filters.details === 'finalized' && !visit.finalizedAt) return false
    if (filters.details === 'open' && visit.finalizedAt) return false
    if (!terms.length) return true

    const text = normalize([
      visit.type, visit.serviceName, visit.service, visit.serviceNotes, visit.notes, visit.queueNumber, visit.historyKind, visit.complaint, visit.diagnosis, visit.subjective, visit.objective,
      visit.assessment, visit.plan, visit.clinicalNotes, visit.veterinarian, status,
      visit.finalizedAt ? 'Finalized' : '', date, visit.followUpDate, visit.hydration,
      visit.careQueue?.queueNumber,
      visit.weightKg != null ? `${visit.weightKg} kg` : '',
      visit.temperatureC != null ? `${visit.temperatureC} °C` : '',
      visit.heartRate != null ? `${visit.heartRate} bpm` : '',
      visit.respiratoryRate != null ? `${visit.respiratoryRate} rpm` : '',
      visit.bodyConditionScore != null ? `BCS ${visit.bodyConditionScore}/${visit.bodyConditionScale || 9}` : '',
      ...(visit.corrections || []).flatMap((item) => [item.reason, item.correction]),
      ...(visit.prescriptions || []).flatMap((item) => prescriptionMedications(item)
        .flatMap((medication) => [medication.medicationName, medication.dose, medication.route, medication.frequency, medication.duration, medication.instructions])),
    ].filter((value) => value != null).join(' '))
    return terms.every((term) => text.includes(term))
  })
}
