import { useMemo, useState } from 'react'
import { addMonths, format, isSameMonth, parseISO, startOfMonth } from 'date-fns'
import { DayPicker } from '@daypicker/react'
import '@daypicker/react/style.css'
import {
  CalendarBlank,
  CalendarDots,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  Funnel,
  Phone,
  Plus,
  Sparkle,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, Field, Modal, PageHeader } from '../components/ui'
import PetSticker from '../components/PetSticker'

const clinicDate = '2026-07-29'

function AppointmentModal({ onClose, initialDate = clinicDate }) {
  const { pets, owners, addAppointment } = useClinicData()
  const [form, setForm] = useState({ petId: pets[0]?.id || '', date: initialDate, time: '09:00', service: 'Wellness check', veterinarian: 'Dr. Andrea Villanueva', notes: '' })
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = (event) => {
    event.preventDefault()
    addAppointment(form)
    onClose()
  }
  return (
    <Modal title="New appointment" description="Schedule a clinic visit and reserve the time slot." onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Patient" required span><select value={form.petId} onChange={set('petId')}>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name} — {owners.find((owner) => owner.id === pet.ownerId)?.fullName}</option>)}</select></Field>
          <Field label="Date" required><input required type="date" value={form.date} onChange={set('date')} /></Field>
          <Field label="Time" required><input required type="time" value={form.time} onChange={set('time')} /></Field>
          <Field label="Service" required><select value={form.service} onChange={set('service')}><option>Wellness check</option><option>Vaccination</option><option>Follow-up</option><option>Dental consultation</option><option>Procedure</option><option>Emergency</option></select></Field>
          <Field label="Veterinarian" required><input required value={form.veterinarian} onChange={set('veterinarian')} /></Field>
          <Field label="Notes" span><textarea rows="3" value={form.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary">Create appointment</button></div>
      </form>
    </Modal>
  )
}

export function Appointments() {
  const { appointments, getPet, getOwner } = useClinicData()
  const [selectedDay, setSelectedDay] = useState(() => parseISO(clinicDate))
  const [month, setMonth] = useState(() => startOfMonth(parseISO(clinicDate)))
  const [modal, setModal] = useState(false)
  const selectedDate = format(selectedDay, 'yyyy-MM-dd')
  const dayAppointments = appointments.filter((item) => item.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time))
  const monthAppointments = appointments.filter((item) => isSameMonth(parseISO(item.date), month))
  const appointmentDates = [...new Set(appointments.map((item) => item.date))].map(parseISO)
  const busyDates = Object.entries(appointments.reduce((counts, item) => ({ ...counts, [item.date]: (counts[item.date] || 0) + 1 }), {}))
    .filter(([, count]) => count >= 2)
    .map(([date]) => parseISO(date))

  const chooseDay = (day) => {
    if (!day) return
    setSelectedDay(day)
    if (!isSameMonth(day, month)) setMonth(startOfMonth(day))
  }

  return (
    <div className="appointments-page">
      <div className="calendar-page-header">
        <div>
          <span className="hero-kicker"><Sparkle size={14} weight="fill" /> Clinic schedule</span>
          <h1>Appointments</h1>
          <p>A clear view of the month, with each day given its own space.</p>
        </div>
        <button className="button button-primary roomy-button" onClick={() => setModal(true)}><Plus size={19} weight="bold" /> New appointment</button>
      </div>

      <div className="calendar-overview">
        <div><strong>{monthAppointments.length}</strong><span>visits this month</span></div>
        <div><strong>{monthAppointments.filter((item) => item.status === 'Confirmed').length}</strong><span>confirmed</span></div>
        <div><strong>{monthAppointments.filter((item) => item.status === 'Pending').length}</strong><span>awaiting confirmation</span></div>
        <button onClick={() => { setSelectedDay(parseISO(clinicDate)); setMonth(startOfMonth(parseISO(clinicDate))) }}>Jump to today</button>
      </div>

      <div className="flow-calendar-layout">
        <section className="month-calendar-card">
          <div className="month-calendar-title">
            <div><span>{format(month, 'yyyy')}</span><h2>{format(month, 'MMMM')}</h2></div>
            <div>
              <button className="calendar-nav-button" onClick={() => setMonth((current) => addMonths(current, -1))} aria-label="Previous month"><CaretLeft size={20} weight="bold" /></button>
              <button className="calendar-nav-button" onClick={() => setMonth((current) => addMonths(current, 1))} aria-label="Next month"><CaretRight size={20} weight="bold" /></button>
            </div>
          </div>
          <DayPicker
            mode="single"
            selected={selectedDay}
            onSelect={chooseDay}
            month={month}
            onMonthChange={setMonth}
            hideNavigation
            fixedWeeks
            showOutsideDays
            modifiers={{ hasAppointments: appointmentDates, busyDay: busyDates }}
            modifiersClassNames={{ hasAppointments: 'calendar-has-appointments', busyDay: 'calendar-busy-day' }}
            className="veterina-day-picker"
          />
          <div className="calendar-legend"><span><i className="legend-dot booked" /> Appointments</span><span><i className="legend-dot busy" /> Busy day</span><span><i className="legend-ring" /> Selected day</span></div>
        </section>

        <aside className="selected-day-panel">
          <header>
            <div className="selected-date-badge"><span>{format(selectedDay, 'EEE')}</span><strong>{format(selectedDay, 'd')}</strong></div>
            <div><span>{format(selectedDay, 'MMMM yyyy')}</span><h2>{format(selectedDay, 'EEEE')}</h2><p>{dayAppointments.length} appointment{dayAppointments.length === 1 ? '' : 's'} scheduled</p></div>
          </header>
          <div className="day-agenda">
            {dayAppointments.length ? dayAppointments.map((appointment) => {
              const pet = getPet(appointment.petId)
              const owner = getOwner(pet?.ownerId)
              return (
                <article className="flow-appointment-card" key={appointment.id}>
                  <time>{format(parseISO(`${selectedDate}T${appointment.time}`), 'h:mm a')}</time>
                  <span className="agenda-line" />
                  <div className="agenda-card-body">
                    <div><PetSticker pet={pet} size="small" /><span><strong>{pet?.name}</strong><small>{pet?.breed} · {owner?.fullName}</small></span></div>
                    <h3>{appointment.service}</h3>
                    <p>{appointment.veterinarian}</p>
                    <Badge tone={appointment.status === 'Confirmed' ? 'success' : 'warning'}>{appointment.status}</Badge>
                  </div>
                </article>
              )
            }) : (
              <div className="open-day-state"><span><CalendarDots size={38} weight="duotone" /></span><h3>The day is open</h3><p>No appointments are scheduled yet.</p><button className="button button-secondary" onClick={() => setModal(true)}><Plus size={17} weight="bold" /> Add appointment</button></div>
            )}
          </div>
        </aside>
      </div>
      {modal && <AppointmentModal initialDate={selectedDate} onClose={() => setModal(false)} />}
    </div>
  )
}

