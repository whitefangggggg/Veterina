import { isClinicDate, patientSource } from './dailyWorkflow'

export function appointmentPatientSource(appointment) {
  return `/patients/${encodeURIComponent(appointment.petId)}?appointmentId=${encodeURIComponent(appointment.id)}#patient-appointment-${encodeURIComponent(appointment.id)}`
}

// A clinical follow-up date has no appointment time. Keep it linked to the
// saved checkup so edits/removal sync without creating another booking.
export function upcomingFollowUps(visits, pets, today) {
  const activePets = new Set(pets.filter((pet) => pet.status === 'Active').map((pet) => pet.id))
  return visits.map((visit) => ({ ...visit, scheduledDate: visit.followUpScheduledDate || visit.followUpDate })).filter((visit) => activePets.has(visit.petId)
    && visit.careStatus !== 'Cancelled' && visit.recordingPurpose !== 'record_only'
    && !visit.followUpArrivedAt && isClinicDate(visit.scheduledDate) && visit.scheduledDate >= today)
    .map((visit) => ({
      id: `follow-up-${visit.id}`, visitId: visit.id, petId: visit.petId,
      date: visit.scheduledDate, service: visit.type === 'Follow-up' ? 'Follow-up checkup' : `${visit.type || 'Checkup'} follow-up`,
      veterinarian: visit.veterinarian, notes: visit.plan || '',
      href: patientSource(visit.petId, 'history', visit.id),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export const openScheduleTask = (task) => !['Completed', 'Cancelled'].includes(task.status)

// Pair only explicit source links on the same date. A snoozed contact task can
// have a different date from its care plan and must retain that distinction.
export function appointmentCareSchedule({ appointments, reminders, visits, vaccinations, pets, today }) {
  const historicalVisits = new Set(visits.filter((visit) => visit.recordingPurpose === 'record_only').map((visit) => visit.id))
  const historicalVaccines = new Set(vaccinations.filter((vaccine) => vaccine.recordingPurpose === 'record_only').map((vaccine) => vaccine.id))
  const tasks = reminders.filter((task) => isClinicDate(task.dueDate) && !historicalVisits.has(task.visit_id) && !historicalVaccines.has(task.vaccination_id))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
  const openTasks = tasks.filter(openScheduleTask)
  const followUps = upcomingFollowUps(visits, pets, today).map((entry) => ({ ...entry,
    tasks: openTasks.filter((task) => task.visit_id === entry.visitId && task.petId === entry.petId && task.type === 'Follow-up' && task.dueDate === entry.date),
  }))
  const attached = new Set(followUps.flatMap((entry) => entry.tasks.map((task) => task.id)))
  const appointmentTasks = new Map(appointments.map((appointment) => [appointment.id, openTasks.filter((task) => ['Pending', 'Confirmed', 'Arrived', 'In Progress'].includes(appointment.status) && task.appointment_id === appointment.id
    && task.petId === appointment.petId && task.dueDate === appointment.date && !attached.has(task.id))]))
  appointmentTasks.forEach((linked) => linked.forEach((task) => attached.add(task.id)))
  return { tasks, openTasks, followUps, appointmentTasks, calendarTasks: openTasks.filter((task) => !attached.has(task.id)) }
}
