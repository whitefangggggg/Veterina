import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowLeft,
  CalendarPlus,
  FileText,
  Heartbeat,
  MapPin,
  Phone,
  Pill,
  Plus,
  Printer,
  Pulse,
  Scales,
  ShieldCheck,
  Syringe,
  Thermometer,
  Warning,
} from '@phosphor-icons/react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, SectionCard } from '../components/ui'
import PetSticker from '../components/PetSticker'
import { useAuth } from '../context/AuthContext'
import { VisitEditor as VisitModal, VaccineEditor as VaccineModal, PrescriptionEditor } from '../components/ClinicalEditors'
import { OwnerEditor, PetEditor } from '../components/PatientEditors'
import { ActionDialog, DeleteRecordDialog } from '../components/RecordForm'
import { fetchReport, printPatientHistory } from '../lib/reports'
import Assistant from '../components/Assistant'
import { QueueDialog } from '../components/QueueEditors'

function CareStatus({ record }) {
  const tone = { Waiting: 'warning', 'In progress': 'blue', Completed: 'success', Cancelled: 'danger' }[record.careStatus] || 'neutral'
  return <div className="record-care-status"><span>Care status</span><Badge tone={tone}>{record.careStatus}</Badge>
    {record.careQueue && <small>{record.careQueue.queueNumber} · {record.careQueue.queueDate}</small>}
    {record.careQueue?.draftSavedAt && <Badge tone="blue">Draft saved</Badge>}
  </div>
}

