import { SelectField } from './VeterinaSelect'
import { Link, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { CheckCircle, Clock, MagnifyingGlass, Phone } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { useAuth } from '../context/AuthContext'
import { Badge, EmptyState } from './ui'
import PetSticker from './PetSticker'
import { appointmentSource, patientSource } from '../lib/dailyWorkflow'
import { openScheduleTask } from '../lib/appointmentSchedule'

export function ScheduleTaskCard({ task, onAction, onBook, embedded = false }) {
  const { getPet, getOwner, appointments, visits, vaccinations, preventiveCare, timezone } = useClinicData()
  const { profile } = useAuth()
  const pet = getPet(task.petId), owner = getOwner(pet?.ownerId)
  const open = openScheduleTask(task)
  const appointment = appointments.find((item) => item.id === task.appointment_id && item.petId === task.petId)
  const visit = visits.find((item) => item.id === task.visit_id && item.petId === task.petId)
  const vaccine = vaccinations.find((item) => item.id === task.vaccination_id && item.petId === task.petId)
  const deworming = preventiveCare.find((record) => record.petId === task.petId && record.kind === 'deworming' && record.items.some((item) => item.id === task.deworming_id))
  const followUp = visit?.recordingPurpose !== 'record_only' && (visit?.followUpScheduledDate || visit?.followUpDate) && !visit?.followUpArrivedAt
  const action = (type) => () => onAction({ type, record: task })
  return <article className={`reminder-card schedule-task-card ${task.status.toLowerCase()}${embedded ? ' schedule-task-embedded' : ''}`} id={`reminder-${task.id}`}>
    <div className="reminder-check">{open ? <Clock size={22} /> : <CheckCircle size={22} />}</div>
    <div className="reminder-main">
      <div className="reminder-title"><Badge tone={task.status === 'Overdue' ? 'danger' : task.status === 'Completed' ? 'success' : 'blue'}>{task.status}</Badge><Badge>{task.type}</Badge><strong>{task.title}</strong></div>
      {task.notes && <p className="service-notes">{task.notes}</p>}
      <div className="reminder-person"><PetSticker pet={pet} size="small" /><span><Link className="text-link" to={`/patients/${encodeURIComponent(task.petId)}`}>{pet?.name || 'View patient'}</Link><small>{owner?.fullName} · {owner?.phone || 'Phone not recorded'}</small></span></div>
      <div className="schedule-task-sources">
        {appointment && <Link className="text-link" to={appointmentSource(appointment)}>Open appointment · {appointment.date} {appointment.time}</Link>}
        {visit && <Link className="text-link" to={patientSource(task.petId, 'history', visit.id)}>View checkup{followUp ? ` · Care due ${visit.followUpScheduledDate || visit.followUpDate}` : ''}</Link>}
        {vaccine && <Link className="text-link" to={patientSource(task.petId, 'vaccines', `vaccination-${vaccine.id}`)}>View vaccination{vaccine.nextDueAt ? ` · Next dose ${vaccine.nextDueAt}` : ''}</Link>}
        {deworming && <Link className="text-link" to={patientSource(task.petId, 'vaccines', `preventive-${deworming.id}`)}>View deworming{deworming.nextDueAt ? ` · Next due ${deworming.nextDueAt}` : ''}</Link>}
      </div>
      {task.outcome && <p><strong>Outcome:</strong> {task.outcome}</p>}
      <details><summary>Contact history ({task.activity.length})</summary>{task.activity.map((entry) => <p key={entry.id}>{new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))} · {entry.action.replaceAll('_', ' ')} · {entry.note}</p>)}</details>
    </div>
    <div className="reminder-due"><span>Contact due</span><strong>{format(parseISO(task.dueDate), 'd MMM yyyy')}</strong><small>{task.assignedTo}</small></div>
    <div className="record-actions">{open && <>
      {owner?.phone && <a className="button button-secondary small-button" href={'tel:' + (owner.normalizedPhone || owner.phone).replace(/\s/g, '')}><Phone size={16} />Call</a>}
      <button className="button button-secondary small-button" onClick={action('contact')}>Log contact</button>
      <button className="button button-primary small-button" onClick={action('complete')}>Complete</button>
      <button className="button button-secondary small-button" onClick={action('reminder')}>Edit</button>
      <button className="text-link" onClick={action('snooze')}>Snooze contact</button>
      <button className="text-link" onClick={action('cancel-reminder')}>Cancel reminder</button>
      {followUp ? <><button className="button button-secondary small-button" onClick={() => onAction({ type: 'queue', dialog: { type: 'reschedule-followup', visitId: visit.id, petId: task.petId } })}>Reschedule follow-up</button>
        <button className="button button-secondary small-button" onClick={() => onAction({ type: 'queue', dialog: { type: 'followup-arrival', visitId: visit.id, petId: task.petId } })}>Patient arrived</button></>
        : !appointment && pet?.status === 'Active' && <button className="button button-secondary small-button" onClick={() => onBook(task)}>Book appointment</button>}
    </>}{profile.role === 'owner' && <button className="text-link danger-text" onClick={action('delete-reminder')}>Delete reminder</button>}</div>
  </article>
}

