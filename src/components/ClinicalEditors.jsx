import { useState } from 'react'
import { RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { clinicDate, clinicTime, clinicTimestamp } from '../lib/clinicRepository'
import { Badge, Field } from './ui'

const staffOptions = (profiles) => profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))

function BodyConditionField({ record, draft }) {
  const legacy = record?.bodyConditionScale === 9 && record.bodyConditionScore != null
  const oldDraft = draft.bodyConditionScale === '9' && draft.bodyConditionScore !== ''
  const [mode, setMode] = useState(draft.bodyConditionMode || (legacy ? 'keep' : 'replace'))
  return <div className="field"><span>Body condition (1–5)</span>
    {legacy && <><span>Previously recorded: {record.bodyConditionScore}/9</span><label className="bcs-replace"><input type="checkbox" checked={mode === 'replace'} onChange={(event) => setMode(event.target.checked ? 'replace' : 'keep')} /> Replace with a new 1–5 assessment</label></>}
    {oldDraft && (!legacy || Number(draft.bodyConditionScore) !== record.bodyConditionScore) && <small>Previous draft: {draft.bodyConditionScore}/9. Enter a new assessment on the 1–5 scale to replace it.</small>}
    <input type="hidden" name="bodyConditionMode" value={mode} />
    <input type="hidden" name="bodyConditionScale" value={legacy && mode === 'keep' ? '9' : '5'} />
    {legacy && mode === 'keep' ? <input type="hidden" name="bodyConditionScore" value={record.bodyConditionScore} /> : <input name="bodyConditionScore" aria-label="Body condition (1–5)" type="number" min="1" max="5" step="1" required={legacy} defaultValue={oldDraft ? '' : draft.bodyConditionScore ?? (legacy ? '' : record?.bodyConditionScore) ?? ''} />}
  </div>
}

export function VisitEditor({ pet, record, queueEntry, onSaved, onClose }) {
  const { execute, profiles, timezone, queueEntries, services } = useClinicData()
  const { user } = useAuth()
  const [careTime] = useState(() => record ? new Date(record.visitedAt) : new Date())
  const [draft] = useState(() => ({ values: queueEntry?.careDraft || {}, version: queueEntry?.draftVersion || 0 }))
  const activeCheckup = queueEntries.find((entry) => entry.petId === pet.id && entry.category === 'checkup' && ['waiting', 'in_progress'].includes(entry.status))
  const initial = { type: queueEntry?.service || 'Wellness check', hydration: 'Normal', weightKg: pet.latestWeight, veterinarianId: activeCheckup?.veterinarianId || user.id, ...record,
    encounteredAt: clinicDate(careTime, timezone) + 'T' + clinicTime(careTime, timezone), ...draft.values,
    ...(queueEntry ? { veterinarianId: queueEntry.veterinarianId } : {}) }
  return <RecordEditor title={record ? `Edit checkup for ${pet.name}` : `Record checkup for ${pet.name}`} description={queueEntry ? `${queueEntry.queueNumber} · ${queueEntry.queueDate}. Save unfinished care as a draft, or save the clinical entry to complete this visit.` : record ? 'Clinical notes, vitals and any follow-up reminder are saved together.' : 'Save this checkup to add the patient to the queue automatically.'}
    onClose={onClose} initial={initial} submitLabel="Save clinical entry"
    onSaveDraft={queueEntry ? (values) => execute('save_queue_draft', { id: queueEntry.id, record: values, draftVersion: draft.version }) : undefined}
    onSave={async (values) => {
      const payload = { ...values, petId: pet.id, ...(record ? { id: record.id } : {}),
        encounteredAt: clinicTimestamp(values.encounteredAt.slice(0, 10), values.encounteredAt.slice(11, 16), timezone) }
      const saved = await execute(queueEntry ? 'complete_queue_entry' : record ? 'update_encounter' : 'create_queued_encounter', queueEntry ? { id: queueEntry.id, record: payload, draftVersion: draft.version } : payload)
      onSaved?.(saved)
      return saved
    }}
    fields={[
      { name: 'type', label: 'Visit type', type: 'select', options: [...new Set(['Wellness check', 'Sick visit', 'Follow-up', 'Emergency', 'Procedure', ...services.filter((service) => service.workflow === 'checkup').map((service) => service.name), initial.type])] },
      { name: 'encounteredAt', label: `Time of care (${timezone})`, type: 'datetime-local', required: true },
      { name: 'veterinarianId', label: 'Attending veterinarian', type: 'select', required: true, options: staffOptions(profiles).filter((option) => !queueEntry || option.value === queueEntry.veterinarianId) },
      { name: 'complaint', label: 'Chief complaint', type: 'textarea', required: true, span: true },
      { name: 'weightKg', label: 'Weight (kg)', type: 'number', min: '0.01', step: '0.01', required: true },
      { name: 'temperatureC', label: 'Temperature (°C)', type: 'number', min: '30', max: '45', step: '0.1' },
      { name: 'heartRate', label: 'Heart rate (bpm)', type: 'number', min: '1', step: '1' },
      { name: 'respiratoryRate', label: 'Respiratory rate', type: 'number', min: '1', step: '1' },
      { name: 'bodyConditionScore', render: () => <BodyConditionField record={record} draft={draft.values} /> },
      { name: 'hydration', label: 'Hydration', type: 'select', options: ['Normal', 'Mild dehydration', 'Moderate dehydration', 'Severe dehydration'] },
      ...['subjective', 'objective', 'assessment', 'plan'].map((name) => ({ name, label: name.charAt(0).toUpperCase() + name.slice(1), type: 'textarea' })),
      { name: 'diagnosis', label: 'Diagnosis', span: true },
      { name: 'followUpDate', label: 'Follow-up date', type: 'date' },
    ]} />
}

