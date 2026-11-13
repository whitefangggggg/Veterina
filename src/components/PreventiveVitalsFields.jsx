import { Field } from './ui'
import { SelectField } from './VeterinaSelect'
import { hydrationOptions } from '../lib/clinicalOptions'

export default function PreventiveVitalsFields({ value, onChange }) {
  const set = (key, next) => onChange((current) => ({ ...current, [key]: next }))
  return <section className="preventive-vitals" aria-label="Vitals & condition">
    <header><h3>Vitals &amp; condition</h3><p>Record measurements taken during this checkup.</p></header>
    <div className="form-grid">
      <Field label="Weight (kg)"><input aria-label="Weight (kg)" type="number" min="0.0001" step="any" value={value.weightKg} onChange={(event) => set('weightKg', event.target.value)} /></Field>
      <Field label="Temperature (°C)"><input aria-label="Temperature (°C)" type="number" min="0.0001" step="any" value={value.temperatureC} onChange={(event) => set('temperatureC', event.target.value)} /></Field>
      <Field label="Heart rate (bpm)"><input aria-label="Heart rate (bpm)" type="number" min="1" step="1" value={value.heartRate} onChange={(event) => set('heartRate', event.target.value)} /></Field>
      <Field label="Respiratory rate (breaths/minute)"><input aria-label="Respiratory rate (breaths/minute)" type="number" min="1" step="1" value={value.respiratoryRate} onChange={(event) => set('respiratoryRate', event.target.value)} /></Field>
      <Field label="Body condition (1–5)"><SelectField aria-label="Body condition (1–5)" value={value.bodyConditionScore} onChange={(event) => set('bodyConditionScore', event.target.value)}>
        <option value="">Not recorded</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}
      </SelectField></Field>
      <Field label="Hydration"><SelectField aria-label="Hydration" value={value.hydration} onChange={(event) => set('hydration', event.target.value)}>
        <option value="">Not recorded</option>{hydrationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </SelectField></Field>
    </div>
  </section>
}
