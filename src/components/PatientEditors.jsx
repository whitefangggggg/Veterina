import { useState } from 'react'
import { DeleteRecordDialog, RecordEditor } from './RecordForm'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { Field } from './ui'
import { birthDateFromAge } from '../utils/clinicRules'

export function OwnerEditor({ record, onClose }) {
  const { execute, owners } = useClinicData()
  const [phone, setPhone] = useState(record?.phone || '')
  const normalized = phone.replace(/[^0-9]/g, '').replace(/^63/, '0')
  const duplicate = normalized.length > 7 ? owners.find((owner) => owner.id !== record?.id && (owner.normalizedPhone || owner.phone).replace(/[^0-9]/g, '').replace(/^63/, '0') === normalized) : null
  return <RecordEditor title={record ? 'Edit pet owner' : 'Add pet owner'} onClose={onClose} initial={record}
    onSave={(values) => execute(record ? 'update_owner' : 'create_owner', { ...values, ...(record ? { id: record.id } : {}) })}
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

export function PetEditor({ record, onClose }) {
  const { owners, execute, today } = useClinicData()
  const [birthMode, setBirthMode] = useState(record?.birthDateEstimated ? 'preserve' : 'date')
  const [birthDate, setBirthDate] = useState(record?.birthDate || '')
  const [ageYears, setAgeYears] = useState('')
  const [ageMonths, setAgeMonths] = useState('')
  const estimated = birthDateFromAge(today, ageYears, ageMonths)
  return <RecordEditor title={record ? 'Edit patient' : 'Register a new patient'} onClose={onClose}
    initial={record ? { ...record, latestWeight: record.baseline_weight } : { ownerId: owners.find((owner) => owner.isActive)?.id, species: 'Dog', sex: '', reproductiveStatus: 'Unknown' }}
    onSave={(values) => execute(record ? 'update_pet' : 'create_pet', { ...values, ...(record ? { id: record.id } : {}) })}
    submitLabel={record ? 'Save patient' : 'Register patient'} fields={[
      { name: 'name', label: 'Pet name', required: true, maxLength: 120 },
      { name: 'ownerId', label: 'Owner', type: 'select', required: true, options: [{ value: '', label: 'Choose owner' }, ...owners.filter((owner) => owner.isActive || owner.id === record?.ownerId).map((owner) => ({ value: owner.id, label: owner.fullName }))] },
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
      { name: 'diet', label: 'Diet / feeding notes', type: 'textarea', span: true },
      { name: 'microchip', label: 'Microchip number', pattern: '[0-9]{15}', hint: '15 digits, or leave blank.' },
      ...(record ? [{ name: 'status', label: 'Patient status', type: 'select', options: ['Active', 'Inactive', 'Deceased'] }] : [{ name: 'allergies', label: 'Known allergies', span: true }]),
    ]} />
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
