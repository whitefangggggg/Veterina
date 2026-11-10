import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Backspace, MagnifyingGlass, X } from '@phosphor-icons/react'
import { clinicSearchUrl, groupSearchResults, normalizeSearch, searchValidation } from '../lib/clinicSearch'
import { useClinicSearch } from '../lib/useClinicSearch'
import { useDialogFocus } from '../lib/useDialogFocus'
import './GlobalSearch.css'

export default function GlobalSearch({ onClose }) {
  const dialog = useRef(null), input = useRef(null)
  const listId = useId(), navigate = useNavigate()
  const [query, setQuery] = useState(''), [active, setActive] = useState(-1), [revision, setRevision] = useState(0)
  useDialogFocus(dialog, onClose)
  const result = useClinicSearch({ query, limit: 12, revision })
  const groups = groupSearchResults(result.records), records = groups.flatMap(group => group.records)
  const open = href => { onClose(); navigate(href) }
  const move = delta => {
    if (!records.length) return
    const next = active < 0 ? (delta > 0 ? 0 : records.length - 1) : (active + delta + records.length) % records.length
    setActive(next); document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' })
  }
  return <div className="search-overlay" onMouseDown={onClose}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Search clinic records" className="global-search clinic-global-search" onMouseDown={event => event.stopPropagation()}>
      <form onSubmit={event => { event.preventDefault(); if (!searchValidation(query)) open(clinicSearchUrl(query)) }}>
        <div className="global-search-input">
          <MagnifyingGlass size={22} aria-hidden="true" />
          <input ref={input} type="search" role="combobox" aria-label="Search clinic records" aria-autocomplete="list" aria-expanded={records.length > 0} aria-controls={records.length ? listId : undefined} aria-activedescendant={records[active] ? `${listId}-${active}` : undefined} aria-describedby={`${listId}-help`} autoComplete="off" maxLength={120}
            value={query} placeholder="Patient, owner, visit, stock, document…" onChange={event => { setQuery(event.target.value); setActive(-1) }}
            onKeyDown={event => {
              if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1) }
              if (event.key === 'Enter' && records[active]) { event.preventDefault(); open(records[active].href) }
            }} />
          {query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => { setQuery(''); setActive(-1); input.current?.focus() }}><Backspace size={18} /></button>}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close search"><X size={20} /></button>
        </div>
        <p id={`${listId}-help`} className="search-result-count">Enter opens all results. Arrow keys select a suggestion. Search stays within your clinic.</p>
        {result.status === 'idle' && <div className="search-empty"><MagnifyingGlass size={30} aria-hidden="true" /><p>Find a clinic record</p><span>{normalizeSearch(query) ? searchValidation(query) : 'Search patients, owners, clinical care, schedules, stock and documents. Use at least 2 characters.'}</span></div>}
        {result.status === 'loading' && <p role="status" className="search-result-count">Searching clinic records…</p>}
        {result.status === 'error' && <div className="search-feedback" role="alert"><p>Search could not be loaded.</p><button type="button" className="button button-secondary" onClick={() => setRevision(value => value + 1)}>Retry search</button></div>}
        {result.status === 'ready' && <p role="status" className="search-result-count">{result.total ? `${result.total} matching records. Showing ${records.length} suggestions.` : 'No results found. Try another name, identifier or service.'}</p>}
        {records.length > 0 && <div id={listId} role="listbox" aria-label="Clinic search suggestions">{groups.map(group => <div key={group.kind} role="group" aria-label={group.label}>
          <h2 className="clinic-search-group-title">{group.label}</h2>
          {group.records.map(record => {
            const index = records.indexOf(record)
            return <div key={`${record.source}:${record.id}`} id={`${listId}-${index}`} role="option" aria-selected={active === index} className={`search-result clinic-search-suggestion ${active === index ? 'is-active' : ''}`} onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => open(record.href)}>
              <MagnifyingGlass size={20} aria-hidden="true" /><span><strong>{record.title}</strong><small>{record.context}</small></span><code>{record.status || group.label}</code>
            </div>
          })}
        </div>)}</div>}
        {!searchValidation(query) && <button className="clinic-search-view-all" type="submit">View all results <ArrowRight size={18} aria-hidden="true" /></button>}
      </form>
    </div>
  </div>
}
