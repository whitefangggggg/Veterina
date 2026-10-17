import { useMemo, useState } from 'react'
import { addMonths, format, isSameMonth, parseISO, startOfMonth } from 'date-fns'
import { DayPicker } from '@daypicker/react'
import '@daypicker/react/style.css'
import {
  CalendarDots,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  Phone,
  Plus,
  Sparkle,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, EmptyState, PageHeader } from '../components/ui'
import PetSticker from '../components/PetSticker'
import { useAuth } from '../context/AuthContext'
import { AppointmentEditor as AppointmentModal, ReminderEditor } from '../components/OperationEditors'
import { ActionDialog, DeleteRecordDialog, RecordEditor } from '../components/RecordForm'
import { QueueDialog } from '../components/QueueEditors'

export function Appointments() {
  const { appointments, queueEntries, getPet, getOwner, today: clinicDate } = useClinicData()
  const { profile } = useAuth()
  const [selectedDay, setSelectedDay] = useState(() => parseISO(clinicDate))
  const [month, setMonth] = useState(() => startOfMonth(parseISO(clinicDate)))
  const [modal, setModal] = useState(null)
  const selectedDate = format(selectedDay, 'yyyy-MM-dd')
  const dayAppointments = appointments.filter((item) => item.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time))
  const monthAppointments = appointments.filter((item) => isSameMonth(parseISO(item.date), month) && !['Cancelled', 'No Show'].includes(item.status))
  const appointmentDates = [...new Set(appointments.filter((item) => !['Cancelled', 'No Show'].includes(item.status)).map((item) => item.date))].map(parseISO)
  const busyDates = Object.entries(appointments.filter((item) => !['Cancelled', 'No Show'].includes(item.status)).reduce((counts, item) => ({ ...counts, [item.date]: (counts[item.date] || 0) + 1 }), {}))
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
        <button className="button button-primary roomy-button" onClick={() => setModal({ type: 'appointment' })}><Plus size={19} weight="bold" /> New appointment</button>
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
              const queueEntry = queueEntries.find((entry) => entry.appointmentId === appointment.id)
              return (
                <article className="flow-appointment-card" key={appointment.id}>
                  <time>{format(parseISO(`${selectedDate}T${appointment.time}`), 'h:mm a')}</time>
                  <span className="agenda-line" />
                  <div className="agenda-card-body">
                    <div><PetSticker pet={pet} size="small" /><span><strong>{pet?.name}</strong><small>{pet?.breed} · {owner?.fullName}</small></span></div>
                    <h3>{appointment.service}</h3>
                    <p>{appointment.veterinarian}</p>
                    <Badge tone={appointment.status === 'Confirmed' ? 'success' : 'warning'}>{appointment.status}</Badge>
                    {queueEntry && <Badge tone="blue">Queue {queueEntry.queueNumber} · {queueEntry.queueDate}</Badge>}
                    <div className="record-actions">
                      {['Pending', 'Confirmed'].includes(appointment.status) && <button className="button button-secondary small-button" onClick={() => setModal({ type: 'appointment', record: appointment })}>Reschedule</button>}
                      {['Pending', 'Confirmed'].includes(appointment.status) && appointment.date === clinicDate && <button className="button button-secondary small-button" onClick={() => setModal({ type: 'queue', dialog: { type: 'checkin', appointmentId: appointment.id } })}>Check in</button>}
                      {appointment.status === 'Arrived' && queueEntry && <button className="button button-secondary small-button" onClick={() => setModal({ type: 'queue', dialog: { type: 'start', entry: queueEntry } })}>Start care</button>}
                      {appointment.status === 'In Progress' && queueEntry && <button className="button button-primary small-button" onClick={() => setModal({ type: 'queue', dialog: { type: 'care', entry: queueEntry } })}>{queueEntry.draftSavedAt ? 'Resume' : 'Record'} {queueEntry.category === 'maintenance' ? queueEntry.service : queueEntry.category === 'vaccination' ? 'vaccination' : 'checkup'}</button>}
                      {['Pending', 'Confirmed'].includes(appointment.status) && ['cancelled', 'no_show'].map((status) => <button key={status} className="button button-secondary small-button" onClick={() => setModal({ type: 'transition', record: appointment, status })}>{status === 'cancelled' ? 'Cancel' : 'No show'}</button>)}
                      {['Arrived', 'In Progress'].includes(appointment.status) && queueEntry && <button className="text-link" onClick={() => setModal({ type: 'queue', dialog: { type: 'cancel', entry: queueEntry } })}>Cancel</button>}
                      {profile.role === 'owner' && <button className="text-link danger-text" onClick={() => setModal({ type: 'delete', record: appointment })}>Delete appointment</button>}
                    </div>
                  </div>
                </article>
              )
            }) : (
              <div className="open-day-state"><span><CalendarDots size={38} weight="duotone" /></span><h3>The day is open</h3><p>No appointments are scheduled yet.</p><button className="button button-secondary" onClick={() => setModal({ type: 'appointment' })}><Plus size={17} weight="bold" /> Add appointment</button></div>
            )}
          </div>
        </aside>
      </div>
      {modal?.type === 'appointment' && <AppointmentModal record={modal.record} initialDate={selectedDate} onClose={() => setModal(null)} />}
      {modal?.type === 'queue' && <QueueDialog modal={modal.dialog} onClose={() => setModal(null)} />}
      {modal?.type === 'transition' && <ActionDialog title={'Mark appointment ' + modal.status.replace('_', ' ') + '?'} action="transition_appointment" data={{ id: modal.record.id, status: modal.status }} onClose={() => setModal(null)} />}
      {modal?.type === 'delete' && <DeleteRecordDialog entity="appointment" record={modal.record} onClose={() => setModal(null)} />}
    </div>
  )
}

