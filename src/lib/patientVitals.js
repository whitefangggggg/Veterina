import { dateInClinic } from './dailyWorkflow'

const fields = ['weightKg', 'temperatureC', 'heartRate', 'respiratoryRate', 'bodyConditionScore']
export const recordedVital = (value) => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0

export function patientVitals(visits, timezone) {
  const rows = visits.filter((visit) => visit.visitedAt && dateInClinic(visit.visitedAt, timezone) && fields.some((field) => recordedVital(visit[field])))
    .sort((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt) || a.id.localeCompare(b.id))
  const weights = [...rows].reverse().filter((visit) => recordedVital(visit.weightKg))
    .map((visit) => ({ visitId: visit.id, at: visit.visitedAt, date: dateInClinic(visit.visitedAt, timezone), weight: Number(visit.weightKg) }))
  const values = weights.map((point) => point.weight)
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0
  const padding = Math.max((max - min) * 0.15, max * 0.05, 0.1)
  return { rows, weights, domain: [Math.max(0, Math.floor((min - padding) * 10) / 10), Math.ceil((max + padding) * 10) / 10] }
}

export function visitDateTime(value, timezone) {
  if (!value || !dateInClinic(value, timezone)) return 'Not recorded'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
