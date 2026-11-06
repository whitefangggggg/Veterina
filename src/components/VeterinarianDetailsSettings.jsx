import { useState } from 'react'
import { Info, MagnifyingGlass, PencilSimple, Stethoscope, UserPlus, Users, WarningCircle } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { veterinarianLicenseWarnings } from '../lib/veterinarianDetails'
import { RecordEditor } from './RecordForm'
import { Badge, EmptyState, Field, SectionCard } from './ui'
import './VeterinarianDetailsSettings.css'

export default function VeterinarianDetailsSettings({ onRegister }) {
  const { profiles, today, execute } = useClinicData()
  const { user, refreshAccess } = useAuth()
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const activeVeterinarians = profiles.filter((entry) => entry.is_veterinarian && entry.is_active).length
  const entries = profiles.filter((entry) => (filter === 'all' || entry.is_veterinarian)
    && [entry.full_name, entry.prc_license_number, entry.ptr_number, entry.tin_number].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => Number(Boolean(b.is_veterinarian)) - Number(Boolean(a.is_veterinarian)) || a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id))
  return <SectionCard title={<span className="veterinarian-title"><span><Stethoscope size={23} weight="duotone" aria-hidden="true" /></span>Veterinarian Details</span>}
    description="Manage your team's professional credentials and veterinarian designations."
    action={<button type="button" className="button button-primary" onClick={onRegister}><UserPlus size={18} aria-hidden="true" />Register a veterinarian</button>}
    className="veterinarian-details-settings">
    <div className="veterinarian-settings-body">
      <div className="veterinarian-toolbar">
        <div className="veterinarian-search"><MagnifyingGlass size={19} aria-hidden="true" /><Field label="Search veterinarian details"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, PRC, PTR or TIN" /></Field></div>
        <Field label="Show profiles"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All clinic accounts</option><option value="veterinarians">Veterinarians</option></select></Field>
      </div>
      <div className="veterinarian-directory-heading">
        <h3>Clinic directory <span aria-live="polite">{entries.length} {entries.length === 1 ? 'profile' : 'profiles'}</span></h3>
        <span className="veterinarian-active-count"><Stethoscope size={15} aria-hidden="true" />{activeVeterinarians} active {activeVeterinarians === 1 ? 'veterinarian' : 'veterinarians'}</span>
      </div>
      <div className="veterinarian-directory">{entries.map((entry) => {
        const credentials = [['PRC License Number', entry.prc_license_number], ['TIN', entry.tin_number], ['PTR Number', entry.ptr_number], ['License Expiry Date', entry.license_expires_on]]
        const missing = credentials.filter(([, value]) => !value?.trim()).length
        const warnings = entry.is_veterinarian ? veterinarianLicenseWarnings(entry, today) : []
        const initials = entry.full_name.trim().split(/\s+/).filter(Boolean).filter((part) => !/^dr\.?$/i.test(part)).map((part) => part[0])
        return <article className="veterinarian-profile" key={entry.id}>
          <header className="veterinarian-profile-header">
            <span className={`veterinarian-avatar${entry.is_veterinarian ? '' : ' veterinarian-avatar-neutral'}`} aria-hidden="true">{initials.length > 1 ? initials[0] + initials.at(-1) : initials[0] || '?'}</span>
            <div><h3>{entry.full_name}</h3><div className="veterinarian-badges"><Badge tone={entry.is_veterinarian ? 'blue' : 'neutral'}>{entry.is_veterinarian ? 'Veterinarian' : 'Not designated as veterinarian'}</Badge><Badge tone={entry.is_active ? 'success' : 'neutral'}>{entry.is_active ? 'Active' : 'Inactive'}</Badge></div></div>
          </header>
          <dl className="veterinarian-credentials">{credentials.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value?.trim() ? '' : 'veterinarian-missing'}>{value?.trim() || 'Not recorded'}</dd></div>)}</dl>
          {warnings.length > 0 && <div className="veterinarian-warnings"><WarningCircle size={18} aria-hidden="true" /><div>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
          <footer className="veterinarian-profile-footer"><span>{missing ? `${missing} ${missing === 1 ? 'detail' : 'details'} missing` : 'All details recorded'}</span><button type="button" className="button button-secondary small-button" aria-label={`Edit details for ${entry.full_name}`} onClick={() => setSelected(entry)}><PencilSimple size={16} aria-hidden="true" />Edit details</button></footer>
        </article>
      })}</div>
      {!entries.length && <EmptyState icon={Users} title="No matching profiles" description={query.trim() || filter !== 'all' ? 'Try another name or credential number, or show all clinic accounts.' : 'Register and approve a clinic staff account, then designate the person as a veterinarian here.'}
        action={query.trim() || filter !== 'all' ? <button type="button" className="button button-secondary" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button> : <button type="button" className="button button-secondary" onClick={onRegister}>Add a clinic account</button>} />}
      <div className="veterinarian-directory-note"><Info size={19} aria-hidden="true" /><p>Only active, designated veterinarians can be selected on new certificates. Manage account permissions under <button type="button" aria-label="Manage staff accounts" onClick={onRegister}>Staff accounts</button>.</p></div>
    </div>
    {selected && <RecordEditor title={`Veterinarian details for ${selected.full_name}`} description="Changes apply to future certificates. Issued certificates retain their saved identity and credentials."
      initial={{ fullName: selected.full_name, isVeterinarian: String(Boolean(selected.is_veterinarian)), tinNumber: selected.tin_number || '', prcLicenseNumber: selected.prc_license_number || '', ptrNumber: selected.ptr_number || '', licenseExpiresOn: selected.license_expires_on || '' }}
      fields={[{ name: 'fullName', label: 'Full name', required: true, maxLength: 120, span: true, hint: 'This is also the name displayed on the clinic staff account.' },
        { name: 'isVeterinarian', label: 'Veterinarian designation', type: 'select', required: true, span: true, options: [{ value: 'true', label: 'Veterinarian' }, { value: 'false', label: 'Not a veterinarian' }], hint: 'Designation does not change account permissions. Removing it prevents future certificate selection.' },
        { name: 'tinNumber', label: 'Veterinarian TIN', maxLength: 64 }, { name: 'prcLicenseNumber', label: 'PRC License Number', maxLength: 64 },
        { name: 'ptrNumber', label: 'PTR Number', maxLength: 64 }, { name: 'licenseExpiresOn', label: 'License Expiry Date', type: 'date', hint: 'Optional. Missing or expired license details show a warning during issuance.' }]}
      onSave={async (values) => { await execute('save_veterinarian_details', { id: selected.id, ...values, isVeterinarian: values.isVeterinarian === 'true' }); if (selected.id === user.id) await refreshAccess() }}
      onClose={() => setSelected(null)} submitLabel="Save veterinarian details" />}
  </SectionCard>
}
