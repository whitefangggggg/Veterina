import { useEffect, useId, useRef, useState } from 'react'
import { format, isValid, parse, parseISO } from 'date-fns'
import { DayPicker } from '@daypicker/react'
import { CalendarDots } from '@phosphor-icons/react'
import '@daypicker/react/style.css'

function readDate(text) {
  if (!text.trim()) return null
  const value = /^\d{4}-\d{2}-\d{2}(T|$)/.test(text) ? parseISO(text) : parse(text, 'MMMM d, yyyy', new Date())
  return isValid(value) ? value : null
}

export default function DateWordsField({ name, label, initial = '', required = false, includeTime = false, hint }) {
  const id = useId()
  const initialDate = readDate(initial)
  const [text, setText] = useState(initialDate ? format(initialDate, 'MMMM d, yyyy') : '')
  const [time, setTime] = useState(includeTime ? initial.slice(11, 16) : '')
  const [open, setOpen] = useState(false)
  const input = useRef(null)
  const container = useRef(null)
  const date = readDate(text)
  const value = date ? format(date, 'yyyy-MM-dd') + (includeTime ? time ? `T${time}` : '' : '') : ''
  useEffect(() => {
    if (!open) return
    const outside = (event) => { if (!container.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const change = (event) => {
    const next = event.target.value
    setText(next)
    if (includeTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(next)) setTime(next.slice(11, 16))
    event.target.setCustomValidity(next && !readDate(next) ? 'Enter a date such as May 9, 2026, or choose one from the calendar.' : '')
  }
  return <div className={`field date-words-field${includeTime ? ' field-span' : ''}`} ref={container} onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); input.current?.focus() } }}>
    <label htmlFor={id}>{label}{required && <b aria-hidden="true"> *</b>}</label>
    <input type="hidden" name={name} value={includeTime && !time ? '' : value} />
    <div className={`date-words-controls${includeTime ? ' with-time' : ''}`}>
      <div><input ref={input} id={id} type="text" aria-label={label} value={text} onChange={change} required={required} placeholder="May 9, 2026" autoComplete="off" aria-describedby={hint ? `${id}-hint` : undefined}
        onBlur={() => { if (date) setText(format(date, 'MMMM d, yyyy')) }} />
        <button type="button" className="icon-button" aria-label={includeTime ? 'Open care calendar' : 'Open follow-up calendar'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><CalendarDots size={20} /></button>
      </div>
      {includeTime && <input type="time" aria-label="Care time" value={time} required={required} onChange={(event) => setTime(event.target.value)} />}
    </div>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {open && <div className="date-words-popover" role="dialog" aria-label={`Choose ${label}`}><DayPicker mode="single" selected={date || undefined} defaultMonth={date || new Date()} captionLayout="dropdown" autoFocus
      startMonth={new Date(1900, 0)} endMonth={new Date(new Date().getFullYear() + 10, 11)} onSelect={(day) => {
        if (!day) return
        setText(format(day, 'MMMM d, yyyy')); input.current?.setCustomValidity(''); setOpen(false); input.current?.focus()
      }} />{!required && <button type="button" className="text-link" onClick={() => { setText(''); input.current?.setCustomValidity(''); setOpen(false); input.current?.focus() }}>Clear date</button>}</div>}
  </div>
}
