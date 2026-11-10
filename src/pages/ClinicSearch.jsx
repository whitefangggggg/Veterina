import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import { Badge, Field, PageHeader, SectionCard } from '../components/ui'
import { SelectField } from '../components/VeterinaSelect'
import { clinicSearchUrl, groupSearchResults, normalizeSearch, readSearchLocation, searchKinds, searchRecordDate, searchValidation } from '../lib/clinicSearch'
import { useClinicSearch } from '../lib/useClinicSearch'
import { useClinicData } from '../context/ClinicDataContext'
import '../components/GlobalSearch.css'

export function SearchResultLink({ record, timezone }) {
  return <Link className="clinic-search-result-link" to={record.href}>
    <div><strong>{record.title}</strong><small>{record.context}</small></div>
    <div className="clinic-search-result-meta">{record.status && <Badge>{record.status.replaceAll('_', ' ')}</Badge>}{record.date && <small>{searchRecordDate(record, timezone)}</small>}</div>
  </Link>
}

export default function ClinicSearch() {
  const location = useLocation(), navigate = useNavigate()
  const { timezone } = useClinicData()
  const { query, kind } = readSearchLocation(location.hash)
  const [draft, setDraft] = useState(query), [validation, setValidation] = useState('')
  const [pagination, setPagination] = useState({ key: '', cursors: [null], page: 0 })
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([query, kind])
  const current = pagination.key === key ? pagination : { cursors: [null], page: 0 }
  const result = useClinicSearch({ query, kind, cursor: current.cursors[current.page], revision, debounce: 0 })
  useEffect(() => { setDraft(query); setValidation('') }, [query])
  const move = direction => setPagination(previous => {
    const base = previous.key === key ? previous : { key, cursors: [null], page: 0 }
    return direction < 0 ? { ...base, page: Math.max(0, base.page - 1) } : { key, page: base.page + 1, cursors: [...base.cursors.slice(0, base.page + 1), result.nextCursor] }
  })
  const retry = () => { setPagination({ key, cursors: [null], page: 0 }); setRevision(value => value + 1) }
  return <div className="page clinic-search-page">
    <PageHeader eyebrow="Your clinic" title="Search clinic records" description="Find saved records across the clinic. Results respect your current access." />
    <SectionCard><form className="clinic-search-form" onSubmit={event => { event.preventDefault(); const problem = searchValidation(draft); setValidation(problem); if (!problem) { if (normalizeSearch(draft) === query) retry(); else navigate(clinicSearchUrl(draft, kind)) } }}>
      <Field label="Search terms"><input type="search" value={draft} maxLength={120} autoComplete="off" onChange={event => { setDraft(event.target.value); setValidation('') }} placeholder="Name, phone, identifier, care or product" /></Field>
      <button className="button button-primary"><MagnifyingGlass size={18} aria-hidden="true" />Search</button>
      <button type="button" className="button button-secondary" onClick={() => { setDraft(''); setValidation(''); navigate('/search', { replace: true }) }}>Clear search</button>
    </form>{validation && <p role="alert">{validation}</p>}</SectionCard>
    <div className="clinic-search-type"><Field label="Record type"><SelectField value={kind} onChange={event => navigate(clinicSearchUrl(query, event.target.value))}><option value="">All records</option>{Object.entries(searchKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></Field></div>
    {result.status === 'idle' && <SectionCard><p role="status">{searchValidation(query)}</p></SectionCard>}
    {result.status === 'loading' && <p role="status">Searching saved clinic records…</p>}
    {result.status === 'error' && <SectionCard><p role="alert">Search could not be loaded. Please try again.</p><button className="button button-secondary" onClick={retry}>Retry search</button></SectionCard>}
    {result.status === 'ready' && <>
      <div className="admission-actions"><p role="status">{result.total ? `${result.total} matching records · page ${current.page + 1} · ${result.records.length} shown` : 'No results found. Try a different name, identifier or service.'}</p><button className="text-link" onClick={retry}>Refresh search</button></div>
      <div className="clinic-search-results">{groupSearchResults(result.records).map(group => <SectionCard key={group.kind} title={group.label}>{group.records.map(record => <SearchResultLink key={`${record.source}:${record.id}`} record={record} timezone={timezone} />)}</SectionCard>)}</div>
      {(current.page > 0 || result.nextCursor) && <nav className="clinic-search-pagination" aria-label="Search results pages"><button className="button button-secondary" disabled={current.page === 0} onClick={() => move(-1)}><ArrowLeft size={18} />Previous results</button><span>Page {current.page + 1}</span><button className="button button-secondary" disabled={!result.nextCursor} onClick={() => move(1)}>Next results<ArrowRight size={18} /></button></nav>}
    </>}
  </div>
}
