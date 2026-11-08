import { useEffect, useId, useRef, useState } from 'react'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react'

export default function Combobox({ label, name, value = '', onChange, options, required = false, allowCustom = false, disabled = false, placeholder, inputProps = {} }) {
  const id = useId()
  const input = useRef(null)
  const list = useRef(null)
  const lastValue = useRef(value)
  const selected = options.find((option) => option.value === value)
  const [query, setQuery] = useState(selected?.label || (allowCustom ? value : ''))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const { refs, floatingStyles } = useFloating({ open: open && !disabled, strategy: 'fixed', placement: 'bottom-start', whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply({ rects, availableHeight, availableWidth, elements }) {
      Object.assign(elements.floating.style, { width: `${Math.min(rects.reference.width, availableWidth)}px`, maxHeight: `${Math.min(260, availableHeight)}px` })
    } })],
  })
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value
      setQuery(selected?.label || (allowCustom ? value : ''))
    }
  }, [value, selected?.label, allowCustom])
  useEffect(() => { input.current?.setCustomValidity(required && !allowCustom && !selected ? 'Select an existing record from the list.' : '') }, [required, allowCustom, selected])
  useEffect(() => { if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  const matches = options.filter((option) => `${option.label} ${option.detail || ''} ${option.searchText || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const choices = allowCustom && query.trim() && !matches.some((option) => option.value === query.trim()) ? [...matches, { value: query.trim(), label: `Use: ${query.trim()}`, custom: true }] : matches
  const select = (option) => {
    if (!option) return
    lastValue.current = option.value
    setQuery(options.find((entry) => entry.value === option.value)?.label || option.value)
    onChange(option.value, { option: option.custom ? null : option }); setOpen(false)
  }
  return <div className="medication-combobox">
    {name && <input type="hidden" name={name} value={value} />}
    <input {...inputProps} ref={(node) => { input.current = node; refs.setReference(node) }} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open && choices.length ? `${id}-${Math.min(active, choices.length - 1)}` : undefined}
      autoComplete="off" placeholder={placeholder} value={query} required={required} disabled={disabled}
      onFocus={() => { setActive(0); setOpen(true) }} onBlur={() => setOpen(false)}
      onChange={(event) => { const next = allowCustom ? event.target.value : ''; lastValue.current = next; setQuery(event.target.value); onChange(next, { option: null }); setActive(0); setOpen(true) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); setOpen(true)
          setActive((current) => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, choices.length - 1) : !open ? 0 : Math.max(0, Math.min(choices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
        }
        if (event.key === 'Enter' && open) { event.preventDefault(); select(choices[Math.min(active, choices.length - 1)]) }
      }} />
    {open && !disabled && <div className="medication-options vt-combobox-options" style={floatingStyles} ref={(node) => { list.current = node; refs.setFloating(node) }} id={id} role="listbox" aria-label={`${label} options`}>
      {!choices.length && <p role="presentation">No matching records.</p>}
      {choices.map((option, index) => <button type="button" role="option" tabIndex={-1} key={option.value} id={`${id}-${index}`} aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(option)}><strong>{option.label}</strong>{option.detail && <span>{option.detail}</span>}</button>)}
    </div>}
  </div>
}
