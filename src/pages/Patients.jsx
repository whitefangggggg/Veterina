import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CaretRight, MagnifyingGlass, PawPrint, Plus, UserPlus, UsersThree, WarningCircle } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, EmptyState, Field, Modal, PageHeader } from '../components/ui'
import PetSticker from '../components/PetSticker'
import MutationForm from '../components/MutationForm'

const emptyOwner = { fullName: '', phone: '', email: '', address: '', emergencyContact: '' }
const emptyPet = { name: '', ownerId: '', species: 'Dog', breed: '', sex: 'Male', reproductiveStatus: 'Intact', birthDate: '', color: '', microchip: '', allergies: '', latestWeight: '' }

function AddOwnerModal({ onClose }) {
  const { addOwner } = useClinicData()
  const [form, setForm] = useState(emptyOwner)
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    await addOwner(form,event.idempotencyKey)
    onClose()
  }

  return (
    <Modal title="Add pet owner" description="Create the household record first, then add their pets." onClose={onClose}>
      <MutationForm onSubmit={submit}>
        <div className="form-grid">
          <Field label="Full name" required span><input required value={form.fullName} onChange={set('fullName')} placeholder="e.g. Maria Santos" /></Field>
          <Field label="Mobile number" required><input required value={form.phone} onChange={set('phone')} placeholder="09XX XXX XXXX" /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} placeholder="owner@example.com" /></Field>
          <Field label="Home address" required span><textarea required rows="2" value={form.address} onChange={set('address')} placeholder="Barangay, city, province" /></Field>
          <Field label="Emergency contact" span><input value={form.emergencyContact} onChange={set('emergencyContact')} placeholder="Name · mobile number" /></Field>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary">Save owner</button></div>
      </MutationForm>
    </Modal>
  )
}

function AddPetModal({ onClose }) {
  const { owners, addPet } = useClinicData()
  const [form, setForm] = useState(() => ({ ...emptyPet, ownerId: owners[0]?.id || '' }))
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    await addPet(form,event.idempotencyKey)
    onClose()
  }

  return (
    <Modal title="Register a new patient" description="Add identity and baseline health information." onClose={onClose} wide>
      <MutationForm onSubmit={submit}>
        <div className="form-grid three-columns">
          <Field label="Pet name" required><input required value={form.name} onChange={set('name')} /></Field>
          <Field label="Owner" required><select required value={form.ownerId} onChange={set('ownerId')}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.fullName}</option>)}</select></Field>
          <Field label="Species" required><select value={form.species} onChange={set('species')}><option>Dog</option><option>Cat</option><option>Bird</option><option>Rabbit</option><option>Other</option></select></Field>
          <Field label="Breed" required><input required value={form.breed} onChange={set('breed')} /></Field>
          <Field label="Sex"><select value={form.sex} onChange={set('sex')}><option>Male</option><option>Female</option><option>Unknown</option></select></Field>
          <Field label="Reproductive status"><select value={form.reproductiveStatus} onChange={set('reproductiveStatus')}><option>Intact</option><option>Neutered</option><option>Spayed</option><option>Unknown</option></select></Field>
          <Field label="Birth date"><input type="date" value={form.birthDate} onChange={set('birthDate')} /></Field>
          <Field label="Current weight (kg)"><input type="number" min="0" step="0.01" value={form.latestWeight} onChange={set('latestWeight')} /></Field>
          <Field label="Color / markings"><input value={form.color} onChange={set('color')} /></Field>
          <Field label="Microchip number"><input value={form.microchip} onChange={set('microchip')} /></Field>
          <Field label="Known allergies" span><input value={form.allergies} onChange={set('allergies')} placeholder="Leave blank if none known" /></Field>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary">Register patient</button></div>
      </MutationForm>
    </Modal>
  )
}

export default function Patients() {
  const { pets, owners } = useClinicData()
  const [query, setQuery] = useState('')
  const [species, setSpecies] = useState('All')
  const [modal, setModal] = useState(null)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return pets.filter((pet) => {
      const owner = owners.find((item) => item.id === pet.ownerId)
      const matchesQuery = !normalized || [pet.name, pet.recordNumber, pet.breed, pet.microchip, owner?.fullName, owner?.phone]
        .some((value) => value?.toLowerCase().includes(normalized))
      return matchesQuery && (species === 'All' || pet.species === species)
    })
  }, [pets, owners, query, species])

  return (
    <div className="page">
      <PageHeader
        eyebrow="Clinical records"
        title="Patients & owners"
        description="Find complete records in seconds or register a new clinic patient."
        actions={
          <>
            <button className="button button-secondary" onClick={() => setModal('owner')}><UserPlus size={18} weight="duotone" /> Add owner</button>
            <button className="button button-primary" onClick={() => setModal('pet')}><Plus size={18} weight="bold" /> Register pet</button>
          </>
        }
      />

      <div className="list-toolbar">
        <label className="table-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pet, owner, phone or record number..." /></label>
        <div className="filter-pills">
          {['All', 'Dog', 'Cat', 'Other'].map((value) => <button key={value} onClick={() => setSpecies(value)} className={species === value ? 'active' : ''}>{value}</button>)}
        </div>
        <span className="result-count">{filtered.length} patient{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {filtered.length ? (
        <div className="patient-table section-card">
          <div className="table-head patient-grid"><span>Patient</span><span>Owner</span><span>Clinical notes</span><span>Last weight</span><span>Status</span><span /></div>
          {filtered.map((pet) => {
            const owner = owners.find((item) => item.id === pet.ownerId)
            return (
              <Link to={`/patients/${pet.id}`} className="table-row patient-grid" key={pet.id}>
                <div className="patient-cell">
                  <PetSticker pet={pet} />
                  <span><strong>{pet.name}</strong><small>{pet.breed} · {pet.species}</small><code>{pet.recordNumber}</code></span>
                </div>
                <div className="cell-owner"><span className="card-meta-label">Owner</span><strong>{owner?.fullName}</strong><small>{owner?.phone}</small></div>
                <div className="clinical-flags">
                  {pet.allergies.length > 0 && <Badge tone="danger"><WarningCircle size={13} weight="fill" /> Allergy</Badge>}
                  {pet.alerts.length > 0 && <Badge tone="warning">{pet.alerts.length} alert{pet.alerts.length > 1 ? 's' : ''}</Badge>}
                  {!pet.allergies.length && !pet.alerts.length && <span className="muted">No active alerts</span>}
                </div>
                <div className="cell-weight"><span className="card-meta-label">Last weight</span><strong>{pet.latestWeight ? `${pet.latestWeight} kg` : '—'}</strong><small>Latest visit</small></div>
                <div className="cell-status"><Badge tone="success">{pet.status}</Badge></div>
                <CaretRight size={19} weight="bold" className="row-chevron" />
              </Link>
            )
          })}
        </div>
      ) : (
        <EmptyState icon={PawPrint} title="No matching patients" description="Try a different search or register a new pet." />
      )}

      <div className="privacy-callout"><UsersThree size={20} weight="duotone" /><div><strong>Personal information stays staff-only</strong><span>Owner contact details and linked animal records are only available to authenticated clinic staff.</span></div></div>
      {modal === 'owner' && <AddOwnerModal onClose={() => setModal(null)} />}
      {modal === 'pet' && <AddPetModal onClose={() => setModal(null)} />}
    </div>
  )
}
