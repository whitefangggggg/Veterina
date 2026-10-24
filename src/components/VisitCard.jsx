import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useClinicData } from '../context/ClinicDataContext'

export default function VisitCard({ visit, children }) {
  const { execute } = useClinicData()
  const [draft, setDraft] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const color = draft === undefined ? visit.cardColor : draft
  const changed = color !== visit.cardColor
  const date = parseISO(visit.visitedAt)
  const pickerId = `visit-color-${visit.id}`

  const save = async (nextColor) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await execute('set_visit_card_color', { id: visit.id, cardColor: nextColor })
      setDraft(undefined)
      setMessage(nextColor ? 'Color saved' : 'Color reset')
    } catch (error) {
      setError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return <article className="visit-card section-card" id={visit.id} style={color ? { '--visit-card-color': color } : undefined}>
    <div className="visit-date">
      <span>{format(date, 'MMM')}</span>
      <strong>{format(date, 'dd')}</strong>
      <small>{format(date, 'yyyy')}</small>
    </div>
    <div className="visit-content">
      <div className="visit-color-controls" role="group" aria-label={`Card color for ${visit.type} checkup from ${format(date, 'd MMM yyyy, h:mm a')}`}>
        <label htmlFor={pickerId}>Card color</label>
        <input id={pickerId} type="color" value={color || '#ffffff'} disabled={saving} onChange={(event) => { setDraft(event.target.value); setError(''); setMessage('') }} />
        <button type="button" className="text-link" disabled={saving || !changed} onClick={() => save(color)}>{saving ? 'Saving…' : 'Save color'}</button>
        <button type="button" className="text-link" disabled={saving || !color && !visit.cardColor} onClick={() => save(null)}>Reset color</button>
        <span role="status">{message}</span>
      </div>
      {error && <p className="auth-message auth-error visit-color-error" role="alert">Color could not be saved. {error}</p>}
      {children}
    </div>
  </article>
}
