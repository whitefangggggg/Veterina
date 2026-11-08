import VeterinaSelect from '../components/VeterinaSelect'
import VeterinaCheckbox from '../components/VeterinaCheckbox'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Bed, Broom, Buildings, Clock, FirstAidKit, Heartbeat, ListBullets, MagnifyingGlass, PawPrint, Plus, SquaresFour } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, Field, Modal, SectionCard } from '../components/ui'
import { AsyncForm } from '../components/RecordForm'
import { AdmissionCreateDialog } from '../components/AdmissionDialogs'
import PetSticker from '../components/PetSticker'
import { admissionSource, admissionStatuses, clinicalConditions, displayAdmissionTime, filterAdmissions, stayDuration, unitStates } from '../lib/admissions'
import './Admissions.css'

function FacilityEditor({ modal, data, onClose }) {
  const [initial] = useState(modal.record)
  return <Modal className="admission-dialog" title={`${initial ? 'Edit' : 'Add'} ${modal.kind === 'ward' ? 'ward' : 'cage or kennel'}`} onClose={onClose}>
    <AsyncForm onClose={onClose} onSave={(values) => data.execute(`facility_${modal.kind}`, { ...values, ...(initial ? { id: initial.id, expectedVersion: initial.version } : {}), isActive: values.isActive !== 'false' })}>
      <div className="form-grid"><Field label="Name" required><input name="name" defaultValue={initial?.name} required maxLength={120} /></Field>
        {modal.kind === 'unit' && <>
          {!initial && <Field label="Ward" required><VeterinaSelect searchable name="wardId" required><option value="">Select ward</option>{data.admissionWards.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</VeterinaSelect></Field>}
          <Field label="Accommodation type"><VeterinaSelect name="kind" defaultValue={initial?.kind || 'cage'}><option value="cage">Cage</option><option value="kennel">Kennel</option></VeterinaSelect></Field>
          {initial && <Field label="Availability"><VeterinaSelect name="state" defaultValue={initial.state} disabled={initial.state === 'occupied'}>{Object.entries(unitStates).map(([v, l]) => <option key={v} value={v} disabled={v === 'occupied' && initial.state !== 'occupied' || v === 'available' && initial.state === 'cleaning_required'}>{l}</option>)}</VeterinaSelect></Field>}
        </>}
        {initial && <Field label="Facility status"><VeterinaSelect name="isActive" defaultValue={String(initial.is_active)}><option value="true">Active</option><option value="false">Archived</option></VeterinaSelect></Field>}
      </div>
    </AsyncForm>
  </Modal>
}
export default function Admissions() {
  const data = useClinicData()
  const reload = data.reload
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const [create, setCreate] = useState(params.has('petId'))
  const [facility, setFacility] = useState(null)
  const [filters, setFilters] = useState({ history: false })
  const [tab, setTab] = useState('patients')
  const [error, setError] = useState('')
  const [view, setView] = useState('skim')
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void reload() }, 30000)
    return () => clearInterval(timer)
  }, [reload])
  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const rows = filterAdmissions(data.admissions, filters)
  const active = data.admissions.filter((a) => !a.closed_at)
  const available = data.admissionUnits.filter((u) => u.is_active && u.state === 'available' && data.admissionWards.some((w) => w.id === u.ward_id && w.is_active))
  const stats = [
    [Bed, 'Current patients', active.length, 'Active hospital stays'],
    [Heartbeat, 'Critical patients', active.filter((a) => a.condition === 'critical').length, 'Prioritized in the patient list'],
    [FirstAidKit, 'Ready for discharge', active.filter((a) => a.status === 'ready_for_discharge').length, 'Awaiting discharge review'],
    [Buildings, 'Available accommodation', available.length, 'Clean cages and kennels'],
  ]
  return <div className="page admissions-page">
    <div className="page-header admission-page-heading"><div><span className="eyebrow">Inpatient care</span><h1>Admissions</h1><p>A clear view of every stay, from intake to home care.</p></div><button className="button button-primary" onClick={() => setCreate(true)}><Plus size={18} aria-hidden="true" />Admit patient</button></div>
    <div className="admission-stats" aria-label="Hospital overview">{stats.map(([Icon, label, value, hint]) => <article className="admission-stat" key={label}><span className="admission-stat-icon"><Icon size={22} weight="duotone" aria-hidden="true" /></span><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></article>)}</div>
    <div className="admission-tabs" role="group" aria-label="Admissions view"><button className="button" aria-pressed={tab === 'patients'} onClick={() => setTab('patients')}><PawPrint size={18} aria-hidden="true" />Patients</button><button className="button" aria-pressed={tab === 'facilities'} onClick={() => setTab('facilities')}><Buildings size={18} aria-hidden="true" />Facilities</button></div>
    {error && <p role="alert" className="auth-message auth-error">{error}</p>}
    {tab === 'patients' ? <div key="patients" className="admission-workspace">
      <SectionCard title="Hospitalized patients" description="Critical patients appear first. Filter current stays or include closed admissions." action={<div className="admission-view-switch" role="group" aria-label="Patient card view"><button aria-label="Quick skim" aria-pressed={view === 'skim'} onClick={() => setView('skim')}><SquaresFour size={17} aria-hidden="true" /><span>Quick skim</span></button><button aria-label="Detailed view" aria-pressed={view === 'detailed'} onClick={() => setView('detailed')}><ListBullets size={17} aria-hidden="true" /><span>Detailed</span></button></div>}>
        <div className="admission-filters">
          <Field label="Search admissions"><span className="admission-search"><MagnifyingGlass size={18} aria-hidden="true" /><input type="search" aria-label="Search admissions" value={filters.query || ''} onChange={(e) => set('query', e.target.value)} placeholder="Patient, owner or reference…" /></span></Field>
          <Field label="Operational status"><VeterinaSelect value={filters.status || ''} onChange={(e) => set('status', e)}><option value="">All statuses</option>{Object.entries(admissionStatuses).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</VeterinaSelect></Field>
          <Field label="Clinical condition"><VeterinaSelect value={filters.condition || ''} onChange={(e) => set('condition', e)}><option value="">All conditions</option>{Object.entries(clinicalConditions).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</VeterinaSelect></Field>
          <Field label="Assigned veterinarian"><VeterinaSelect searchable value={filters.veterinarian || ''} onChange={(e) => set('veterinarian', e)}><option value="">All veterinarians</option>{data.profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</VeterinaSelect></Field>
          <Field label="Location"><VeterinaSelect searchable value={filters.unit || ''} onChange={(e) => set('unit', e)}><option value="">All locations</option><option value="unassigned">Unassigned</option>{data.admissionUnits.map((u) => <option key={u.id} value={u.id}>{data.admissionWards.find((w) => w.id === u.ward_id)?.name} / {u.name}</option>)}</VeterinaSelect></Field>
          <VeterinaCheckbox label="Include closed stays" checked={filters.history} onChange={(checked) => set('history', checked)} />
        </div>
        <div className="admission-results"><p role="status">{rows.length} matching {rows.length === 1 ? 'admission' : 'admissions'}</p><button className="text-link" onClick={() => setFilters({ history: false })}>Reset filters</button></div>
        <div className={`admission-grid admission-patient-grid admission-view-${view}`}>{rows.map((a) => <article key={a.id} className={`admission-card admission-patient-card ${a.condition === 'critical' && !a.closed_at ? 'admission-critical' : ''}`}>
          <div className="admission-badges"><Badge tone={a.condition === 'critical' ? 'danger' : 'neutral'}>{clinicalConditions[a.condition]}</Badge><Badge tone={a.closed_at ? 'success' : 'blue'}>{admissionStatuses[a.status]}</Badge>{a.is_historical && <Badge>Historical</Badge>}</div>
          <div className="admission-patient-heading"><PetSticker pet={data.pets.find((p) => p.id === a.petId)} /><div><h3><Link to={admissionSource(a.id)}>{a.patientName}</Link></h3><small>{a.reference}</small></div></div>
          <p className="admission-reason">{a.reason}</p>
          {view === 'detailed' ? <dl><dt>Veterinarian</dt><dd>{a.veterinarianName}</dd><dt>Location</dt><dd>{a.unitName}</dd><dt>Admitted</dt><dd>{displayAdmissionTime(a.admitted_at, data.timezone)}</dd><dt>Length of stay</dt><dd>{stayDuration(a)}</dd></dl> : <div className="admission-skim-meta"><span><Bed size={16} aria-hidden="true" />{a.unitName || 'Unassigned'}</span><span><Clock size={16} aria-hidden="true" />{stayDuration(a)}</span></div>}
          <Link className="text-link admission-card-footer" to={admissionSource(a.id)}>Open admission<ArrowRight size={17} aria-hidden="true" /></Link>
        </article>)}</div>{!rows.length && <div className="admission-empty"><PawPrint size={34} weight="duotone" aria-hidden="true" /><h3>No matching admissions</h3><p>Try changing your filters, or admit a registered patient.</p><button className="button button-secondary" onClick={() => setCreate(true)}>Start an admission</button></div>}
      </SectionCard>
    </div> : <div key="facilities" className="admission-workspace"><SectionCard title="Wards and accommodation" description="Add a ward, then cages or kennels. Assign accommodation from the patient’s admission." action={profile.role === 'owner' && <div className="admission-actions"><button className="button button-secondary" onClick={() => setFacility({ kind: 'ward' })}><Plus size={16} aria-hidden="true" />Add ward</button><button className="button button-primary" onClick={() => setFacility({ kind: 'unit' })} disabled={!data.admissionWards.some((w) => w.is_active)}><Plus size={16} aria-hidden="true" />Add cage or kennel</button></div>}>
      {!data.admissionWards.length && <div className="admission-empty"><Buildings size={34} weight="duotone" aria-hidden="true" /><h3>A comfortable place to recover</h3><p>{profile.role === 'owner' ? 'Start with a ward, then add the cages or kennels available to your patients.' : 'A clinic owner can add wards and accommodation here.'}</p></div>}
      {data.admissionWards.map((ward) => <section className="admission-ward" key={ward.id}><div className="admission-section-heading"><div><h3><Buildings size={20} aria-hidden="true" />{ward.name} {!ward.is_active && <Badge>Archived</Badge>}</h3><p>{data.admissionUnits.filter((u) => u.ward_id === ward.id && u.is_active).length} active accommodation units</p></div>{profile.role === 'owner' && <button className="text-link" onClick={() => setFacility({ kind: 'ward', record: ward })}>Edit {ward.name}</button>}</div>
        <div className="admission-grid">{data.admissionUnits.filter((u) => u.ward_id === ward.id).map((u) => <article key={u.id} className={`admission-card admission-unit-card admission-unit-${u.state}`}><span className="admission-unit-icon">{u.state === 'cleaning_required' ? <Broom size={24} weight="duotone" aria-hidden="true" /> : <Bed size={24} weight="duotone" aria-hidden="true" />}</span><h4>{u.name}</h4><small className="admission-unit-kind">{u.kind}</small><div className="admission-badges"><Badge tone={u.state === 'available' ? 'success' : u.state === 'cleaning_required' ? 'warning' : u.state === 'occupied' ? 'blue' : 'neutral'}>{unitStates[u.state]}</Badge>{!u.is_active && <Badge>Archived</Badge>}</div>
          <div className="admission-actions">{u.state === 'cleaning_required' && u.is_active && <button className="button button-secondary small-button" onClick={async () => { setError(''); try { await data.execute('facility_clean', { id: u.id, expectedVersion: u.version }) } catch (e) { setError(e.message) } }}>Mark {u.name} cleaned</button>}{profile.role === 'owner' && <button className="text-link" onClick={() => setFacility({ kind: 'unit', record: u })}>Edit {u.name}</button>}</div>
        </article>)}</div>
        {!data.admissionUnits.some((u) => u.ward_id === ward.id) && <p className="admission-ward-empty">No cages or kennels in this ward yet.</p>}
      </section>)}
    </SectionCard></div>}
    {create && <AdmissionCreateDialog petId={params.get('petId') || ''} onClose={() => setCreate(false)} />}
    {facility && <FacilityEditor modal={facility} data={data} onClose={() => setFacility(null)} />}
  </div>
}
