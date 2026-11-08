import { Children, isValidElement, useCallback, useId, useRef, useState } from 'react'
import { autoUpdate, flip, offset, shift, size, useDismiss, useFloating, useInteractions } from '@floating-ui/react'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import './VeterinaSelect.css'

function childOptions(children) {
  return Children.toArray(children).flatMap((child) => !isValidElement(child) ? [] : child.type === 'option'
    ? [{ value: String(child.props.value ?? child.props.children), label: Children.toArray(child.props.children).join(''), disabled: child.props.disabled }]
    : childOptions(child.props.children))
}

// The hidden native control retains FormData, required validation and fieldset semantics.
export default function VeterinaSelect({ options, children, value, defaultValue, onChange, onFocus, name, required, disabled, searchable, searchPlaceholder = 'Type to search…', placeholder = 'Select an option', className = '', id, ariaLabel, 'aria-label': label, 'aria-describedby': describedBy }) {
  const generatedId = useId()
  const listId = `${generatedId}-options`
  const normalized = options ? options.map((o) => typeof o === 'string' ? { value: o, label: o } : o) : childOptions(children)
  searchable ??= normalized.length > 8
  const [localValue, setLocalValue] = useState(() => normalized.some((option) => String(option.value) === String(defaultValue)) ? String(defaultValue) : String(normalized[0]?.value ?? ''))
  const requestedValue = String(value ?? localValue)
  const selected = normalized.find((o) => String(o.value) === requestedValue)
  const selectedValue = selected ? requestedValue : ''
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(-1)
  const [invalid, setInvalid] = useState(false)
  const searchInput = useRef(null)
  const focusSearch = useCallback((node) => { searchInput.current = node; node?.focus() }, [])
  const optionRefs = useRef([])
  const typeahead = useRef({ text: '', at: 0 })
  const filtered = normalized.filter((o) => String(o.label).toLowerCase().includes(search.toLowerCase()))
  const changeOpen = (next) => { setOpen(next); setSearch(''); setActive(-1) }
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: changeOpen, strategy: 'fixed', placement: 'bottom-start', whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply({ rects, availableHeight, availableWidth, elements }) {
      Object.assign(elements.floating.style, { width: `${Math.min(rects.reference.width, availableWidth)}px`, maxHeight: `${Math.min(320, availableHeight)}px` })
    } })],
  })
  const dismiss = useDismiss(context, { escapeKey: false })
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss])
  const choose = (option) => {
    if (!option || option.disabled || refs.domReference.current?.matches(':disabled')) return
    setLocalValue(String(option.value))
    setInvalid(false)
    onChange?.(String(option.value))
    changeOpen(false)
    refs.domReference.current?.focus()
  }
  const navigate = (direction, edge) => {
    const enabled = filtered.map((o, i) => o.disabled ? -1 : i).filter((i) => i >= 0)
    const current = enabled.indexOf(active)
    const next = edge === 'first' ? enabled[0] : edge === 'last' ? enabled.at(-1) : current < 0 ? direction < 0 ? enabled.at(-1) : enabled[0] : enabled[(current + direction + enabled.length) % enabled.length]
    setActive(next ?? -1)
    optionRefs.current[next]?.scrollIntoView({ block: 'nearest' })
  }
  const keyDown = (event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); changeOpen(false); refs.domReference.current?.focus(); return }
    if (!open && ['Enter', ' '].includes(event.key)) { event.preventDefault(); changeOpen(true); setActive(normalized.findIndex((o) => String(o.value) === selectedValue)); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) { changeOpen(true); setActive(normalized.findIndex((o) => String(o.value) === selectedValue)); return }
      navigate(event.key === 'ArrowUp' ? -1 : 1, event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : null)
    } else if ((event.key === 'Enter' || event.key === ' ' && event.target !== searchInput.current) && open) {
      event.preventDefault(); choose(filtered[active])
    } else if (event.key === 'Tab') { if (open) refs.domReference.current?.focus(); changeOpen(false) }
    else if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const previous = typeahead.current
      const text = Date.now() - previous.at < 700 ? previous.text + event.key : event.key
      typeahead.current = { text, at: Date.now() }
      const match = normalized.find((o) => !o.disabled && String(o.label).toLowerCase().startsWith(text.toLowerCase()))
      if (match) choose(match)
    }
  }
  return <span className={`vt-select-root ${className}`} onKeyDown={keyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) changeOpen(false) }}>
    <button {...getReferenceProps()} ref={refs.setReference} id={id || generatedId} type="button" role="combobox" aria-label={label || ariaLabel} aria-describedby={[describedBy, invalid ? `${generatedId}-error` : ''].filter(Boolean).join(' ') || undefined} aria-invalid={invalid || undefined} aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-activedescendant={open && active >= 0 && !searchable ? `${listId}-${active}` : undefined} aria-required={required || undefined} disabled={disabled} className={`vt-select-trigger ${open ? 'is-open' : ''}`} onFocus={onFocus} onClick={() => changeOpen(!open)}>
      <span className="vt-select-label">{selected?.label || placeholder}</span><CaretDown size={15} aria-hidden="true" />
    </button>
    <select className="vt-select-native" data-field-label={label || ariaLabel} aria-hidden="true" tabIndex={-1} name={name} value={selectedValue} required={required} disabled={disabled} onChange={(event) => choose(normalized.find((o) => String(o.value) === event.target.value))} onInvalid={(event) => { event.preventDefault(); setInvalid(true); refs.domReference.current?.focus() }}>
      {!normalized.some((o) => String(o.value) === '') && !selected && <option value="" />}
      {normalized.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
    {invalid && <span id={`${generatedId}-error`} className="vt-select-error" role="alert">Please select {String(label || ariaLabel || 'an option').toLowerCase()}.</span>}
    {open && <span {...getFloatingProps()} ref={refs.setFloating} style={floatingStyles} className="vt-select-popover">
      {searchable && <span className="vt-select-search"><MagnifyingGlass size={17} aria-hidden="true" /><input ref={focusSearch} aria-label={`Search ${label || ariaLabel || 'options'}`} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} value={search} onChange={(event) => { setSearch(event.target.value); setActive(-1) }} placeholder={searchPlaceholder} /></span>}
      <span className="vt-select-options" id={listId} role="listbox" aria-label={label || ariaLabel || placeholder}>
        {filtered.map((option, index) => <span id={`${listId}-${index}`} ref={(node) => { optionRefs.current[index] = node }} key={option.value} role="option" aria-selected={String(option.value) === selectedValue} aria-disabled={option.disabled || undefined} className={`vt-select-option ${index === active ? 'is-active' : ''}`} onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); choose(option) }}><span>{option.label}</span>{String(option.value) === selectedValue && <Check size={16} weight="bold" aria-hidden="true" />}</span>)}
        {!filtered.length && <span className="vt-select-empty" role="status">No options found</span>}
      </span>
    </span>}
  </span>
}

// Keep existing form handlers and FormData contracts while sharing the branded UI.
export function SelectField({ onChange, name, ...props }) {
  return <VeterinaSelect {...props} name={name} onChange={(value) => {
    const target = { name, value, type: 'select-one' }
    onChange?.({ target, currentTarget: target })
  }} />
}
