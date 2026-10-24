import { useId, useState } from 'react'
import { CalendarBlank, CaretDown, ListBullets, MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react'
import { Field } from './ui'

const optionsFor = (visits, field) => [...new Set(visits.map((visit) => visit[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b))

export default function ClinicalHistoryFilters({ visits, filters, onChange, onClear, count, timezone, view, onViewChange,
  label = 'Clinical history', itemName = 'checkup', itemPlural = 'checkups', advancedFields, dateLabel = 'Visit date', placeholder = 'Search clinical details…' }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const active = Object.values(filters).some(Boolean)
  const advancedCount = Object.entries(filters).filter(([key, value]) => key !== 'query' && value).length
  const update = (name) => (event) => onChange(name, event.target.value)
  const invalidRange = filters.from && filters.to && filters.from > filters.to
  return <section className="clinical-history-filters section-card" aria-label={`${label} search and filters`}>
    <div className="clinical-history-toolbar">
      <label className="clinical-history-search"><MagnifyingGlass size={18} aria-hidden="true" /><input aria-label={`Search ${label.toLowerCase()}`} type="search" value={filters.query} onChange={update('query')} placeholder={placeholder} /></label>
      <div className="clinical-history-view-toggle" role="group" aria-label={`${label} view`}>
        <button type="button" aria-pressed={view === 'cards'} onClick={() => onViewChange('cards')}><ListBullets size={16} aria-hidden="true" />Cards</button>
        <button type="button" aria-pressed={view === 'calendar'} onClick={() => onViewChange('calendar')}><CalendarBlank size={16} aria-hidden="true" />Calendar</button>
      </div>
      <button type="button" className="clinical-history-advanced-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}><SlidersHorizontal size={16} aria-hidden="true" />Advanced{advancedCount > 0 && <span>{advancedCount}</span>}<CaretDown size={12} aria-hidden="true" /></button>
    </div>
    <div id={panelId} hidden={!expanded}>
    <div className="clinical-history-filter-grid">
      {advancedFields ? advancedFields.map((field) => <Field key={field.name} label={field.label}><select aria-label={field.ariaLabel || `Filter ${field.label.toLowerCase()}`} value={filters[field.name]} onChange={update(field.name)}><option value="">{field.allLabel || 'All'}</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>) : <>
      <Field label="Visit type"><select aria-label="Filter visit type" value={filters.type} onChange={update('type')}><option value="">All visit types</option>{optionsFor(visits, 'type').map((type) => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Care status"><select aria-label="Filter care status" value={filters.status} onChange={update('status')}><option value="">All care statuses</option>{['Recorded', 'Waiting', 'In progress', 'Completed', 'Cancelled'].map((status) => <option key={status}>{status}</option>)}</select></Field>
      <Field label="Veterinarian"><select aria-label="Filter veterinarian" value={filters.veterinarian} onChange={update('veterinarian')}><option value="">All veterinarians</option>{optionsFor(visits, 'veterinarian').map((name) => <option key={name}>{name}</option>)}</select></Field>
      <Field label="Clinical details"><select aria-label="Filter clinical details" value={filters.details} onChange={update('details')}><option value="">All records</option><option value="prescription">With prescriptions</option><option value="follow-up">With follow-up date</option><option value="correction">With corrections</option><option value="finalized">Finalized checkups</option><option value="open">Unfinalized checkups</option></select></Field>
      </>}
      <Field label={`${dateLabel} from`}><input type="date" value={filters.from} max={filters.to || undefined} onChange={update('from')} aria-invalid={invalidRange ? true : undefined} /></Field>
      <Field label={`${dateLabel} to`}><input type="date" value={filters.to} min={filters.from || undefined} onChange={update('to')} aria-invalid={invalidRange ? true : undefined} /></Field>
    </div>
    {invalidRange && <p className="auth-message auth-error" role="alert">The end date must be on or after the start date.</p>}
    <p className="clinical-history-date-hint">Dates use {timezone}</p>
    </div>
    <div className="clinical-history-filter-summary"><span role="status">{count} of {visits.length} {visits.length === 1 ? itemName : itemPlural}</span>{active && <button type="button" className="text-link" onClick={onClear}>Clear filters</button>}</div>
  </section>
}
