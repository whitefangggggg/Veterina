import { dateInClinic, isClinicDate } from './dailyWorkflow'
import { prescriptionMedications } from './prescriptions'

export const clinicalHistoryParams = {
  query: 'historySearch', type: 'historyType', status: 'historyStatus',
  veterinarian: 'historyVet', details: 'historyDetails', from: 'historyFrom', to: 'historyTo',
}

const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

export function filterClinicalHistory(visits, filters = {}, timezone = 'Asia/Manila') {
  const terms = normalize(filters.query).trim().split(/\s+/).filter(Boolean)
  return visits.filter((visit) => {
    if (filters.type && visit.type !== filters.type) return false
    if (filters.status && (visit.careStatus || 'Recorded') !== filters.status) return false
    if (filters.veterinarian && visit.veterinarian !== filters.veterinarian) return false
    const date = dateInClinic(visit.visitedAt, timezone)
    if (isClinicDate(filters.from) && (!date || date < filters.from)) return false
    if (isClinicDate(filters.to) && (!date || date > filters.to)) return false
    if (filters.details === 'prescription' && !visit.prescriptions?.length) return false
    if (filters.details === 'follow-up' && !visit.followUpDate) return false
    if (filters.details === 'correction' && !visit.corrections?.length) return false
    if (filters.details === 'finalized' && !visit.finalizedAt) return false
    if (filters.details === 'open' && visit.finalizedAt) return false
    if (!terms.length) return true

    const text = normalize([
      visit.type, visit.complaint, visit.diagnosis, visit.subjective, visit.objective,
      visit.assessment, visit.plan, visit.veterinarian, visit.careStatus || 'Recorded',
      visit.finalizedAt ? 'Finalized' : '', date, visit.followUpDate, visit.hydration,
      visit.careQueue?.queueNumber,
      visit.weightKg != null ? `${visit.weightKg} kg` : '',
      visit.temperatureC != null ? `${visit.temperatureC} °C` : '',
      visit.heartRate != null ? `${visit.heartRate} bpm` : '',
      visit.respiratoryRate != null ? `${visit.respiratoryRate} rpm` : '',
      visit.bodyConditionScore != null ? `BCS ${visit.bodyConditionScore}/${visit.bodyConditionScale || 9}` : '',
      ...(visit.corrections || []).flatMap((item) => [item.reason, item.correction]),
      ...(visit.prescriptions || []).flatMap((item) => prescriptionMedications(item)
        .flatMap((medication) => [medication.medicationName, medication.dose, medication.frequency, medication.duration, medication.instructions])),
    ].filter((value) => value != null).join(' '))
    return terms.every((term) => text.includes(term))
  })
}
