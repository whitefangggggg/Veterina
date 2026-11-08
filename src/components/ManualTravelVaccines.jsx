import { Field } from './ui'
import { emptyManualTravelVaccination } from '../lib/manualTravelVaccinations'

export default function ManualTravelVaccines({ items, onChange, today, manualRabiesItemId, onRabiesChange, manualRabies }) {
  const update = (id, key, value) => onChange(items.map((item) => item.id === id ? { ...item, [key]: value } : item))
  return <section className="manual-travel-vaccines field-span" aria-labelledby="manual-vaccine-heading">
    <h3 id="manual-vaccine-heading">Manually entered vaccines</h3>
    <p className="muted">Issuing saves these vaccines in patient history as historical records. Previewing or cancelling saves nothing. No stock is deducted and no reminders are created.</p>
    {items.map((item, index) => <fieldset className="medication-editor" key={item.id}>
      <legend>Manual vaccine {index + 1}</legend>
      {manualRabies && <label className="manual-rabies-choice"><input type="radio" name="manualRabies" checked={manualRabiesItemId === item.id} onChange={() => onRabiesChange(item.id)} />Use as Anti-Rabies evidence</label>}
      <div className="form-grid">
        {[[ 'vaccine', 'Vaccine name', 300, true ], [ 'brand', 'Brand', 300 ], [ 'lotNumber', 'Lot number', 200, true ], [ 'dose', 'Dose', 300 ], [ 'veterinarianName', 'Administering veterinarian', 300 ]].map(([key, label, max, required]) => <Field label={label} key={key} required={required}><input aria-label={`Manual ${label.toLowerCase()} ${index + 1}`} maxLength={max} required={required} value={item[key]} onChange={(event) => update(item.id, key, event.target.value)} /></Field>)}
        <Field label="Administration date" required><input aria-label={`Manual administration date ${index + 1}`} type="date" required max={today} value={item.administeredAt} onChange={(event) => update(item.id, 'administeredAt', event.target.value)} /></Field>
        <Field label="Next due date" required={manualRabiesItemId === item.id} hint="Required for the selected Anti-Rabies vaccine; must cover certificate validity."><input aria-label={`Manual next due date ${index + 1}`} type="date" required={manualRabiesItemId === item.id} min={item.administeredAt || undefined} value={item.nextDueAt} onChange={(event) => update(item.id, 'nextDueAt', event.target.value)} /></Field>
        <Field label="Vaccine product expiration date"><input aria-label={`Manual product expiration ${index + 1}`} type="date" min={item.administeredAt || undefined} value={item.expirationDate} onChange={(event) => update(item.id, 'expirationDate', event.target.value)} /></Field>
      </div>
      <button type="button" className="text-link danger-text" onClick={() => { onChange(items.filter((entry) => entry.id !== item.id)); if (manualRabiesItemId === item.id) onRabiesChange('') }}>Remove manual vaccine {index + 1}</button>
    </fieldset>)}
    <button type="button" className="button button-secondary" disabled={items.length >= 50} onClick={() => onChange([...items, emptyManualTravelVaccination()])}>Add vaccine details</button>
  </section>
}
