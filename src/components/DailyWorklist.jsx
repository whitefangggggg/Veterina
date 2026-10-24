import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useClinicData } from '../context/ClinicDataContext'
import { appointmentSource, buildDailyWork, patientSource, reminderSource, stockAttention } from '../lib/dailyWorkflow'
import { Badge, SectionCard } from './ui'

export default function DailyWorklist() {
  const data = useClinicData()
  const { reload } = data
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, 30000)
    return () => clearInterval(timer)
  }, [reload])
  const { care, checkins, calls } = buildDailyWork(data)
  const stock = stockAttention(data.inventory, data.today)
  const patientName = (id) => data.getPet(id)?.name || 'Patient unavailable'
  return <section className="daily-work-section" aria-labelledby="daily-work-heading">
    <div className="spaces-heading"><div><span className="eyebrow">Daily priorities</span><h2 id="daily-work-heading">Today’s action board</h2><p>Keep care moving, follow up with owners, and review stock that needs attention.</p></div></div>
    <div className="daily-work-grid">
      <SectionCard title={`Care at the clinic (${care.length})`} description="In-progress care first, then waiting patients by arrival time." action={<Link className="text-link" to="/queue">Open queue</Link>}>
        <ul className="daily-work-list">{care.slice(0, 5).map((entry) => <li key={entry.id}><div><Link className="daily-patient-link" to={patientSource(entry.petId)}>{patientName(entry.petId)}</Link><small>{entry.queueNumber} · {entry.service}</small><span>{entry.status === 'in_progress' ? 'At clinic for' : 'Waiting for'} {Number.isFinite(entry.waitMinutes) ? `${entry.waitMinutes} min` : 'time unavailable'}</span></div><div><Badge tone={entry.status === 'in_progress' ? 'blue' : 'warning'}>{entry.status === 'in_progress' ? 'In progress' : 'Waiting'}</Badge><Link className="text-link" to={entry.href}>{entry.draftSavedAt ? 'Resume care' : 'Open arrival'}</Link></div></li>)}</ul>
        {!care.length && <p className="daily-empty">No patients waiting or in care.</p>}
        {care.length > 5 && <Link className="text-link" to="/queue">View all {care.length} active arrivals</Link>}
      </SectionCard>
      <SectionCard title={`Check-ins today (${checkins.length})`} description="Today’s bookings that have not arrived." action={<Link className="text-link" to="/appointments">Open calendar</Link>}>
        <ul className="daily-work-list">{checkins.slice(0, 5).map((appointment) => <li key={appointment.id}><div><Link className="daily-patient-link" to={patientSource(appointment.petId)}>{patientName(appointment.petId)}</Link><small>{appointment.time} · {appointment.service}</small><span>{appointment.veterinarian}</span></div><Link className="text-link" to={appointmentSource(appointment)}>Open booking</Link></li>)}</ul>
        {!checkins.length && <p className="daily-empty">No bookings awaiting check-in today.</p>}
        {checkins.length > 5 && <Link className="text-link" to="/appointments">View all {checkins.length} bookings</Link>}
      </SectionCard>
      <SectionCard title={`Calls due (${calls.length})`} description="Overdue follow-ups first. Log outcomes in the reminder record." action={<Link className="text-link" to="/reminders">Open reminders</Link>}>
        <ul className="daily-work-list">{calls.slice(0, 5).map((reminder) => {
          const pet = data.getPet(reminder.petId)
          const owner = data.getOwner(pet?.ownerId)
          const phone = owner?.normalizedPhone || owner?.phone
          return <li key={reminder.id}><div><Link className="daily-patient-link" to={patientSource(reminder.petId)}>{patientName(reminder.petId)}</Link><small>{reminder.title}</small><span>{reminder.dueDate} · {reminder.status}</span></div><div>{phone ? <a className="text-link" href={`tel:${phone.replace(/\s/g, '')}`}>Call owner</a> : <span>No phone recorded</span>}<Link className="text-link" to={reminderSource(reminder.id)}>Open reminder</Link></div></li>
        })}</ul>
        {!calls.length && <p className="daily-empty">No follow-up calls due.</p>}
        {calls.length > 5 && <Link className="text-link" to="/reminders">View all reminders</Link>}
      </SectionCard>
      <SectionCard title={`Stock watch (${stock.length})`} description="Expired batches, low stock and batches expiring within 30 days." action={<Link className="text-link" to="/inventory?attention=all">Review stock</Link>}>
        <ul className="daily-work-list">{stock.slice(0, 5).map(({ item, expired, expiring, lowStock, href }) => <li key={item.id}><div><strong>{item.name}</strong><small>{item.quantity} {item.unit} on hand · minimum {item.minimumStock}</small><span>{[expired.length ? `${expired.length} expired ${expired.length === 1 ? 'batch' : 'batches'}` : '', expiring.length ? `${expiring.length} ${expiring.length === 1 ? 'batch' : 'batches'} expiring soon` : '', lowStock ? 'At or below minimum' : ''].filter(Boolean).join(' · ')}</span>{item.supplierId && <Link className="text-link" to={`/suppliers#${encodeURIComponent(item.supplierId)}`}>Supplier contact</Link>}</div><Link className="text-link" to={href}>Review item</Link></li>)}</ul>
        {!stock.length && <p className="daily-empty">No stock needs attention.</p>}
        {stock.length > 5 && <Link className="text-link" to="/inventory?attention=all">View all {stock.length} stock alerts</Link>}
      </SectionCard>
    </div>
  </section>
}
