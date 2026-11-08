import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addMonths, format, isSameMonth, parseISO, startOfMonth } from 'date-fns'
import { DayPicker } from '@daypicker/react'
import '@daypicker/react/style.css'
import {
  CalendarDots,
  CaretLeft,
  CaretRight,
  Plus,
  Sparkle,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge } from '../components/ui'
import PetSticker from '../components/PetSticker'
import { useAuth } from '../context/AuthContext'
import { AppointmentEditor as AppointmentModal, ReminderEditor } from '../components/OperationEditors'
import { ActionDialog, DeleteRecordDialog, RecordEditor } from '../components/RecordForm'
import { QueueDialog } from '../components/QueueEditors'
import { isClinicDate } from '../lib/dailyWorkflow'
import { useHashTarget } from '../lib/useHashTarget'
import ScheduleTasks, { ScheduleTaskCard } from '../components/ScheduleTasks'
import '../components/ScheduleTasks.css'
import { appointmentCareSchedule, appointmentPatientSource } from '../lib/appointmentSchedule'

export function Appointments() {
  const target = useHashTarget()
  const { appointments, visits, vaccinations, reminders, completeReminder, queueEntries, pets, getPet, getOwner, today: clinicDate } = useClinicData()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'tasks' || target.startsWith('reminder-') ? 'tasks' : 'calendar'
  const setView = (value) => { const next = new URLSearchParams(searchParams); next.set('view', value); setSearchParams(next, { preventScrollReset: true }) }
  const requestedPetId = searchParams.get('petId')
  const newRequested = searchParams.get('new') === '1'
  const invalidPatient = requestedPetId !== null && !pets.some((pet) => pet.id === requestedPetId && pet.status === 'Active')
  const closeAppointment = () => {
    setModal(null)
    if (searchParams.has('new') || searchParams.has('petId')) {
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      next.delete('petId')
      setSearchParams(next, { replace: true })
    }
  }
  const { profile } = useAuth()
  const selectedDate = isClinicDate(searchParams.get('date')) ? searchParams.get('date') : clinicDate
  const selectedDay = parseISO(selectedDate)
  const setSelectedDay = (day) => { const next = new URLSearchParams(searchParams); next.set('date', format(day, 'yyyy-MM-dd')); setSearchParams(next) }
  const [month, setMonth] = useState(() => startOfMonth(parseISO(selectedDate)))
  useEffect(() => { setMonth(startOfMonth(parseISO(selectedDate))) }, [selectedDate])
  const [modal, setModal] = useState(null)
  const { tasks, openTasks, followUps, appointmentTasks, calendarTasks } = appointmentCareSchedule({ appointments, visits, vaccinations, reminders, pets, today: clinicDate })
  const dayTasks = calendarTasks.filter((task) => task.dueDate === selectedDate)
  const onBook = (task) => setModal({ type: 'appointment', initialPetId: task.petId, initialDate: task.dueDate })
  const dayFollowUps = followUps.filter((item) => item.date === selectedDate)
  const dayAppointments = appointments.filter((item) => item.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time))
  const monthAppointments = appointments.filter((item) => isSameMonth(parseISO(item.date), month) && !['Cancelled', 'No Show'].includes(item.status))
  const appointmentDates = [...new Set([...appointments.filter((item) => !['Cancelled', 'No Show'].includes(item.status)), ...followUps, ...calendarTasks.map((task) => ({ date: task.dueDate }))].map((item) => item.date))].map(parseISO)
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
          <p>Bookings, care due dates and owner follow-ups in one place.</p>
        </div>
        <div className="schedule-header-actions"><button className="button button-secondary roomy-button" onClick={() => setModal({ type: 'reminder' })}><Plus size={18} />Add task</button><button className="button button-primary roomy-button" onClick={() => { closeAppointment(); setModal({ type: 'appointment' }) }}><Plus size={19} weight="bold" /> New appointment</button></div>
      </div>
      {invalidPatient && <p className="auth-message auth-error" role="alert">This patient is unavailable or inactive. Open a patient record or choose New appointment to select an active patient.</p>}

      <div className="schedule-view-switch" role="group" aria-label="Appointments view">
        <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>Calendar</button>
        <button type="button" aria-label="Follow-ups & tasks" aria-pressed={view === 'tasks'} onClick={() => setView('tasks')}>Follow-ups &amp; tasks <span>{openTasks.filter((task) => task.dueDate <= clinicDate).length} due</span></button>
      </div>
      {view === 'tasks' ? <ScheduleTasks tasks={tasks} onAction={setModal} onBook={onBook} /> : <>
      <div className="calendar-overview">
        <div><strong>{monthAppointments.length}</strong><span>visits this month</span></div>
        <div><strong>{monthAppointments.filter((item) => item.status === 'Confirmed').length}</strong><span>confirmed</span></div>
        <div><strong>{monthAppointments.filter((item) => item.status === 'Pending').length}</strong><span>awaiting confirmation</span></div>
        <div><strong>{followUps.filter((item) => isSameMonth(parseISO(item.date), month)).length}</strong><span>follow-ups due</span></div>
        <div><strong>{openTasks.filter((task) => isSameMonth(parseISO(task.dueDate), month)).length}</strong><span>contact tasks this month</span></div>
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
          <div className="calendar-legend"><span><i className="legend-dot booked" /> Bookings / care / tasks</span><span><i className="legend-dot busy" /> Busy day</span><span><i className="legend-ring" /> Selected day</span></div>
        </section>

        <aside className="selected-day-panel">
          <header>
            <div className="selected-date-badge"><span>{format(selectedDay, 'EEE')}</span><strong>{format(selectedDay, 'd')}</strong></div>
            <div><span>{format(selectedDay, 'MMMM yyyy')}</span><h2>{format(selectedDay, 'EEEE')}</h2><p>{dayAppointments.length} appointment{dayAppointments.length === 1 ? '' : 's'} scheduled{dayTasks.length > 0 && ` · ${dayTasks.length} contact task${dayTasks.length === 1 ? '' : 's'}`}{dayFollowUps.length > 0 && ` · ${dayFollowUps.length} follow-up${dayFollowUps.length === 1 ? '' : 's'} due`}</p></div>
          </header>
          <div className="day-agenda">
            {dayAppointments.map((appointment) => {
              const pet = getPet(appointment.petId)
              const owner = getOwner(pet?.ownerId)
              const queueEntry = queueEntries.find((entry) => entry.appointmentId === appointment.id)
              return (
                <article className="flow-appointment-card" key={appointment.id} id={`appointment-${appointment.id}`}>
                  <time>{format(parseISO(`${selectedDate}T${appointment.time}`), 'h:mm a')}</time>
                  <span className="agenda-line" />
                  <div className="agenda-card-body">
                    <div><PetSticker pet={pet} size="small" /><span><Link className="text-link agenda-patient-link" title={`Open patient details for ${appointment.service}`} to={appointmentPatientSource(appointment)}>{pet?.name || 'View patient'}</Link><small>{pet?.breed} · {owner?.fullName}</small></span></div>
                    <h3>{appointment.service}</h3>
                    <p>{appointment.veterinarian}</p>
                    {appointment.notes && <p className="service-notes">{appointment.notes}</p>}
                    <Badge tone={appointment.status === 'Confirmed' ? 'success' : 'warning'}>{appointment.status}</Badge>
                    {queueEntry && <Badge tone="blue">Queue {queueEntry.queueNumber} · {queueEntry.queueDate}</Badge>}
                    {appointmentTasks.get(appointment.id)?.map((task) => <ScheduleTaskCard key={task.id} task={task} embedded onAction={setModal} onBook={onBook} />)}
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
            })}
            {dayFollowUps.map((followUp) => {
              const pet = getPet(followUp.petId)
              const owner = getOwner(pet?.ownerId)
              return <article className="flow-appointment-card" key={followUp.id} id={followUp.id}>
                <time>Time not set</time><span className="agenda-line" />
                <div className="agenda-card-body">
                  <div><PetSticker pet={pet} size="small" /><span><Link className="text-link agenda-patient-link" aria-label={`Open ${pet?.name || 'patient'} follow-up checkup`} to={followUp.href}>{pet?.name || 'View patient'}</Link><small>{pet?.breed} · {owner?.fullName}</small></span></div>
                  <h3>{followUp.service}</h3><p>{followUp.veterinarian}</p>
                  <Badge tone="blue">Follow-up due</Badge>
                  {followUp.notes && <p className="service-notes">{followUp.notes}</p>}
                  {followUp.tasks.map((task) => <ScheduleTaskCard key={task.id} task={task} embedded onAction={setModal} onBook={onBook} />)}
                  {!followUp.tasks.length && <div className="record-actions"><button className="button button-secondary small-button" onClick={() => setModal({ type: 'queue', dialog: { type: 'reschedule-followup', visitId: followUp.visitId, petId: followUp.petId } })}>Reschedule follow-up</button><button className="button button-secondary small-button" onClick={() => setModal({ type: 'queue', dialog: { type: 'followup-arrival', visitId: followUp.visitId, petId: followUp.petId } })}>Patient arrived</button></div>}
                </div>
              </article>
            })}
            {dayTasks.map((task) => <ScheduleTaskCard key={task.id} task={task} onAction={setModal} onBook={onBook} />)}
            {!dayAppointments.length && !dayFollowUps.length && !dayTasks.length && (
              <div className="open-day-state"><span><CalendarDots size={38} weight="duotone" /></span><h3>The day is open</h3><p>No bookings or follow-up tasks are due on this day.</p><button className="button button-secondary" onClick={() => setModal({ type: 'appointment' })}><Plus size={17} weight="bold" /> Add appointment</button></div>
            )}
          </div>
        </aside>
      </div>
      </>}
      {(modal?.type === 'appointment' || (newRequested && !invalidPatient && !modal)) && <AppointmentModal key={modal?.record?.id || modal?.initialPetId || requestedPetId || 'new'} record={modal?.record} initialDate={modal?.initialDate || selectedDate} initialPetId={modal?.initialPetId || requestedPetId} onClose={closeAppointment} />}
      {modal?.type === 'queue' && <QueueDialog modal={modal.dialog} onClose={() => setModal(null)} />}
      {modal?.type === 'transition' && <ActionDialog title={'Mark appointment ' + modal.status.replace('_', ' ') + '?'} action="transition_appointment" data={{ id: modal.record.id, status: modal.status }} onClose={() => setModal(null)} />}
      {modal?.type === 'delete' && <DeleteRecordDialog entity="appointment" record={modal.record} onClose={() => setModal(null)} />}
      {modal?.type === 'reminder' && <ReminderEditor record={modal.record} initialDate={selectedDate} onClose={() => setModal(null)} />}
      {modal?.type === 'complete' && <RecordEditor title="Complete reminder" description="Record the contact outcome. This does not complete a clinic appointment." onClose={() => setModal(null)}
        fields={[{ name: 'outcome', label: 'Call outcome', type: 'select', required: true, options: ['Reached owner', 'No answer', 'Appointment booked', 'Owner declined', 'Other'] }, { name: 'notes', label: 'Contact notes', type: 'textarea' }]}
        onSave={(values) => completeReminder(modal.record.id, values.outcome + (values.notes ? ': ' + values.notes : ''))} submitLabel="Save outcome" />}
      {modal?.type === 'contact' && <ActionDialog title="Log contact attempt" description="Adds contact history and leaves the task open." action="log_reminder_attempt" data={{ id: modal.record.id }} fields={[{ name: 'notes', label: 'Contact notes', type: 'textarea', required: true, span: true }]} onClose={() => setModal(null)} />}
      {modal?.type === 'snooze' && <ActionDialog title="Snooze contact" description="Move the next contact date. Clinical due dates and bookings stay on their recorded dates." action="snooze_reminder" data={{ id: modal.record.id }} fields={[{ name: 'dueDate', label: 'New due date', type: 'date', required: true }]} onClose={() => setModal(null)} />}
      {modal?.type === 'cancel-reminder' && <ActionDialog title="Cancel this reminder?" action="cancel_reminder" data={{ id: modal.record.id }} onClose={() => setModal(null)} />}
      {modal?.type === 'delete-reminder' && <DeleteRecordDialog entity="reminder" record={modal.record} onClose={() => setModal(null)} />}

    </div>
  )
}
