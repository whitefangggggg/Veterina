import { SelectField } from './VeterinaSelect'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Field, Modal } from './ui'
import { useClinicData } from '../context/ClinicDataContext'
import { RecordReview, RecordStepper } from './RecordWizard'
import { useRecordWizard } from '../lib/useRecordWizard'

export function AsyncForm({ onSave, onSaveDraft, onClose, children, submitLabel = 'Save changes', className, submitActions = [], steps }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitter = useRef(null)
  const saving = useRef(false)
  const formRef = useRef(null)
  const wizard = useRecordWizard(steps, formRef, setError)
  useEffect(() => {
    if (error && !busy) submitter.current?.focus()
  }, [error, busy])
  const submit = async (event) => {
    event.preventDefault()
    if (saving.current) return
    const saveDraft = event.nativeEvent.submitter?.value === 'draft'
    if (!saveDraft && steps) {
      submitter.current = null
      if (wizard.index < steps.length) { wizard.next(); return }
      if (!wizard.validateAll()) return
    }
    submitter.current = event.nativeEvent.submitter
    const form = event.currentTarget
    const lockedSections = [...form.querySelectorAll('fieldset[data-readonly-section]:disabled')]
    let values
    // Disabled section controls stay visible but cannot be edited. Include their
    // current values in saves, including custom date and body-condition fields.
    try {
      lockedSections.forEach((section) => { section.disabled = false })
      if (!saveDraft) {
        const invalid = lockedSections.find((section) => [...section.elements].some((control) => !control.checkValidity()))
        if (invalid) {
          setError(`Check the required fields in ${invalid.dataset.readonlySection}. Click Edit to update this section.`)
          return
        }
      }
      values = Object.fromEntries(new FormData(form))
    } finally { lockedSections.forEach((section) => { section.disabled = true }) }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const result = await (saveDraft ? onSaveDraft : onSave)(values, { intent: event.nativeEvent.submitter?.value })
      if (result !== false) onClose?.()
    }
    catch (error) { setError(error.message || 'Unable to save. Please try again.') }
    finally { saving.current = false; setBusy(false) }
  }
  const reviewing = !steps || wizard.index === steps.length
  return <form ref={formRef} onSubmit={submit} noValidate={Boolean(steps)} className={`${className || ''}${steps ? ' record-wizard' : ''}`} aria-busy={busy}>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <p className="form-progress" role="status">{busy ? 'Saving changes. Keep this window open until the save finishes.' : ''}</p>
    <fieldset disabled={busy} className="record-fieldset">
      {steps && <><RecordStepper {...wizard.navigationProps} busy={busy} />{steps.map((step, index) => <section key={step.id} className="record-step-panel" data-record-step={step.id} hidden={wizard.index !== index} aria-label={step.label}>
        <h3 data-step-heading tabIndex={-1}>{step.label}</h3>{step.description && <p className="record-step-description">{step.description}</p>}{step.content}
      </section>)}<section className="record-step-panel" data-record-step="review" hidden={!reviewing}><RecordReview groups={wizard.review} onEdit={wizard.navigate} /></section></>}
      {children}
      <div className="form-actions">{onClose && <button type="button" className="button button-secondary record-cancel" onClick={onClose}>Cancel</button>}
        {steps && wizard.canGoBack && <button type="button" className="button button-secondary" onClick={wizard.back}>Back</button>}
        <button type="submit" className="button button-primary">{busy ? 'Saving...' : reviewing ? submitLabel : 'Next'}</button>
        {reviewing && submitActions.map((action) => <button key={action.value} type="submit" value={action.value} className="button button-secondary">{action.label}</button>)}{onSaveDraft && <button type="submit" value="draft" formNoValidate className="button button-secondary">Save as draft</button>}</div>
    </fieldset>
  </form>
}

