import { SelectField } from '../components/VeterinaSelect'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CaretRight, MagnifyingGlass, PawPrint, Plus, UserPlus, UsersThree, WarningCircle } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, EmptyState, PageHeader } from '../components/ui'
import PetSticker from '../components/PetSticker'
import ContactActions from '../components/ContactActions'
import { OwnerEditor as AddOwnerModal, PetEditor as AddPetModal, OwnerDirectory } from '../components/PatientEditors'

export default function Patients() {
  const { pets, owners } = useClinicData()
  const [query, setQuery] = useState('')
  const [species, setSpecies] = useState('All')
  const [status, setStatus] = useState('All')
  const [modal, setModal] = useState(null)
  const hasFilters = Boolean(query || species !== 'All' || status !== 'All')
  const resetFilters = () => { setQuery(''); setSpecies('All'); setStatus('All') }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return pets.filter((pet) => {
      const owner = owners.find((item) => item.id === pet.ownerId)
      const matchesQuery = !normalized || [pet.name, pet.recordNumber, pet.breed, pet.microchip, owner?.fullName, owner?.phone, owner?.normalizedPhone?.replace(/^\+63/, '0'), owner?.normalizedPhone]
        .some((value) => value?.toLowerCase().includes(normalized))
      return matchesQuery && (species === 'All' || pet.species === species) && (status === 'All' || pet.status === status)
    })
  }, [pets, owners, query, species, status])

  return (
    <div className="page">
      <PageHeader
        eyebrow="Clinical records"
        title="Patients & owners"
        description="Find complete records in seconds or register a new clinic patient."
        actions={
          <>
            <button className="button button-secondary" onClick={() => setModal('owner')}><UserPlus size={18} weight="duotone" /> Add owner</button>
            <button className="button button-primary" disabled={!owners.some((owner) => owner.isActive)} onClick={() => setModal('pet')}><Plus size={18} weight="bold" /> Register pet</button>
          </>
        }
      />

      <div className="list-toolbar">
        <label className="table-search"><MagnifyingGlass size={18} /><input aria-label="Search patients and owners" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pet, owner, phone or record number..." /></label>
        <div className="filter-pills" role="group" aria-label="Patient species">
          {['All', 'Dog', 'Cat', 'Bird', 'Rabbit', 'Other'].map((value) => <button key={value} onClick={() => setSpecies(value)} aria-pressed={species === value} className={species === value ? 'active' : ''}>{value}</button>)}
        </div>
        <span className="result-count" role="status">{filtered.length} patient{filtered.length === 1 ? '' : 's'}</span>
        <SelectField aria-label="Filter patient status" value={status} onChange={(event) => setStatus(event.target.value)}>{['All', 'Active', 'Inactive', 'Deceased'].map((value) => <option key={value} value={value}>{value === 'All' ? 'All patient statuses' : value}</option>)}</SelectField>
        {hasFilters && <button className="button button-secondary small-button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {filtered.length ? (
        <div className="patient-table section-card">
          <div className="table-head patient-grid"><span>Patient</span><span>Owner</span><span>Clinical notes</span><span>Last weight</span><span>Status</span><span /></div>
          {filtered.map((pet) => {
            const owner = owners.find((item) => item.id === pet.ownerId)
            return (
              <div className="table-row patient-grid" key={pet.id}>
                <Link to={`/patients/${pet.id}`} className="patient-cell">
                  <PetSticker pet={pet} />
                  <span><strong>{pet.name}</strong><small>{pet.breed} · {pet.species}</small><code>{pet.recordNumber}</code></span>
                </Link>
                <div className="cell-owner"><span className="card-meta-label">Owner</span><strong>{owner?.fullName}</strong><small>{owner?.phone}</small><ContactActions contact={owner} /></div>
                <div className="clinical-flags">
                  {pet.allergies.length > 0 && <Badge tone="danger"><WarningCircle size={13} weight="fill" /> Allergy</Badge>}
                  {pet.alerts.length > 0 && <Badge tone="warning">{pet.alerts.length} alert{pet.alerts.length > 1 ? 's' : ''}</Badge>}
                  {!pet.allergies.length && !pet.alerts.length && <span className="muted">No active alerts</span>}
                </div>
                <div className="cell-weight"><span className="card-meta-label">Last weight</span><strong>{pet.latestWeight ? `${pet.latestWeight} kg` : '—'}</strong><small>Latest visit</small></div>
                <div className="cell-status"><Badge tone={pet.status === 'Active' ? 'success' : 'neutral'}>{pet.status}</Badge></div>
                <CaretRight size={19} weight="bold" className="row-chevron" aria-hidden="true" />
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState icon={PawPrint} title={hasFilters ? 'No matching patients' : 'No patients registered yet'} description={hasFilters ? 'Change your search or clear the filters to see all patients.' : 'Add an owner, then register their pet to start a patient record.'} />
      )}

      <OwnerDirectory />
      <div className="privacy-callout"><UsersThree size={20} weight="duotone" /><div><strong>Personal information stays staff-only</strong><span>Owner contact details and linked animal records are only available to authenticated clinic staff.</span></div></div>
      {modal === 'owner' && <AddOwnerModal onClose={() => setModal(null)} />}
      {modal === 'pet' && <AddPetModal onClose={() => setModal(null)} />}
    </div>
  )
}
