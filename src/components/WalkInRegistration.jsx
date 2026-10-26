import { useEffect, useRef, useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { AsyncForm, RecordEditor } from './RecordForm'
import { OwnerEditor, PetEditor } from './PatientEditors'
import { Field, Modal } from './ui'
import Combobox from './Combobox'

export default function WalkInRegistration({ onClose }) {
  const { owners, pets, services, profiles, execute } = useClinicData()
  const [step, setStep] = useState(1)
  const [ownerMode, setOwnerMode] = useState('existing')
  const [petMode, setPetMode] = useState('existing')
  const [ownerId, setOwnerId] = useState('')
  const [petId, setPetId] = useState('')
  const flow = useRef(null)
  useEffect(() => {
    const controls = flow.current?.querySelector(`[data-walkin-step="${step}"]`)?.querySelectorAll('input:not([type="hidden"]), select, textarea, button') || []
    ;[...controls].find((control) => !control.matches(':disabled') && control.getClientRects().length)?.focus()
  }, [step])
  const owner = owners.find((entry) => entry.id === ownerId)
  const pet = pets.find((entry) => entry.id === petId)
  const selectOwner = (id) => { if (id !== ownerId) setPetId(''); setOwnerId(id) }
  const availablePets = pets.filter((entry) => entry.ownerId === ownerId && entry.status === 'Active')
  return <Modal title="Add walk-in" description="Choose or register the owner, then the pet, before recording the arrival." wide onClose={onClose}>
    <div ref={flow}>
    <ol className="walkin-steps">{['Owner', 'Pet', 'Arrival'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol>
    <div data-walkin-step="1" hidden={step !== 1}>
      <div className="segmented-control"><button type="button" className={ownerMode === 'existing' ? 'active' : ''} onClick={() => setOwnerMode('existing')}>Existing owner</button><button type="button" className={ownerMode === 'new' ? 'active' : ''} onClick={() => setOwnerMode('new')}>Register owner</button></div>
      <div hidden={ownerMode !== 'existing'}><AsyncForm submitLabel="Continue to pet" onSave={() => { if (!owner?.isActive) throw new Error('Select an active owner.'); setStep(2) }}>
        <Field label="Owner" required><Combobox label="Walk-in owner" value={ownerId} onChange={selectOwner} required options={owners.filter((entry) => entry.isActive).map((entry) => ({ value: entry.id, label: entry.fullName, detail: [entry.phone, entry.email].filter(Boolean).join(' · ') }))} placeholder="Search name, phone or email" /></Field>
      </AsyncForm></div>
      <div hidden={ownerMode !== 'new'}><OwnerEditor embedded onSaved={(saved) => { selectOwner(saved.id); setOwnerMode('existing'); setStep(2) }} /></div>
    </div>
    <div data-walkin-step="2" hidden={step !== 2}>
      <p>Owner: <strong>{owner?.fullName}</strong> · {owner?.phone}</p>
      <div className="segmented-control"><button type="button" className={petMode === 'existing' ? 'active' : ''} onClick={() => setPetMode('existing')}>Existing pet</button><button type="button" className={petMode === 'new' ? 'active' : ''} onClick={() => setPetMode('new')}>Register pet</button></div>
      <div hidden={petMode !== 'existing'}><AsyncForm submitLabel="Continue to arrival" onSave={() => { if (!availablePets.some((entry) => entry.id === petId)) throw new Error('Select a pet belonging to this owner.'); setStep(3) }}>
        <Field label="Patient" required><select aria-label="Walk-in patient" required value={petId} onChange={(event) => setPetId(event.target.value)}><option value="">Select an active patient</option>{availablePets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.recordNumber}</option>)}</select></Field>
        {!availablePets.length && <p>This owner has no active patients. Register their pet to continue.</p>}
      </AsyncForm></div>
      <div hidden={petMode !== 'new'}><PetEditor key={ownerId} initialOwnerId={ownerId} lockOwner embedded onSaved={(saved) => { setPetId(saved.id); setPetMode('existing'); setStep(3) }} /></div>
    </div>
    <div data-walkin-step="3" hidden={step !== 3}>
      <p><strong>{pet?.name}</strong> · {owner?.fullName} · {owner?.phone}</p>
      <RecordEditor embedded initial={{ serviceId: services.find((service) => service.name === 'Wellness check')?.id || services[0]?.id }} submitLabel="Add to queue"
        onSave={(values) => execute('add_queue_entry', { ...values, ownerId, petId })} onClose={onClose} fields={[
          { name: 'serviceId', label: 'Service', type: 'select', required: true, options: [{ value: '', label: 'Select service' }, ...services.map((entry) => ({ value: entry.id, label: entry.name }))] },
          { name: 'veterinarianId', label: 'Assigned veterinarian / staff', type: 'select', options: [{ value: '', label: 'Unassigned' }, ...profiles.filter((entry) => entry.is_active).map((entry) => ({ value: entry.id, label: entry.full_name }))] },
          { name: 'notes', label: 'Arrival notes', type: 'textarea', span: true },
        ]} />
    </div>
    {step > 1 && <button type="button" className="text-link walkin-back" onClick={(event) => { if (!event.currentTarget.closest('[role="dialog"]').querySelector('form[aria-busy="true"]')) setStep(step - 1) }}>Back to {step === 3 ? 'pet' : 'owner'}</button>}
    </div>
  </Modal>
}
