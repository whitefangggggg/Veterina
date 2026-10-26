import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Field, Modal } from './ui'
import { useClinicData } from '../context/ClinicDataContext'

export function AsyncForm({ onSave, onSaveDraft, onClose, children, submitLabel = 'Save changes', className, submitActions = [] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitter = useRef(null)
  useEffect(() => {
    if (error && !busy) submitter.current?.focus()
  }, [error, busy])
  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    submitter.current = event.nativeEvent.submitter
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const saveDraft = event.nativeEvent.submitter?.value === 'draft'
    setBusy(true)
    setError('')
    try {
      const result = await (saveDraft ? onSaveDraft : onSave)(values, { intent: event.nativeEvent.submitter?.value })
      if (result !== false) onClose?.()
    }
    catch (error) { setError(error.message || 'Unable to save. Please try again.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className={className} aria-busy={busy}>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <fieldset disabled={busy} className="record-fieldset">{children}
      <div className="form-actions">{onClose && <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>}<button type="submit" className="button button-primary">{busy ? 'Saving...' : submitLabel}</button>{submitActions.map((action) => <button key={action.value} type="submit" value={action.value} className="button button-secondary">{action.label}</button>)}{onSaveDraft && <button type="submit" value="draft" formNoValidate className="button button-secondary">Save as draft</button>}</div>
    </fieldset>
  </form>
}

export function RecordEditor({ title, description, fields, initial = {}, onSave, onSaveDraft, onClose, submitLabel, submitActions, embedded = false, className }) {
  const sectionId = useId()
  const renderField = ({ name, label, type = 'text', options, required, hint, span, render, ...props }) => render ? <Fragment key={name}>{render()}</Fragment> : <Field key={name} label={label} required={required} hint={hint} span={span}>
    {type === 'select' ? <select name={name} defaultValue={initial[name] ?? ''} required={required} {...props}>
      {options.map((option) => <option key={typeof option === 'object' ? option.value : option} value={typeof option === 'object' ? option.value : option}>{typeof option === 'object' ? option.label : option}</option>)}
    </select> : type === 'textarea' ? <textarea name={name} defaultValue={initial[name] ?? ''} required={required} rows={3} {...props} />
      : <input name={name} type={type} defaultValue={initial[name] ?? ''} required={required} {...props} />}
  </Field>
  const grouped = fields.some((field) => field.fields)
  const content = <>
    <AsyncForm className={className} onSave={onSave} onSaveDraft={onSaveDraft} onClose={onClose} submitLabel={submitLabel} submitActions={submitActions}>
      <div className={grouped ? 'form-sections' : 'form-grid'}>
        {fields.map((field, index) => field.fields ? <section className="form-section" key={field.name} aria-labelledby={`${sectionId}-${field.name}`}>
          <header><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3 id={`${sectionId}-${field.name}`}>{field.title}</h3>{field.description && <p>{field.description}</p>}</div></header>
          <div className="form-grid">{field.fields.map(renderField)}</div>
        </section> : renderField(field))}
      </div>
    </AsyncForm>
  </>
  return embedded ? content : <Modal title={title} description={description} onClose={onClose} wide={grouped || fields.length > 7}>{content}</Modal>
}

export function DeleteRecordDialog({ entity, record, onClose, onDeleted }) {
  const { execute } = useClinicData()
  return <RecordEditor title={`Permanently delete ${record.name || record.fullName || record.title || 'record'}?`}
    description="This permanently removes the record and its linked history. This action is logged and cannot be undone."
    fields={[{ name: 'reason', label: 'Reason for deletion', type: 'textarea', required: true, span: true }]}
    onSave={async ({ reason }) => { await execute('delete_record', { entity, id: record.id, reason }); onDeleted?.() }}
    onClose={onClose} submitLabel="Permanently delete" />
}

export function ActionDialog({ title, description, action, data, fields = [], initial, onClose, submitLabel = 'Confirm' }) {
  const { execute } = useClinicData()
  return <RecordEditor title={title} description={description} fields={fields} initial={initial} onClose={onClose}
    onSave={(values) => execute(action, { ...data, ...values })} submitLabel={submitLabel} />
}
