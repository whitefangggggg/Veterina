import { dateInClinic, isClinicDate } from './dailyWorkflow'

const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const statusName = (status) => ({ waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })[status] || status
const entry = (record, date, facets, text) => ({ id: record.id, record, date, facets, search: [date, ...Object.values(facets), ...text].filter(Boolean).join(' ') })

export function vaccinationHistoryRecords(vaccinations, profiles, timezone) {
  return vaccinations.map((vaccine) => entry(vaccine, dateInClinic(vaccine.administeredAt, timezone), {
    vaccine: vaccine.vaccine, brand: vaccine.brand || 'Not recorded', status: vaccine.careStatus || 'Recorded',
    due: vaccine.nextDoseStatus, veterinarian: vaccine.administered_by_name || profiles.find((profile) => profile.id === vaccine.veterinarianId)?.full_name || 'Clinic staff',
  }, [vaccine.dose, vaccine.lotNumber, vaccine.nextDueAt, vaccine.careQueue?.queueNumber]))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function serviceHistoryRecords(services, timezone) {
  return services.map((service) => entry(service, isClinicDate(service.queueDate) ? service.queueDate : dateInClinic(service.arrivedAt, timezone), {
    service: service.service, status: statusName(service.status), veterinarian: service.veterinarian || 'Unassigned',
    notes: service.serviceNotes?.trim() ? 'With service notes' : 'Without service notes',
  }, [service.serviceNotes, service.notes, service.queueNumber, service.source?.replaceAll('_', ' ')]))
    .sort((a, b) => b.date.localeCompare(a.date) || b.record.arrivedAt.localeCompare(a.record.arrivedAt))
}

export function timelineHistoryRecords(events) {
  return events.map((event) => entry(event, event.date, { kind: event.kind, status: event.status || 'Recorded' }, [event.visitType, event.title, event.detail]))
}

export function filterPatientRecords(records, filters) {
  const terms = normalize(filters.query).trim().split(/\s+/).filter(Boolean)
  return records.filter((record) => {
    if (isClinicDate(filters.from) && (!record.date || record.date < filters.from)) return false
    if (isClinicDate(filters.to) && (!record.date || record.date > filters.to)) return false
    if (Object.entries(record.facets).some(([key, value]) => filters[key] && filters[key] !== value)) return false
    const text = normalize(record.search)
    return terms.every((term) => text.includes(term))
  })
}

export function recordHistoryFields(records, definitions) {
  return definitions.map(([name, label, allLabel, ariaLabel]) => ({ name, label, allLabel, ariaLabel,
    options: [...new Set(records.map((record) => record.facets[name]).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  }))
}

const eventTime = (value, timezone) => !value || isClinicDate(value) || !dateInClinic(value, timezone) ? ''
  : new Intl.DateTimeFormat('en-PH', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(value))

export function clinicalCalendarEntries(visits, timezone) {
  return visits.map((visit) => ({
    id: visit.id, date: dateInClinic(visit.visitedAt, timezone), time: eventTime(visit.visitedAt, timezone),
    type: visit.type || 'Checkup', title: visit.diagnosis || visit.complaint || 'Checkup', color: visit.cardColor,
    timestamp: Date.parse(visit.visitedAt) || 0,
  }))
}

export function patientCalendarEntries(records, kind, timezone) {
  return records.map(({ id, date, record }) => {
    const at = kind === 'timeline' ? record.at : kind === 'service' ? record.arrivedAt : record.administeredAt
    const type = kind === 'timeline' ? record.visitType || (record.kind === 'Checkup' ? record.title : record.kind)
      : kind === 'service' ? record.service : 'Vaccination'
    const title = kind === 'timeline' ? [record.kind !== type && record.kind !== 'Checkup' ? record.kind : '', record.detail || record.title].filter(Boolean).join(' · ')
      : kind === 'service' ? record.serviceNotes || statusName(record.status) : record.vaccine
    return { id, date, type, title, time: eventTime(at, timezone), timestamp: isClinicDate(at) ? 0 : Date.parse(at) || 0 }
  })
}
