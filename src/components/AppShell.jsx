import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BellRinging,
  CalendarDots,
  CaretDown,
  ChartBar,
  FirstAidKit,
  Gear,
  MagnifyingGlass,
  Package,
  PawPrint,
  SquaresFour,
  Stethoscope,
  Truck,
  X,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import PetSticker from './PetSticker'

const workspaces = [
  { to: '/patients', label: 'Patients', detail: 'Owners and clinical records', icon: PawPrint, color: 'sage' },
  { to: '/appointments', label: 'Appointments', detail: 'Calendar and daily agenda', icon: CalendarDots, color: 'mint' },
  { to: '/reminders', label: 'Reminders', detail: 'Calls, vaccines and follow-ups', icon: BellRinging, color: 'blue' },
  { to: '/inventory', label: 'Inventory', detail: 'Stock, batches and expirations', icon: Package, color: 'blue' },
  { to: '/suppliers', label: 'Suppliers', detail: 'Ordering contacts', icon: Truck, color: 'amber' },
  { to: '/reports', label: 'Reports', detail: 'Clinic exports and summaries', icon: ChartBar, color: 'mint' },
  { to: '/settings', label: 'Settings', detail: 'Staff and clinic profile', icon: Gear, color: 'slate' },
]

function Brand() {
  return (
    <Link to="/dashboard" className="header-brand" aria-label="Veterina home">
      <span><Stethoscope size={23} weight="duotone" /></span>
      <div><strong>Veterina</strong><small>Clinic care system</small></div>
    </Link>
  )
}

function WorkspaceSwitcher({ onClose }) {
  const location = useLocation()
  return (
    <div className="workspace-overlay" onMouseDown={onClose}>
      <section className="workspace-switcher" role="dialog" aria-modal="true" aria-label="Choose a workspace" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">Clinic workspaces</span><h2>Where would you like to go?</h2><p>Each area has its own focused space.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close workspace menu"><X size={20} /></button>
        </header>
        <div className="workspace-grid">
          {workspaces.map(({ to, label, detail, icon: Icon, color }) => (
            <Link key={to} to={to} onClick={onClose} className={`workspace-tile ${location.pathname.startsWith(to) ? 'current' : ''}`}>
              <span className={`workspace-icon workspace-${color}`}><Icon size={27} weight="duotone" /></span>
              <span><strong>{label}</strong><small>{detail}</small></span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function GlobalSearch({ onClose }) {
  const { pets, owners } = useClinicData()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')

  useEffect(() => inputRef.current?.focus(), [])

  const normalized = query.trim().toLowerCase()
  const results = normalized
    ? pets.filter((pet) => {
        const owner = owners.find((item) => item.id === pet.ownerId)
        return [pet.name, pet.recordNumber, pet.microchip, owner?.fullName, owner?.phone]
          .some((value) => value?.toLowerCase().includes(normalized))
      }).slice(0, 6)
    : []

  const openPet = (id) => {
    navigate(`/patients/${id}`)
    onClose()
  }

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search clinic records" onMouseDown={onClose}>
      <div className="global-search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="global-search-input">
          <MagnifyingGlass size={22} weight="bold" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any patient, owner or record..."
            onKeyDown={(event) => event.key === 'Escape' && onClose()}
          />
          <button className="icon-button" onClick={onClose} aria-label="Close search"><X size={20} /></button>
        </div>
        {!normalized && (
          <div className="search-empty">
            <FirstAidKit size={34} weight="duotone" />
            <p>Find a clinic record</p>
            <span>Search by pet, owner, phone, microchip or record number.</span>
          </div>
        )}
        {normalized && results.length === 0 && <div className="search-empty"><p>No matching clinic records found.</p></div>}
        {results.map((pet) => {
          const owner = owners.find((item) => item.id === pet.ownerId)
          return (
            <button key={pet.id} className="search-result" onClick={() => openPet(pet.id)}>
              <PetSticker pet={pet} size="small" />
              <span><strong>{pet.name}</strong><small>{pet.breed} · {owner?.fullName}</small></span>
              <code>{pet.recordNumber}</code>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [workspacesOpen, setWorkspacesOpen] = useState(false)
  const { reminders } = useClinicData()
  const dueCount = reminders.filter((item) => item.status === 'Due' || item.status === 'Overdue').length
  const overlayOpen = searchOpen || workspacesOpen

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setWorkspacesOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('overlay-open', overlayOpen)
    return () => document.body.classList.remove('overlay-open')
  }, [overlayOpen])

  return (
    <div className="app-shell spacious-shell">
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <Brand />
          <button className="workspace-trigger" onClick={() => setWorkspacesOpen(true)} aria-label="Open workspaces">
            <SquaresFour size={20} weight="duotone" /><span>Workspaces</span><CaretDown size={13} weight="bold" />
          </button>
          <button className="header-search" onClick={() => setSearchOpen(true)} aria-label="Search clinic records">
            <MagnifyingGlass size={18} /><span>Search clinic records</span><kbd>Ctrl K</kbd>
          </button>
          <div className="header-actions">
            <Link to="/reminders" className="notification-button icon-button" aria-label={`${dueCount} reminders due`}>
              <BellRinging size={21} weight="duotone" />
              {dueCount > 0 && <span>{dueCount}</span>}
            </Link>
            <button className="profile-chip"><span className="avatar small-avatar">AV</span><span><strong>Dr. Andrea</strong><small>Head doctor</small></span><CaretDown size={13} /></button>
          </div>
        </div>
      </header>
      <main className="main-content spacious-content"><Outlet /></main>
      {workspacesOpen && <WorkspaceSwitcher onClose={() => setWorkspacesOpen(false)} />}
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