export default function PetDetail() {
  const { petId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { getPet, getOwner, visits, vaccinations, reminders, alerts, profiles, settings, queueEntries } = useClinicData()
  const [modal, setModal] = useState(null)
  const [tab, setTab] = useState('history')
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  const [careReceipt, setCareReceipt] = useState(null)
  const openCheckup = (visit) => {
    if (visit.finalizedAt) return
    setModal(visit.careStatus === 'In progress' && visit.careQueue
      ? { type: 'queue-care', entry: visit.careQueue }
      : { type: 'visit', record: visit })
  }
  const printHistory = async () => {
    setPrinting(true); setPrintError('')
    try { const rows = await fetchReport('history', petId); printPatientHistory(rows[0], { profiles, clinic: settings }) }
    catch (error) { setPrintError(error.message) } finally { setPrinting(false) }
  }
  const pet = getPet(petId)
  const owner = getOwner(pet?.ownerId)
  const petVisits = useMemo(() => visits.filter((item) => item.petId === petId).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)), [visits, petId])
  const petVaccinations = vaccinations.filter((item) => item.petId === petId)
  const maintenance = queueEntries.filter((entry) => entry.petId === petId && entry.category === 'maintenance').sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt))
  const petReminders = reminders.filter((item) => item.petId === petId && !['Completed', 'Cancelled'].includes(item.status))
  const weightData = [...petVisits].reverse().map((visit) => ({ visitId: visit.id, date: format(parseISO(visit.visitedAt), 'MMM yy'), weight: visit.weightKg, bcs: visit.bodyConditionScore }))

  if (!pet) return <div className="page"><Link to="/patients" className="text-link"><ArrowLeft size={17} weight="bold" /> Back to patients</Link><div className="not-found"><h1>Patient not found</h1></div></div>

  return (
    <div className="page">
      <Link to="/patients" className="back-link"><ArrowLeft size={17} weight="bold" /> Patients & owners</Link>
      <div className="pet-hero section-card">
        <PetSticker pet={pet} size="large" />
        <div className="pet-identity">
          <div className="pet-title-row"><h1>{pet.name}</h1><Badge tone="success">{pet.status}</Badge></div>
          <p>{pet.breed} · {pet.species} · {pet.sex}, {pet.reproductiveStatus}</p>
          <div className="pet-meta"><code>{pet.recordNumber}</code>{pet.microchip && <span><ShieldCheck size={15} weight="duotone" /> {pet.microchip}</span>}</div>
        </div>
        <div className="pet-hero-actions">
          {profile.role === 'owner' && <button className="button button-secondary" disabled={printing} onClick={printHistory}><Printer size={18} weight="duotone" /> {printing ? 'Preparing...' : 'Print history'}</button>}
          <button className="button button-primary" onClick={() => setModal({ type: 'visit' })}><Plus size={18} weight="bold" /> Record checkup</button>
        </div>
      </div>

      {printError && <p className="auth-message auth-error" role="alert">{printError}</p>}
      {careReceipt?.queueEntryId && careReceipt.petId === pet.id && <p className="auth-message" role="status">{careReceipt.label} saved in queue <strong>Q-{String(careReceipt.queueNumber).padStart(3, '0')}</strong>. <Link className="text-link" to="/queue">Open queue</Link></p>}
      {(pet.allergies.length > 0 || pet.alerts.length > 0) && (
        <div className="clinical-alerts">
          {pet.allergies.map((allergy) => <div className="clinical-alert danger" key={allergy}><Warning size={19} weight="fill" /><span><strong>Allergy</strong>{allergy}</span></div>)}
          {pet.alerts.map((alert) => <div className="clinical-alert warning" key={alert}><Warning size={19} weight="fill" /><span><strong>Care alert</strong>{alert}</span></div>)}
        </div>
      )}

      <div className="pet-summary-grid">
        <div><Scales size={19} weight="duotone" /><span>Current weight<strong>{pet.latestWeight ? `${pet.latestWeight} kg` : 'Not recorded'}</strong></span></div>
        <div><Pulse size={19} weight="duotone" /><span>Last visit<strong>{petVisits[0] ? format(parseISO(petVisits[0].visitedAt), 'd MMM yyyy') : 'No visits'}</strong></span></div>
        <div><Syringe size={19} weight="duotone" /><span>Vaccinations<strong>{petVaccinations.length} recorded</strong></span></div>
        <div><CalendarPlus size={19} weight="duotone" /><span>Open reminders<strong>{petReminders.length} upcoming</strong></span></div>
      </div>

      <div className="record-layout">
        <div className="record-main">
          <div className="tabs" role="tablist">
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Clinical history</button>
            <button className={tab === 'vaccines' ? 'active' : ''} onClick={() => setTab('vaccines')}>Vaccinations</button>
            <button className={tab === 'growth' ? 'active' : ''} onClick={() => setTab('growth')}>Weight & vitals</button>
            <button className={tab === 'services' ? 'active' : ''} onClick={() => setTab('services')}>Service history</button>
          </div>

          {tab === 'history' && (
            <div className="clinical-timeline">
              {petVisits.map((visit) => {
                const activeQueue = ['Waiting', 'In progress'].includes(visit.careStatus) ? visit.careQueue : null
                return (
                <article className="visit-card section-card" key={visit.id} id={visit.id}>
                  <div className="visit-date">
                    <span>{format(parseISO(visit.visitedAt), 'MMM')}</span>
                    <strong>{format(parseISO(visit.visitedAt), 'dd')}</strong>
                    <small>{format(parseISO(visit.visitedAt), 'yyyy')}</small>
                  </div>
                  <div className="visit-content">
                    <div className="visit-heading"><div><Badge tone="blue">{visit.type}</Badge><CareStatus record={visit} /><h2>{visit.finalizedAt ? visit.diagnosis || visit.complaint : <button type="button" className="visit-edit-trigger" aria-label={`Edit ${visit.type} checkup from ${format(parseISO(visit.visitedAt), 'd MMM yyyy, h:mm a')}`} onClick={() => openCheckup(visit)}>{visit.diagnosis || visit.complaint}</button>}</h2><p>{visit.complaint}</p></div><span>{visit.veterinarian}</span></div>
                    <div className="vitals-strip">
                      <span><Scales size={15} weight="duotone" /> {visit.weightKg} kg</span>
                      {visit.temperatureC && <span><Thermometer size={15} weight="duotone" /> {visit.temperatureC} °C</span>}
                      {visit.heartRate && <span><Heartbeat size={15} weight="duotone" /> {visit.heartRate} bpm</span>}
                      {visit.respiratoryRate && <span><Pulse size={15} weight="duotone" /> {visit.respiratoryRate} rpm</span>}
                      {visit.bodyConditionScore && <span>BCS {visit.bodyConditionScore}/{visit.bodyConditionScale}</span>}
                    </div>
                    <div className="soap-grid">
                      <div><strong>S · Subjective</strong><p>{visit.subjective || '—'}</p></div>
                      <div><strong>O · Objective</strong><p>{visit.objective || '—'}</p></div>
                      <div><strong>A · Assessment</strong><p>{visit.assessment || '—'}</p></div>
                      <div><strong>P · Plan</strong><p>{visit.plan || '—'}</p></div>
                    </div>
                    <div className="record-actions">
                      {!visit.finalizedAt && <button className="button button-secondary small-button" onClick={() => openCheckup(visit)}>Edit checkup</button>}
                      {!visit.finalizedAt && (activeQueue ? <Link className="button button-secondary small-button" to="/queue">Open queued checkup</Link> : <button className="button button-secondary small-button" onClick={() => setModal({ type: 'finalize', record: visit })}>Finalize checkup</button>)}
                      {visit.finalizedAt && <Badge>Finalized</Badge>}
                      {visit.finalizedAt && profile.role === 'owner' && <button className="button button-secondary small-button" onClick={() => setModal({ type: 'correct', record: visit })}>Append correction</button>}
                      {profile.role === 'owner' && <button className="button button-secondary small-button danger-text" onClick={() => setModal({ type: 'delete', entity: 'visit', record: visit })}>Delete checkup</button>}
                    </div>
                    {visit.corrections.map((correction) => <div className="follow-up-note" key={correction.id}><strong>Correction: {correction.reason}</strong><p>{correction.correction}</p></div>)}
                    {visit.prescriptions.map((prescription) => <div className="prescription-row" key={prescription.id}><strong>{prescription.medication_name}</strong><p>{prescription.dose} · {prescription.frequency}</p><p>{prescription.instructions}</p>{!visit.finalizedAt && <button className="text-link" onClick={() => setModal({ type: 'prescription', record: prescription })}>Edit prescription</button>}{profile.role === 'owner' && <button className="text-link danger-text" onClick={() => setModal({ type: 'delete', entity: 'prescription', record: prescription })}>Delete prescription</button>}</div>)}
                    {visit.followUpDate && <div className="follow-up-note"><CalendarPlus size={16} weight="duotone" /> Follow-up due {format(parseISO(visit.followUpDate), 'd MMMM yyyy')}</div>}
                  </div>
                </article>
              )})}
              {!petVisits.length && <div className="empty-inline"><FileText size={30} weight="duotone" /><h3>No clinical visits yet</h3><p>Record the first checkup to begin this pet’s history.</p></div>}
            </div>
          )}

          {tab === 'vaccines' && (
            <SectionCard title="Vaccination history" description="Vaccine records, brands, care status and next due dates" action={<button className="button button-primary small-button" onClick={() => setModal({ type: 'vaccine' })}><Plus size={16} weight="bold" /> Add vaccine</button>}>
              <div className="vaccine-list">
                {petVaccinations.map((vaccine) => (
                  <div className="vaccine-row" key={vaccine.id}>
                    <div className="vaccine-icon"><Syringe size={20} weight="duotone" /></div>
                    <div><strong>{vaccine.vaccine}</strong><span>{['Recorded', 'Completed'].includes(vaccine.careStatus) ? 'Given' : 'Recorded date'} {format(parseISO(vaccine.administeredAt), 'd MMM yyyy')} · {vaccine.dose}</span><CareStatus record={vaccine} /></div>
                    <div><span>Brand</span><strong>{vaccine.brand || 'Not recorded'}</strong>{vaccine.lotNumber && <small>Historical lot: {vaccine.lotNumber}</small>}</div>
                    <div><span>Next due</span><strong>{vaccine.nextDueAt ? format(parseISO(vaccine.nextDueAt), 'd MMM yyyy') : 'Not scheduled'}</strong><Badge tone={vaccine.nextDoseStatus === 'Overdue' ? 'danger' : vaccine.nextDoseStatus === 'Due today' ? 'warning' : vaccine.nextDoseStatus === 'Up to date' ? 'success' : 'neutral'}>{vaccine.nextDoseStatus}</Badge></div>
                    <div className="record-actions">{['Waiting', 'In progress'].includes(vaccine.careStatus) ? <Link className="button button-secondary small-button" to="/queue">Open queued vaccination</Link> : <button className="button button-secondary small-button" onClick={() => setModal({ type: 'vaccine', record: vaccine })}>Edit vaccine</button>}{profile.role === 'owner' && <button className="button button-secondary small-button danger-text" onClick={() => setModal({ type: 'delete', entity: 'vaccination', record: vaccine })}>Delete vaccine</button>}</div>
                  </div>
                ))}
                {!petVaccinations.length && <div className="empty-inline"><Syringe size={30} weight="duotone" /><h3>No vaccinations recorded</h3></div>}
              </div>
            </SectionCard>
          )}

          {tab === 'services' && <SectionCard title="Maintenance service history" description="Grooming and other maintenance services recorded at the clinic.">
            {maintenance.map((entry) => <article className="directory-card" key={entry.id}><div><h3>{entry.service}</h3><p>{entry.queueNumber} · {entry.queueDate} · {entry.veterinarian}</p><Badge>{entry.status.replaceAll('_', ' ')}</Badge>{entry.serviceNotes && <p className="service-notes">{entry.serviceNotes}</p>}</div>{['waiting', 'in_progress'].includes(entry.status) && <Link className="text-link" to="/queue">Open queue</Link>}</article>)}
            {!maintenance.length && <p className="empty-inline">No maintenance services recorded.</p>}
          </SectionCard>}

          {tab === 'growth' && (
            <SectionCard title="Weight trend" description="Every measurement remains tied to its original clinic visit">
              {weightData.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={weightData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                      <defs><linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2d7d6e" stopOpacity={0.24}/><stop offset="95%" stopColor="#2d7d6e" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9e5" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} unit=" kg" domain={['dataMin - 1', 'dataMax + 1']} />
                      <Tooltip formatter={(value) => [`${value} kg`, 'Weight']} />
                      <Area type="monotone" dataKey="weight" stroke="#2d7d6e" strokeWidth={3} fill="url(#weightFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="empty-inline"><Scales size={30} weight="duotone" /><h3>No measurements yet</h3></div>}
            </SectionCard>
          )}
        </div>

        <aside className="record-sidebar">
          <Assistant key={petId} patientId={petId} />
          <SectionCard title="Owner" action={<button className="text-link" onClick={() => setModal({ type: 'owner' })}>Edit owner</button>}>
            <div className="owner-card">
              <div className="avatar owner-avatar">{owner?.fullName?.split(' ').map((word) => word[0]).slice(0, 2).join('')}</div>
              <div><strong>{owner?.fullName}</strong><span>Primary contact</span></div>
            </div>
            <a href={`tel:${owner?.phone?.replace(/\s/g, '')}`}><Phone size={16} weight="duotone" /> {owner?.phone}</a>
            <span><MapPin size={16} weight="duotone" /> {owner?.address}</span>
          </SectionCard>
          <SectionCard title="Patient details" action={<button className="text-link" onClick={() => setModal({ type: 'pet' })}>Edit patient</button>}>
            <dl className="detail-list">
              <div><dt>Born</dt><dd>{pet.birthDate ? `${format(parseISO(pet.birthDate), 'd MMM yyyy')}${pet.birthDateEstimated ? ' (estimated)' : ''}` : 'Unknown'}</dd></div>
              <div><dt>Color</dt><dd>{pet.color || '—'}</dd></div>
              <div><dt>Sex</dt><dd>{pet.sex}</dd></div>
              <div><dt>Status</dt><dd>{pet.reproductiveStatus}</dd></div>
              <div><dt>Diet</dt><dd className="service-notes">{pet.diet || 'Not recorded'}</dd></div>
            </dl>
          </SectionCard>
          <SectionCard title="Care alerts" action={<button className="text-link" onClick={() => setModal({ type: 'alert' })}>Add alert</button>}>
            <div className="care-alert-list">{alerts.filter((alert) => alert.pet_id === pet.id).map((alert) => <div key={alert.id}><Badge tone={alert.is_active ? 'warning' : 'neutral'}>{alert.is_active ? alert.alert_type : 'Resolved'}</Badge><p>{alert.description}</p><div className="record-actions"><button className="text-link" onClick={() => setModal({ type: 'edit-alert', record: alert })}>Edit alert</button>{alert.is_active && <button className="text-link" onClick={() => setModal({ type: 'resolve-alert', record: alert })}>Resolve alert</button>}{profile.role === 'owner' && <button className="text-link danger-text" onClick={() => setModal({ type: 'delete', entity: 'alert', record: alert })}>Delete alert</button>}</div></div>)}</div>
          </SectionCard>
          <SectionCard title="Quick actions">
            <button className="quick-action" onClick={() => setModal({ type: 'vaccine' })}><Syringe size={18} weight="duotone" /><span><strong>Record vaccination</strong><small>Select vaccine, brand and next due date</small></span></button>
            <Link className="quick-action" to="/appointments"><CalendarPlus size={18} weight="duotone" /><span><strong>Book appointment</strong><small>Schedule the next visit</small></span></Link>
            <button className="quick-action" onClick={() => setModal({ type: 'prescription' })}><Pill size={18} weight="duotone" /><span><strong>Add prescription</strong><small>Record medication details</small></span></button>
          </SectionCard>
        {profile.role === 'owner' && <button className="button button-secondary danger-text" onClick={() => setModal({ type: 'delete', entity: 'pet', record: pet })}>Delete patient</button>}
        </aside>
      </div>
      {modal?.type === 'visit' && <VisitModal pet={pet} record={modal.record} onSaved={(saved) => { if (saved.queueEntryId) setCareReceipt({ ...saved, petId: pet.id, label: 'Checkup' }) }} onClose={() => setModal(null)} />}
      {modal?.type === 'queue-care' && <QueueDialog modal={{ type: 'care', entry: modal.entry }} onClose={() => setModal(null)} />}
      {modal?.type === 'vaccine' && <VaccineModal pet={pet} record={modal.record} onSaved={(saved) => { if (saved.queueEntryId) setCareReceipt({ ...saved, petId: pet.id, label: 'Vaccination' }) }} onClose={() => setModal(null)} />}
      {modal?.type === 'owner' && <OwnerEditor record={owner} onClose={() => setModal(null)} />}
      {modal?.type === 'pet' && <PetEditor record={pet} onClose={() => setModal(null)} />}
      {modal?.type === 'prescription' && <PrescriptionEditor pet={pet} record={modal.record} onClose={() => setModal(null)} />}
      {modal?.type === 'delete' && <DeleteRecordDialog entity={modal.entity} record={modal.record} onDeleted={() => { if (modal.entity === 'pet') navigate('/patients') }} onClose={() => setModal(null)} />}
      {modal?.type === 'finalize' && <ActionDialog title="Finalize this checkup?" description="Finalized notes and vitals cannot be edited. An owner can append a correction." action="finalize_encounter" data={{ id: modal.record.id }} onClose={() => setModal(null)} />}
      {modal?.type === 'correct' && <ActionDialog title="Append clinical correction" action="correct_encounter" data={{ id: modal.record.id }} fields={[{ name: 'reason', label: 'Reason', required: true }, { name: 'correction', label: 'Correction', type: 'textarea', required: true, span: true }]} onClose={() => setModal(null)} />}
      {modal?.type === 'alert' && <ActionDialog title="Add care alert" action="create_alert" data={{ petId: pet.id }} fields={[{ name: 'alertType', label: 'Category', type: 'select', options: ['allergy', 'medical', 'behavior', 'other'] }, { name: 'severity', label: 'Severity', type: 'select', options: ['info', 'warning', 'critical'] }, { name: 'description', label: 'Description', type: 'textarea', required: true, span: true }]} onClose={() => setModal(null)} />}
      {modal?.type === 'resolve-alert' && <ActionDialog title="Resolve this alert?" description="The alert stays in history and is removed from the active care alerts." action="resolve_alert" data={{ id: modal.record.id }} onClose={() => setModal(null)} />}
      {modal?.type === 'edit-alert' && <ActionDialog title="Edit care alert" action="update_alert" data={{ id: modal.record.id }} initial={{ alertType: modal.record.alert_type, severity: modal.record.severity, description: modal.record.description }} fields={[{ name: 'alertType', label: 'Category', type: 'select', options: ['allergy', 'medical', 'behavior', 'other'] }, { name: 'severity', label: 'Severity', type: 'select', options: ['info', 'warning', 'critical'] }, { name: 'description', label: 'Description', type: 'textarea', required: true, span: true }]} onClose={() => setModal(null)} />}
    </div>
  )
}