export function Reminders() {
  const { reminders, completeReminder, getPet, getOwner } = useClinicData()
  const [filter, setFilter] = useState('Open')
  const [outcomeId, setOutcomeId] = useState(null)
  const [outcome, setOutcome] = useState('')
  const visible = useMemo(() => reminders.filter((item) => {
    if (filter === 'Open') return item.status !== 'Completed'
    if (filter === 'Completed') return item.status === 'Completed'
    return item.type === filter
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [reminders, filter])

  const saveOutcome = (event) => {
    event.preventDefault()
    completeReminder(outcomeId, outcome)
    setOutcomeId(null)
    setOutcome('')
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Daily call list" title="Reminders" description="One worklist for checkups, vaccines and follow-up calls." actions={<button className="button button-primary"><Plus size={18} weight="bold" /> Custom reminder</button>} />
      <div className="reminder-summary">
        <div><span className="summary-icon overdue"><Clock size={22} weight="duotone" /></span><span><strong>{reminders.filter((item) => item.status === 'Overdue').length}</strong> overdue</span></div>
        <div><span className="summary-icon due"><Phone size={22} weight="duotone" /></span><span><strong>{reminders.filter((item) => item.status === 'Due').length}</strong> due today</span></div>
        <div><span className="summary-icon upcoming"><CalendarBlank size={22} weight="duotone" /></span><span><strong>{reminders.filter((item) => item.status === 'Upcoming').length}</strong> upcoming</span></div>
        <div><span className="summary-icon complete"><CheckCircle size={22} weight="duotone" /></span><span><strong>{reminders.filter((item) => item.status === 'Completed').length}</strong> completed</span></div>
      </div>
      <div className="list-toolbar compact">
        <Funnel size={17} weight="duotone" />
        <div className="filter-pills">
          {['Open', 'Follow-up', 'Vaccination', 'Checkup', 'Completed'].map((value) => <button key={value} onClick={() => setFilter(value)} className={filter === value ? 'active' : ''}>{value}</button>)}
        </div>
      </div>
      <div className="reminder-list">
        {visible.map((reminder) => {
          const pet = getPet(reminder.petId)
          const owner = getOwner(pet?.ownerId)
          return (
            <article className={`reminder-card ${reminder.status.toLowerCase()}`} key={reminder.id}>
              <div className="reminder-check">{reminder.status === 'Completed' ? <CheckCircle size={22} weight="duotone" /> : <Clock size={22} weight="duotone" />}</div>
              <div className="reminder-main">
                <div className="reminder-title"><Badge tone={reminder.status === 'Overdue' ? 'danger' : reminder.status === 'Due' ? 'warning' : reminder.status === 'Completed' ? 'success' : 'blue'}>{reminder.status}</Badge><Badge>{reminder.type}</Badge><strong>{reminder.title}</strong></div>
                <p>{reminder.notes}</p>
                <div className="reminder-person"><PetSticker pet={pet} size="small" /><span><strong>{pet?.name}</strong><small>{owner?.fullName} · {owner?.phone}</small></span></div>
              </div>
              <div className="reminder-due"><span>Due date</span><strong>{format(parseISO(reminder.dueDate), 'd MMM yyyy')}</strong><small>{reminder.assignedTo}</small></div>
              {reminder.status !== 'Completed' && <div className="reminder-actions"><a className="button button-secondary small-button" href={`tel:${owner?.phone?.replace(/\s/g, '')}`}><Phone size={16} weight="duotone" /> Call</a><button className="button button-primary small-button" onClick={() => setOutcomeId(reminder.id)}><Check size={16} weight="bold" /> Complete</button></div>}
            </article>
          )
        })}
      </div>
      {outcomeId && (
        <Modal title="Complete reminder" description="Record what happened so the clinic retains the contact history." onClose={() => setOutcomeId(null)}>
          <form onSubmit={saveOutcome}><Field label="Call outcome" required><textarea required rows="4" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="e.g. Owner confirmed appointment for Friday." /></Field><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setOutcomeId(null)}>Cancel</button><button className="button button-primary">Save outcome</button></div></form>
        </Modal>
      )}
    </div>
  )
}
