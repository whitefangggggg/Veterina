const action = (type, label, record, petId = record.petId) => ({ type, label, record, petId })
const correction = (visit, role) => role === 'owner' ? [action('correct', 'Append correction', visit)] : []

export function calendarEditActions(kind, record, data, role) {
  if (kind === 'checkup') return record.finalizedAt ? correction(record, role) : [action('visit', 'Edit checkup', record)]
  if (kind === 'vaccination') return [action('vaccine', 'Edit vaccination', record)]
  if (kind === 'service') return [action('service-notes', 'Edit service notes', record)]
  if (kind !== 'timeline') return []
  const id = record.sourceId
  if (['Checkup', 'Prescription', 'Correction'].includes(record.kind)) {
    const visit = data.visits.find((visit) => record.kind === 'Checkup' ? visit.id === id : record.kind === 'Prescription'
      ? visit.prescriptions.some((prescription) => prescription.id === id) : visit.corrections.some((correction) => correction.id === id))
    if (!visit) return []
    if (record.kind === 'Correction' || visit.finalizedAt) return correction(visit, role)
    if (record.kind === 'Prescription') return [action('prescription', 'Edit prescription', visit.prescriptions.find((prescription) => prescription.id === id), visit.petId)]
    return calendarEditActions('checkup', visit, data, role)
  }
  if (record.kind === 'Vaccination') {
    const vaccine = data.vaccinations.find((vaccine) => vaccine.id === id)
    return vaccine ? calendarEditActions('vaccination', vaccine, data, role) : []
  }
  if (['Arrival', 'Care draft', 'Queue outcome'].includes(record.kind)) {
    const entry = data.queueEntries.find((entry) => entry.id === id)
    if (!entry) return []
    if (entry.category === 'maintenance') return calendarEditActions('service', entry, data, role)
    const visit = data.visits.find((visit) => visit.id === entry.visit_id)
    if (visit) return calendarEditActions('checkup', visit, data, role)
    const vaccine = data.vaccinations.find((vaccine) => vaccine.id === entry.vaccination_id)
    if (vaccine) return calendarEditActions('vaccination', vaccine, data, role)
    if (entry.status === 'in_progress') return [action('queue-care', 'Edit care draft', entry)]
    if (entry.status === 'waiting') return [action('queue-start', 'Start care', entry)]
  }
  if (record.kind === 'Appointment') {
    const appointment = data.appointments.find((appointment) => appointment.id === id)
    return appointment && ['Pending', 'Confirmed'].includes(appointment.status) ? [action('appointment', 'Reschedule appointment', appointment)] : []
  }
  if (['Reminder', 'Reminder activity'].includes(record.kind)) {
    const reminder = data.reminders.find((reminder) => record.kind === 'Reminder' ? reminder.id === id : reminder.activity.some((activity) => activity.id === id))
    return reminder && !['Completed', 'Cancelled'].includes(reminder.status) ? [action('reminder', 'Edit reminder', reminder)] : []
  }
  return []
}