export function VaccineEditor({ pet, record, queueEntry, onSaved, onClose }) {
  const { execute, profiles, today, queueEntries, inventory } = useClinicData()
  const { user } = useAuth()
  const [draft] = useState(() => ({ values: queueEntry?.careDraft || {}, version: queueEntry?.draftVersion || 0 }))
  const [inventoryItemId, setInventoryItemId] = useState(draft.values.inventoryItemId ?? record?.inventoryItemId ?? '')
  const items = inventory.filter((item) => item.isActive && item.category === 'Vaccines')
  const selected = inventory.find((item) => item.id === inventoryItemId)
  const unchanged = record && inventoryItemId === record.inventoryItemId
  const brand = unchanged ? record.brand : selected?.brand
  const careStatus = queueEntry ? { waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[queueEntry.status] : record?.careStatus || 'Waiting'
  const activeVaccination = queueEntries.find((entry) => entry.petId === pet.id && entry.category === 'vaccination' && ['waiting', 'in_progress'].includes(entry.status))
  return <RecordEditor title={record ? `Edit vaccination for ${pet.name}` : `Record vaccination for ${pet.name}`} description={queueEntry ? `${queueEntry.queueNumber} · ${queueEntry.queueDate}. Save unfinished care as a draft, or save the vaccination to complete this visit. A next-due date creates a linked reminder automatically.` : record ? 'A next-due date creates a linked reminder automatically.' : 'Save this vaccine to add the patient to the queue automatically. A next-due date creates a linked reminder.'}
    onClose={onClose} initial={{ administeredAt: today, veterinarianId: activeVaccination?.veterinarianId || user.id, ...record, ...draft.values, ...(queueEntry ? { veterinarianId: queueEntry.veterinarianId } : {}) }} submitLabel="Save vaccination"
    onSaveDraft={queueEntry ? (values) => execute('save_queue_draft', { id: queueEntry.id, record: values, draftVersion: draft.version }) : undefined}
    onSave={async (values) => {
      const payload = { ...values, petId: pet.id, ...(record ? { id: record.id } : {}) }
      const saved = await execute(queueEntry ? 'complete_queue_entry' : record ? 'update_vaccination' : 'create_queued_vaccination', queueEntry ? { id: queueEntry.id, record: payload, draftVersion: draft.version } : payload)
      onSaved?.(saved)
      return saved
    }}
    fields={[
      { name: 'inventoryItemId', render: () => <Field label="Vaccine type" required={!record} span hint="Choose a vaccine from inventory. Stock movements are recorded separately.">
        <select name="inventoryItemId" aria-label="Vaccine type" value={inventoryItemId} required={!record} onChange={(event) => setInventoryItemId(event.target.value)}>
          <option value="" disabled={Boolean(record?.inventoryItemId)}>{record && !record.inventoryItemId ? `Keep historical vaccine: ${record.vaccine}` : 'Select vaccine from inventory'}</option>
          {record?.inventoryItemId && !items.some((item) => item.id === record.inventoryItemId) && <option value={record.inventoryItemId}>{record.vaccine} (historical selection)</option>}
          {items.map((item) => <option key={item.id} value={item.id} disabled={!item.brand?.trim() && item.id !== record?.inventoryItemId}>{item.name}{!item.brand?.trim() ? ' — add brand in inventory' : ''}</option>)}
        </select>
        {!items.length && <span>Add an active vaccine with a brand in Inventory to record a new vaccination.</span>}
        {draft.values.vaccine && !draft.values.inventoryItemId && <small>Previous draft vaccine: {draft.values.vaccine}. Select its inventory item to continue.</small>}
      </Field> },
      { name: 'brand', render: () => <Field label="Brand"><input aria-label="Brand" readOnly value={brand || ''} placeholder={unchanged ? 'Not recorded on historical vaccination' : 'From selected inventory item'} /></Field> },
      { name: 'careStatus', render: () => <Field label="Care status"><Badge tone={{ Completed: 'success', 'In progress': 'blue', Waiting: 'warning', Cancelled: 'danger' }[careStatus] || 'neutral'}>{careStatus}</Badge>{!record && !queueEntry && <small>Saving adds this vaccination to the queue as Waiting.</small>}</Field> },
      { name: 'administeredAt', label: 'Date administered', type: 'date', required: true },
      { name: 'nextDueAt', label: 'Next due date', type: 'date', hint: 'Optional; must be after the administered date.' },
      { name: 'dose', label: 'Dose' },
      { name: 'veterinarianId', label: 'Veterinarian', type: 'select', required: true, options: staffOptions(profiles).filter((option) => !queueEntry || option.value === queueEntry.veterinarianId) },
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
