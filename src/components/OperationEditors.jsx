import { useEffect, useState } from 'react'
import { RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { appointmentMinimum, validateAppointmentStart } from '../lib/appointmentScheduling'
import AppointmentTimePicker from './AppointmentTimePicker'

export function AppointmentEditor({ record, initialDate, initialPetId, onClose }) {
  const { pets, owners, profiles, services, timezone, execute } = useClinicData()
  const { user } = useAuth()
  const [clock, setClock] = useState(() => new Date())
  const minimum = appointmentMinimum(timezone, clock)
  const [selectedDate, setSelectedDate] = useState(() => record?.date || (initialDate && initialDate >= minimum.date ? initialDate : minimum.date))
  const [initial] = useState(() => record || { date: selectedDate, petId: initialPetId || '',
    time: selectedDate === minimum.date && minimum.time > '09:00' ? minimum.time : '09:00',
    veterinarianId: user.id, service: services[0]?.name })
  const refreshClock = () => setClock(new Date())

  useEffect(() => {
    const refreshClock = () => setClock(new Date())
    const tick = setInterval(refreshClock, 1000)
    window.addEventListener('focus', refreshClock)
    return () => { clearInterval(tick); window.removeEventListener('focus', refreshClock) }
  }, [])

  return <RecordEditor title={record ? 'Reschedule appointment' : 'New appointment'} description="Choose a future date and time for this appointment."
    initial={initial} onClose={onClose}
    onSave={(values) => {
      if (!pets.some((pet) => pet.id === values.petId && (pet.status === 'Active' || pet.id === record?.petId))) {
        throw new Error('Select an active patient before booking an appointment.')
      }
      const error = validateAppointmentStart(values.date, values.time, timezone)
      if (error) throw new Error(error)
      return execute(record ? 'reschedule_appointment' : 'book_appointment', { ...values, ...(record ? { id: record.id } : {}) })
    }}
    submitLabel={record ? 'Save appointment' : 'Create appointment'} fields={[
      { name: 'petId', label: 'Patient', type: 'select', required: true, span: true, options: [{ value: '', label: 'Select patient' }, ...pets.filter((pet) => pet.status === 'Active' || pet.id === record?.petId).map((pet) => ({ value: pet.id, label: pet.name + ' — ' + (owners.find((owner) => owner.id === pet.ownerId)?.fullName || '') }))] },
      { name: 'date', label: 'Date', type: 'date', required: true, min: minimum.date, onChange: (event) => setSelectedDate(event.target.value) },
      { name: 'time', render: () => <AppointmentTimePicker date={selectedDate} timezone={timezone} clock={clock} initialTime={initial.time} onRefresh={refreshClock} /> },
      { name: 'service', label: 'Service', type: 'select', required: true, options: [{ value: '', label: 'Select an active service' }, ...services.map((service) => service.name)] },
      { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', min: '5', max: '480', step: '1', hint: 'Leave blank to use the service duration.' },
      { name: 'veterinarianId', label: 'Veterinarian', type: 'select', required: true, options: profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' })) },
      { name: 'notes', label: 'Notes', type: 'textarea', span: true },
    ]} />
}

export function ReminderEditor({ record, initialDate, onClose }) {
  const { pets, profiles, visits, execute, today } = useClinicData()
  const visit = visits.find((visit) => visit.id === record?.visit_id && visit.petId === record?.petId)
  const linkedFollowUp = record?.type === 'Follow-up' && (visit?.followUpScheduledDate || visit?.followUpDate) && !visit.followUpArrivedAt
  return <RecordEditor title={record ? 'Edit follow-up task' : 'New follow-up task'} initial={record ? { ...record, priority: record.priority, assignedTo: record.assigned_to || '' } : { dueDate: initialDate || today, priority: 'normal' }} onClose={onClose}
    onSave={(values) => execute(record ? 'update_reminder' : 'create_reminder', { ...values, ...(record ? { id: record.id } : {}) })}
    fields={[
      ...(!record ? [{ name: 'petId', label: 'Patient', type: 'select', required: true, options: [{ value: '', label: 'Select patient' }, ...pets.map((pet) => ({ value: pet.id, label: pet.name + ' · ' + pet.recordNumber }))] },
        { name: 'reminderType', label: 'Type', type: 'select', options: [{ value: 'custom', label: 'Custom' }, { value: 'appointment', label: 'Checkup' }, { value: 'medication', label: 'Medication' }] }] : []),
      { name: 'title', label: 'Title', required: true }, { name: 'dueDate', label: 'Due date', type: 'date', required: true, readOnly: Boolean(linkedFollowUp), hint: linkedFollowUp ? 'Use Reschedule follow-up to move the care date and its contact task together, or Snooze contact to change only the next call date.' : record ? 'This is the contact date. Bookings and clinical due dates are changed through their linked records.' : undefined },
      { name: 'priority', label: 'Priority', type: 'select', options: ['normal', 'high', 'urgent'] },
      { name: 'assignedTo', label: 'Assigned to', type: 'select', options: [{ value: '', label: 'Unassigned' }, ...profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))] },
      { name: 'notes', label: 'Notes', type: 'textarea', span: true },
    ]} />
}
