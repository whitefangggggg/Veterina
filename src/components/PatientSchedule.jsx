import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { CalendarDots, CaretRight, CheckCircle, Clock, NoteBlank, PencilSimple, UserCircle } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { appointmentSource, queueSource } from '../lib/dailyWorkflow'
import { upcomingFollowUps } from '../lib/appointmentSchedule'
import { Badge, SectionCard } from './ui'

function ScheduleEntry({ date, title, staff, notes, status, selected, followUp, children, id, time }) {
  const day = parseISO(date)
  return <article id={id} className={`patient-schedule-entry${followUp ? ' patient-schedule-follow-up' : ''}${selected ? ' patient-schedule-selected' : ''}`}>
    <time dateTime={date} className="patient-schedule-date" aria-label={format(day, 'd MMMM yyyy')}>
      <span>{format(day, 'MMM')}</span><strong>{format(day, 'dd')}</strong><small>{format(day, 'EEE')}</small>
    </time>
    <div className="patient-schedule-content">
      <div className="patient-schedule-heading">
        <div><span className="patient-schedule-kind">{followUp ? 'Checkup follow-up' : 'Appointment'}</span><h3>{title}</h3></div>
        <div className="care-event-tags">{selected && <Badge tone="blue">Selected appointment</Badge>}<Badge tone={followUp ? 'blue' : status === 'Confirmed' ? 'success' : 'neutral'}>{status}</Badge></div>
      </div>
      <div className="patient-schedule-meta">
        <span><Clock size={16} aria-hidden="true" />{time
          ? <time dateTime={`${date}T${time}`}>{format(parseISO(`${date}T${time}`), 'd MMMM yyyy, h:mm a')}</time>
          : <span>{format(day, 'd MMMM yyyy')} · Time not set</span>}</span>
        <span><UserCircle size={17} aria-hidden="true" /><span><span className="sr-only">Assigned staff: </span>{staff}</span></span>
      </div>
      {notes && <div className="patient-schedule-notes"><NoteBlank size={17} aria-hidden="true" /><div><span>{followUp ? 'Follow-up plan' : 'Visit notes'}</span><p className="service-notes">{notes}</p></div></div>}
      <div className="patient-schedule-actions">{children}</div>
    </div>
  </article>
}

export default function PatientSchedule({ patientId, appointmentId, onEditAppointment, onEditFollowUp, onArrive }) {
  const { appointments, visits, pets, queueEntries, today } = useClinicData()
  const activePatient = pets.some((pet) => pet.id === patientId && pet.status === 'Active')
  const activeCheckup = queueEntries.find((entry) => entry.petId === patientId && entry.category === 'checkup' && ['waiting', 'in_progress'].includes(entry.status))
  const selected = appointments.find((item) => item.id === appointmentId && item.petId === patientId)
  const upcoming = appointments.filter((item) => item.petId === patientId && item.id !== selected?.id
    && item.date >= today && ['Pending', 'Confirmed', 'Arrived', 'In Progress'].includes(item.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  const followUps = upcomingFollowUps(visits, pets, today).filter((item) => item.petId === patientId)
  if (!selected && !upcoming.length && !followUps.length && !appointmentId) return null
  const scheduled = [...(selected ? [selected] : []), ...upcoming]

  return <SectionCard title="Appointments & follow-ups" className="patient-schedule" description="Scheduled care and upcoming checkup plans."
    action={<span className="patient-schedule-count" aria-label={`${scheduled.length + followUps.length} schedule entries`}><CalendarDots size={18} aria-hidden="true" />{scheduled.length + followUps.length}</span>}>
    <div className="patient-schedule-list">
      {appointmentId && !selected && <p className="patient-schedule-unavailable" role="status">This appointment is no longer available for this patient.</p>}
      {scheduled.map((appointment) => {
        const queued = queueEntries.find((entry) => entry.appointmentId === appointment.id)
        const editable = ['Pending', 'Confirmed'].includes(appointment.status)
        return <ScheduleEntry key={appointment.id} id={`patient-appointment-${appointment.id}`} date={appointment.date} time={appointment.time}
        title={appointment.service} staff={appointment.veterinarian} notes={appointment.notes} status={appointment.status} selected={appointment.id === selected?.id}>
        {editable && <button type="button" className="button button-secondary small-button" onClick={() => onEditAppointment(appointment)}><PencilSimple size={15} aria-hidden="true" />Edit appointment</button>}
        {queued ? <Link className="button button-secondary small-button" to={queueSource(queued)}>Open queue{queued.queueNumber && ` · ${queued.queueNumber}`}</Link>
          : editable && <button type="button" className="button button-primary small-button" disabled={!activePatient || appointment.date !== today} title={appointment.date !== today ? 'Appointments can be checked in on their scheduled date.' : undefined}
            onClick={() => onArrive({ type: 'checkin', appointmentId: appointment.id })}><CheckCircle size={16} aria-hidden="true" />Patient arrived</button>}
        <Link className="button button-secondary small-button" to={appointmentSource(appointment)}>Open in Appointments<CaretRight size={14} aria-hidden="true" /></Link>
      </ScheduleEntry>})}
      {followUps.map((followUp) => {
        const visit = visits.find((item) => item.id === followUp.visitId)
        return <ScheduleEntry key={followUp.id} date={followUp.date} title={followUp.service} staff={followUp.veterinarian} notes={followUp.notes} status="Follow-up due" followUp>
        <button type="button" className="button button-secondary small-button" disabled={Boolean(visit?.finalizedAt)} title={visit?.finalizedAt ? 'This checkup is finalized. Open it to view the record or append a correction.' : undefined}
          onClick={() => onEditFollowUp(visit)}><PencilSimple size={15} aria-hidden="true" />Edit follow-up</button>
        <button type="button" className="button button-secondary small-button" onClick={() => onArrive({ type: 'reschedule-followup', visitId: followUp.visitId, petId: patientId })}><CalendarDots size={15} aria-hidden="true" />Reschedule</button>
        {activeCheckup ? <Link className="button button-secondary small-button" to={queueSource(activeCheckup)}>Open queue{activeCheckup.queueNumber && ` · ${activeCheckup.queueNumber}`}</Link>
          : <button type="button" className="button button-primary small-button" onClick={() => onArrive({ type: 'followup-arrival', visitId: followUp.visitId, petId: patientId })}><CheckCircle size={16} aria-hidden="true" />Patient arrived</button>}
        <Link className="button button-secondary small-button" to={followUp.href}>View checkup<CaretRight size={14} aria-hidden="true" /></Link>
        <Link className="text-link" to={`/appointments?date=${followUp.date}#${followUp.id}`}>Open in Appointments<CaretRight size={14} aria-hidden="true" /></Link>
      </ScheduleEntry>})}
    </div>
  </SectionCard>
}
