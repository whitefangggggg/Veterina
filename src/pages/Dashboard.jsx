import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BellRinging,
  CalendarDots,
  ChartBar,
  FirstAidKit,
  MagnifyingGlass,
  Package,
  PawPrint,
  Plus,
  Heartbeat,
  Truck,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import PetSticker from '../components/PetSticker'
import { Badge } from '../components/ui'
import { clinicToday } from '../lib/clinicRepository'
import { useAuth } from '../context/AuthContext'

const today = clinicToday()

const spaces = [
  { to: '/patients', title: 'Patient records', description: 'Owners, pets, checkups and complete clinical histories.', icon: PawPrint, color: 'sage' },
  { to: '/appointments', title: 'Appointments', description: 'A calm monthly calendar and focused daily agenda.', icon: CalendarDots, color: 'mint' },
  { to: '/reminders', title: 'Reminder center', description: 'Today’s calls, follow-ups and upcoming vaccines.', icon: BellRinging, color: 'blue' },
  { to: '/inventory', title: 'Inventory', description: 'Quantities, stock movements, batches and expirations.', icon: Package, color: 'blue' },
  { to: '/suppliers', title: 'Suppliers', description: 'Ordering contacts and linked clinic supplies.', icon: Truck, color: 'amber' },
  { to: '/reports', title: 'Reports', description: 'Patient histories, vaccine lists and clinic exports.', icon: ChartBar, color: 'mint' },
]

export default function Dashboard() {
  const { appointments, reminders, inventory, getPet, getOwner,profile } = useClinicData()
  const {isDemo}=useAuth()
  const todayAppointments = appointments.filter((item) => item.date === today).sort((a, b) => a.time.localeCompare(b.time))
  const dueReminders = reminders.filter((item) => item.status === 'Due' || item.status === 'Overdue')
  const lowStock = inventory.filter((item) => item.quantity <= item.minimumStock)

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-greeting">
          <span className="hero-kicker"><Heartbeat size={16} weight="duotone" /> {new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'long',day:'numeric',month:'long'}).format(new Date())}</span>
          <h1>Welcome,<br /><span>{isDemo?'Demo staff':profile?.full_name}.</span></h1>
          <p>Patient care, scheduling, and clinic operations — ready when you are.</p>
          <div className="hero-actions">
            <Link className="button button-primary roomy-button" to="/patients"><MagnifyingGlass size={19} weight="bold" /> Find a patient</Link>
            <Link className="button button-glass roomy-button" to="/appointments"><Plus size={19} weight="bold" /> New appointment</Link>
          </div>
        </div>
        <div className="today-glance">
          <div className="glance-heading"><span><FirstAidKit size={20} weight="duotone" /> Today at Veterina</span><Link to="/appointments">Open calendar <ArrowRight size={15} /></Link></div>
          <div className="glance-metrics">
            <div><strong>{todayAppointments.length}</strong><span>appointments</span></div>
            <div><strong>{dueReminders.length}</strong><span>calls due</span></div>
            <div><strong>{lowStock.length}</strong><span>low-stock items</span></div>
          </div>
          <div className="next-patients">
            <span className="glance-label">Next patients</span>
            {todayAppointments.slice(0, 3).map((appointment) => {
              const pet = getPet(appointment.petId)
              const owner = getOwner(pet?.ownerId)
              return (
                <Link to={`/patients/${pet?.id}`} key={appointment.id}>
                  <time>{appointment.time}</time>
                  <PetSticker pet={pet} size="small" />
                  <span><strong>{pet?.name}</strong><small>{appointment.service} · {owner?.fullName}</small></span>
                  <Badge tone={appointment.status === 'Confirmed' ? 'success' : 'warning'}>{appointment.status}</Badge>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section className="spaces-section">
        <div className="spaces-heading">
          <div><span className="eyebrow">Your clinic</span><h2>Choose a workspace</h2><p>Open a focused area and keep the rest of the day out of the way.</p></div>
        </div>
        <div className="space-card-grid">
          {spaces.map(({ to, title, description, icon: Icon, color }) => (
            <Link to={to} className="space-card" key={to}>
              <span className={`workspace-icon workspace-${color}`}><Icon size={31} weight="duotone" /></span>
              <div><h3>{title}</h3><p>{description}</p></div>
              <span className="space-arrow"><ArrowRight size={18} /></span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
