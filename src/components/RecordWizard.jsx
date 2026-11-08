import { useEffect, useRef } from 'react'
import { Check } from '@phosphor-icons/react'
import './RecordWizard.css'

export function RecordStepper({ steps, current, onNavigate, available = current, busy = false }) {
  const active = useRef(null)
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [current])
  return <nav className="record-stepper" aria-label="Record progress"><ol>{steps.map((step, index) => <li key={step.id} className={index === current ? 'is-current' : index < current ? 'is-complete' : ''}>
    <button ref={index === current ? active : undefined} type="button" data-record-nav={step.id} aria-current={index === current ? 'step' : undefined} disabled={busy || index > available} onClick={() => onNavigate(index)}>
      <span className="record-step-number" aria-hidden="true">{index < current ? <Check size={13} weight="bold" /> : index + 1}</span><span>{step.label}</span>
    </button>
  </li>)}</ol></nav>
}

export function RecordReview({ groups, onEdit }) {
  return <><h3 data-step-heading tabIndex={-1}>Review your record</h3><p className="record-step-description">Check the details below. You can go back to any step before saving.</p>
    <div className="record-review">{groups.map((group, index) => <section key={group.id}><header><h4>{group.label}</h4><button type="button" className="text-link" onClick={() => onEdit(index)}>Edit {group.label}</button></header>
      {group.fields.length ? <dl>{group.fields.map((field, i) => <div key={i}><dt>{field.label.replace(/\s*\*\s*$/, '')}</dt><dd>{field.value}</dd></div>)}</dl> : <p>No additional details entered.</p>}
    </section>)}</div></>
}