export function RecordEditor({ title, description, fields, initial = {}, onSave, onSaveDraft, onClose, submitLabel, submitActions, embedded = false, className, wizard = false }) {
  const sectionId = useId()
  const renderField = ({ name, label, type = 'text', options, required, hint, span, render, ...props }) => render ? <Fragment key={name}>{render()}</Fragment> : <Field key={name} label={label} required={required} hint={hint} span={span}>
    {type === 'select' ? <SelectField name={name} defaultValue={initial[name] ?? ''} required={required} {...props}>
      {options.map((option) => <option key={typeof option === 'object' ? option.value : option} value={typeof option === 'object' ? option.value : option}>{typeof option === 'object' ? option.label : option}</option>)}
    </SelectField> : type === 'textarea' ? <textarea name={name} defaultValue={initial[name] ?? ''} required={required} rows={3} {...props} />
      : <input name={name} type={type} defaultValue={initial[name] ?? ''} required={required} {...props} />}
  </Field>
  const grouped = fields.some((field) => field.fields)
  const stepContent = (field) => <div className="form-grid">{field.fields ? field.fields.map(renderField) : renderField(field)}</div>
  const steps = wizard ? grouped ? fields.filter((field) => !field.hidden).map((field) => ({ id: field.name, label: field.title, shortLabel: ({ visit: 'Details', vitals: 'Vitals', soap: 'Notes', followup: 'Follow-up', historicalPrescription: 'Medicines' })[field.name], description: field.description,
    content: field.onToggleEdit ? <><button type="button" className="button button-secondary small-button" onClick={field.onToggleEdit}>{field.readOnly ? 'Edit' : 'Done'}</button><fieldset className="form-grid section-fields" disabled={field.readOnly} data-readonly-section={field.title}>{field.fields.map(renderField)}</fieldset></> : stepContent(field) }))
    : [{ id: 'details', label: 'Details', content: <div className="form-grid">{fields.map(renderField)}</div> }] : undefined
  const content = <>
    <AsyncForm className={className} onSave={onSave} onSaveDraft={onSaveDraft} onClose={onClose} submitLabel={submitLabel} submitActions={submitActions} steps={steps}>
      {wizard ? <div hidden>{fields.filter((field) => field.hidden).map((field) => <Fragment key={field.name}>{stepContent(field)}</Fragment>)}</div> : <div className={grouped ? 'form-sections' : 'form-grid'}>
        {fields.map((field, index) => field.fields ? <section className="form-section" key={field.name} hidden={field.hidden} aria-labelledby={`${sectionId}-${field.name}`}>
          <header><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3 id={`${sectionId}-${field.name}`}>{field.title}</h3>{field.description && <p>{field.description}</p>}</div>{field.onToggleEdit && <button type="button" className="button button-secondary small-button section-edit-button" onClick={field.onToggleEdit} aria-label={`${field.readOnly ? 'Edit' : 'Done editing'} ${field.title}`} aria-controls={`${sectionId}-${field.name}-fields`} aria-pressed={!field.readOnly}>{field.readOnly ? 'Edit' : 'Done'}</button>}</header>
          {field.onToggleEdit ? <fieldset id={`${sectionId}-${field.name}-fields`} className="form-grid section-fields" disabled={field.readOnly} data-readonly-section={field.title} aria-label={field.title}>{field.fields.map(renderField)}</fieldset> : <div className="form-grid">{field.fields.map(renderField)}</div>}
        </section> : renderField(field))}
      </div>}
    </AsyncForm>
  </>
  return embedded ? content : <Modal title={title} description={description} onClose={onClose} wide={grouped || fields.length > 7}>{content}</Modal>
}

export function DeleteRecordDialog({ entity, record, onClose, onDeleted }) {
  const { execute } = useClinicData()
  return <RecordEditor title={`Permanently delete ${record.name || record.fullName || record.title || 'record'}?`}
    description="This permanently removes the record and its linked history. This action is logged and cannot be undone."
    fields={[{ name: 'reason', label: 'Reason for deletion', type: 'textarea', required: true, span: true }]}
    onSave={async ({ reason }) => { await execute(entity === 'preventive' ? 'delete_preventive_care' : 'delete_record', { entity, id: record.id, reason }); onDeleted?.() }}
    onClose={onClose} submitLabel="Permanently delete" />
}

export function ActionDialog({ title, description, action, data, fields = [], initial, onClose, submitLabel = 'Confirm' }) {
  const { execute } = useClinicData()
  return <RecordEditor title={title} description={description} fields={fields} initial={initial} onClose={onClose}
    onSave={(values) => execute(action, { ...data, ...values })} submitLabel={submitLabel} />
}
