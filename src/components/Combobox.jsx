import { useEffect, useId, useRef, useState } from 'react'

export default function Combobox({ label, name, value = '', onChange, options, required = false, allowCustom = false, disabled = false, placeholder }) {
  const id = useId()
  const input = useRef(null)
  const list = useRef(null)
  const lastValue = useRef(value)
  const selected = options.find((option) => option.value === value)
  const [query, setQuery] = useState(selected?.label || (allowCustom ? value : ''))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value
      setQuery(selected?.label || (allowCustom ? value : ''))
    }
  }, [value, selected?.label, allowCustom])
  useEffect(() => { input.current?.setCustomValidity(required && !allowCustom && !selected ? 'Select an existing record from the list.' : '') }, [required, allowCustom, selected])
  useEffect(() => { if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  const matches = options.filter((option) => `${option.label} ${option.detail || ''} ${option.searchText || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const choices = allowCustom && query.trim() && !matches.some((option) => option.value === query.trim()) ? [...matches, { value: query.trim(), label: `Use: ${query.trim()}` }] : matches
  const select = (option) => {
    if (!option) return
    lastValue.current = option.value
    setQuery(options.find((entry) => entry.value === option.value)?.label || option.value)
    onChange(option.value); setOpen(false)
  }
  return <div className="medication-combobox">
    {name && <input type="hidden" name={name} value={value} />}
    <input ref={input} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={id}
      aria-activedescendant={open && choices.length ? `${id}-${Math.min(active, choices.length - 1)}` : undefined}
      autoComplete="off" placeholder={placeholder} value={query} required={required} disabled={disabled}
      onFocus={() => { setActive(0); setOpen(true) }} onBlur={() => setOpen(false)}
      onChange={(event) => { const next = allowCustom ? event.target.value : ''; lastValue.current = next; setQuery(event.target.value); onChange(next); setActive(0); setOpen(true) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); setOpen(true)
          setActive((current) => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, choices.length - 1) : !open ? 0 : Math.max(0, Math.min(choices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
        }
        if (event.key === 'Enter' && open) { event.preventDefault(); select(choices[Math.min(active, choices.length - 1)]) }
      }} />
    {open && !disabled && <div className="medication-options" ref={list} id={id} role="listbox" aria-label={`${label} options`}>
      {!choices.length && <p role="presentation">No matching records.</p>}
      {choices.map((option, index) => <button type="button" role="option" tabIndex={-1} key={option.value} id={`${id}-${index}`} aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(option)}><strong>{option.label}</strong>{option.detail && <span>{option.detail}</span>}</button>)}
    </div>}
  </div>
}