export function Reminders() {
  const { reminders, completeReminder, getPet, getOwner } = useClinicData()
  const { profile } = useAuth()
  const [status, setStatus] = useState('Open')
  const [type, setType] = useState('All')
  const [modal, setModal] = useState(null)
  const visible = useMemo(() => reminders.filter((item) => {
    const statusMatch = status === 'All' || (status === 'Open' ? !['Completed', 'Cancelled'].includes(item.status) : item.status === status)
    return statusMatch && (type === 'All' || item.type === type)
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [reminders, status, type])
  return <div className="page">
    <PageHeader eyebrow="Daily call list" title="Reminders" description="Checkups, vaccines and follow-up calls with permanent contact history."
      actions={<button className="button button-primary" onClick={() => setModal({ type: 'reminder' })}><Plus size={18} /> Custom reminder</button>} />
    <div className="reminder-summary">{['Overdue', 'Due', 'Upcoming', 'Completed'].map((value) => <div key={value}><span className={'summary-icon ' + value.toLowerCase()}><Clock size={22} /></span><span><strong>{reminders.filter((item) => item.status === value).length}</strong> {value === 'Due' ? 'due today' : value.toLowerCase()}</span></div>)}</div>
    <div className="list-toolbar compact">
      <label>Status <select aria-label="Reminder status" value={status} onChange={(event) => setStatus(event.target.value)}>{['Open', 'Overdue', 'Due', 'Upcoming', 'Completed', 'Cancelled', 'All'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Type <select aria-label="Reminder type" value={type} onChange={(event) => setType(event.target.value)}>{['All', 'Follow-up', 'Vaccination', 'Checkup', 'Custom', 'Medication'].map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="reminder-list">{visible.map((reminder) => {
      const pet = getPet(reminder.petId)
      const owner = getOwner(pet?.ownerId)
      const open = !['Completed', 'Cancelled'].includes(reminder.status)
      return <article className={'reminder-card ' + reminder.status.toLowerCase()} key={reminder.id}>
        <div className="reminder-check">{open ? <Clock size={22} /> : <CheckCircle size={22} />}</div>
        <div className="reminder-main">
          <div className="reminder-title"><Badge tone={reminder.status === 'Overdue' ? 'danger' : 'blue'}>{reminder.status}</Badge><Badge>{reminder.type}</Badge><strong>{reminder.title}</strong></div>
          <p>{reminder.notes}</p><div className="reminder-person"><PetSticker pet={pet} size="small" /><span><strong>{pet?.name}</strong><small>{owner?.fullName} · {owner?.phone}</small></span></div>
          {reminder.outcome && <p><strong>Outcome:</strong> {reminder.outcome}</p>}
          <details><summary>Contact history ({reminder.activity.length})</summary>{reminder.activity.map((entry) => <p key={entry.id}>{format(parseISO(entry.created_at), 'd MMM yyyy, h:mm a')} · {entry.action} · {entry.note}</p>)}</details>
        </div>
        <div className="reminder-due"><span>Due date</span><strong>{format(parseISO(reminder.dueDate), 'd MMM yyyy')}</strong><small>{reminder.assignedTo}</small></div>
        <div className="record-actions">{open && <><a className="button button-secondary small-button" href={'tel:' + (owner?.normalizedPhone || owner?.phone || '')}><Phone size={16} /> Call</a><button className="button button-secondary small-button" onClick={() => setModal({ type: 'contact', record: reminder })}>Log contact</button><button className="button button-primary small-button" onClick={() => setModal({ type: 'complete', record: reminder })}>Complete</button><button className="button button-secondary small-button" onClick={() => setModal({ type: 'reminder', record: reminder })}>Edit</button><button className="text-link" onClick={() => setModal({ type: 'snooze', record: reminder })}>Snooze</button><button className="text-link" onClick={() => setModal({ type: 'cancel', record: reminder })}>Cancel reminder</button></>}{profile.role === 'owner' && <button className="text-link danger-text" onClick={() => setModal({ type: 'delete', record: reminder })}>Delete reminder</button>}</div>
      </article>
    })}</div>
    {!visible.length && <EmptyState title="No reminders match" description="Change filters or create a custom reminder." />}
    {modal?.type === 'reminder' && <ReminderEditor record={modal.record} onClose={() => setModal(null)} />}
    {modal?.type === 'complete' && <RecordEditor title="Complete reminder" description="Record the contact outcome." onClose={() => setModal(null)}
      fields={[{ name: 'outcome', label: 'Call outcome', type: 'select', required: true, options: ['Reached owner', 'No answer', 'Appointment booked', 'Owner declined', 'Other'] }, { name: 'notes', label: 'Contact notes', type: 'textarea' }]}
      onSave={(values) => completeReminder(modal.record.id, values.outcome + (values.notes ? ': ' + values.notes : ''))} submitLabel="Save outcome" />}
    {modal?.type === 'contact' && <ActionDialog title="Log contact attempt" description="This adds to contact history and leaves the reminder open." action="log_reminder_attempt" data={{ id: modal.record.id }} fields={[{ name: 'notes', label: 'Contact notes', type: 'textarea', required: true, span: true }]} onClose={() => setModal(null)} />}
    {modal?.type === 'snooze' && <ActionDialog title="Snooze reminder" action="snooze_reminder" data={{ id: modal.record.id }} fields={[{ name: 'dueDate', label: 'New due date', type: 'date', required: true }]} onClose={() => setModal(null)} />}
    {modal?.type === 'cancel' && <ActionDialog title="Cancel this reminder?" action="cancel_reminder" data={{ id: modal.record.id }} onClose={() => setModal(null)} />}
    {modal?.type === 'delete' && <DeleteRecordDialog entity="reminder" record={modal.record} onClose={() => setModal(null)} />}
  </div>
}
