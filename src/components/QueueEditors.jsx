import { useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { ActionDialog, RecordEditor } from './RecordForm'
import { VaccineEditor, VisitEditor } from './ClinicalEditors'

function MaintenanceEditor({ entry, pet, onClose }) {
  const { execute } = useClinicData()
  const [draft] = useState(() => ({ values: entry.careDraft, version: entry.draftVersion }))
  return <RecordEditor title={`Record ${entry.service} for ${pet.name}`} description={`${entry.queueNumber} · ${entry.queueDate}. Save a draft, or complete this service with a description of the work performed.`}
    initial={{ serviceNotes: entry.serviceNotes, ...draft.values }} onClose={onClose} submitLabel="Complete service"
    onSaveDraft={(values) => execute('save_queue_draft', { id: entry.id, draftVersion: draft.version, record: { ...values, veterinarianId: entry.veterinarianId } })}
    onSave={(values) => execute('complete_queue_entry', { id: entry.id, draftVersion: draft.version, record: { ...values, petId: pet.id, veterinarianId: entry.veterinarianId } })}
    fields={[{ name: 'serviceNotes', label: 'Work performed / service notes', type: 'textarea', required: true, span: true }]} />
}

export function QueueDialog({ modal, onClose }) {
  const { pets, owners, profiles, appointments, queueEntries, visits, vaccinations, today, execute, getPet, services } = useClinicData()
  const { user } = useAuth()
  const staff = profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))
  const patientLabel = (pet) => `${pet?.name || 'Patient'} — ${owners.find((owner) => owner.id === pet?.ownerId)?.fullName || ''}`
  if (!modal) return null
  if (modal.type === 'walkin') return <RecordEditor title="Add walk-in" description="Register an arrival for a clinic service." onClose={onClose}
    initial={{ serviceId: services.find((service) => service.name === 'Wellness check')?.id || services[0]?.id }} submitLabel="Add to queue" onSave={(values) => execute('add_queue_entry', values)} fields={[
      { name: 'petId', label: 'Patient', type: 'select', required: true, span: true, options: [{ value: '', label: 'Select an active patient' }, ...pets.filter((pet) => pet.status === 'Active').map((pet) => ({ value: pet.id, label: patientLabel(pet) }))] },
      { name: 'serviceId', label: 'Service', type: 'select', required: true, options: [{ value: '', label: 'Select service' }, ...services.map((service) => ({ value: service.id, label: service.name }))] },
      { name: 'veterinarianId', label: 'Assigned veterinarian / staff', type: 'select', options: [{ value: '', label: 'Unassigned' }, ...staff] },
      { name: 'notes', label: 'Arrival notes', type: 'textarea', span: true },
    ]} />
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
