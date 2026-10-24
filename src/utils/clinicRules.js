import { intervalToDuration, isValid, parseISO } from 'date-fns'

export function formatPatientAge(birthDate, today) {
  if (!birthDate || !today) return ''
  const start = parseISO(birthDate)
  const end = parseISO(today)
  if (!isValid(start) || !isValid(end) || start > end) return ''
  const duration = intervalToDuration({ start, end })
  const totalMonths = (duration.years || 0) * 12 + (duration.months || 0)
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  return `${years} ${years === 1 ? 'year' : 'years'}, ${months} ${months === 1 ? 'month' : 'months'}`
}

export function vaccinationStatus(nextDueAt, today) {
  if (!nextDueAt) return 'No next dose scheduled'
  return nextDueAt < today ? 'Overdue' : nextDueAt === today ? 'Due today' : 'Up to date'
}

export function visibleQueueEntries(entries, { service = 'All', status = 'Active', date }) {
  return entries.filter((entry) => {
    const active = ['waiting', 'in_progress'].includes(entry.status)
    return (service === 'All' || entry.category === service || `service:${entry.serviceTypeId || entry.service}` === service)
      && (status === 'All' || (status === 'Active' ? active : entry.status === status))
      && (active || entry.finishedDate === date)
  }).sort((a, b) => {
    if (a.queueDate && b.queueDate && a.queueSequence != null && b.queueSequence != null) {
      return a.queueDate.localeCompare(b.queueDate) || a.queueSequence - b.queueSequence
    }
    return a.arrivedAt.localeCompare(b.arrivedAt) || a.id.localeCompare(b.id)
  })
}

// Calendar-month subtraction matches Postgres interval arithmetic, including leap days.
export function birthDateFromAge(today, years = '', months = '') {
  if (years === '' && months === '') return ''
  const y = Number(years || 0), m = Number(months || 0)
  if (!Number.isInteger(y) || y < 0 || !Number.isInteger(m) || m < 0 || m > 11) return ''
  const [year, month, day] = today.split('-').map(Number)
  const total = year * 12 + month - 1 - y * 12 - m
  const targetYear = Math.floor(total / 12), targetMonth = ((total % 12) + 12) % 12
  if (targetYear < 1) return ''
  const monthEnd = new Date(0)
  monthEnd.setUTCFullYear(targetYear, targetMonth + 1, 0)
  const lastDay = monthEnd.getUTCDate()
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

export function classifyReminder(dueDate, today, completed = false) {
  if (completed) return 'Completed'
  const due = new Date(`${dueDate}T00:00:00`)
  const current = new Date(`${today}T00:00:00`)
  if (due < current) return 'Overdue'
  if (due.getTime() === current.getTime()) return 'Due'
  return 'Upcoming'
}

export function calculateStockOnHand(movements) {
  return movements.reduce((total, movement) => total + Number(movement.quantityDelta), 0)
}

export function canApplyStockMovement(currentQuantity, quantityDelta) {
  return Number(currentQuantity) + Number(quantityDelta) >= 0
}

export function formatPetRecordNumber(year, sequence) {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Sequence must be a positive integer')
  return `VET-${year}-${String(sequence).padStart(5, '0')}`
}
