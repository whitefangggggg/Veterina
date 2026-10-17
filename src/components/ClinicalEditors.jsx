import { useState } from 'react'
import { RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { clinicDate, clinicTime, clinicTimestamp } from '../lib/clinicRepository'

const staffOptions = (profiles) => profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))

export function VisitEditor({ pet, record, onClose }) {
  const { execute, profiles, timezone } = useClinicData()
  const { user } = useAuth()
  const [careTime] = useState(() => record ? new Date(record.visitedAt) : new Date())
  const initial = { type: 'Wellness check', hydration: 'Normal', weightKg: pet.latestWeight, veterinarianId: user.id, ...record,
    encounteredAt: clinicDate(careTime, timezone) + 'T' + clinicTime(careTime, timezone) }
  return <RecordEditor title={record ? `Edit checkup for ${pet.name}` : `Record checkup for ${pet.name}`} description="Clinical notes, vitals and any follow-up reminder are saved together."
    onClose={onClose} initial={initial} submitLabel="Save clinical entry"
    onSave={(values) => execute(record ? 'update_encounter' : 'create_encounter', { ...values, petId: pet.id, ...(record ? { id: record.id } : {}),
      encounteredAt: clinicTimestamp(values.encounteredAt.slice(0, 10), values.encounteredAt.slice(11, 16), timezone) })}
    fields={[
      { name: 'type', label: 'Visit type', type: 'select', options: ['Wellness check', 'Sick visit', 'Follow-up', 'Emergency', 'Procedure'] },
      { name: 'encounteredAt', label: `Time of care (${timezone})`, type: 'datetime-local', required: true },
      { name: 'veterinarianId', label: 'Attending veterinarian', type: 'select', required: true, options: staffOptions(profiles) },
      { name: 'complaint', label: 'Chief complaint', type: 'textarea', required: true, span: true },
      { name: 'weightKg', label: 'Weight (kg)', type: 'number', min: '0.01', step: '0.01', required: true },
      { name: 'temperatureC', label: 'Temperature (°C)', type: 'number', min: '30', max: '45', step: '0.1' },
      { name: 'heartRate', label: 'Heart rate (bpm)', type: 'number', min: '1', step: '1' },
      { name: 'respiratoryRate', label: 'Respiratory rate', type: 'number', min: '1', step: '1' },
      { name: 'bodyConditionScore', label: 'Body condition (1–9)', type: 'number', min: '1', max: '9', step: '1' },
      { name: 'hydration', label: 'Hydration', type: 'select', options: ['Normal', 'Mild dehydration', 'Moderate dehydration', 'Severe dehydration'] },
      ...['subjective', 'objective', 'assessment', 'plan'].map((name) => ({ name, label: name.charAt(0).toUpperCase() + name.slice(1), type: 'textarea' })),
      { name: 'diagnosis', label: 'Diagnosis', span: true },
      { name: 'followUpDate', label: 'Follow-up date', type: 'date' },
    ]} />
}

export function VaccineEditor({ pet, record, onClose }) {
  const { execute, profiles, today } = useClinicData()
  const { user } = useAuth()
  return <RecordEditor title={record ? `Edit vaccination for ${pet.name}` : `Record vaccination for ${pet.name}`} description="A next-due date creates a linked reminder automatically."
    onClose={onClose} initial={{ administeredAt: today, veterinarianId: user.id, ...record }} submitLabel="Save vaccination"
    onSave={(values) => execute(record ? 'update_vaccination' : 'create_vaccination', { ...values, petId: pet.id, ...(record ? { id: record.id } : {}) })}
    fields={[
      { name: 'vaccine', label: 'Vaccine', required: true, span: true },
      { name: 'administeredAt', label: 'Date administered', type: 'date', required: true },
      { name: 'nextDueAt', label: 'Next due date', type: 'date', hint: 'Optional; must be after the administered date.' },
      { name: 'lotNumber', label: 'Batch / lot number', required: true },
      { name: 'dose', label: 'Dose' },
      { name: 'veterinarianId', label: 'Veterinarian', type: 'select', required: true, options: staffOptions(profiles) },
    ]} />
}

export function PrescriptionEditor({ pet, record, onClose }) {
  const { visits, execute } = useClinicData()
  return <RecordEditor title={record ? 'Edit prescription' : 'Add prescription'} onClose={onClose}
    initial={record ? { medicationName: record.medication_name, dose: record.dose, frequency: record.frequency, instructions: record.instructions } : {}}
    onSave={(values) => execute(record ? 'update_prescription' : 'create_prescription', { ...values, ...(record ? { id: record.id } : {}) })}
    fields={[
      ...(!record ? [{ name: 'visitId', label: 'Open encounter', type: 'select', required: true, options: [{ value: '', label: 'Select an open encounter' }, ...visits.filter((visit) => visit.petId === pet.id && !visit.finalizedAt).map((visit) => ({ value: visit.id, label: visit.type + ' · ' + visit.visitedAt.slice(0, 10) }))] }] : []),
      { name: 'medicationName', label: 'Medication name', required: true }, { name: 'dose', label: 'Dose', required: true },
      { name: 'frequency', label: 'Frequency', required: true }, { name: 'instructions', label: 'Instructions', type: 'textarea', span: true },
    ]} />
}
