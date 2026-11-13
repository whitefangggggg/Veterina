import { SelectField } from './VeterinaSelect'
import { useState } from 'react'
import { AsyncForm } from './RecordForm'
import { Field, Modal } from './ui'
import { ClinicianField } from './ClinicalFields'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { emptyPreventiveItem, preventivePayload } from '../lib/preventiveCare'
import { prescriptionInventoryBatches } from '../lib/prescriptions'
import PreventiveVitalsFields from './PreventiveVitalsFields'
import './PreventiveCare.css'

export default function PreventiveCareEditor({ pet, record: inputRecord, queueEntry, purpose, service, onSaved, onClose, embedded = false, wizard = false }) {
  const { preventiveCare, execute, profiles, inventory, today } = useClinicData()
  const { user, profile } = useAuth()
  const record = inputRecord?.items ? inputRecord : preventiveCare.find((group) => group.id === (inputRecord?.preventive_record_id || inputRecord?.id))
  const [draft] = useState(() => ({ ...queueEntry?.careDraft }))
  const historical = (record?.recordingPurpose || purpose) === 'record_only'
  const [vitals, setVitals] = useState(() => ({ weightKg: '', temperatureC: '', heartRate: '', respiratoryRate: '', bodyConditionScore: '', hydration: '', ...(record?.vitals || {}), ...(draft.vitals || {}) }))
  const [kind, setKind] = useState(record?.kind || draft.kind || 'vaccination')
  const [items, setItems] = useState(() => {
    const initial = draft.kind === 'deworming' ? [draft.deworming] : draft.vaccines || (Object.keys(draft).length && !draft.kind ? [{ ...record?.items[0], ...draft }] : null)
    return (initial || record?.items || [emptyPreventiveItem()]).map((item) => ({ ...emptyPreventiveItem(), ...item, dose: item.dose || '', dispenseQuantity: item.dispenseQuantity ?? '', nextDueAt: item.nextDueAt || '' }))
  })
  const [date, setDate] = useState(draft.administeredAt ?? record?.administeredAt ?? (historical ? '' : today))
  const [clinician, setClinician] = useState({ id: queueEntry?.veterinarianId || draft.veterinarianId || record?.veterinarianId || (historical ? '' : user.id), name: draft.veterinarianName || record?.veterinarianName || '' })
  const change = (id, values) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...values } : item))
  const payload = () => preventivePayload({ kind, petId: pet.id, administeredAt: date, veterinarianId: clinician.id, veterinarianName: clinician.name,
    vitals,
    recordingPurpose: historical ? 'record_only' : 'queue', ...(record ? { id: record.id, version: record.version } : {}), ...(service ? { serviceId: service.id } : {}),
  }, items, historical)
  const save = async () => {
    const values = payload()
    const result = await execute(queueEntry ? 'complete_queue_entry' : record ? 'update_preventive_care' : 'create_preventive_care',
      queueEntry ? { id: queueEntry.id, record: values, draftVersion: queueEntry.draftVersion } : values)
    onSaved?.(result)
  }
  const details = <div className="form-grid">
        <Field label="Record type"><SelectField aria-label="Record type" disabled={Boolean(record)} value={kind} onChange={(event) => { setKind(event.target.value); setItems([emptyPreventiveItem()]) }}><option value="vaccination">Vaccination</option><option value="deworming">Deworming</option></SelectField></Field>
        <Field label="Date administered" required><input aria-label="Date administered" type="date" value={date} max={today} required onChange={(event) => setDate(event.target.value)} /></Field>
        {historical ? <ClinicianField label="Veterinarian" value={clinician} onChange={setClinician} profiles={profiles} /> : <Field label="Veterinarian" required><SelectField aria-label="Veterinarian" value={clinician.id} required disabled={Boolean(queueEntry)} onChange={(event) => setClinician({ id: event.target.value, name: '' })}><option value="">Select veterinarian</option>{profiles.filter((p) => p.is_active || p.id === clinician.id).map((p) => <option value={p.id} key={p.id}>{p.full_name}</option>)}</SelectField></Field>}
      </div>
  const itemEditors = items.map((item, index) => {
        const existing = record?.items.find((entry) => entry.id === item.id)
        const legacy = existing?.stockTracked === false
        const locked = Boolean(existing?.consumed)
        const product = inventory.find((entry) => entry.id === item.inventoryItemId)
        const category = kind === 'vaccination' ? 'Vaccines' : 'Medicine'
        const options = inventory.filter((entry) => entry.category === category && entry.isActive && (category !== 'Vaccines' || entry.brand?.trim()))
        const batches = prescriptionInventoryBatches(product, today)
        return <fieldset className="medication-editor" key={item.id}><legend>{kind === 'vaccination' ? `Vaccine ${index + 1}` : 'Deworming administration'}</legend>
          <div className="form-grid">
            {historical ? <>
              <Field label={kind === 'vaccination' ? 'Vaccine name' : 'Product name'} required span><input aria-label={`Product name ${index + 1}`} required maxLength={300} value={item.vaccine} onChange={(e) => change(item.id, { vaccine: e.target.value })} /></Field>
              <Field label="Brand"><input aria-label={`Brand ${index + 1}`} maxLength={300} value={item.brand || ''} onChange={(e) => change(item.id, { brand: e.target.value })} /></Field>
              <Field label="Batch / lot number"><input aria-label={`Batch / lot number ${index + 1}`} maxLength={200} value={item.lotNumber || ''} onChange={(e) => change(item.id, { lotNumber: e.target.value })} /></Field>
            </> : <>
              <Field label={kind === 'vaccination' ? 'Vaccine type' : 'Deworming product'} required={!legacy} span>
                <SelectField aria-label={`Inventory product ${index + 1}`} value={item.inventoryItemId} disabled={locked} required={!legacy} onChange={(e) => { const selected = inventory.find((p) => p.id === e.target.value); change(item.id, { inventoryItemId: e.target.value, vaccine: selected?.name || '', brand: selected?.brand || '', batchId: '', dispenseQuantity: '' }) }}>
                  <option value="">{legacy ? `Keep historical product: ${existing.vaccine}` : 'Select inventory product'}</option>
                  {existing?.inventoryItemId && !options.some((p) => p.id === existing.inventoryItemId) && <option value={existing.inventoryItemId}>{existing.vaccine} (saved product)</option>}
                  {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` · ${p.brand}` : ''}</option>)}
                </SelectField>
                {!options.length && !legacy && <small>Add an active {category === 'Vaccines' ? 'vaccine with a brand' : 'deworming medicine'} in Inventory first.</small>}
              </Field>
              <Field label="Brand"><input aria-label={`Brand ${index + 1}`} readOnly value={item.brand || product?.brand || ''} /></Field>
              {kind === 'vaccination' && <Field label="Lot number" required={!existing || Boolean(queueEntry)} hint="Copy from the vaccine label. This lot appears on travel certificates; stock is deducted from the selected batch."><input aria-label={`Lot number ${index + 1}`} maxLength={200} required={!existing || Boolean(queueEntry)} pattern={(!existing || queueEntry) ? '.*\\S.*' : undefined} value={item.lotNumber || ''} onChange={(event) => change(item.id, { lotNumber: event.target.value })} /></Field>}
              {!legacy && <>
                <Field label="Stock batch" required><SelectField aria-label={`Stock batch ${index + 1}`} value={item.batchId} disabled={locked} required onChange={(e) => change(item.id, { batchId: e.target.value })}>
                  <option value="">Select available batch</option>
                  {locked ? <option value={item.batchId}>{product?.batches?.find((batch) => batch.id === item.batchId)?.lot_number || 'Saved batch'} · already administered</option> : batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.lot_number || 'Unnumbered'} · {batch.quantity} {product.unit}{batch.expiration_date ? ` · expires ${batch.expiration_date}` : ''}</option>)}
                </SelectField></Field>
                <Field label={`Stock quantity (${item.dispenseUnit || product?.unit || 'units'})`} required hint="Inventory units to deduct; enter the clinical dose separately."><input aria-label={`Stock quantity ${index + 1}`} type="number" min={product?.allowsFraction ? '0.01' : '1'} step={product?.allowsFraction ? '0.01' : '1'} value={item.dispenseQuantity} required readOnly={locked} onChange={(e) => change(item.id, { dispenseQuantity: e.target.value })} /></Field>
              </>}
              {legacy && <p className="muted">Existing record: no retroactive stock deduction.</p>}
              {locked && <p className="muted">Already deducted. Use Inventory for stock corrections.</p>}
            </>}
            <Field label="Dose"><input aria-label={`Dose ${index + 1}`} maxLength={300} value={item.dose} onChange={(e) => change(item.id, { dose: e.target.value })} /></Field>
            <Field label="Next due date" hint={historical ? 'Historical information only; no live reminder.' : 'Optional; creates a linked reminder.'}><input aria-label={`Next due date ${index + 1}`} type="date" value={item.nextDueAt} min={date || undefined} onChange={(e) => change(item.id, { nextDueAt: e.target.value })} /></Field>
          </div>
          {kind === 'vaccination' && items.length > 1 && !locked && (!existing || profile.role === 'owner') && <button type="button" className="text-link danger-text" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>Remove vaccine {index + 1}</button>}
        </fieldset>
      })
  const addVaccine = kind === 'vaccination' && <button type="button" className="button button-secondary" disabled={items.length >= 50} onClick={() => setItems((current) => [...current, emptyPreventiveItem()])}>Add another vaccine</button>
  const vitalsFields = <PreventiveVitalsFields value={vitals} onChange={setVitals} />
  return <Modal title={`${record ? 'Edit' : 'Record'} ${kind === 'deworming' ? 'deworming' : 'vaccination'} for ${pet.name}`} wide onClose={onClose} embedded={embedded}
    description={historical ? 'Record past care without a queue entry, live reminder, or stock deduction.' : queueEntry ? `${queueEntry.queueNumber} · Complete care to deduct stock. Drafts do not deduct stock.` : record ? 'Consumed products, batches and stock quantities are fixed. Additional vaccines deduct stock once.' : 'Saving creates a waiting queue entry. Stock is deducted when care is completed.'}>
    <AsyncForm steps={wizard ? [{ id: 'details', label: 'Details', description: 'Choose the record type, administration date, and veterinarian.', content: details },
      { id: 'vitals', label: 'Vitals & condition', content: vitalsFields },
      ...itemEditors.map((editor, index) => ({ id: items[index].id, label: kind === 'vaccination' ? `Vaccine ${index + 1}` : 'Deworming', content: <div className="preventive-items">{editor}{addVaccine}</div> }))] : undefined} onClose={onClose} onSave={save} submitLabel={queueEntry ? 'Save and complete care' : historical ? 'Save historical record' : 'Save record'}
      onSaveDraft={queueEntry ? async () => { const { serviceId: _serviceId, ...values } = payload(); await execute('save_queue_draft', { id: queueEntry.id, record: values, draftVersion: queueEntry.draftVersion }) } : undefined}>
      {!wizard && <>{details}{vitalsFields}<div className="preventive-items">{itemEditors}</div>{addVaccine}</>}

    </AsyncForm>
  </Modal>
}
