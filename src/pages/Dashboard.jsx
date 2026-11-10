import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, Plus, Stethoscope } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { ActionRadar, LiveClinicFloor } from '../components/DailyWorklist'
import { QueueDialog } from '../components/QueueEditors'
import { VisitEditor } from '../components/ClinicalEditors'
import { Badge } from '../components/ui'
import PetSticker from '../components/PetSticker'
import { appointmentSource, patientSource } from '../lib/dailyWorkflow'
import { appointmentTime, clinicShift, dashboardWork } from '../lib/dashboard'
import { isClinicLogoDataUrl } from '../lib/clinicLogo'
import { useRecentPatients } from '../lib/useRecentPatients'
import './Dashboard.css'

function ShiftCommandBar({ now, onWalkIn }) {
  const { settings } = useClinicData()
  const { profile } = useAuth()
  const shift = clinicShift(settings, now)
  return <section className="shift-command-bar" aria-label="Shift command bar">
    <div className="shift-brand"><span className="shift-logo">{isClinicLogoDataUrl(settings?.logo_data_url) ? <img src={settings.logo_data_url} alt="Clinic logo" /> : <Stethoscope size={23} aria-hidden="true" />}</span>
      <div><h1 title={settings?.clinic_name}>{settings?.clinic_name || 'Clinic dashboard'}</h1><p>{shift.greeting}, {profile.full_name || 'clinic team'}.</p></div></div>
    <div className="shift-context"><Badge tone={shift.status === 'open' ? 'success' : 'neutral'}>{shift.label}</Badge><time>{shift.date}</time></div>
    <div className="shift-actions"><button className="button button-primary" onClick={onWalkIn}><Plus size={17} aria-hidden="true" />Quick Walk-In</button>
      <Link className="button button-secondary" to="/appointments?new=1"><CalendarPlus size={17} aria-hidden="true" />Book appointment</Link>
    </div>
  </section>
}

function AppointmentStream({ appointments }) {
  const { getPet, getOwner } = useClinicData()
  return <section className="appointment-stream-card" aria-labelledby="appointment-stream-title">
    <header><h2 id="appointment-stream-title">Today’s appointment stream</h2><Link className="text-link" to="/appointments">Open calendar</Link></header>
    {!appointments.length ? <p className="command-empty">No appointments booked today. Ready for walk-in arrivals.</p>
      : <div className="appointment-stream" tabIndex={0} role="region" aria-label="Today’s appointments, scroll for more">{appointments.map((appointment) => {
        const pet = getPet(appointment.petId), owner = getOwner(pet?.ownerId)
        const status = appointment.arrival ? { waiting: 'Waiting', in_progress: 'In consultation', completed: 'Completed' }[appointment.arrival.status] : appointment.status
        return <Link className="stream-appointment" key={appointment.id} to={appointmentSource(appointment)}><time>{appointmentTime(appointment.time)}</time><PetSticker pet={pet} size="small" /><span><strong>{pet?.name || 'Patient unavailable'}</strong><small>{appointment.service} · {owner?.fullName || 'Owner not recorded'}</small></span><Badge tone={status === 'Completed' ? 'success' : status === 'Waiting' ? 'warning' : 'blue'}>{status}</Badge></Link>
      })}</div>}
  </section>
}

function RecentPatients() {
  const { ids, clear } = useRecentPatients()
  const { getPet } = useClinicData()
  const pets = ids.map((id) => getPet(id)).filter(Boolean)
  return <section className="recent-patients-tray" aria-labelledby="recent-patients-title"><div><h2 id="recent-patients-title">Recent patients</h2><small>Pick up where you left off</small></div>
    {pets.length ? <><button className="text-link" onClick={clear}>Clear recent patients</button><div className="recent-patient-chips">{pets.map((pet) => <Link className="recent-patient-chip" to={patientSource(pet.id)} key={pet.id}><PetSticker pet={pet} size="small" /><span><strong>{pet.name}</strong><small>{pet.recordNumber}</small></span></Link>)}</div></>
      : <p className="command-empty">Patients you open appear here on this browser. <Link to="/patients" className="text-link">Find a patient</Link></p>}
  </section>
}

export default function Dashboard() {
  const data = useClinicData()
  const { user, accountAccess } = useAuth()
  const [now, setNow] = useState(() => new Date())
  const [modal, setModal] = useState(null)
  const { record } = useRecentPatients()
  const { reload } = data
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { setNow(new Date()); void reload() } }
    const timer = setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [reload])
  const work = dashboardWork(data, user.id, now)
  const open = (next) => {
    const id = next.entry?.petId || next.visit?.petId
    if (id && data.getPet(id)) record(id)
    setModal(next)
  }
  const walkIn = () => setModal({ type: 'walkin' })
  return <div className="command-dashboard">
    <ShiftCommandBar now={now} onWalkIn={walkIn} />
    <div className="command-dashboard-grid"><LiveClinicFloor work={work} onOpen={open} onWalkIn={walkIn} /><ActionRadar key={`${user.id}:${accountAccess?.subscription?.clinicId}`} work={work} onOpen={open} /></div>
    <AppointmentStream appointments={work.appointments} />
    <RecentPatients />
    {modal?.type === 'chart' ? data.getPet(modal.visit.petId) && <VisitEditor pet={data.getPet(modal.visit.petId)} record={modal.visit} onClose={() => setModal(null)} />
      : <QueueDialog modal={modal} onClose={() => setModal(null)} />}
  </div>
}
