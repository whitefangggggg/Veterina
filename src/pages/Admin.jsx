import { useState } from 'react'
import { ClipboardText, ClockCountdown, FileText, PawPrint, ShieldCheck, Syringe } from '@phosphor-icons/react'
import { PageHeader, SectionCard } from '../components/ui'
import { AsyncForm } from '../components/RecordForm'
import StaffAdmin from '../components/StaffAdmin'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { downloadReport, fetchReport, printPatientHistory } from '../lib/reports'

export function Reports() {
  const { pets, profiles, settings } = useClinicData()
  const { profile } = useAuth()
  const [patientId, setPatientId] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ date_from: '', date_to: '', species: '', patient_status: '', reminder_status: 'all', category: '', low_stock_only: false, include_archived: false })
  const invalidDates = filters.date_from && filters.date_to && filters.date_from > filters.date_to
  const changeFilter = (name) => (event) => setFilters((current) => ({ ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const filtersFor = (report) => report === 'patients' ? { species: filters.species, patient_status: filters.patient_status }
    : report === 'inventory' ? { category: filters.category, low_stock_only: filters.low_stock_only, include_archived: filters.include_archived }
      : { date_from: filters.date_from, date_to: filters.date_to, ...(report === 'reminders' ? { reminder_status: filters.reminder_status } : {}) }
  const reports = [
    { id: 'patients', icon: PawPrint, title: 'Patient register', description: 'Patient identities, owners and identifiers', format: 'CSV' },
    { id: 'vaccinations', icon: Syringe, title: 'Vaccinations due', description: 'Recorded doses and next-due dates', format: 'CSV' },
    { id: 'history', icon: FileText, title: 'Complete clinical history', description: 'Identity, owner, alerts, encounters, vitals, vaccines and prescriptions', format: 'Print / Save as PDF' },
    { id: 'inventory', icon: ClipboardText, title: 'Inventory status', description: 'Stock on hand, minimum levels and expirations', format: 'CSV' },
    { id: 'reminders', icon: ClockCountdown, title: 'Reminder outcomes', description: 'Follow-ups, due dates and contact outcomes', format: 'CSV' },
  ]
  const prepare = async (report) => {
    setBusy(report); setMessage(''); setError('')
    try {
      if (report === 'history') {
        const rows = await fetchReport(report, patientId || undefined)
        printPatientHistory(rows[0], { profiles, clinic: settings })
        setMessage('Complete history prepared for printing.')
      } else {
        const count = await downloadReport(report, filtersFor(report))
        setMessage(count + ' records exported.')
      }
    } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  return <div className="page">
    <PageHeader eyebrow="Clinic exports" title="Reports" description="Export saved clinic records. Every export is checked and recorded on the server." />
    {profile.role !== 'owner' ? <p className="auth-message">Only the clinic owner can export records.</p> : <>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}
      <SectionCard title="Report filters" description="Due dates apply to vaccination and reminder exports. Complete patient histories always include every encounter.">
        <div className="settings-panel form-grid">
          <label className="field"><span>Due from</span><input aria-label="Due from" type="date" value={filters.date_from} onChange={changeFilter('date_from')} /></label>
          <label className="field"><span>Due through</span><input aria-label="Due through" type="date" min={filters.date_from || undefined} value={filters.date_to} onChange={changeFilter('date_to')} /></label>
          <label className="field"><span>Patient species</span><select aria-label="Patient species" value={filters.species} onChange={changeFilter('species')}><option value="">All species</option>{['Dog','Cat','Bird','Rabbit','Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field"><span>Patient status</span><select aria-label="Patient status" value={filters.patient_status} onChange={changeFilter('patient_status')}><option value="">All statuses</option>{['Active','Inactive','Deceased'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field"><span>Reminder status</span><select aria-label="Reminder status" value={filters.reminder_status} onChange={changeFilter('reminder_status')}>{['all','open','due','overdue','upcoming','completed','cancelled'].map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase()+value.slice(1)}</option>)}</select></label>
          <label className="field"><span>Inventory category</span><select aria-label="Inventory category" value={filters.category} onChange={changeFilter('category')}><option value="">All categories</option>{['Vaccines','Medicine','Consumables','Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><input type="checkbox" checked={filters.low_stock_only} onChange={changeFilter('low_stock_only')} /> Low stock only</label>
          <label><input type="checkbox" checked={filters.include_archived} onChange={changeFilter('include_archived')} /> Include archived inventory</label>
          {invalidDates && <p className="auth-message auth-error" role="alert">Due through must be on or after Due from.</p>}
        </div>
      </SectionCard>
      <div className="report-grid">{reports.map(({ id, icon: Icon, title, description, format }) => <SectionCard key={id} className="report-card">
        <div className="report-icon"><Icon size={23} /></div><h2>{title}</h2><p>{description}</p><span>{format}</span>
        {id === 'history' && <label className="field"><span>Patient</span><select aria-label="Patient for history export" value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Select patient</option>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name} · {pet.recordNumber}</option>)}</select></label>}
        <button className="button button-secondary" disabled={Boolean(busy) || (id === 'history' && !patientId) || (['vaccinations','reminders'].includes(id) && Boolean(invalidDates))} onClick={() => prepare(id)}>{busy === id ? 'Preparing...' : 'Prepare report'}</button>
      </SectionCard>)}</div>
    </>}
    <div className="privacy-callout"><ShieldCheck size={20} /><div><strong>Exports contain personal information</strong><span>Keep exported files within your clinic’s approved storage.</span></div></div>
  </div>
}

export function Settings() {
  const { settings, profiles, execute } = useClinicData()
  const { user, profile, refreshAccess } = useAuth()
  const [tab, setTab] = useState('profile')
  const [saved, setSaved] = useState(false)
  const ownProfile = profiles.find((entry) => entry.id === user.id)
  if (profile.role !== 'owner') return <div className="page"><PageHeader title="Clinic settings" description="Clinic settings and staff administration are managed by the clinic owner." /><SectionCard title={settings?.clinic_name}><div className="directory-card"><p>{settings?.address}</p><p>{settings?.phone}</p><p>{settings?.email}</p><p>Clinic timezone: {settings?.timezone}</p></div></SectionCard></div>
  return <div className="page">
    <PageHeader eyebrow="Owner access" title="Clinic settings" description="Persisted clinic identity, professional details, privacy settings and staff access." />
    <div className="tabs"><button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Clinic profile</button><button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>Staff accounts</button></div>
    {tab === 'staff' ? <SectionCard className="settings-panel"><StaffAdmin /></SectionCard> : <SectionCard title="Clinic profile">
      <div className="settings-panel">
      {saved && <p className="auth-message" role="status">Clinic settings saved.</p>}
      <AsyncForm submitLabel="Save settings" onSave={async (values) => { setSaved(false); await execute('save_settings', { ...values, aiEnabled: values.aiEnabled === 'on' }); await refreshAccess(); setSaved(true) }}>
        <div className="form-grid">
          <label className="field"><span>Clinic name *</span><input name="clinicName" defaultValue={settings?.clinic_name || ''} required /></label>
          <label className="field"><span>Clinic phone</span><input name="phone" type="tel" defaultValue={settings?.phone || ''} /></label>
          <label className="field"><span>Clinic email</span><input name="email" type="email" defaultValue={settings?.email || ''} /></label>
          <label className="field"><span>Clinic address</span><input name="address" defaultValue={settings?.address || ''} /></label>
          <label className="field"><span>Clinic timezone *</span><input name="timezone" defaultValue={settings?.timezone || 'Asia/Manila'} required placeholder="Asia/Manila" /></label>
          <label className="field"><span>Retention (years) *</span><input name="retentionYears" type="number" min="1" max="50" required defaultValue={settings?.record_retention_years || 10} /></label>
          <label className="field"><span>Reminder lead days *</span><input name="reminderLeadDays" type="number" min="0" max="365" required defaultValue={settings?.reminder_lead_days ?? 3} /></label>
          <label className="field"><span>Record recall assistant</span><span><input name="aiEnabled" type="checkbox" defaultChecked={settings?.ai_enabled || false} /> Enable cited record recall</span></label>
          <div className="form-divider full"><h3>Your professional details</h3><p>Printed with the clinic’s clinical documents.</p></div>
          <label className="field"><span>Full name *</span><input name="fullName" required defaultValue={ownProfile.full_name} /></label>
          <label className="field"><span>PRC license number</span><input name="prcLicenseNumber" defaultValue={ownProfile.prc_license_number || ''} /></label>
          <label className="field"><span>PTR number</span><input name="ptrNumber" defaultValue={ownProfile.ptr_number || ''} /></label>
          <label className="field"><span>License expiry</span><input name="licenseExpiresOn" type="date" defaultValue={ownProfile.license_expires_on || ''} /></label>
        </div>
      </AsyncForm>
      </div>
    </SectionCard>}
  </div>
}
