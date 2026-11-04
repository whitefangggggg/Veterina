import { useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { ActionDialog, RecordEditor } from './RecordForm'
import { VaccineEditor, VisitEditor } from './ClinicalEditors'
import WalkInRegistration from './WalkInRegistration'

function FollowUpArrival({ pet, visit, onSaved, onClose }) {
  const { services, profiles, owners, queueEntries, today, execute } = useClinicData()
  const scheduledDate = visit.followUpScheduledDate || visit.followUpDate
  const checkups = services.filter((service) => service.workflow === 'checkup')
  const initialService = checkups.find((service) => service.name === 'Follow-up') || checkups.find((service) => service.name === visit.type) || checkups[0]
  const initialStaff = profiles.find((profile) => profile.id === visit.veterinarianId && profile.is_active)
  return <RecordEditor title={`Patient arrived · ${pet.name}`} description="Create a new clinical record and add this follow-up to today's queue. Enter the current complaint and measured weight; the previous clinical record is preserved."
    initial={{ serviceId: initialService?.id || '', veterinarianId: initialStaff?.id || '', complaint: 'Scheduled follow-up checkup', notes: `Follow-up scheduled for ${scheduledDate}` }}
    submitLabel="Create checkup & add to queue" onClose={onClose} onSave={async (values) => {
      if (scheduledDate !== today) throw new Error('This follow-up is not scheduled for today. Close this dialog and reschedule it before recording arrival.')
      if (pet.status !== 'Active' || !owners.some((owner) => owner.id === pet.ownerId && owner.isActive)) throw new Error('Select an active patient with an active owner before recording an arrival.')
      if (queueEntries.some((entry) => entry.petId === pet.id && entry.category === 'checkup' && ['waiting', 'in_progress'].includes(entry.status))) throw new Error('This patient is already in the checkup queue. Open their existing queue entry.')
      const saved = await execute('arrive_follow_up', { ...values, visitId: visit.id, petId: pet.id, expectedDate: scheduledDate })
      onSaved?.(saved)
      return saved
    }} fields={[
      { name: 'serviceId', label: 'Service', type: 'select', required: true, options: [{ value: '', label: 'Select checkup service' }, ...checkups.map((service) => ({ value: service.id, label: service.name }))] },
      { name: 'veterinarianId', label: 'Assigned veterinarian / staff', type: 'select', required: true, options: [{ value: '', label: 'Select staff' }, ...profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))] },
      { name: 'complaint', label: 'Chief complaint', type: 'textarea', required: true, maxLength: 10000, span: true },
      { name: 'weightKg', label: 'Current weight (kg)', type: 'number', required: true, min: '0.01', step: '0.01', hint: 'Enter a newly measured weight for this checkup.' },
      { name: 'notes', label: 'Arrival notes', type: 'textarea', maxLength: 10000, span: true },
    ]} />
}

function MaintenanceEditor({ entry, pet, onClose }) {
  const { execute } = useClinicData()
  const [draft] = useState(() => ({ values: entry.careDraft, version: entry.draftVersion }))
  return <RecordEditor title={`Record ${entry.service} for ${pet.name}`} description={`${entry.queueNumber} · ${entry.queueDate}. Save a draft, or complete this service with a description of the work performed.`}
    initial={{ serviceNotes: entry.serviceNotes, ...draft.values }} onClose={onClose} submitLabel="Complete service"
    onSaveDraft={(values) => execute('save_queue_draft', { id: entry.id, draftVersion: draft.version, record: { ...values, veterinarianId: entry.veterinarianId } })}
    onSave={(values) => execute('complete_queue_entry', { id: entry.id, draftVersion: draft.version, record: { ...values, petId: pet.id, veterinarianId: entry.veterinarianId } })}
    fields={[{ name: 'serviceNotes', label: 'Work performed / service notes', type: 'textarea', required: true, span: true }]} />
}

export function ServiceNotesEditor({ entry, onClose }) {
  const { execute } = useClinicData()
  const [original] = useState(() => ({ originalNotes: entry.notes || '', originalServiceNotes: entry.serviceNotes || '' }))
  return <RecordEditor title={`Edit ${entry.service} notes`} description={`${entry.queueNumber} · ${entry.queueDate}. Update the notes while preserving the recorded service status and dates.`}
    initial={{ notes: original.originalNotes, serviceNotes: original.originalServiceNotes }} onClose={onClose} submitLabel="Save service notes"
    onSave={(values) => execute('update_service_notes', { id: entry.id, ...values, ...original })}
    fields={[{ name: 'notes', label: 'Arrival notes', type: 'textarea', maxLength: 10000, span: true }, { name: 'serviceNotes', label: 'Work performed / service notes', type: 'textarea', maxLength: 10000, required: entry.status === 'completed', span: true }]} />
}

