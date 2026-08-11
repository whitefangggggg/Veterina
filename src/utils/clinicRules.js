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
