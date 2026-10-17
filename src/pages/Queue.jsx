import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Plus, SignIn } from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, EmptyState, PageHeader } from '../components/ui'
import PetSticker from '../components/PetSticker'
import { QueueDialog } from '../components/QueueEditors'
import { visibleQueueEntries } from '../utils/clinicRules'

const statuses = { waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }

export default function Queue() {
  const { queueEntries, getPet, getOwner, today, timezone, reload, allServices } = useClinicData()
  const [service, setService] = useState('All')
  const [status, setStatus] = useState('Active')
  const [historyDate, setHistoryDate] = useState('')
  const [modal, setModal] = useState(null)
  const date = historyDate || today
  useEffect(() => {
    const timer = setInterval(() => { void reload() }, 30000)
    return () => clearInterval(timer)
  }, [reload])
  const visible = visibleQueueEntries(queueEntries, { service, status, date })
  const showHistory = !['Active', 'waiting', 'in_progress'].includes(status)
  const serviceOptions = new Map(allServices.map((entry) => [`service:${entry.id}`, entry.name + (entry.is_active ? '' : ' (archived)')]))
  queueEntries.forEach((entry) => { const key = `service:${entry.serviceTypeId || entry.service}`; if (!serviceOptions.has(key)) serviceOptions.set(key, entry.service) })
  return <div className="page queue-page">
    <PageHeader eyebrow="Care at the clinic" title="In-site queue" description="Check in arrivals and keep clinical care and maintenance services moving."
      actions={<><button className="button button-secondary" onClick={() => setModal({ type: 'checkin' })}><SignIn size={18} /> Check in appointment</button><button className="button button-primary" onClick={() => setModal({ type: 'walkin' })}><Plus size={18} /> Add walk-in</button></>} />
    <div className="queue-summary">{['waiting', 'in_progress'].map((value) => <div key={value}><Clock size={21} /><strong>{queueEntries.filter((entry) => entry.status === value).length}</strong><span>{statuses[value]}</span></div>)}</div>
    <div className="list-toolbar compact queue-toolbar">
      <label>Service <select aria-label="Queue service" value={service} onChange={(event) => setService(event.target.value)}><option>All</option><optgroup label="Workflow"><option value="checkup">Checkup</option><option value="vaccination">Vaccination</option><option value="maintenance">Maintenance</option></optgroup><optgroup label="Services">{[...serviceOptions].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup></select></label>
      <label>Status <select aria-label="Queue status" value={status} onChange={(event) => setStatus(event.target.value)}><option>Active</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option>All</option></select></label>
      {showHistory && <label>History date <input aria-label="Queue history date" type="date" value={date} onChange={(event) => setHistoryDate(event.target.value)} /></label>}
    </div>
    {showHistory && <p className="queue-hint">History shows entries finished on the selected date. Active arrivals remain visible across days.</p>}
    <div className="queue-list">{visible.map((entry) => {
      const pet = getPet(entry.petId)
      const owner = getOwner(pet?.ownerId)
      const active = ['waiting', 'in_progress'].includes(entry.status)
      return <article className="queue-card" key={entry.id}>
        <div className="queue-patient"><span className="queue-ticket" aria-label={`Queue number ${entry.queueNumber}, ${entry.queueDate}`}><strong>{entry.queueNumber}</strong><small>{entry.queueDate}</small></span><PetSticker pet={pet} size="small" /><div><Link className="queue-patient-link" to={`/patients/${entry.petId}`} aria-label={`View patient details for ${pet?.name || 'patient'} (${entry.queueNumber})`}><strong>{pet?.name || 'Patient'}</strong></Link><small>{owner?.fullName} · {pet?.recordNumber}</small></div></div>
        <div className="queue-care"><strong>{entry.service}</strong><span>{entry.veterinarian}</span>{entry.notes && <p>{entry.notes}</p>}</div>
        <div className="queue-arrival"><time dateTime={entry.arrivedAt}>{new Intl.DateTimeFormat('en-PH', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(entry.arrivedAt))}</time><span>{entry.source === 'appointment' ? 'Booked appointment' : entry.source === 'patient_record' ? entry.category === 'vaccination' ? 'Patient vaccination' : 'Patient checkup' : 'Walk-in'}</span></div>
        <div className="queue-actions"><Badge tone={entry.status === 'completed' ? 'success' : entry.status === 'in_progress' ? 'blue' : entry.status === 'waiting' ? 'warning' : 'neutral'}>{statuses[entry.status]}</Badge>
          {entry.draftSavedAt && <span className="queue-draft-note"><Badge tone="blue">Draft saved</Badge><small>{entry.draftSavedBy} · {new Intl.DateTimeFormat('en-PH', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(entry.draftSavedAt))}</small></span>}
          <div className="record-actions">{entry.status === 'waiting' && <button className="button button-primary small-button" onClick={() => setModal({ type: 'start', entry })}>Start care</button>}
            {entry.status === 'in_progress' && <button className="button button-primary small-button" onClick={() => setModal({ type: 'care', entry })}>{entry.draftSavedAt ? 'Resume' : 'Record'} {entry.category === 'maintenance' ? entry.service : entry.category === 'vaccination' ? 'vaccination' : 'checkup'}</button>}
            {active && <button className="text-link" onClick={() => setModal({ type: 'cancel', entry })}>Cancel</button>}
            {entry.status === 'completed' && <Link className="text-link" to={`/patients/${entry.petId}`}>View patient record</Link>}
          </div>
        </div>
      </article>
    })}</div>
    {!visible.length && <EmptyState icon={Clock} title="No queue entries match" description="Change the filters, add a walk-in, or check in today’s appointment." />}
    <QueueDialog modal={modal} onClose={() => setModal(null)} />
  </div>
}
