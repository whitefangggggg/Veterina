import { useRef, useState } from 'react'
export default function MutationForm({ onSubmit, children, className }) {
  const key = useRef(crypto.randomUUID())
  const busy = useRef(false)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (busy.current) return
    busy.current=true; setSaving(true); setError('')
    try { await onSubmit({ preventDefault:()=>{}, idempotencyKey:key.current }); key.current=crypto.randomUUID() }
    catch (e) { setError(e.message || 'Could not save. Please retry.') }
    finally { busy.current=false; setSaving(false) }
  }
  return <form onSubmit={submit} className={className}>
    {error && <p role="alert" className="form-error">{error}</p>}
    {saving && <p role="status">Saving…</p>}
    <fieldset disabled={saving} className="mutation-fields">{children}</fieldset>
  </form>
}
