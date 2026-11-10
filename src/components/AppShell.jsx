import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  CalendarDots,
  CaretDown,
  ChartBar,
  FirstAidKit,
  FileText,
  Gear,
  MagnifyingGlass,
  Package,
  PawPrint,
  SignOut,
  SquaresFour,
  Stethoscope,
  Truck,
  X,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage } from '../lib/authAccess'
import GlobalSearch from './GlobalSearch'
import { isClinicLogoDataUrl } from '../lib/clinicLogo'
import SubscriptionTimer from './SubscriptionTimer'
import NotificationHub from './NotificationHub'
import { useDialogFocus } from '../lib/useDialogFocus'
import '../pages/PlatformAdmin.css'

const workspaces = [
  { to: '/queue', label: 'In-site queue', detail: 'Arrivals and care in progress', icon: FirstAidKit, color: 'amber' },
  { to: '/admissions', label: 'Admissions', detail: 'Hospitalization and inpatient care', icon: FirstAidKit, color: 'sage' },
  { to: '/patients', label: 'Patients', detail: 'Owners and clinical records', icon: PawPrint, color: 'sage' },
  { to: '/travel-certificates', label: 'Travel Certificates', detail: 'Pet vaccination and travel documents', icon: FileText, color: 'sage' },
  { to: '/appointments', label: 'Appointments', detail: 'Bookings, due care and owner follow-ups', icon: CalendarDots, color: 'mint' },
  { to: '/inventory', label: 'Inventory', detail: 'Stock, batches and expirations', icon: Package, color: 'blue' },
  { to: '/suppliers', label: 'Suppliers', detail: 'Ordering contacts', icon: Truck, color: 'amber' },
  { to: '/reports', label: 'Reports', detail: 'Clinic exports and summaries', icon: ChartBar, color: 'mint', ownerOnly: true },
  { to: '/settings', label: 'Settings', detail: 'Staff and clinic profile', staffDetail: 'Display mode and clinic information', icon: Gear, color: 'slate' },
  // Paused until the Knowledge workspace is ready for release.
  // { to: '/knowledge', label: 'Knowledge', detail: 'Approved documents and cited recall', icon: FirstAidKit, color: 'sage' },
]

function Brand() {
  const { settings } = useClinicData()
  const personalized = Boolean(settings?.onboarding_completed_at && settings?.brand_color)
  return (
    <Link to="/dashboard" className="header-brand" aria-label="Veterina home">
      <span>{personalized && isClinicLogoDataUrl(settings?.logo_data_url) ? <img src={settings.logo_data_url} alt="Clinic logo" /> : <Stethoscope size={23} weight="duotone" />}</span>
      <div><strong>{personalized ? settings.clinic_name : 'Veterina'}</strong><small>{personalized ? settings.tagline || 'Powered by Veterina' : 'Clinic care system'}</small></div>
    </Link>
  )
}

function WorkspaceSwitcher({ onClose }) {
  const location = useLocation()
  const { profile } = useAuth()
  const dialog = useRef(null)
  useDialogFocus(dialog, onClose)
  return (
    <div className="workspace-overlay" onMouseDown={onClose}>
      <section ref={dialog} tabIndex={-1} className="workspace-switcher" role="dialog" aria-modal="true" aria-label="Choose a workspace" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">Clinic workspaces</span><h2>Where would you like to go?</h2><p>Each area has its own focused space.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close workspace menu"><X size={20} /></button>
        </header>
        <div className="workspace-grid">
          {workspaces.filter((workspace) => !workspace.ownerOnly || profile.role === 'owner').map(({ to, label, detail, staffDetail, icon: Icon, color }) => (
            <Link key={to} to={to} onClick={onClose} aria-current={location.pathname.startsWith(to) ? 'page' : undefined} className={`workspace-tile ${location.pathname.startsWith(to) ? 'current' : ''}`}>
              <span className={`workspace-icon workspace-${color}`}><Icon size={27} weight="duotone" /></span>
              <span><strong>{label}</strong><small>{profile.role !== 'owner' && staffDetail ? staffDetail : detail}</small></span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function AppShell() {
  const { searchWorkspace } = useClinicData()
  const [searchOpen, setSearchOpen] = useState(false)
  const [workspacesOpen, setWorkspacesOpen] = useState(false)
  const location = useLocation()
  const { profile, user, signOut, accountAccess } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const name = profile.full_name || user.email
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const handleSignOut = async () => {
    setSigningOut(true)
    setSignOutError('')
    try { await signOut() } catch (error) { setSignOutError(authErrorMessage(error)) }
    finally { setSigningOut(false) }
  }
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!document.querySelector('[aria-modal="true"]')) setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell spacious-shell">
      <a className="skip-link" href="#clinic-main" onClick={() => document.getElementById('clinic-main')?.focus()}>Skip to clinic workspace</a>
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <Brand />
          <button className="workspace-trigger" onClick={() => setWorkspacesOpen(true)} aria-label="Open workspaces" aria-haspopup="dialog" aria-expanded={workspacesOpen}>
            <SquaresFour size={20} weight="duotone" /><span>Workspaces</span><CaretDown size={13} weight="bold" />
          </button>
          <button className="header-search" onClick={() => setSearchOpen(true)} aria-label="Search clinic records" aria-haspopup="dialog" aria-expanded={searchOpen} aria-keyshortcuts="Control+k Meta+k">
            <MagnifyingGlass size={18} /><span>Search clinic records</span><kbd>Ctrl K</kbd>
          </button>
          <div className="header-actions">
            {accountAccess?.isPlatformAdmin && <Link className="text-link" to="/admin">Platform admin</Link>}
            {!searchWorkspace && <NotificationHub key={location.pathname} />}
            <div className="profile-chip" title={`${name} · ${profile.role === 'owner' ? 'Clinic owner' : 'Clinical staff'}`}><span className="avatar small-avatar">{initials}</span><span><strong>{name}</strong><small>{profile.role === 'owner' ? 'Clinic owner' : 'Clinical staff'}</small></span></div>
            <button className="icon-button" onClick={handleSignOut} disabled={signingOut} aria-label={signingOut ? 'Signing out' : 'Sign out'} title="Sign out"><SignOut size={21} /></button>
          </div>
        </div>
      </header>
      {signOutError && <p className="workspace-auth-error" role="alert">{signOutError}</p>}
      <SubscriptionTimer />
      <main id="clinic-main" tabIndex={-1} className="main-content spacious-content"><div key={location.pathname} className="workspace-page-transition"><Outlet context={{ openSearch: () => setSearchOpen(true) }} /></div></main>
      {workspacesOpen && <WorkspaceSwitcher onClose={() => setWorkspacesOpen(false)} />}
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
