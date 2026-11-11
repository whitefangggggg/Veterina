import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CaretRight,
  CheckCircle,
  MagnifyingGlass,
  PawPrint,
  Plus,
  Scales,
  UserPlus,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react'
import { SelectField } from '../components/VeterinaSelect'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, EmptyState, PageHeader } from '../components/ui'
import PetSticker from '../components/PetSticker'
import ContactActions from '../components/ContactActions'
import { OwnerEditor as AddOwnerModal, PetEditor as AddPetModal, OwnerDirectory } from '../components/PatientEditors'
import './Patients.css'

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
      const matchesQuery = !normalized || [
        pet.name, pet.recordNumber, pet.breed, pet.microchip,
        owner?.fullName, owner?.phone, owner?.normalizedPhone?.replace(/^\+63/, '0'), owner?.normalizedPhone
      ].some((value) => value?.toLowerCase().includes(normalized))
      return matchesQuery && (species === 'All' || pet.species === species) && (status === 'All' || pet.status === status)
    })
  }, [pets, owners, query, species, status])

  return (
    <div className="page patients-page">
      <PageHeader
        eyebrow="Clinical records"
        title="Patients & owners"
        description="Find complete records in seconds or register a new clinic patient."
        actions={
          <>
            <button className="button button-secondary" onClick={() => setModal('owner')}>
              <UserPlus size={18} weight="duotone" /> Add owner
            </button>
            <button className="button button-primary" disabled={!owners.some((owner) => owner.isActive)} onClick={() => setModal('pet')}>
              <Plus size={18} weight="bold" /> Register pet
            </button>
          </>
        }
      />

      <div className="list-toolbar">
        <label className="table-search">
          <MagnifyingGlass size={18} />
          <input
            aria-label="Search patients and owners"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pet, owner, phone or record number..."
          />
        </label>
        <div className="filter-pills" role="group" aria-label="Patient species">
          {['All', 'Dog', 'Cat', 'Bird', 'Rabbit', 'Other'].map((value) => (
            <button
              key={value}
              onClick={() => setSpecies(value)}
              aria-pressed={species === value}
              className={species === value ? 'active' : ''}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="result-count" role="status">
          {filtered.length} patient{filtered.length === 1 ? '' : 's'}
        </span>
        <SelectField aria-label="Filter patient status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {['All', 'Active', 'Inactive', 'Deceased'].map((value) => (
            <option key={value} value={value}>{value === 'All' ? 'All patient statuses' : value}</option>
          ))}
        </SelectField>
        {hasFilters && <button className="button button-secondary small-button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {filtered.length ? (
        <div className="patient-card-stack" role="feed" aria-label="Patient records">
          {filtered.map((pet) => {
            const owner = owners.find((item) => item.id === pet.ownerId)
            return (
              <article className="patient-long-card" key={pet.id}>
                {/* Subtle Paw Watermark in Theme Tone */}
                <PawPrint size={110} weight="fill" className="card-paw-watermark" aria-hidden="true" />

                {/* Patient Identity & Link */}
                <Link to={`/patients/${pet.id}`} className="patient-card-main-link" aria-label={`Open record for ${pet.name}`}>
                  <div className="patient-avatar-frame">
                    <PetSticker pet={pet} size="medium" />
                  </div>
                  <div className="patient-identity-col">
                    <div className="patient-name-row">
                      <h3>{pet.name}</h3>
                      <span className="species-chip">{pet.species}</span>
                      <Badge tone={pet.status === 'Active' ? 'success' : 'neutral'}>
                        ● {pet.status}
                      </Badge>
                    </div>
                    <p className="patient-sub-meta">
                      <span>{pet.breed || 'Unknown breed'}</span>
                      {pet.sex && <span>· {pet.sex}</span>}
                      <code>{pet.recordNumber}</code>
                    </p>
                  </div>
                </Link>

                {/* Clinical Flags */}
                <div className="patient-medical-col">
                  {pet.allergies.length > 0 && (
                    <Badge tone="danger">
                      <WarningCircle size={13} weight="fill" /> Allergy ({pet.allergies.join(', ')})
                    </Badge>
                  )}
                  {pet.alerts.length > 0 && (
                    <Badge tone="warning">
                      <WarningCircle size={13} weight="fill" /> {pet.alerts.length} care alert{pet.alerts.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                  {!pet.allergies.length && !pet.alerts.length && (
                    <span className="clean-record-chip">
                      <CheckCircle size={14} weight="bold" /> No active alerts
                    </span>
                  )}
                </div>

                {/* Vitals Shelf */}
                <div className="patient-vitals-col">
                  <div className="vitals-metric" title="Last recorded weight">
                    <Scales size={16} weight="duotone" />
                    <span>{pet.latestWeight ? `${pet.latestWeight} kg` : '—'}</span>
                  </div>
                  <small>Latest recorded</small>
                </div>

                {/* Owner & Quick Contact Actions */}
                <div className="patient-owner-col">
                  <div className="owner-meta">
                    <span className="owner-label">Owner</span>
                    <strong>{owner?.fullName || 'No owner recorded'}</strong>
                    <small>{owner?.phone || 'No phone'}</small>
                  </div>
                  <ContactActions contact={owner} />
                </div>

                {/* View Chart Action Button */}
                <Link to={`/patients/${pet.id}`} className="patient-open-btn" aria-label={`View ${pet.name}'s chart`}>
                  <span>View chart</span>
                  <CaretRight size={16} weight="bold" />
                </Link>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={PawPrint}
          title={hasFilters ? 'No matching patients' : 'No patients registered yet'}
          description={hasFilters ? 'Change your search or clear the filters to see all patients.' : 'Add an owner, then register their pet to start a patient record.'}
        />
      )}

      <OwnerDirectory />
      <div className="privacy-callout">
        <UsersThree size={20} weight="duotone" />
        <div>
          <strong>Personal information stays staff-only</strong>
          <span>Owner contact details and linked animal records are only available to authenticated clinic staff.</span>
        </div>
      </div>
      {modal === 'owner' && <AddOwnerModal onClose={() => setModal(null)} />}
      {modal === 'pet' && <AddPetModal onClose={() => setModal(null)} />}
    </div>
  )
}
