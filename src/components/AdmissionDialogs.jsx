import VeterinaSelect from './VeterinaSelect'
import VeterinaCheckbox from './VeterinaCheckbox'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bed, ClipboardText, Heartbeat } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { AsyncForm } from './RecordForm'
import { Field, Modal } from './ui'
import { admissionLocalTime, admissionSource, admissionTimestamp, clinicalConditions, observationValues, vitalLabels } from '../lib/admissions'

function FormHeading({ icon: Icon, title, description }) {
  return <div className="field-span admission-form-heading"><Icon size={23} weight="duotone" aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p></div></div>
}
export function AdmissionVitalsFields({ initial = {}, prefix = '' }) {
  return <>{Object.entries(vitalLabels).filter(([key]) => !['condition', 'hydration'].includes(key)).map(([key, label]) => <Field key={key} label={label}>
    <input name={`${prefix}${key}`} type="number" step={['weightKg', 'temperatureC'].includes(key) ? '0.01' : '1'} min={key === 'temperatureC' ? '30' : key === 'weightKg' ? '0.01' : '1'} max={key === 'temperatureC' ? '45' : key === 'bodyConditionScore' ? '9' : '10000'} defaultValue={initial[key] ?? ''} />
  </Field>)}<Field label="Hydration"><input name={`${prefix}hydration`} defaultValue={initial.hydration || ''} maxLength={200} /></Field></>
}
function HistoricalDetails({ observations, setObservations, medications, setMedications, now }) {
  const update = (setter, list, index, key, value) => setter(list.map((row, i) => i === index ? { ...row, [key]: value } : row))
  return <div className="field-span admission-historical">
    <h3>Historical care details</h3>
    {observations.map((row, i) => <fieldset key={row.key}><legend>Past observation {i + 1}</legend><div className="form-grid">
      <Field label={`Observation ${i + 1} time`} required><input type="datetime-local" value={row.occurredAt} onChange={(e) => update(setObservations, observations, i, 'occurredAt', e.target.value)} required /></Field>
      <Field label={`Observation ${i + 1} type`}><VeterinaSelect value={row.kind} onChange={(e) => update(setObservations, observations, i, 'kind', e)}><option value="note">Progress note</option><option value="vitals">Vitals</option><option value="condition">Condition</option></VeterinaSelect></Field>
      {row.kind === 'vitals' && Object.entries(vitalLabels).filter(([k]) => !['hydration', 'condition'].includes(k)).map(([k, label]) => <Field key={k} label={`${label} ${i + 1}`}><input type="number" step="any" min="0.01" value={row[k] || ''} onChange={(e) => update(setObservations, observations, i, k, e.target.value)} /></Field>)}
      {row.kind === 'condition' && <Field label={`Past condition ${i + 1}`}><VeterinaSelect value={row.condition} onChange={(e) => update(setObservations, observations, i, 'condition', e)}>{Object.entries(clinicalConditions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</VeterinaSelect></Field>}
      <Field label={`Observation ${i + 1} notes`} required={row.kind === 'note'} span><textarea value={row.note} onChange={(e) => update(setObservations, observations, i, 'note', e.target.value)} required={row.kind === 'note'} /></Field>
    </div><button type="button" className="text-link" onClick={() => setObservations(observations.filter((_, index) => index !== i))}>Remove observation {i + 1}</button></fieldset>)}
    <button type="button" className="button button-secondary" onClick={() => setObservations([...observations, { key: crypto.randomUUID(), kind: 'note', occurredAt: now, note: '', condition: 'stable' }])}>Add past observation</button>
    {medications.map((row, i) => <fieldset key={row.key}><legend>Historical medicine {i + 1}</legend><div className="form-grid">
      {['title', 'dose', 'route', 'frequency', 'duration', 'instructions'].map((key) => <Field key={key} label={`${key === 'title' ? 'Medicine' : key} ${i + 1}`} required={key === 'title'}><input value={row[key] || ''} onChange={(e) => update(setMedications, medications, i, key, e.target.value)} required={key === 'title'} /></Field>)}
    </div><button type="button" className="text-link" onClick={() => setMedications(medications.filter((_, index) => index !== i))}>Remove medicine {i + 1}</button></fieldset>)}
    <button type="button" className="button button-secondary" onClick={() => setMedications([...medications, { key: crypto.randomUUID(), title: '' }])}>Add historical medicine</button>
  </div>
}
export function AdmissionCreateDialog({ petId = '', onClose }) {
  const { pets, profiles, admissionUnits, admissionWards, timezone, execute } = useClinicData()
  const navigate = useNavigate()
  const [historical, setHistorical] = useState(false)
  const [observations, setObservations] = useState([])
  const [medications, setMedications] = useState([])
  const [now] = useState(() => admissionLocalTime(new Date().toISOString(), timezone))
  return <Modal className="admission-dialog" wide title={historical ? 'Record completed hospital stay' : 'Admit patient'} onClose={onClose} description={historical ? 'Past care only. No occupancy, tasks, reminders or inventory changes.' : 'Record the patient’s intake and attending veterinarian. Accommodation can be assigned later.'}>
    <AsyncForm onClose={onClose} submitLabel={historical ? 'Save historical stay' : 'Admit patient'} onSave={async (values) => {
      const payload = { petId: values.petId, reason: values.reason, condition: values.condition, admittedAt: admissionTimestamp(values.admittedAt, timezone), initialNotes: values.initialNotes,
        veterinarianId: values.veterinarianId || undefined, veterinarianName: values.veterinarianName || undefined, vitals: observationValues(values) }
      if (historical) Object.assign(payload, { dischargedAt: admissionTimestamp(values.dischargedAt, timezone), assessment: values.assessment, instructions: values.instructions, followUp: values.followUp,
        observations: observations.map((row) => ({ kind: row.kind, occurredAt: admissionTimestamp(row.occurredAt, timezone), note: row.note, values: row.kind === 'condition' ? { condition: row.condition } : row.kind === 'vitals' ? observationValues(row) : {} })),
        medications: medications.map(({ key: _key, ...row }) => row) })
      else if (values.unitId) payload.unitId = values.unitId
      const result = await execute(historical ? 'admission_historical_create' : 'admission_create', payload)
      navigate(admissionSource(result.id))
    }}>
      <div className="form-grid">
        <FormHeading icon={Bed} title="Patient & stay" description="Choose the patient, attending veterinarian and accommodation." />
        <Field label="Recording method"><VeterinaSelect value={historical ? 'historical' : 'live'} onChange={(e) => setHistorical(e === 'historical')}><option value="live">Current admission</option><option value="historical">Completed historical stay</option></VeterinaSelect></Field>
        <Field label="Patient" required><VeterinaSelect searchable name="petId" defaultValue={petId} required><option value="">Select patient</option>{pets.filter((p) => historical || p.status === 'Active').map((p) => <option key={p.id} value={p.id}>{p.name} · {p.recordNumber}</option>)}</VeterinaSelect></Field>
        <Field label="Admitted at" required hint={`Clinic time: ${timezone}`}><input type="datetime-local" name="admittedAt" defaultValue={now} max={now} required /></Field>
        <Field label="Clinical condition" required><VeterinaSelect name="condition" defaultValue="under_observation">{Object.entries(clinicalConditions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</VeterinaSelect></Field>
        <Field label="Attending veterinarian" required={!historical}><VeterinaSelect searchable name="veterinarianId" required={!historical}><option value="">{historical ? 'External / not recorded' : 'Select veterinarian'}</option>{profiles.filter((p) => p.is_active && p.is_veterinarian).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</VeterinaSelect></Field>
        {historical ? <><Field label="Historical veterinarian name"><input name="veterinarianName" maxLength={200} /></Field><Field label="Discharged at" required><input name="dischargedAt" type="datetime-local" defaultValue={now} max={now} required /></Field></> : <Field label="Accommodation"><VeterinaSelect searchable name="unitId"><option value="">Unassigned</option>{admissionUnits.filter((u) => u.is_active && u.state === 'available' && admissionWards.some((w) => w.id === u.ward_id && w.is_active)).map((u) => <option key={u.id} value={u.id}>{admissionWards.find((w) => w.id === u.ward_id)?.name} / {u.name}</option>)}</VeterinaSelect></Field>}
        <Field label="Reason for admission" required span><textarea name="reason" required maxLength={10000} /></Field>
        <FormHeading icon={Heartbeat} title="Intake observations" description="Add available measurements. You can continue monitoring throughout the stay." />
        <AdmissionVitalsFields />
        <Field label="Initial condition notes" span><textarea name="initialNotes" maxLength={10000} /></Field>
        {historical && <><HistoricalDetails {...{ observations, setObservations, medications, setMedications, now }} /><FormHeading icon={ClipboardText} title="Discharge record" description="Record the assessment and home care advice from this completed stay." /><Field label="Discharge assessment" span><textarea name="assessment" /></Field><Field label="Discharge instructions" span><textarea name="instructions" /></Field><Field label="Follow-up recommendation" span><textarea name="followUp" /></Field></>}
      </div>
    </AsyncForm>
  </Modal>
}

export function AdmissionActionDialog({ type, admission, data, target, onSave, onClose }) {
  // Polling must not silently rebase an open editor onto a newer record version.
  const [base] = useState(admission)
  const [kind, setKind] = useState(target?.kind || (type === 'note' ? 'note' : type === 'order' ? 'treatment' : 'vitals'))
  const { timezone, admissionUnits, admissionWards, inventory, profiles } = data
  const [now] = useState(() => admissionLocalTime(new Date().toISOString(), timezone))
  const order = type === 'task' ? target.order || data.orders.find((o) => o.id === target.order_id) : type === 'unscheduled' ? target : null
  const [outcome, setOutcome] = useState(order && order.status !== 'active' ? 'held' : 'given')
  const prescribed = type === 'revise' ? data.visits.find((v) => v.id === base.visit_id)?.prescriptions?.find((rx) => rx.id === target.prescription_id)?.medications?.find((m) => m.medicationId === target.medication_id) : null
  const [itemId, setItemId] = useState(type === 'revise' ? target?.inventory_item_id || '' : '')
  const item = inventory.find((i) => i.id === order?.inventory_item_id)
  const titles = { transfer: 'Assign or transfer accommodation', transition: 'Change admission status', discharge: 'Discharge patient', cancel: 'Cancel mistaken admission', observe: 'Record monitoring', note: 'Record progress note', correct: 'Append observation correction', correctCare: 'Append care correction', order: 'Add care order', revise: 'Revise care order', stop: 'Stop care order', task: 'Record care outcome', unscheduled: 'Record unscheduled care' }
  return <Modal className="admission-dialog" wide title={titles[type]} onClose={onClose}>
    <AsyncForm onClose={onClose} submitLabel={type === 'discharge' ? 'Authorize discharge' : 'Save'} onSave={async (values) => {
      let action, extra = {}
      if (type === 'transfer') { action = 'admission_transfer'; extra.unitId = values.unitId || null }
      if (type === 'transition') { action = 'admission_transition'; extra = { status: values.status, reason: values.reason } }
      if (['cancel', 'stop'].includes(type)) { action = type === 'cancel' ? 'admission_cancel' : 'admission_stop_order'; extra = { reason: values.reason, ...(target ? { orderId: target.id } : {}) } }
      if (type === 'discharge') { action = 'admission_discharge'; extra = { condition: values.condition, assessment: values.assessment, instructions: values.instructions, followUp: values.followUp, overdueReason: values.overdueReason, acknowledgeFutureTasks: values.acknowledgeFutureTasks === 'on' } }
      if (['observe', 'note', 'correct'].includes(type)) { action = type === 'correct' ? 'admission_correct' : 'admission_observe'; extra = { kind: type === 'correct' ? target.kind : kind, values: { ...observationValues(values), ...(values.condition ? { condition: values.condition } : {}) }, note: values.note, occurredAt: admissionTimestamp(values.occurredAt, timezone), ...(type === 'correct' ? { correctsId: target.id, reason: values.reason } : {}) } }
      if (type === 'correctCare') { action = 'admission_correct'; extra = { administrationId: target.id, reason: values.reason } }
      if (['order', 'revise'].includes(type)) { if (values.intervalHours && !values.endsAt) throw new Error('Choose a last due time for repeating care.'); action = type === 'revise' ? 'admission_revise_order' : 'admission_order'; extra = { kind, title: values.title, instructions: values.instructions, startsAt: admissionTimestamp(values.startsAt, timezone), endsAt: admissionTimestamp(values.endsAt, timezone), intervalHours: values.intervalHours ? Number(values.intervalHours) : undefined,
        ...(kind === 'medication' ? { dose: values.dose, route: values.route, frequency: values.frequency, duration: values.duration, inventoryItemId: itemId || undefined } : {}), ...(type === 'revise' ? { replacesOrderId: target.id, reason: values.reason } : {}) } }
      if (['task', 'unscheduled'].includes(type)) { action = type === 'task' ? 'admission_task' : 'admission_unscheduled'; extra = { outcome, reason: values.reason, occurredAt: admissionTimestamp(values.occurredAt, timezone), ...(type === 'task' ? { taskId: target.id, taskVersion: target.version } : { orderId: order?.id, title: values.title }),
        ...(outcome === 'delayed' ? { deferredUntil: admissionTimestamp(values.deferredUntil, timezone) } : {}), ...(item && outcome === 'given' ? { inventoryItemId: item.id, batchId: values.batchId, stockQuantity: Number(values.stockQuantity) } : {}) } }
      await onSave(action, { id: base.id, expectedVersion: base.version, ...extra })
    }}><div className="form-grid">
      {type === 'transfer' && <Field label="Accommodation"><VeterinaSelect searchable name="unitId"><option value="">Unassigned</option>{admissionUnits.filter((u) => u.is_active && u.state === 'available' && admissionWards.some((w) => w.id === u.ward_id && w.is_active)).map((u) => <option key={u.id} value={u.id}>{admissionWards.find((w) => w.id === u.ward_id)?.name} / {u.name}</option>)}</VeterinaSelect></Field>}
      {type === 'transition' && <Field label="New status"><VeterinaSelect name="status">{base.status === 'admitted' && <option value="under_treatment">Under Treatment</option>}{base.status !== 'ready_for_discharge' && <option value="ready_for_discharge">Ready for Discharge</option>}{base.status === 'ready_for_discharge' && <option value="under_treatment">Resume Under Treatment</option>}</VeterinaSelect></Field>}
      {['cancel', 'stop', 'correct', 'correctCare', 'revise'].includes(type) || type === 'transition' && base.status === 'ready_for_discharge' ? <Field label="Reason" required span><textarea name="reason" required maxLength={10000} /></Field> : null}
      {['observe', 'note', 'correct'].includes(type) && <>
        {type !== 'correct' && <Field label="Observation type"><VeterinaSelect value={kind} onChange={(e) => setKind(e)}><option value="vitals">Vitals</option><option value="condition">Condition update</option><option value="note">Progress note</option></VeterinaSelect></Field>}
        <Field label="Observed at" required hint={`Clinic time: ${timezone}`}><input type="datetime-local" name="occurredAt" defaultValue={target ? admissionLocalTime(target.occurred_at, timezone) : now} max={now} required /></Field>
        {['vitals', 'intake'].includes(type === 'correct' ? target.kind : kind) && <AdmissionVitalsFields initial={target?.values} />}
        {['condition', 'intake'].includes(type === 'correct' ? target.kind : kind) && <Field label="Clinical condition"><VeterinaSelect name="condition" defaultValue={target?.values?.condition || base.condition}>{Object.entries(clinicalConditions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</VeterinaSelect></Field>}
        <Field label="Notes" span required={(type === 'correct' ? target.kind : kind) === 'note'}><textarea name="note" defaultValue={target?.note || ''} required={(type === 'correct' ? target.kind : kind) === 'note'} maxLength={10000} /></Field>
      </>}
      {['order', 'revise'].includes(type) && <>
        <Field label="Care type"><VeterinaSelect value={kind} onChange={(e) => setKind(e)}><option value="vitals" disabled>Select care type</option><option value="treatment">Treatment / nursing care</option><option value="medication">Medication</option></VeterinaSelect></Field>
        <Field label="Care / medication name" required><input name="title" required maxLength={300} defaultValue={target?.title} /></Field>
        {kind === 'medication' && <><Field label="Prescribed dose" required><input name="dose" defaultValue={prescribed?.dose} required /></Field><Field label="Route" required><input name="route" defaultValue={prescribed?.route} required /></Field><Field label="Frequency" required><input name="frequency" defaultValue={prescribed?.frequency} required /></Field><Field label="Duration"><input name="duration" defaultValue={prescribed?.duration} /></Field>
          <Field label="Inventory item" hint="Stock is deducted only when a dose is recorded Given."><VeterinaSelect searchable value={itemId} onChange={(e) => setItemId(e)}><option value="">External / no clinic stock</option>{inventory.filter((i) => i.isActive).map((i) => <option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}</VeterinaSelect></Field></>}
        <Field label="First due at" required><input name="startsAt" type="datetime-local" defaultValue={now} required /></Field><Field label="Last due at" hint="Required for repeating care."><input name="endsAt" type="datetime-local" /></Field><Field label="Repeat every (hours)" hint="Leave blank for a single task. Maximum 1,000 tasks per order."><input name="intervalHours" type="number" min="0.25" max="8760" step="0.25" /></Field>
        <Field label="Instructions" span><textarea name="instructions" defaultValue={target?.instructions || ''} maxLength={10000} /></Field>
        <p className="field-span">Attending veterinarian: {profiles.find((p) => p.id === base.veterinarianId)?.full_name || base.veterinarianName}. The ordering staff member is recorded separately.</p>
      </>}
      {['task', 'unscheduled'].includes(type) && <>
        <p className="field-span">{order?.title || target?.title || 'Unscheduled care'}</p>
        {!order && <Field label="Care description" required><input name="title" required maxLength={300} /></Field>}
        <Field label="Outcome"><VeterinaSelect value={outcome} onChange={(e) => setOutcome(e)}><option value="given" disabled={order && order.status !== 'active'}>Given / performed</option><option value="held">Held</option><option value="missed">Missed</option>{type === 'task' && <option value="delayed" disabled={order && order.status !== 'active'}>Delayed</option>}</VeterinaSelect></Field>
        <Field label="Performed at" required><input name="occurredAt" type="datetime-local" defaultValue={now} max={now} required /></Field>
        {outcome === 'delayed' && <Field label="New due time" required><input name="deferredUntil" type="datetime-local" required /></Field>}
        <Field label="Reason / care notes" required={outcome !== 'given'} span><textarea name="reason" required={outcome !== 'given'} maxLength={10000} /></Field>
        {item && outcome === 'given' && <><Field label="Stock batch" required><VeterinaSelect searchable name="batchId" required><option value="">Select batch</option>{item.batches.filter((b) => b.is_active && b.quantity > 0 && (!b.expiration_date || b.expiration_date >= data.today)).map((b) => <option key={b.id} value={b.id}>{b.lot_number || b.batch_number || b.id} · {b.quantity} {item.unit}</option>)}</VeterinaSelect></Field><Field label={`Stock quantity (${item.unit})`} required hint="Separate from the prescribed dose."><input name="stockQuantity" type="number" min={item.allowsFraction ? '0.01' : '1'} step={item.allowsFraction ? '0.01' : '1'} required /></Field></>}
      </>}
      {type === 'discharge' && <>
        <Field label="Final clinical condition"><VeterinaSelect name="condition" defaultValue={base.condition}>{Object.entries(clinicalConditions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</VeterinaSelect></Field>
        <Field label="Discharge assessment" required span><textarea name="assessment" required maxLength={10000} /></Field><Field label="Discharge instructions" required span><textarea name="instructions" required maxLength={10000} /></Field><Field label="Follow-up recommendation" span><textarea name="followUp" maxLength={10000} /></Field>
        <Field label="Reason overdue tasks were missed" hint="Required if any care is overdue. Applied to each outstanding overdue task." span><textarea name="overdueReason" maxLength={10000} /></Field>
        <VeterinaCheckbox className="field-span admission-discharge-check" name="acknowledgeFutureTasks" label="I acknowledge that all remaining future tasks will be cancelled and accommodation will require cleaning." />
      </>}
    </div></AsyncForm>
  </Modal>
}
