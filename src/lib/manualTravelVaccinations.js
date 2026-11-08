import { isClinicDate } from './dailyWorkflow'

export const emptyManualTravelVaccination = () => ({ id: crypto.randomUUID(), vaccine: '', brand: '', lotNumber: '', administeredAt: '', nextDueAt: '', dose: '', veterinarianName: '', expirationDate: '' })

export function manualTravelVaccinationErrors(items, today) {
  const errors = []
  if (items.length > 50) errors.push('Enter no more than 50 manual vaccines.')
  const ids = new Set()
  items.forEach((item, index) => {
    const prefix = `Manual vaccine ${index + 1}: `
    if (!item.id || ids.has(item.id)) errors.push(prefix + 'duplicate vaccine identifier.')
    ids.add(item.id)
    for (const [key, label, max, required] of [['vaccine', 'vaccine name', 300, true], ['lotNumber', 'lot number', 200, true], ['brand', 'brand', 300], ['dose', 'dose', 300], ['veterinarianName', 'veterinarian name', 300]]) {
      const value = item[key]
      if (typeof value !== 'string' || (required && !value.trim()) || [...value.trim()].length > max || /\p{Cc}/u.test(value)) errors.push(prefix + `enter a valid ${label} (up to ${max} characters).`)
    }
    if (!isClinicDate(item.administeredAt) || item.administeredAt > today) errors.push(prefix + 'administration date must be on or before issuance.')
    if (item.nextDueAt && (!isClinicDate(item.nextDueAt) || item.nextDueAt <= item.administeredAt)) errors.push(prefix + 'next due date must follow administration.')
    if (item.expirationDate && (!isClinicDate(item.expirationDate) || item.expirationDate < item.administeredAt)) errors.push(prefix + 'product expiration cannot precede administration.')
  })
  return errors
}

export const manualTravelVaccinationPayload = (items) => items.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])))

export const manualTravelVaccinationRecords = (items, petId) => manualTravelVaccinationPayload(items).map((item) => ({ ...item, petId, careStatus: 'Recorded', administered_by_name: item.veterinarianName }))
