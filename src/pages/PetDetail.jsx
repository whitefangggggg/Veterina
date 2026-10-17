import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import { Badge, Field, Modal, SectionCard } from '../components/ui'
import PetSticker from '../components/PetSticker'
import MutationForm from '../components/MutationForm'
import Assistant from '../components/Assistant'
import { useAuth } from '../context/AuthContext'
import { clinicToday } from '../lib/clinicRepository'
import { printHistory } from '../lib/printHistory'
import ClinicalActionModal from '../components/ClinicalActionModal'

const emptyVisit = {
  type: 'Wellness check',
  complaint: '',
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  diagnosis: '',
  veterinarian: 'Dr. Andrea Villanueva',
  weightKg: '',
  temperatureC: '',
  heartRate: '',
  respiratoryRate: '',
  bodyConditionScore: '',
  hydration: 'Normal',
  followUpDate: '',
}

function VisitModal({ pet, onClose }) {
  const { addVisit,staff=[],profile } = useClinicData()
  const [form, setForm] = useState(() => ({ ...emptyVisit, weightKg: pet.latestWeight || '',veterinarianId:profile?.id || '' }))
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    await addVisit({ ...form, petId: pet.id,veterinarianId:form.veterinarianId || profile?.id },event.idempotencyKey)
    onClose()
  }

  return (
    <Modal title={`Record checkup for ${pet.name}`} description="This entry will be appended to the permanent clinical timeline." onClose={onClose} wide>
      <MutationForm onSubmit={submit}>
        <h3 className="form-section-title">Visit details</h3>
        <div className="form-grid three-columns">
          <Field label="Visit type" required><select value={form.type} onChange={set('type')}><option>Wellness check</option><option>Sick visit</option><option>Follow-up</option><option>Emergency</option><option>Procedure</option></select></Field>
          <Field label="Attending veterinarian" required><select required value={form.veterinarianId || profile?.id || ''} onChange={set('veterinarianId')}>{staff.map((s)=><option key={s.id} value={s.id}>{s.full_name}</option>)}{!staff.length && <option value="">Demo veterinarian</option>}</select></Field>
          <Field label="Follow-up date"><input type="date" value={form.followUpDate} onChange={set('followUpDate')} /></Field>
          <Field label="Chief complaint" required span><textarea required rows="2" value={form.complaint} onChange={set('complaint')} /></Field>
        </div>
        <h3 className="form-section-title">Vitals</h3>
        <div className="form-grid four-columns">
          <Field label="Weight (kg)" required><input required type="number" min="0" step="0.01" value={form.weightKg} onChange={set('weightKg')} /></Field>
          <Field label="Temperature (°C)"><input type="number" min="30" max="45" step="0.1" value={form.temperatureC} onChange={set('temperatureC')} /></Field>
          <Field label="Heart rate (bpm)"><input type="number" min="0" value={form.heartRate} onChange={set('heartRate')} /></Field>
          <Field label="Respiratory rate"><input type="number" min="0" value={form.respiratoryRate} onChange={set('respiratoryRate')} /></Field>
          <Field label="Body condition (1–9)"><input type="number" min="1" max="9" value={form.bodyConditionScore} onChange={set('bodyConditionScore')} /></Field>
          <Field label="Hydration"><select value={form.hydration} onChange={set('hydration')}><option>Normal</option><option>Mild dehydration</option><option>Moderate dehydration</option><option>Severe dehydration</option></select></Field>
        </div>
        <h3 className="form-section-title">SOAP clinical note</h3>
        <div className="form-grid two-columns">
          <Field label="Subjective"><textarea rows="3" value={form.subjective} onChange={set('subjective')} placeholder="Owner observations and history" /></Field>
          <Field label="Objective"><textarea rows="3" value={form.objective} onChange={set('objective')} placeholder="Examination findings and measurements" /></Field>
          <Field label="Assessment"><textarea rows="3" value={form.assessment} onChange={set('assessment')} placeholder="Clinical interpretation" /></Field>
          <Field label="Plan"><textarea rows="3" value={form.plan} onChange={set('plan')} placeholder="Treatment, tests and follow-up" /></Field>
          <Field label="Diagnosis" span><input value={form.diagnosis} onChange={set('diagnosis')} /></Field>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary">Save clinical entry</button></div>
      </MutationForm>
    </Modal>
  )
}

