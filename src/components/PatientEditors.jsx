import { useRef, useState } from 'react'
import { DeleteRecordDialog, RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { Field } from './ui'
import { birthDateFromAge } from '../utils/clinicRules'
import Combobox from './Combobox'
import PetPhotoField from './PetPhotoField'
import { petPhotoRequest } from '../lib/petPhotos'

export function OwnerEditor({ record, onClose, embedded = false, onSaved }) {
  const { execute, owners } = useClinicData()
  const [phone, setPhone] = useState(record?.phone || '')
  const normalized = phone.replace(/[^0-9]/g, '').replace(/^63/, '0')
  const duplicate = normalized.length > 7 ? owners.find((owner) => owner.id !== record?.id && (owner.normalizedPhone || owner.phone).replace(/[^0-9]/g, '').replace(/^63/, '0') === normalized) : null
  return <RecordEditor title={record ? 'Edit pet owner' : 'Add pet owner'} onClose={onClose} initial={record} embedded={embedded}
    onSave={async (values) => { const saved = await execute(record ? 'update_owner' : 'create_owner', { ...values, ...(record ? { id: record.id } : {}) }); onSaved?.(saved); return saved }}
    submitLabel="Save owner" fields={[
      { name: 'fullName', label: 'Full name', required: true, maxLength: 120, span: true },
      { name: 'phone', label: 'Mobile number', required: true, type: 'tel', placeholder: '09XX XXX XXXX or +63...', onChange: (event) => setPhone(event.target.value), hint: duplicate ? `An existing owner shares this phone: ${duplicate.fullName}. Check the owner directory before creating another record.` : 'Use a Philippine mobile number or an international number starting with +.' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Home address', type: 'textarea', required: true, span: true },
      { name: 'emergencyContact', label: 'Emergency contact', span: true },
      { name: 'notes', label: 'Notes', type: 'textarea', span: true },
      ...(record ? [{ name: 'isActive', label: 'Status', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }] : []),
    ]} />
}

export function PetEditor({ record, onClose, initialOwnerId = '', embedded = false, onSaved, lockOwner = false }) {
  const { owners, execute, today, reload } = useClinicData()
  const [ownerId, setOwnerId] = useState(record?.ownerId || initialOwnerId)
  const [photo, setPhoto] = useState({ file: null, remove: false, requestId: crypto.randomUUID() })
  const savedRecord = useRef(null)
  const [registered, setRegistered] = useState(false)
  const [birthMode, setBirthMode] = useState(record?.birthDateEstimated ? 'preserve' : 'date')
  const [birthDate, setBirthDate] = useState(record?.birthDate || '')
  const [ageYears, setAgeYears] = useState('')
  const [ageMonths, setAgeMonths] = useState('')
  const estimated = birthDateFromAge(today, ageYears, ageMonths)
  return <RecordEditor title={record ? 'Edit patient' : 'Register a new patient'} onClose={onClose} embedded={embedded}
    initial={record ? { ...record, latestWeight: record.baseline_weight } : { ownerId, species: 'Dog', sex: '', reproductiveStatus: 'Unknown' }}
    onSave={async (values) => {
      if (!savedRecord.current) {
        savedRecord.current = await execute(record ? 'update_pet' : 'create_pet', { ...values, ownerId, ...(record ? { id: record.id } : {}) })
        setRegistered(true)
      }
      if (photo.file) await petPhotoRequest({ petId: savedRecord.current.id, requestId: photo.requestId, expectedRevision: record?.photo_revision || 0 }, photo.file)
      else if (photo.remove) await petPhotoRequest({ action: 'remove', petId: savedRecord.current.id, expectedRevision: record?.photo_revision || 0 })
      await reload()
      onSaved?.(savedRecord.current)
      return savedRecord.current
    }}
    submitLabel={registered ? 'Retry photo' : record ? 'Save patient' : 'Register patient'} fields={[
      { name: 'photo', render: () => <PetPhotoField pet={record} value={photo} onChange={setPhoto} disabled={registered} /> },
      ...(registered ? [{ name: 'photoRecovery', render: () => <div className="field-span auth-message" role="status">The patient record is saved. Retry the photo or continue without changing it. <button type="button" className="text-link" onClick={async () => { await reload(); onSaved?.(savedRecord.current); onClose?.() }}>Continue without photo</button></div> }] : []),
      { name: 'name', label: 'Pet name', required: true, maxLength: 120 },
      { name: 'ownerId', render: () => <Field label="Owner" required><Combobox name="ownerId" label="Owner" value={ownerId} onChange={setOwnerId} required disabled={registered || lockOwner}
        options={owners.filter((owner) => owner.isActive || owner.id === record?.ownerId).map((owner) => ({ value: owner.id, label: owner.fullName, detail: [owner.phone, owner.email].filter(Boolean).join(' · ') }))} placeholder="Search owner name, phone or email" /></Field> },
      { name: 'species', label: 'Species', type: 'select', options: ['Dog', 'Cat', 'Bird', 'Rabbit', 'Other'] },
      { name: 'breed', label: 'Breed', required: true },
      { name: 'sex', label: 'Sex', type: 'select', required: true, options: [{ value: '', label: record?.sex === 'Unknown' ? 'Previously Unknown — select sex' : 'Select sex' }, 'Male', 'Female'] },
      { name: 'reproductiveStatus', label: 'Reproductive status', type: 'select', options: ['Intact', 'Neutered', 'Spayed', 'Unknown'] },
      { name: 'birthInformation', render: () => <>
        <Field label="Birth information"><select aria-label="Birth information" name="birthMode" value={birthMode} onChange={(event) => setBirthMode(event.target.value)}>
          {record?.birthDateEstimated && <option value="preserve">Keep estimated birth date</option>}
          <option value="date">Birth date</option><option value="age">Enter age</option>
        </select></Field>
        {birthMode === 'age' ? <>
          <Field label="Age in years"><input name="ageYears" type="number" min="0" step="1" value={ageYears} onChange={(event) => setAgeYears(event.target.value)} /></Field>
          <Field label="Additional months"><input name="ageMonths" type="number" min="0" max="11" step="1" value={ageMonths} onChange={(event) => setAgeMonths(event.target.value)} /></Field>
          <p className="full" role="status">{estimated ? `Estimated birth date: ${estimated} (based on ${today})` : 'Enter years or months to calculate an estimated birth date.'}</p>
        </> : <Field label={birthMode === 'preserve' ? 'Estimated birth date' : 'Birth date'}><input name="birthDate" type="date" max={today} readOnly={birthMode === 'preserve'} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></Field>}
      </> },
      { name: 'latestWeight', label: 'Baseline weight (kg)', type: 'number', min: '0.01', step: '0.01' },
      { name: 'color', label: 'Color / markings' },
      { name: 'environment', label: 'Environment', type: 'select', options: [{ value: '', label: 'Not recorded' }, 'Indoor', 'Outdoor', 'Indoor & outdoor'] },
      { name: 'diet', label: 'Diet / feeding notes', type: 'textarea', span: true },
      { name: 'microchip', label: 'Microchip number', pattern: '[0-9]{15}', hint: '15 digits, or leave blank.' },
      ...(record ? [{ name: 'status', label: 'Patient status', type: 'select', options: ['Active', 'Inactive', 'Deceased'] }] : [{ name: 'allergies', label: 'Known allergies', span: true }]),
    ].map((field) => field.render ? field : { ...field, disabled: registered })} />
}

export function OwnerDirectory() {
  const { owners } = useClinicData()
  const { profile } = useAuth()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const filtered = owners.filter((owner) => [owner.fullName, owner.phone, owner.normalizedPhone, owner.email].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())))
  return <details className="section-card owner-directory"><summary>Owner directory · {owners.length} owners</summary>
    <input className="directory-search" aria-label="Search owners" placeholder="Search owner name, email or phone" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="record-directory">{filtered.map((owner) => <article className="directory-card" key={owner.id}>
      <div><h3>{owner.fullName}</h3><p>{owner.phone} · {owner.email || 'No email'}</p><p>{owner.address}</p><small>{owner.pets.length} linked patients · {owner.isActive ? 'Active' : 'Inactive'}</small></div>
      <div className="record-actions"><button className="button button-secondary small-button" onClick={() => setModal({ type: 'edit', record: owner })}>Edit owner</button>{profile.role === 'owner' && <button className="button button-secondary small-button danger-text" onClick={() => setModal({ type: 'delete', record: owner })}>Delete owner</button>}</div>
    </article>)}</div>
    {!filtered.length && <p className="empty-inline">No matching owners. Add an owner to start the patient registry.</p>}
    {modal?.type === 'edit' && <OwnerEditor record={modal.record} onClose={() => setModal(null)} />}
    {modal?.type === 'delete' && <DeleteRecordDialog entity="owner" record={modal.record} onClose={() => setModal(null)} />}
  </details>
}
