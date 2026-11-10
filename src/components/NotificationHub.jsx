import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRinging, CalendarDots, X } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { appointmentSource, STOCK_EXPIRY_WARNING_DAYS, stockExpiryAlerts } from '../lib/dailyWorkflow'
import PetSticker from './PetSticker'
import { Badge } from './ui'

export default function NotificationHub() {
  const { appointments, reminders, inventory, getPet, getOwner, today } = useClinicData()
  const [open, setOpen] = useState(false)
  const wrapper = useRef(null)
  const trigger = useRef(null)
  const closeButton = useRef(null)
  const pending = appointments.filter((appointment) => appointment.date === today && !['Cancelled', 'No Show', 'Completed'].includes(appointment.status)).sort((a, b) => a.time.localeCompare(b.time))
  const due = reminders.filter((task) => ['Due', 'Overdue'].includes(task.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const expiries = stockExpiryAlerts(inventory, today)
  const count = pending.length + due.length + expiries.length
  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const outside = (event) => { if (!wrapper.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="notification-wrapper" ref={wrapper} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={trigger} type="button" className={`notification-button icon-button ${open ? 'is-active' : ''}`} aria-label={`${count} clinic notification${count === 1 ? '' : 's'}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'clinic-agenda' : undefined} onClick={() => setOpen(!open)}>
      <BellRinging size={21} weight="duotone" />{count > 0 && <span className="notification-badge">{count > 99 ? '99+' : count}</span>}
    </button>
    {open && <section id="clinic-agenda" className="notification-popover" role="dialog" aria-label="Clinic notifications">
      <header className="notif-header"><div><strong>Today’s Clinic Glance</strong><small>{new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${today}T00:00:00Z`))}</small></div><button ref={closeButton} className="icon-button" aria-label="Close agenda" onClick={() => { setOpen(false); trigger.current?.focus() }}><X size={18} /></button></header>
      {expiries.length > 0 && <div className="notif-section notif-expiries"><h2>Stock expiry warnings <span>{expiries.length} batch{expiries.length === 1 ? '' : 'es'}</span></h2>
        {expiries.slice(0, 3).map(({ item, batch, status, label, href }) => <Link key={batch.id} className="notif-item notif-expiry-item" to={href} onClick={() => setOpen(false)}>
          <span className="notif-info"><strong>{item.name}</strong><small>{batch.lot_number || 'Unnumbered batch'} · {batch.quantity} {item.unit} · {batch.expiration_date}</small></span><Badge tone={status === 'expired' ? 'danger' : 'warning'}>{label}</Badge>
        </Link>)}
        <Link className="text-link notif-expiry-all" to="/inventory?attention=expiry" onClick={() => setOpen(false)}>Review all expiry warnings · {STOCK_EXPIRY_WARNING_DAYS}-day window</Link>
      </div>}
      <div className="notif-section"><h2>Pending appointments <span>{pending.length}</span></h2>
        {!pending.length && <p className="notif-empty">No remaining appointments today.</p>}
        {pending.slice(0, 3).map((appointment) => {
          const pet = getPet(appointment.petId), owner = getOwner(pet?.ownerId)
          return <Link key={appointment.id} className="notif-item" to={appointmentSource(appointment)} onClick={() => setOpen(false)}><time>{appointment.time}</time><PetSticker pet={pet} size="small" /><span className="notif-info"><strong>{pet?.name || 'View patient'}</strong><small>{appointment.service} · {owner?.fullName || 'Owner not recorded'}</small></span><Badge tone={appointment.status === 'Confirmed' ? 'success' : 'warning'}>{appointment.status}</Badge></Link>
        })}
      </div>
      <div className="notif-section"><h2>Tasks &amp; follow-ups <span>{due.length}</span></h2>
        {!due.length && <p className="notif-empty">All follow-ups up to date!</p>}
        {due.slice(0, 2).map((task) => <Link key={task.id} className="notif-task-item" to={`/appointments?view=tasks&status=${encodeURIComponent(task.status)}#reminder-${encodeURIComponent(task.id)}`} onClick={() => setOpen(false)}><span className={`task-dot ${task.status.toLowerCase()}`} /><span>{task.title}</span><Badge tone={task.status === 'Overdue' ? 'danger' : 'warning'}>{task.status}</Badge></Link>)}
      </div>
      <footer className="notif-footer"><Link className="button button-primary small-button" to="/appointments" onClick={() => setOpen(false)}><CalendarDots size={16} /> Open Calendar</Link><Link className="button button-secondary small-button" to="/appointments?view=tasks" onClick={() => setOpen(false)}>Follow-up Tasks</Link></footer>
    </section>}
  </div>
}