function VaccineModal({ pet, onClose }) {
  const { addVaccination,staff=[],profile } = useClinicData()
  const [form, setForm] = useState({ vaccine:'Anti-rabies',administeredAt:clinicToday(),nextDueAt:'',lotNumber:'',dose:'',veterinarianId:profile?.id || '' })
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    await addVaccination({ ...form, petId: pet.id },event.idempotencyKey)
    onClose()
  }
  return (
    <Modal title={`Record vaccination for ${pet.name}`} description="The next due date will automatically create a reminder." onClose={onClose}>
      <MutationForm onSubmit={submit}>
        <div className="form-grid">
          <Field label="Vaccine" required span><input required value={form.vaccine} onChange={set('vaccine')} /></Field>
          <Field label="Date administered" required><input required type="date" value={form.administeredAt} onChange={set('administeredAt')} /></Field>
          <Field label="Next due date" required><input required type="date" value={form.nextDueAt} onChange={set('nextDueAt')} /></Field>
          <Field label="Batch / lot number" required><input required value={form.lotNumber} onChange={set('lotNumber')} /></Field>
          <Field label="Dose"><input value={form.dose} onChange={set('dose')} /></Field>
          <Field label="Veterinarian" required span><select required value={form.veterinarianId} onChange={set('veterinarianId')}>{staff.map((s)=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary">Save vaccination</button></div>
      </MutationForm>
    </Modal>
  )
}

export default function PetDetail() {
  const { isDemo } = useAuth()
  const { petId } = useParams()
  const { getPet,getOwner,visits,vaccinations,reminders,profile,staff=[],prescriptions=[],corrections=[],finalizeEncounter }=useClinicData()
  const [correctionVisit,setCorrectionVisit]=useState(null)
  const [modal, setModal] = useState(null)
  const [tab, setTab] = useState('history')
  const pet = getPet(petId)
  const owner = getOwner(pet?.ownerId)
  const petVisits = useMemo(() => visits.filter((item) => item.petId === petId).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)), [visits, petId])
  const petVaccinations = vaccinations.filter((item) => item.petId === petId)
  const petReminders = reminders.filter((item) => item.petId === petId && item.status !== 'Completed')
  const weightData = [...petVisits].reverse().map((visit) => ({ date: format(parseISO(visit.visitedAt), 'MMM yy'), weight: visit.weightKg, bcs: visit.bodyConditionScore }))

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
          {isDemo?<button className="button button-secondary" onClick={()=>window.print()}><Printer size={18}/> Print demo</button>:profile?.role==='owner'&&<MutationForm onSubmit={async()=>printHistory(petId,staff)}><button className="button button-secondary"><Printer size={18}/> Print history</button></MutationForm>}
          <button className="button button-primary" onClick={() => setModal('visit')}><Plus size={18} weight="bold" /> Record checkup</button>
        </div>
      </div>

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
          </div>

          {tab === 'history' && (
            <div className="clinical-timeline">
              {petVisits.map((visit) => (
                <article className="visit-card section-card" key={visit.id} id={visit.id}>
                  <div className="visit-date">
                    <span>{format(parseISO(visit.visitedAt), 'MMM')}</span>
                    <strong>{format(parseISO(visit.visitedAt), 'dd')}</strong>
                    <small>{format(parseISO(visit.visitedAt), 'yyyy')}</small>
                  </div>
                  <div className="visit-content">
                    <div className="visit-heading"><div><Badge tone="blue">{visit.type}</Badge><h2>{visit.diagnosis || visit.complaint}</h2><p>{visit.complaint}</p></div><span>{visit.veterinarian}</span></div>
                    <div className="vitals-strip">
                      <span><Scales size={15} weight="duotone" /> {visit.weightKg} kg</span>
                      {visit.temperatureC && <span><Thermometer size={15} weight="duotone" /> {visit.temperatureC} °C</span>}
                      {visit.heartRate && <span><Heartbeat size={15} weight="duotone" /> {visit.heartRate} bpm</span>}
                      {visit.respiratoryRate && <span><Pulse size={15} weight="duotone" /> {visit.respiratoryRate} rpm</span>}
                      {visit.bodyConditionScore && <span>BCS {visit.bodyConditionScore}/9</span>}
                    </div>
                    <div className="soap-grid">
                      <div><strong>S · Subjective</strong><p>{visit.subjective || '—'}</p></div>
                      <div><strong>O · Objective</strong><p>{visit.objective || '—'}</p></div>
                      <div><strong>A · Assessment</strong><p>{visit.assessment || '—'}</p></div>
                      <div><strong>P · Plan</strong><p>{visit.plan || '—'}</p></div>
                    </div>
                    {visit.followUpDate && <div className="follow-up-note"><CalendarPlus size={16} weight="duotone" /> Follow-up due {format(parseISO(visit.followUpDate), 'd MMMM yyyy')}</div>}
                    {prescriptions.filter((pr)=>pr.visit_id===visit.id).map((pr)=><p key={pr.id}><strong>{pr.medication_name}</strong> · {pr.dose} · {pr.frequency} · {pr.instructions}</p>)}
                    {corrections.filter((c)=>c.visit_id===visit.id).map((c)=><p key={c.id}><strong>Correction: {c.reason}</strong> · {c.correction}</p>)}
                    {!isDemo && (visit.finalized_at?<p>Finalized · original entry is locked.</p>:<MutationForm onSubmit={async(e)=>finalizeEncounter(visit.id,e.idempotencyKey)}><button className="button button-secondary small-button">Finalize entry</button></MutationForm>)}
                    {!isDemo && profile?.role==='owner'&&<button className="button button-secondary small-button" onClick={()=>{setCorrectionVisit(visit.id);setModal('correction')}}>Append correction</button>}
                  </div>
                </article>
              ))}
              {!petVisits.length && <div className="empty-inline"><FileText size={30} weight="duotone" /><h3>No clinical visits yet</h3><p>Record the first checkup to begin this pet’s history.</p></div>}
            </div>
          )}

          {tab === 'vaccines' && (
            <SectionCard title="Vaccination history" description="Administered doses, batches and next due dates" action={<button className="button button-primary small-button" onClick={() => setModal('vaccine')}><Plus size={16} weight="bold" /> Add vaccine</button>}>
              <div className="vaccine-list">
                {petVaccinations.map((vaccine) => (
                  <div className="vaccine-row" key={vaccine.id} id={vaccine.id}>
                    <div className="vaccine-icon"><Syringe size={20} weight="duotone" /></div>
                    <div><strong>{vaccine.vaccine}</strong><span>Given {format(parseISO(vaccine.administeredAt), 'd MMM yyyy')} · {vaccine.dose}</span></div>
                    <div><span>Lot number</span><strong>{vaccine.lotNumber}</strong></div>
                    <div><span>Next due</span><strong>{vaccine.nextDueAt?format(parseISO(vaccine.nextDueAt),'d MMM yyyy'):'Not recorded'}</strong></div>
                    <Badge tone="success">Recorded</Badge>
                  </div>
                ))}
                {!petVaccinations.length && <div className="empty-inline"><Syringe size={30} weight="duotone" /><h3>No vaccinations recorded</h3></div>}
              </div>
            </SectionCard>
          )}

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
          {!isDemo && <Assistant patientId={petId} />}
          <SectionCard title="Owner">
            <div className="owner-card">
              <div className="avatar owner-avatar">{owner?.fullName?.split(' ').map((word) => word[0]).slice(0, 2).join('')}</div>
              <div><strong>{owner?.fullName}</strong><span>Primary contact</span></div>
            </div>
            <a href={`tel:${owner?.phone?.replace(/\s/g, '')}`}><Phone size={16} weight="duotone" /> {owner?.phone}</a>
            <span><MapPin size={16} weight="duotone" /> {owner?.address}</span>
          </SectionCard>
          <SectionCard title="Patient details">
            <dl className="detail-list">
              <div><dt>Born</dt><dd>{pet.birthDate ? format(parseISO(pet.birthDate), 'd MMM yyyy') : 'Unknown'}</dd></div>
              <div><dt>Color</dt><dd>{pet.color || '—'}</dd></div>
              <div><dt>Sex</dt><dd>{pet.sex}</dd></div>
              <div><dt>Status</dt><dd>{pet.reproductiveStatus}</dd></div>
            </dl>
          </SectionCard>
          <SectionCard title="Quick actions">
            <button className="quick-action" onClick={() => setModal('vaccine')}><Syringe size={18} weight="duotone" /><span><strong>Record vaccination</strong><small>Add batch and next due date</small></span></button>
            <Link className="quick-action" to="/appointments"><CalendarPlus size={18} weight="duotone" /><span><strong>Book appointment</strong><small>Schedule the next visit</small></span></Link>
            {!isDemo && <button className="quick-action" onClick={()=>setModal('prescription')}><Pill size={18} weight="duotone" /><span><strong>Add prescription</strong><small>Record medication details</small></span></button>}
          </SectionCard>
        </aside>
      </div>
      {modal === 'visit' && <VisitModal pet={pet} onClose={() => setModal(null)} />}
      {modal === 'vaccine' && <VaccineModal pet={pet} onClose={() => setModal(null)} />}
      {['prescription','correction'].includes(modal)&&<ClinicalActionModal kind={modal} petId={petId} visitId={correctionVisit} onClose={()=>setModal(null)}/>}
    </div>
  )
}
