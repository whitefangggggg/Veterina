import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, PageHeader, SectionCard } from '../components/ui'
import { useClinicData } from '../context/ClinicDataContext'
import { fetchClinicSearchRecord, searchKinds, searchRecordDate } from '../lib/clinicSearch'
import { SearchResultLink } from './ClinicSearch'
import '../components/GlobalSearch.css'

export default function ClinicSearchRecord() {
  const { source, recordId } = useParams()
  const { timezone } = useClinicData()
  const [revision, setRevision] = useState(0), [result, setResult] = useState({ key: '', status: 'loading' })
  const key = `${source}:${recordId}:${revision}`
  useEffect(() => {
    const controller = new AbortController()
    fetchClinicSearchRecord(source, recordId, { signal: controller.signal }).then(record => {
      if (!controller.signal.aborted) setResult({ key, status: record ? 'ready' : 'unavailable', record })
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, status: 'error' }) })
    return () => controller.abort()
  }, [source, recordId, revision, key])
  const visible = result.key === key ? result : { status: 'loading' }, record = visible.record
  return <div className="page clinic-search-page">
    <Link className="text-link" to="/search">Search clinic records</Link>
    {visible.status === 'loading' && <p role="status">Loading the selected record…</p>}
    {visible.status === 'unavailable' && <SectionCard title="Record not available"><p>This record may have been removed or is outside your current clinic access.</p></SectionCard>}
    {visible.status === 'error' && <SectionCard title="Record could not be loaded"><p role="alert">Please try again.</p><button className="button button-secondary" onClick={() => setRevision(value => value + 1)}>Retry record</button></SectionCard>}
    {record && <>
      <PageHeader eyebrow={searchKinds[record.kind]} title={record.title} description="Selected saved record. This view is read-only." actions={<>{record.source === 'pets' && <Link className="button button-primary" to={`/patients/${record.id}`}>Open patient chart</Link>}<button className="button button-secondary" onClick={() => setRevision(value => value + 1)}>Refresh record</button></>} />
      <SectionCard title="Record details"><div className="admission-actions">{record.status && <Badge>{record.status.replaceAll('_', ' ')}</Badge>}{record.date && <time dateTime={record.date}>{searchRecordDate(record, timezone)}</time>}</div><p className="clinic-record-context">{record.context}</p><dl className="clinic-record-fields">{Object.entries(record.fields || {}).filter(([, value]) => value !== null && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl><p className="clinic-record-context">Record ID: {record.id}</p></SectionCard>
      {record.related?.length > 0 && <SectionCard title="Related records">{record.related.map(row => <SearchResultLink key={`${row.source}:${row.id}`} record={row} timezone={timezone} />)}</SectionCard>}
    </>}
  </div>
}
