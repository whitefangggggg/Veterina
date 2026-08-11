import { useState } from 'react'
import {
  Check,
  ClipboardText,
  ClockCountdown,
  DownloadSimple,
  FileText,
  FloppyDisk,
  LockKey,
  PawPrint,
  ShieldCheck,
  Syringe,
  UserGear,
  UsersThree,
} from '@phosphor-icons/react'
import { PageHeader, SectionCard } from '../components/ui'

export function Reports() {
  const reports = [
    { icon: PawPrint, title: 'Patient register', description: 'All active pets with owners and identifiers', format: 'CSV' },
    { icon: Syringe, title: 'Vaccinations due', description: 'Patients due for vaccines in the selected period', format: 'CSV / Print' },
    { icon: FileText, title: 'Complete clinical history', description: 'Printable medical history for one patient', format: 'PDF / Print' },
    { icon: ClipboardText, title: 'Inventory status', description: 'On-hand stock, minimum levels and expirations', format: 'CSV' },
    { icon: ClockCountdown, title: 'Reminder outcomes', description: 'Completed calls, outcomes and pending follow-ups', format: 'CSV' },
  ]
  return (
    <div className="page">
      <PageHeader eyebrow="Clinic exports" title="Reports" description="Prepare operational lists and complete patient records." />
      <div className="report-grid">
        {reports.map(({ icon: Icon, title, description, format }) => (
          <SectionCard key={title} className="report-card">
            <div className="report-icon"><Icon size={23} weight="duotone" /></div>
            <h2>{title}</h2>
            <p>{description}</p>
            <span>{format}</span>
            <button className="button button-secondary"><DownloadSimple size={17} weight="bold" /> Prepare report</button>
          </SectionCard>
        ))}
      </div>
      <div className="privacy-callout"><ShieldCheck size={20} weight="duotone" /><div><strong>Exports contain personal information</strong><span>Only the owner/head doctor can create complete data exports. Every export will be recorded in the audit log.</span></div></div>
    </div>
  )
}

export function Settings() {
  const [saved, setSaved] = useState(false)
  const save = (event) => {
    event.preventDefault()
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }
  return (
    <div className="page">
      <PageHeader eyebrow="Owner access" title="Clinic settings" description="Manage identity, professional details and staff permissions." />
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className="active"><PawPrint size={18} weight="duotone" /> Clinic profile</button>
          <button><UsersThree size={18} weight="duotone" /> Staff accounts</button>
          <button><UserGear size={18} weight="duotone" /> Roles & access</button>
          <button><LockKey size={18} weight="duotone" /> Privacy & retention</button>
        </nav>
        <SectionCard title="Clinic profile" description="Used on printed histories and vaccination certificates.">
          <form onSubmit={save} className="settings-form">
            <label><span>Clinic name</span><input defaultValue="Veterina Veterinary Clinic" /></label>
            <label><span>Clinic phone</span><input defaultValue="0917 000 0000" /></label>
            <label className="full"><span>Clinic address</span><input defaultValue="Cebu, Philippines" /></label>
            <div className="form-divider full"><h3>Head veterinarian</h3><p>Professional details appear on signed clinical documents.</p></div>
            <label><span>Full name</span><input defaultValue="Dr. Andrea Villanueva" /></label>
            <label><span>PRC license number</span><input placeholder="Enter PRC number" /></label>
            <label><span>PTR number</span><input placeholder="Enter PTR number" /></label>
            <label><span>License expiry</span><input type="date" /></label>
            <div className="form-actions full"><button className="button button-primary">{saved ? <Check size={18} weight="bold" /> : <FloppyDisk size={18} weight="duotone" />}{saved ? 'Saved' : 'Save settings'}</button></div>
          </form>
        </SectionCard>
      </div>
    </div>
  )
}
