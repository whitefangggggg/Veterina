import { isClinicDate, patientSource } from './dailyWorkflow'

export function appointmentPatientSource(appointment) {
  return `/patients/${encodeURIComponent(appointment.petId)}?appointmentId=${encodeURIComponent(appointment.id)}#patient-appointment-${encodeURIComponent(appointment.id)}`
}

// A clinical follow-up date has no appointment time. Keep it linked to the
// saved checkup so edits/removal sync without creating another booking.
export function upcomingFollowUps(visits, pets, today) {
  const activePets = new Set(pets.filter((pet) => pet.status === 'Active').map((pet) => pet.id))
  return visits.map((visit) => ({ ...visit, scheduledDate: visit.followUpScheduledDate || visit.followUpDate })).filter((visit) => activePets.has(visit.petId)
    && visit.careStatus !== 'Cancelled'
    && !visit.followUpArrivedAt && isClinicDate(visit.scheduledDate) && visit.scheduledDate >= today)
    .map((visit) => ({
      id: `follow-up-${visit.id}`, visitId: visit.id, petId: visit.petId,
      date: visit.scheduledDate, service: visit.type === 'Follow-up' ? 'Follow-up checkup' : `${visit.type || 'Checkup'} follow-up`,
      veterinarian: visit.veterinarian, notes: visit.plan || '',
      href: patientSource(visit.petId, 'history', visit.id),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
