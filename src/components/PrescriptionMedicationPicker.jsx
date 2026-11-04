import { useEffect, useId, useRef, useState } from 'react'
import { Field } from './ui'
import { prescriptionInventoryBatches } from '../lib/prescriptions'

export default function PrescriptionMedicationPicker({ medication, index, inventory, today, locked, onChange }) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])
  const query = medication.medicationName.toLocaleLowerCase().trim()
  const matches = inventory.filter((item) => item.isActive && [item.name, item.sku, item.brand].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  const select = (item) => {
    onChange({ medicationName: item ? item.name : medication.medicationName, inventoryItemId: item?.id || '', batchId: '', dispenseQuantity: '', dispenseUnit: item?.unit || '' })
    setOpen(false)
  }
  return <Field label="Medication name" required span hint={locked ? 'Already dispensed. Item, batch and quantity are fixed; use Inventory for stock corrections.' : 'Search inventory by name, SKU or brand, or use a custom medication without deducting stock.'}>
    <div className="medication-combobox">
      <input role="combobox" aria-label={`Medication name ${index + 1}`} aria-autocomplete="list" aria-expanded={open && !locked} aria-controls={listId}
        aria-activedescendant={open && !locked ? `${listId}-${Math.min(active, matches.length)}` : undefined}
        value={medication.medicationName} required readOnly={locked} autoComplete="off"
        onFocus={() => { if (!locked) { setActive(0); setOpen(true) } }} onBlur={() => setOpen(false)}
        onChange={(event) => { onChange({ medicationName: event.target.value, inventoryItemId: '', batchId: '', dispenseQuantity: '', dispenseUnit: '' }); setActive(0); setOpen(true) }}
        onKeyDown={(event) => {
          if (locked) return
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true)
            setActive((current) => open ? Math.max(0, Math.min(matches.length, current + (event.key === 'ArrowDown' ? 1 : -1))) : event.key === 'ArrowDown' ? 0 : matches.length)
          }
          if (event.key === 'Enter' && open) { event.preventDefault(); select(matches[Math.min(active, matches.length)]) }
        }} />
      {open && !locked && <div className="medication-options" ref={listRef} id={listId} role="listbox" aria-label={`Medication options ${index + 1}`}>
        {!matches.length && <p role="presentation">No matching inventory items.</p>}
        {[...matches, null].map((item, optionIndex) => <button type="button" role="option" tabIndex={-1} key={item?.id || 'custom'} id={`${listId}-${optionIndex}`}
          aria-selected={active === optionIndex} onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(optionIndex)} onClick={() => select(item)}>
          {item ? <><strong>{item.name}</strong><span>{[item.sku, item.brand, item.category, `${prescriptionInventoryBatches(item, today).reduce((total, batch) => total + batch.quantity, 0)} ${item.unit} available`].filter(Boolean).join(' · ')}</span></> : <strong>Use custom medication{medication.medicationName ? `: ${medication.medicationName}` : ''}</strong>}
        </button>)}
      </div>}
    </div>
  </Field>
}