export function QueueDialog({ modal, onSaved, onClose }) {
  const { owners, profiles, appointments, queueEntries, visits, vaccinations, today, execute, getPet } = useClinicData()
  const { user } = useAuth()
  const staff = profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))
  const patientLabel = (pet) => `${pet?.name || 'Patient'} — ${owners.find((owner) => owner.id === pet?.ownerId)?.fullName || ''}`
  if (!modal) return null
  if (['followup-arrival', 'reschedule-followup'].includes(modal.type)) {
    const pet = getPet(modal.petId)
    const visit = visits.find((item) => item.id === modal.visitId && item.petId === modal.petId)
    if (!pet || !visit?.followUpDate) return null
    const scheduledDate = visit.followUpScheduledDate || visit.followUpDate
    if (modal.type === 'reschedule-followup') return <RecordEditor title="Reschedule follow-up" description={`Choose a new follow-up date for ${pet.name}. The previous clinical notes stay unchanged.`}
      initial={{ date: scheduledDate }} fields={[{ name: 'date', label: 'Follow-up date', type: 'date', min: today, required: true }]}
      onSave={(values) => execute('reschedule_follow_up', { visitId: visit.id, expectedDate: scheduledDate, date: values.date })} onClose={onClose} submitLabel="Save follow-up date" />
    if (scheduledDate !== today) return <ActionDialog title="This follow-up is not scheduled for today" description={`${pet.name}'s follow-up is scheduled for ${scheduledDate}. Today is ${today}. Reschedule it to today before recording arrival. No queue entry or clinical record has been created.`}
      action="reschedule_follow_up" data={{ visitId: visit.id, expectedDate: scheduledDate, date: today }} submitLabel="Reschedule to today" onClose={onClose} />
    return <FollowUpArrival pet={pet} visit={visit} onSaved={onSaved} onClose={onClose} />
  }
  if (modal.type === 'walkin') return <WalkInRegistration onClose={onClose} />
  if (modal.type === 'checkin') {
    const eligible = appointments.filter((appointment) => appointment.date === today && ['Pending', 'Confirmed'].includes(appointment.status)
      && getPet(appointment.petId)?.status === 'Active' && !queueEntries.some((entry) => entry.appointmentId === appointment.id))
    return <RecordEditor title="Check in appointment" description={eligible.length ? 'Check in a booked patient who has arrived at the clinic.' : 'No eligible appointments today. Add a walk-in for an unscheduled arrival.'}
      initial={{ appointmentId: modal.appointmentId || '' }} onClose={onClose} submitLabel="Check in" onSave={(values) => execute('check_in_appointment', values)}
      fields={[{ name: 'appointmentId', label: 'Appointment', type: 'select', required: true, span: true,
        options: [{ value: '', label: 'Select today’s appointment' }, ...eligible.map((appointment) => ({ value: appointment.id, label: `${appointment.time} · ${patientLabel(getPet(appointment.petId))} · ${appointment.service}` }))] }]} />
  }
  const entry = queueEntries.find((item) => item.id === modal.entry?.id) || modal.entry
  const ticket = entry?.queueNumber ? `${entry.queueNumber} · ${entry.queueDate}. ` : ''
  if (modal.type === 'start') return <ActionDialog title="Start care" description={`${ticket}Assign the ${entry.category === 'maintenance' ? 'staff member' : 'veterinarian'} who will record this care.`} action="start_queue_entry"
    data={{ id: entry.id }} initial={{ veterinarianId: entry.veterinarianId || user.id }} onClose={onClose}
    fields={[{ name: 'veterinarianId', label: entry.category === 'maintenance' ? 'Assigned staff' : 'Attending veterinarian', type: 'select', required: true, options: [{ value: '', label: 'Select staff' }, ...staff] }]} />
  if (modal.type === 'cancel') return <ActionDialog title="Cancel this queue entry?" description={`${ticket}${entry.appointmentId ? 'The arrival stays in the queue history. Its linked appointment will also be cancelled.' : 'The arrival stays in the queue history.'}`}
    action="cancel_queue_entry" data={{ id: entry.id }} onClose={onClose} />
  if (modal.type === 'care') {
    const pet = getPet(entry.petId)
    if (!pet) return null
    if (entry.category === 'maintenance') return <MaintenanceEditor entry={entry} pet={pet} onClose={onClose} />
    return entry.category === 'vaccination' ? <VaccineEditor pet={pet} record={vaccinations.find((vaccination) => vaccination.id === entry.vaccination_id)} queueEntry={entry} onClose={onClose} /> : <VisitEditor pet={pet} record={visits.find((visit) => visit.id === entry.visit_id)} queueEntry={entry} onClose={onClose} />
  }
  return null
}
