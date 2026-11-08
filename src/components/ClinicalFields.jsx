/* oxlint-disable react/only-export-components */
import { useState } from 'react'
import { Field } from './ui'
import Combobox from './Combobox'

export const checkupReasons = ['Wellness Check', 'Routine Checkup', 'Follow-up Checkup', 'Medical Concern', 'Other']
const routes = ['Oral', 'Topical', 'Subcutaneous', 'Intramuscular', 'Intravenous', 'Ophthalmic', 'Otic', 'Intranasal', 'Rectal', 'Inhalation']
const frequencies = ['Once a day', 'Twice a day', 'Every 4 hours']
const durations = ['3 days', '5 days', '7 days', '14 days', '1 month']
const options = (values) => values.map((value) => ({ value, label: value }))

export function ClinicianField({ value, onChange, profiles, required = false, label = 'Attending veterinarian', idName = 'veterinarianId', textName = 'veterinarianName' }) {
  const choices = profiles.filter((profile) => profile.is_active || profile.id === value.id).map((profile) => ({ value: profile.id, label: profile.full_name || 'Clinic staff' }))
  // An archived clinician's saved name must remain visible even when their profile is no longer in the fetched list.
  if (value.id && !choices.some((option) => option.value === value.id)) choices.push({ value: value.id, label: value.name || 'Recorded clinician' })
  const missing = required && !value.id && !value.name.trim()
  return <div className="clinical-clinician-field">
    <input type="hidden" name={idName} value={value.id || ''} />
    <input type="hidden" name={textName} value={value.name || ''} />
    <Field label={label} required={required} hint={missing ? 'Select an attending veterinarian or enter a name' : undefined}>
      <Combobox label={label} value={value.id || value.name} options={choices} allowCustom required={required} placeholder="Search staff or enter a name"
        inputProps={{ className: 'veterinarian-select', 'aria-invalid': missing || undefined }}
        onChange={(next, { option }) => onChange(option ? { id: option.value, name: option.label } : { id: '', name: next })} />
    </Field>
  </div>
}

export const emptyMedication = () => ({ key: crypto.randomUUID(), medicationId: crypto.randomUUID(), medicationName: '', dose: '', route: '', frequency: '', duration: '', instructions: '' })
export const medicationPayload = (medication) => ({ medicationId: medication.medicationId, ...Object.fromEntries(['medicationName', 'dose', 'route', 'frequency', 'duration', 'instructions'].map((field) => [field, (medication[field] || '').trim()])) })

export function MedicationDetailsFields({ medication, index, historical = false, onChange }) {
  return <>{[
    { name: 'dose', label: 'Dose', required: !historical },
    { name: 'route', label: 'Route', required: !historical, choices: routes },
    { name: 'frequency', label: 'Frequency', required: !historical, choices: frequencies },
    { name: 'duration', label: 'Duration', choices: durations },
    { name: 'instructions', label: 'Instructions', textarea: true },
  ].map(({ name, label, required, choices, textarea }) => <Field key={name} label={label} required={required} span={textarea}>
    {choices ? <Combobox label={`${label} ${index + 1}`} value={medication[name] || ''} options={options(choices)} allowCustom required={required} placeholder={`Select or enter ${label.toLowerCase()}`} onChange={(value) => onChange({ [name]: value })} />
      : textarea ? <textarea aria-label={`${label} ${index + 1}`} value={medication[name] || ''} rows={2} onChange={(event) => onChange({ [name]: event.target.value })} />
        : <input aria-label={`${label} ${index + 1}`} value={medication[name] || ''} required={required} onChange={(event) => onChange({ [name]: event.target.value })} />}
  </Field>)}</>
}

export function HistoricalPrescriptionFields({ medications, setMedications, clinician, profiles, careTime, prefix = '' }) {
  const [prescriberOverride, setPrescriberOverride] = useState(null)
  const [dateOverride, setDateOverride] = useState(null)
  const fieldName = (name) => prefix ? prefix + name.charAt(0).toUpperCase() + name.slice(1) : name
  return <>
    <div className="form-grid">
      <Field label="Prescription date" required><input name={fieldName('prescribedAt')} type="datetime-local" required value={dateOverride ?? careTime} onChange={(event) => setDateOverride(event.target.value)} /></Field>
      <ClinicianField label="Historical prescriber" idName={fieldName('prescribedById')} textName={fieldName('prescribedByName')} value={prescriberOverride ?? clinician} onChange={setPrescriberOverride} profiles={profiles} />
    </div>
    <p>Record past treatment. Unknown details may be left blank. Inventory is not deducted.</p>
    <div className="prescription-medications">{medications.map((medication, index) => {
      const change = (values) => setMedications((current) => current.map((item) => item.key === medication.key ? { ...item, ...values } : item))
      return <fieldset className="medication-editor" key={medication.key}><legend>Medication {index + 1}</legend><div className="form-grid">
        <Field label="Medication name" required><input aria-label={`Medication name ${index + 1}`} value={medication.medicationName} required onChange={(event) => change({ medicationName: event.target.value })} /></Field>
        <MedicationDetailsFields medication={medication} index={index} historical onChange={change} />
      </div>{medications.length > 1 && <button type="button" className="text-link danger-text" aria-label={`Remove medication ${index + 1}`} onClick={() => setMedications((current) => current.filter((item) => item.key !== medication.key))}>Remove medication</button>}</fieldset>
    })}</div>
    <button type="button" className="button button-secondary" onClick={() => setMedications((current) => [...current, emptyMedication()])}>Add medication</button>
  </>
}
