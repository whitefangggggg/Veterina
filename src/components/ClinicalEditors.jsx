import { useEffect, useRef, useState } from 'react'
import { AsyncForm, RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { clinicDate, clinicTime, clinicTimestamp } from '../lib/clinicRepository'
import { Badge, Field, Modal } from './ui'
import { prescriptionInventoryBatches, prescriptionMedications } from '../lib/prescriptions'
import PrescriptionMedicationPicker from './PrescriptionMedicationPicker'
import Combobox from './Combobox'
import DateWordsField from './DateWordsField'
import { format, parseISO } from 'date-fns'

const prescriptionRoutes = ['Oral', 'Topical', 'Subcutaneous', 'Intramuscular', 'Intravenous', 'Ophthalmic', 'Otic', 'Intranasal', 'Rectal', 'Inhalation'].map((route) => ({ value: route, label: route }))

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
  const [completion, setCompletion] = useState(null)
  const [completing, setCompleting] = useState(false)
  const [completionError, setCompletionError] = useState('')
  const [prescriptionCheckup, setPrescriptionCheckup] = useState(null)
  const completionCancel = useRef(null)
  useEffect(() => { if (completion) completionCancel.current?.focus() }, [completion])
  const [completionVersion] = useState(() => queueEntry?.draftVersion ?? record?.careQueue?.draftVersion ?? 0)
  const careQueue = queueEntry || record?.careQueue
  const careStarted = Boolean(careQueue?.startedAt || careQueue?.started_at || ['in_progress', 'completed'].includes(careQueue?.status))
  const [editingSections, setEditingSections] = useState({ visit: false, vitals: false })
  const sectionEditing = (name) => careStarted ? {
    readOnly: !editingSections[name],
    onToggleEdit: () => setEditingSections((current) => ({ ...current, [name]: !current[name] })),
  } : {}
  const canComplete = !record || ['waiting', 'in_progress'].includes(careQueue?.status)
  const activeCheckup = queueEntries.find((entry) => entry.petId === pet.id && entry.category === 'checkup' && ['waiting', 'in_progress'].includes(entry.status))
  const initial = { type: queueEntry?.service || 'Wellness check', hydration: 'Normal', weightKg: pet.latestWeight, veterinarianId: activeCheckup?.veterinarianId || user.id, ...record,
    encounteredAt: clinicDate(careTime, timezone) + 'T' + clinicTime(careTime, timezone), ...draft.values,
    ...(queueEntry ? { veterinarianId: queueEntry.veterinarianId } : {}) }
  const payloadFor = (values) => ({ ...values, petId: pet.id, ...(record ? { id: record.id } : {}),
    encounteredAt: clinicTimestamp(values.encounteredAt.slice(0, 10), values.encounteredAt.slice(11, 16), timezone) })
  const complete = async (withPrescription) => {
    if (completing) return
    setCompleting(true); setCompletionError('')
    try {
      const payload = { ...payloadFor(completion), ...(careQueue ? { queueEntryId: careQueue.id, draftVersion: completionVersion } : {}) }
      const saved = await execute(withPrescription ? 'save_checkup_progress' : queueEntry ? 'complete_queue_entry' : 'complete_checkup',
        !withPrescription && queueEntry ? { id: queueEntry.id, record: payloadFor(completion), draftVersion: completionVersion } : payload)
      onSaved?.(saved)
      if (withPrescription) setPrescriptionCheckup({ ...payload, id: saved.id, queueEntryId: saved.queueEntryId, draftVersion: saved.draftVersion })
      else onClose()
    } catch (failure) { setCompletionError(failure.message) }
    finally { setCompleting(false) }
  }
  if (prescriptionCheckup) return <PrescriptionEditor pet={pet} visitId={prescriptionCheckup.id} completingCheckup={prescriptionCheckup} onClose={onClose} />
  return <Modal wide={!completion} title={completion ? 'Complete this checkup?' : record ? `Edit checkup for ${pet.name}` : `Record checkup for ${pet.name}`} description={completion ? `Finish ${pet.name}'s checkup with or without a prescription. Care stays in progress until you save the prescription or choose Complete Checkup.` : queueEntry ? `${queueEntry.queueNumber} · ${format(parseISO(queueEntry.queueDate), 'MMMM d, yyyy')}. Save unfinished care as a draft, or complete this checkup.` : record ? 'Clinical notes, vitals and any follow-up reminder are saved together.' : 'Save this checkup to add the patient to the queue, or complete the checkup now.'}
    onClose={() => { if (completion) { setCompletion(null); setCompletionError('') } else onClose() }}>
    <div hidden={Boolean(completion)}><RecordEditor embedded className="checkup-form"
    onClose={onClose} initial={initial} submitLabel={queueEntry ? 'Complete Checkup' : 'Save clinical entry'}
    submitActions={canComplete && !queueEntry ? [{ value: 'complete', label: 'Complete Checkup' }] : []}
    onSaveDraft={queueEntry ? (values) => execute('save_queue_draft', { id: queueEntry.id, record: values, draftVersion: draft.version }) : undefined}
    onSave={async (values, { intent }) => {
      if (queueEntry || intent === 'complete') { setCompletion(values); setCompletionError(''); return false }
      const payload = payloadFor(values)
      const saved = await execute(queueEntry ? 'complete_queue_entry' : record ? 'update_encounter' : 'create_queued_encounter', queueEntry ? { id: queueEntry.id, record: payload, draftVersion: draft.version } : payload)
      onSaved?.(saved)
      return saved
    }}
    fields={[
      { name: 'visit', title: 'Visit details', description: 'When the care took place, who is attending, and the reason for the visit.', ...sectionEditing('visit'), fields: [
      { name: 'type', label: 'Visit type', type: 'select', options: [...new Set(['Wellness check', 'Sick visit', 'Follow-up', 'Emergency', 'Procedure', ...services.filter((service) => service.workflow === 'checkup').map((service) => service.name), initial.type])] },
      { name: 'veterinarianId', label: 'Attending veterinarian', type: 'select', required: true, options: staffOptions(profiles).filter((option) => !queueEntry || option.value === queueEntry.veterinarianId) },
      { name: 'encounteredAt', render: () => <DateWordsField name="encounteredAt" label={`Time of care (${timezone})`} initial={initial.encounteredAt} includeTime required /> },
      { name: 'complaint', label: 'Chief complaint', type: 'textarea', required: true, span: true },
      ] },
      { name: 'vitals', title: 'Vitals & condition', description: 'Record measurements taken during this checkup.', ...sectionEditing('vitals'), fields: [
      { name: 'weightKg', label: 'Weight (kg)', type: 'number', min: '0.01', step: '0.01', required: true },
      { name: 'temperatureC', label: 'Temperature (°C)', type: 'number', min: '30', max: '45', step: '0.1' },
      { name: 'heartRate', label: 'Heart rate (bpm)', type: 'number', min: '1', step: '1' },
      { name: 'respiratoryRate', label: 'Respiratory rate', type: 'number', min: '1', step: '1' },
      { name: 'bodyConditionScore', render: () => <BodyConditionField record={record} draft={draft.values} /> },
      { name: 'hydration', label: 'Hydration', type: 'select', options: ['Normal', 'Mild dehydration', 'Moderate dehydration', 'Severe dehydration'] },
      ] },
      { name: 'soap', title: 'Clinical observations', description: 'Subjective history, objective findings, assessment, and care plan.', fields: [
      ...['subjective', 'objective', 'assessment', 'plan'].map((name) => ({ name, label: name.charAt(0).toUpperCase() + name.slice(1), type: 'textarea' })),
      { name: 'clinicalNotes', label: 'Clinical notes', type: 'textarea', maxLength: 10000, span: true },
      ] },
      { name: 'followup', title: 'Diagnosis & follow-up', description: 'Save the diagnosis and arrange any next checkup.', fields: [
      { name: 'diagnosis', label: 'Diagnosis', span: true },
      { name: 'followUpDate', render: () => <DateWordsField name="followUpDate" label="Follow-up date" initial={initial.followUpDate || ''} hint="Optional. This date appears in the appointment calendar." /> },
      ] },
    ]} /></div>
    {completion && <form aria-busy={completing} onSubmit={(event) => event.preventDefault()}>
      {completionError && <p className="auth-message auth-error" role="alert">{completionError}</p>}
      <p>Choose Complete Checkup to finish without a prescription, or Add Prescription to enter medications. Cancelling the prescription keeps the checkup In progress.</p>
      <fieldset className="record-fieldset" disabled={completing}><div className="form-actions">
        <button ref={completionCancel} type="button" className="button button-secondary" onClick={() => { setCompletion(null); setCompletionError('') }}>Cancel</button>
        <button type="button" className="button button-secondary" onClick={() => complete(true)}>Add Prescription</button>
        <button type="button" className="button button-primary" onClick={() => complete(false)}>{completing ? 'Completing...' : 'Complete Checkup'}</button>
      </div></fieldset>
    </form>}
  </Modal>
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

export function PrescriptionEditor({ pet, record, visitId, completingCheckup, onClose }) {
  const { visits, execute, timezone, inventory, today } = useClinicData()
  const emptyMedication = () => ({ key: crypto.randomUUID(), medicationId: crypto.randomUUID(), medicationName: '', dose: '', route: '', frequency: '', duration: '', instructions: '' })
  const [medications, setMedications] = useState(() => record ? prescriptionMedications(record).map((medication) => ({ ...emptyMedication(), ...medication })) : [emptyMedication()])
  const changeMedication = (key, values) => setMedications((current) => current.map((item) => item.key === key ? { ...item, ...values } : item))
  const dispensedIds = new Set(record ? prescriptionMedications(record).filter((item) => item.inventoryItemId).map((item) => item.medicationId) : [])
  const openVisits = visits.filter((visit) => visit.petId === pet.id && !visit.finalizedAt)
  return <Modal title={record ? 'Edit prescription' : `Add prescription for ${pet.name}`} description="Add all medications to one prescription. Printed documents use your clinic settings and the prescriber's professional details." wide onClose={onClose}>
    <AsyncForm onClose={onClose} submitLabel="Save prescription" onSave={(values) => {
      const items = medications.map((medication) => Object.fromEntries(['medicationName', 'dose', 'route', 'frequency', 'duration', 'instructions'].map((field) => [field, field === 'medicationName' && medication.inventoryItemId ? medication[field] : (medication[field] || '').trim()])))
      items.forEach((item, index) => {
        const medication = medications[index]
        item.medicationId = medication.medicationId
        if (medication.inventoryItemId) Object.assign(item, { inventoryItemId: medication.inventoryItemId, batchId: medication.batchId, dispenseQuantity: Number(medication.dispenseQuantity), dispenseUnit: medication.dispenseUnit })
      })
      return execute(completingCheckup ? 'prescribe_and_complete_checkup' : record ? 'update_prescription' : 'create_prescription', { ...values, ...items[0], medications: items, ...(visitId ? { visitId } : {}), ...(record ? { id: record.id } : {}), ...(completingCheckup ? { checkup: completingCheckup } : {}) })
    }}>
      {!record && <Field label="Open encounter" required><select name="visitId" required disabled={Boolean(visitId)} defaultValue={visitId || (openVisits.length === 1 ? openVisits[0].id : '')}>
        {visitId && !openVisits.some((visit) => visit.id === visitId) && <option value={visitId}>Current checkup for {pet.name}</option>}
        <option value="">Select an open encounter</option>{openVisits.map((visit) => <option key={visit.id} value={visit.id}>{visit.type} · {clinicDate(new Date(visit.visitedAt), timezone)}</option>)}
      </select></Field>}
      {completingCheckup && <p className="auth-message">Saving this prescription completes the checkup. Cancel to leave care In progress.</p>}
      {!record && !visitId && !openVisits.length && <p className="auth-message">Record an open checkup before adding a prescription.</p>}
      <div className="prescription-medications">{medications.map((medication, index) => {
        const locked = dispensedIds.has(medication.medicationId)
        const item = inventory.find((item) => item.id === medication.inventoryItemId)
        const batches = prescriptionInventoryBatches(item, today)
        const batch = item?.batches.find((batch) => batch.id === medication.batchId)
        return <fieldset className="medication-editor" key={medication.key}>
        <legend>Medication {index + 1}</legend>
        <div className="form-grid">
          <PrescriptionMedicationPicker medication={medication} index={index} inventory={inventory} today={today} locked={locked} onChange={(values) => changeMedication(medication.key, values)} />
          <Field label="Route" required><Combobox label={`Route ${index + 1}`} value={medication.route || ''} options={prescriptionRoutes} allowCustom required onChange={(route) => changeMedication(medication.key, { route })} placeholder="Select or enter route" /></Field>
          {medication.inventoryItemId && <>
            <Field label="Stock batch" required>
              <select aria-label={`Stock batch ${index + 1}`} value={medication.batchId || ''} required disabled={locked} onChange={(event) => changeMedication(medication.key, { batchId: event.target.value })}>
                <option value="">Select an available batch</option>
                {locked ? <option value={medication.batchId}>{batch?.lot_number || 'Recorded batch'} · already dispensed</option> : batches.map((entry) => <option key={entry.id} value={entry.id}>{entry.lot_number || 'Unnumbered batch'} · {entry.quantity} {item.unit} · {entry.expiration_date ? `expires ${entry.expiration_date}` : 'no expiry'}</option>)}
              </select>
            </Field>
            <Field label={`Dispensing quantity (${medication.dispenseUnit || item?.unit || 'units'})`} required hint={locked ? 'Previously deducted from stock.' : 'Deducted when the prescription is saved; separate from the prescribed dose.'}>
              <input aria-label={`Dispensing quantity ${index + 1}`} type="number" required readOnly={locked} min={item?.allowsFraction ? '0.01' : '1'} step={item?.allowsFraction ? '0.01' : '1'} max={locked ? undefined : batch?.quantity} value={medication.dispenseQuantity ?? ''} onChange={(event) => changeMedication(medication.key, { dispenseQuantity: event.target.value })} />
            </Field>
            {!locked && !batches.length && <p className="auth-message field-span">No available, unexpired batches. Choose another item or use a custom medication.</p>}
            {item?.notes && <p className="inventory-item-notes field-span">Inventory notes: {item.notes}</p>}
          </>}
          {[
          { name: 'dose', label: 'Dose', required: true },
          { name: 'frequency', label: 'Frequency', required: true },
          { name: 'duration', label: 'Duration', placeholder: 'e.g. 7 days' },
          { name: 'instructions', label: 'Instructions', textarea: true, span: true },
        ].map(({ name, label, required, span, textarea, placeholder }) => {
          const props = { value: medication[name], required, placeholder, 'aria-label': `${label} ${index + 1}`, onChange: (event) => setMedications((current) => current.map((item) => item.key === medication.key ? { ...item, [name]: event.target.value } : item)) }
          return <Field key={name} label={label} required={required} span={span}>{textarea ? <textarea {...props} rows={2} /> : <input {...props} />}</Field>
        })}</div>
        {medications.length > 1 && !locked && <button type="button" className="text-link danger-text" aria-label={`Remove medication ${index + 1}`} onClick={() => setMedications((current) => current.filter((item) => item.key !== medication.key))}>Remove medication</button>}
      </fieldset>})}</div>
      <button type="button" className="button button-secondary" onClick={() => setMedications((current) => [...current, emptyMedication()])}>Add medication</button>
    </AsyncForm>
  </Modal>
}
