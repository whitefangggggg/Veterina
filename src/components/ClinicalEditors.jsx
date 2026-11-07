import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ClockCounterClockwise, Stethoscope, Syringe } from '@phosphor-icons/react'
import { AsyncForm, RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { clinicDate, clinicTime, clinicTimestamp } from '../lib/clinicRepository'
import { Field, Modal } from './ui'
import { prescriptionInventoryBatches, prescriptionMedications } from '../lib/prescriptions'
import PrescriptionMedicationPicker from './PrescriptionMedicationPicker'
import { checkupReasons, ClinicianField, emptyMedication, HistoricalPrescriptionFields, MedicationDetailsFields, medicationPayload } from './ClinicalFields'
import DateWordsField from './DateWordsField'
import PreventiveCareEditor from './PreventiveCareEditor'
import { format, parseISO } from 'date-fns'

export function VisitEditor(props) {
  const [purpose, setPurpose] = useState(props.purpose || null)
  if (props.record || props.queueEntry || purpose) return <CheckupEditor {...props} purpose={props.record?.recordingPurpose || purpose || 'queue'} />
  return <RecordingPurpose pet={props.pet} kind="checkup" onSelect={setPurpose} onClose={props.onClose} />
}

export function RecordingPurpose({ pet, kind, onSelect, onClose, onBack }) {
  return <Modal title={`Record ${kind} for ${pet.name}`} description={`Choose how to record this ${kind}.`} onClose={onClose}>
    <div className="checkup-purpose-choices">
      <button type="button" className="checkup-purpose-card" onClick={() => onSelect('queue')}>
        <span className="checkup-purpose-icon" aria-hidden="true">{kind.toLowerCase() === 'vaccination' ? <Syringe size={26} weight="duotone" /> : <Stethoscope size={26} weight="duotone" />}</span>
        <span className="checkup-purpose-copy"><strong>Queue processing</strong><span>For a patient receiving care at the clinic now.</span><small>Joins the care queue</small></span>
        <ArrowRight className="checkup-purpose-arrow" size={20} aria-hidden="true" />
      </button>
      <button type="button" className="checkup-purpose-card checkup-purpose-history" onClick={() => onSelect('record_only')}>
        <span className="checkup-purpose-icon" aria-hidden="true"><ClockCounterClockwise size={26} weight="duotone" /></span>
        <span className="checkup-purpose-copy"><strong>Record-keeping only</strong><span>For previous care or records you’re migrating.</span><small>Saves to history · No queue or live reminders</small></span>
        <ArrowRight className="checkup-purpose-arrow" size={20} aria-hidden="true" />
      </button>
    </div>
    {onBack && <button type="button" className="text-link walkin-back" onClick={onBack}>Change service</button>}
  </Modal>
}

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

function CheckupEditor({ pet, record, queueEntry, onSaved, onClose, purpose, service }) {
  const { execute, profiles, timezone, queueEntries } = useClinicData()
  const recordOnly = purpose === 'record_only'
  const { user, profile } = useAuth()
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
  const canComplete = !recordOnly && (!record || ['waiting', 'in_progress'].includes(careQueue?.status))
  const activeCheckup = queueEntries.find((entry) => entry.petId === pet.id && entry.category === 'checkup' && ['waiting', 'in_progress'].includes(entry.status))
  const initial = { type: service?.name === 'Follow-up' ? 'Follow-up Checkup' : ['Surgery', 'Sick visit'].includes(service?.name) ? 'Medical Concern' : 'Wellness Check', hydration: recordOnly ? '' : 'Normal', weightKg: recordOnly ? '' : pet.latestWeight,
    veterinarianId: recordOnly ? '' : activeCheckup?.veterinarianId || (profile.role === 'clinical_staff' ? '' : user.id), ...record,
    encounteredAt: clinicDate(careTime, timezone) + 'T' + clinicTime(careTime, timezone), ...draft.values }
  const [clinician, setClinician] = useState(() => ({ id: initial.veterinarianId || '', name: initial.veterinarianName ?? record?.attending_veterinarian_name ?? '' }))
  const [historicalMedications, setHistoricalMedications] = useState([])
  const [selectedCareTime, setSelectedCareTime] = useState(initial.encounteredAt)
  const assignedStaffId = careQueue?.veterinarianId || (!recordOnly && activeCheckup?.veterinarianId) || clinician.id || user.id
  const payloadFor = (values) => ({ ...values, petId: pet.id, ...(service ? { serviceId: service.id } : {}), recordingPurpose: purpose, ...(record ? { id: record.id } : {}),
    ...(recordOnly && historicalMedications.length ? { prescription: { medications: historicalMedications.map(medicationPayload),
      prescribedAt: clinicTimestamp(values.historicalPrescribedAt.slice(0, 10), values.historicalPrescribedAt.slice(11, 16), timezone),
      prescribedById: values.historicalPrescribedById, prescribedByName: values.historicalPrescribedByName } } : {}),
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
  return <Modal wide={!completion} title={completion ? 'Complete this checkup?' : record ? `Edit checkup for ${pet.name}` : `Record checkup for ${pet.name}`} description={completion ? `Finish ${pet.name}'s checkup with or without a prescription. Care stays in progress until you save the prescription or choose Complete Checkup.` : recordOnly ? 'Record-keeping only. Save previous care without joining the queue or creating live reminders.' : queueEntry ? `${queueEntry.queueNumber} · ${format(parseISO(queueEntry.queueDate), 'MMMM d, yyyy')}. Save unfinished care as a draft, or complete this checkup.` : record ? 'Clinical notes, vitals and any follow-up reminder are saved together.' : 'Save this checkup to add the patient to the queue, or complete the checkup now.'}
    onClose={() => { if (completion) { setCompletion(null); setCompletionError('') } else onClose() }}>
    <div hidden={Boolean(completion)}><RecordEditor embedded className="checkup-form"
    onClose={onClose} initial={initial} submitLabel={recordOnly ? 'Save historical checkup' : queueEntry ? 'Complete Checkup' : 'Save clinical entry'}
    submitActions={canComplete && !queueEntry ? [{ value: 'complete', label: 'Complete Checkup' }] : []}
    onSaveDraft={queueEntry ? (values) => execute('save_queue_draft', { id: queueEntry.id, record: values, draftVersion: draft.version }) : undefined}
    onSave={async (values, { intent }) => {
      if (queueEntry || intent === 'complete') { setCompletion(values); setCompletionError(''); return false }
      const payload = payloadFor(values)
      const saved = await execute(queueEntry ? 'complete_queue_entry' : record ? 'update_encounter' : recordOnly ? 'create_record_only_checkup' : 'create_queued_encounter', queueEntry ? { id: queueEntry.id, record: payload, draftVersion: draft.version } : payload)
      onSaved?.(saved)
      return saved
    }}
    fields={[
      { name: 'visit', title: 'Visit details', description: 'When the care took place, who is attending, and the reason for the visit.', ...sectionEditing('visit'), fields: [
      ...(service ? [{ name: 'service', render: () => <Field label="Service"><input aria-label="Service" readOnly value={service.name} /></Field> }] : []),
      { name: 'type', label: 'Reason for Checkup', type: 'select', required: true, options: [...checkupReasons, ...(record && !checkupReasons.includes(initial.type) ? [initial.type] : [])] },
      { name: 'veterinarianId', render: () => <ClinicianField value={clinician} onChange={setClinician} profiles={profiles} required={!recordOnly} /> },
      ...(!recordOnly ? [{ name: 'assignedStaffId', render: () => <Field label="Assigned staff" hint="Queue responsibility is assigned to this staff account."><input aria-label="Assigned staff" readOnly value={profiles.find((entry) => entry.id === assignedStaffId)?.full_name || 'Clinic staff'} /><input type="hidden" name="assignedStaffId" value={assignedStaffId} /></Field> }] : []),
      { name: 'encounteredAt', render: () => <DateWordsField name="encounteredAt" label={`Time of care (${timezone})`} initial={initial.encounteredAt} includeTime required onChange={setSelectedCareTime} /> },
      { name: 'complaint', label: 'Chief complaint', type: 'textarea', required: true, span: true },
      ] },
      { name: 'vitals', title: 'Vitals & condition', description: 'Record measurements taken during this checkup.', ...sectionEditing('vitals'), fields: [
      { name: 'weightKg', label: 'Weight (kg)', type: 'number', min: '0.01', step: '0.01', required: !recordOnly },
      { name: 'temperatureC', label: 'Temperature (°C)', type: 'number', min: '30', max: '45', step: '0.1' },
      { name: 'heartRate', label: 'Heart rate (bpm)', type: 'number', min: '1', step: '1' },
      { name: 'respiratoryRate', label: 'Respiratory rate', type: 'number', min: '1', step: '1' },
      { name: 'bodyConditionScore', render: () => <BodyConditionField record={record} draft={draft.values} /> },
      { name: 'hydration', label: 'Hydration', type: 'select', options: [...(recordOnly ? [''] : []), 'Normal', 'Mild dehydration', 'Moderate dehydration', 'Severe dehydration'] },
      ] },
      { name: 'soap', title: 'Clinical observations', description: 'Subjective history, objective findings, assessment, and care plan.', hidden: !recordOnly && careQueue?.status !== 'in_progress', fields: [
      ...['subjective', 'objective', 'assessment', 'plan'].map((name) => ({ name, label: name.charAt(0).toUpperCase() + name.slice(1), type: 'textarea' })),
      { name: 'clinicalNotes', label: 'Clinical notes', type: 'textarea', maxLength: 10000, span: true },
      ] },
      { name: 'followup', title: 'Diagnosis & follow-up', description: recordOnly ? 'Record the original diagnosis and follow-up plan.' : 'Save the diagnosis and arrange any next checkup.', hidden: !recordOnly && careQueue?.status !== 'in_progress', fields: [
      { name: 'diagnosis', label: 'Diagnosis', span: true },
      { name: 'followUpDate', render: () => <DateWordsField name="followUpDate" label="Follow-up date" initial={initial.followUpDate || ''} hint={recordOnly ? 'Historical information only. No live reminder is created.' : 'Optional. This date appears in the appointment calendar.'} /> },
      ] },
      ...(recordOnly && !record ? [{ name: 'historicalPrescription', title: 'Historical prescription', description: 'Optionally record medicines from the original checkup.', fields: [
        { name: 'historicalMedications', render: () => historicalMedications.length ? <div className="field-span"><HistoricalPrescriptionFields medications={historicalMedications} setMedications={setHistoricalMedications} clinician={clinician} profiles={profiles} careTime={selectedCareTime} prefix="historical" /><button type="button" className="text-link danger-text" onClick={() => setHistoricalMedications([])}>Remove historical prescription</button></div> : <button type="button" className="button button-secondary" onClick={() => setHistoricalMedications([emptyMedication()])}>Add historical prescription</button> },
      ] }] : []),
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

export function VaccineEditor(props) {
  const [purpose, setPurpose] = useState(props.purpose || null)
  const mode = props.record ? props.record.recordingPurpose || 'queue' : props.queueEntry ? 'queue' : purpose
  if (!mode) return <RecordingPurpose pet={props.pet} kind="Vaccinations and Deworming" onSelect={setPurpose} onClose={props.onClose} />
  return <PreventiveCareEditor {...props} purpose={mode} />
}

export function PrescriptionEditor({ pet, record, visitId, completingCheckup, onClose }) {
  const { visits, execute, timezone, inventory, today, profiles } = useClinicData()
  const [medications, setMedications] = useState(() => record ? prescriptionMedications(record).map((medication) => ({ ...emptyMedication(), ...medication })) : [emptyMedication()])
  const changeMedication = (key, values) => setMedications((current) => current.map((item) => item.key === key ? { ...item, ...values } : item))
  const dispensedIds = new Set(record ? prescriptionMedications(record).filter((item) => item.inventoryItemId).map((item) => item.medicationId) : [])
  const openVisits = visits.filter((visit) => visit.petId === pet.id && !visit.finalizedAt)
  const [selectedVisitId, setSelectedVisitId] = useState(record?.visit_id || visitId || (openVisits.length === 1 ? openVisits[0].id : ''))
  const selectedVisit = visits.find((visit) => visit.id === selectedVisitId)
  const historical = selectedVisit?.recordingPurpose === 'record_only' || record?.is_historical === true
  const historicalClinician = { id: record ? record.prescribed_by || '' : selectedVisit?.veterinarianId || '', name: record ? record.prescribed_by_name || '' : selectedVisit?.attending_veterinarian_name || '' }
  return <Modal title={record ? 'Edit prescription' : `Add prescription for ${pet.name}`} description="Add all medications to one prescription. Printed documents use your clinic settings and the prescriber's professional details." wide onClose={onClose}>
    <AsyncForm onClose={onClose} submitLabel="Save prescription" onSave={(values) => {
      const items = medications.map((medication) => Object.fromEntries(['medicationName', 'dose', 'route', 'frequency', 'duration', 'instructions'].map((field) => [field, field === 'medicationName' && medication.inventoryItemId ? medication[field] : (medication[field] || '').trim()])))
      items.forEach((item, index) => {
        const medication = medications[index]
        item.medicationId = medication.medicationId
        if (medication.inventoryItemId) Object.assign(item, { inventoryItemId: medication.inventoryItemId, batchId: medication.batchId, dispenseQuantity: Number(medication.dispenseQuantity), dispenseUnit: medication.dispenseUnit })
      })
      if (historical) Object.assign(values, { prescribedAt: clinicTimestamp(values.prescribedAt.slice(0, 10), values.prescribedAt.slice(11, 16), timezone) })
      return execute(completingCheckup ? 'prescribe_and_complete_checkup' : record ? 'update_prescription' : 'create_prescription', { ...values, ...items[0], medications: items, ...(visitId ? { visitId } : {}), ...(record ? { id: record.id } : {}), ...(completingCheckup ? { checkup: completingCheckup } : {}) })
    }}>
      {!record && <Field label="Open encounter" required><select name="visitId" required disabled={Boolean(visitId)} value={selectedVisitId} onChange={(event) => { const next = event.target.value; if (historical !== (visits.find((visit) => visit.id === next)?.recordingPurpose === 'record_only')) setMedications([emptyMedication()]); setSelectedVisitId(next) }}>
        {visitId && !openVisits.some((visit) => visit.id === visitId) && <option value={visitId}>Current checkup for {pet.name}</option>}
        <option value="">Select an open encounter</option>{openVisits.map((visit) => <option key={visit.id} value={visit.id}>{visit.type} · {clinicDate(new Date(visit.visitedAt), timezone)}</option>)}
      </select></Field>}
      {completingCheckup && <p className="auth-message">Saving this prescription completes the checkup. Cancel to leave care In progress.</p>}
      {!record && !visitId && !openVisits.length && <p className="auth-message">Record an open checkup before adding a prescription.</p>}
      {historical ? <HistoricalPrescriptionFields medications={medications} setMedications={setMedications} clinician={historicalClinician} profiles={profiles} careTime={record ? clinicDate(new Date(record.prescribed_at), timezone) + 'T' + clinicTime(record.prescribed_at, timezone) : selectedVisit?.visitedAt ? clinicDate(new Date(selectedVisit.visitedAt), timezone) + 'T' + clinicTime(selectedVisit.visitedAt, timezone) : ''} /> : <>
      <div className="prescription-medications">{medications.map((medication, index) => {
        const locked = dispensedIds.has(medication.medicationId)
        const item = inventory.find((item) => item.id === medication.inventoryItemId)
        const batches = prescriptionInventoryBatches(item, today)
        const batch = item?.batches.find((batch) => batch.id === medication.batchId)
        return <fieldset className="medication-editor" key={medication.key}>
        <legend>Medication {index + 1}</legend>
        <div className="form-grid">
          <PrescriptionMedicationPicker medication={medication} index={index} inventory={inventory} today={today} locked={locked} onChange={(values) => changeMedication(medication.key, values)} />
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
          <MedicationDetailsFields medication={medication} index={index} onChange={(values) => changeMedication(medication.key, values)} /></div>
        {medications.length > 1 && !locked && <button type="button" className="text-link danger-text" aria-label={`Remove medication ${index + 1}`} onClick={() => setMedications((current) => current.filter((item) => item.key !== medication.key))}>Remove medication</button>}
      </fieldset>})}</div>
      <button type="button" className="button button-secondary" onClick={() => setMedications((current) => [...current, emptyMedication()])}>Add medication</button></>}
    </AsyncForm>
  </Modal>
}
