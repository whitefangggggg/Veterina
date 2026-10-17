import { Fragment, useState } from 'react'
import { Field, Modal } from './ui'
import { useClinicData } from '../context/ClinicDataContext'

export function AsyncForm({ onSave, onClose, children, submitLabel = 'Save changes', className }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    try { await onSave(values); onClose?.() }
    catch (error) { setError(error.message || 'Unable to save. Please try again.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className={className} aria-busy={busy}>
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
    <fieldset disabled={busy} className="record-fieldset">{children}
      <div className="form-actions">{onClose && <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>}<button type="submit" className="button button-primary">{busy ? 'Saving...' : submitLabel}</button></div>
    </fieldset>
  </form>
}

export function RecordEditor({ title, description, fields, initial = {}, onSave, onClose, submitLabel }) {
  return <Modal title={title} description={description} onClose={onClose} wide={fields.length > 7}>
    <AsyncForm onSave={onSave} onClose={onClose} submitLabel={submitLabel}>
      <div className="form-grid">
        {fields.map(({ name, label, type = 'text', options, required, hint, span, render, ...props }) => render ? <Fragment key={name}>{render()}</Fragment> : <Field key={name} label={label} required={required} hint={hint} span={span}>
          {type === 'select' ? <select name={name} defaultValue={initial[name] ?? ''} required={required} {...props}>
            {options.map((option) => <option key={typeof option === 'object' ? option.value : option} value={typeof option === 'object' ? option.value : option}>{typeof option === 'object' ? option.label : option}</option>)}
          </select> : type === 'textarea' ? <textarea name={name} defaultValue={initial[name] ?? ''} required={required} rows={3} {...props} />
            : <input name={name} type={type} defaultValue={initial[name] ?? ''} required={required} {...props} />}
        </Field>)}
      </div>
    </AsyncForm>
  </Modal>
}

export function DeleteRecordDialog({ entity, record, onClose, onDeleted }) {
  const { execute } = useClinicData()
  return <RecordEditor title={`Permanently delete ${record.name || record.fullName || record.title || 'record'}?`}
    description="This permanently removes the record and its linked history. This action is logged and cannot be undone."
    fields={[{ name: 'reason', label: 'Reason for deletion', type: 'textarea', required: true, span: true }]}
    onSave={async ({ reason }) => { await execute('delete_record', { entity, id: record.id, reason }); onDeleted?.() }}
    onClose={onClose} submitLabel="Permanently delete" />
}

export function ActionDialog({ title, description, action, data, fields = [], initial, onClose }) {
  const { execute } = useClinicData()
  return <RecordEditor title={title} description={description} fields={fields} initial={initial} onClose={onClose}
    onSave={(values) => execute(action, { ...data, ...values })} submitLabel="Confirm" />
}