export default function ScheduleTasks({ tasks, onAction, onBook }) {
  const { getPet, getOwner } = useClinicData()
  const [params, setParams] = useSearchParams()
  const statuses = ['Open', 'Overdue', 'Due', 'Upcoming', 'Completed', 'Cancelled', 'All']
  const status = statuses.includes(params.get('status')) ? params.get('status') : 'Open'
  const type = params.get('type') || 'All'
  const query = params.get('taskSearch') || ''
  const patientId = params.get('taskPet') || ''
  const change = (name, value) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next, { preventScrollReset: true }) }
  const visible = tasks.filter((task) => (status === 'All' || (status === 'Open' ? openScheduleTask(task) : task.status === status)) && (type === 'All' || task.type === type)
    && (!patientId || task.petId === patientId) && [task.title, task.notes, task.type, getPet(task.petId)?.name, getOwner(getPet(task.petId)?.ownerId)?.fullName].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return <section className="schedule-tasks" aria-label="Follow-ups and tasks">
    <div className="schedule-tasks-heading"><h2>Follow-ups &amp; tasks</h2><p>Manage owner calls, vaccination due dates and contact outcomes alongside your bookings.</p></div>
    <div className="reminder-summary">{['Overdue', 'Due', 'Upcoming', 'Completed'].map((value) => <div key={value}><span className={'summary-icon ' + value.toLowerCase()}><Clock size={22} /></span><span><strong>{tasks.filter((task) => task.status === value).length}</strong> {value === 'Due' ? 'due today' : value.toLowerCase()}</span></div>)}</div>
    <div className="list-toolbar compact">
      <div className="table-search"><MagnifyingGlass size={18} aria-hidden="true" /><input type="search" aria-label="Search follow-up tasks" placeholder="Search patient, owner, or task…" value={query} onChange={(event) => change('taskSearch', event.target.value)} /></div>
      <label>Status<SelectField aria-label="Task status" value={status} onChange={(event) => change('status', event.target.value)}>{statuses.map((value) => <option key={value}>{value}</option>)}</SelectField></label>
      <label>Type<SelectField aria-label="Task type" value={type} onChange={(event) => change('type', event.target.value)}>{['All', 'Follow-up', 'Vaccination', 'Deworming', 'Checkup', 'Custom', 'Medication'].map((value) => <option key={value}>{value}</option>)}</SelectField></label>
      {patientId && <button className="text-link" onClick={() => change('taskPet', '')}>Show all patients</button>}
    </div>
    <div className="reminder-list">{visible.map((task) => <ScheduleTaskCard key={task.id} task={task} onAction={onAction} onBook={onBook} />)}</div>
    {!visible.length && <EmptyState title="No follow-up tasks match" description="Change filters or add a task." />}
  </section>
}
