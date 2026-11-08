import { useId, useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { RecordEditor } from './RecordForm'
import { RecordingPurpose, VaccineEditor, VisitEditor } from './ClinicalEditors'
import { ClinicianField } from './ClinicalFields'
import DateWordsField from './DateWordsField'
import { clinicTimestamp } from '../lib/clinicRepository'
import { ArrowRight, ClockCounterClockwise, FirstAidKit, Heartbeat, PawPrint, Scissors, ShieldCheck, Syringe } from '@phosphor-icons/react'
import { Modal } from './ui'
import './NewVisitDialog.css'
import { RecordStepper } from './RecordWizard'
import { RecordFlowContext } from '../context/RecordFlowContext'

const serviceAppearance = (service) => ({
  'Vaccinations and Deworming': { Icon: Syringe, description: 'Multiple vaccines or one deworming administration.' },
  Vaccination: { Icon: Syringe, description: 'Multiple vaccines or one deworming administration.' },
  'Follow-up': { Icon: ClockCounterClockwise, description: 'Review progress after previous care.' },
  Grooming: { Icon: Scissors, description: 'Baths, coat care and grooming services.' },
  'Wellness check': { Icon: ShieldCheck, description: 'Routine health and preventive care.' },
  Surgery: { Icon: FirstAidKit, description: 'Surgical care and procedure records.' },
  'Sick visit': { Icon: Heartbeat, description: 'Symptoms, illness or a medical concern.' },
}[service.name] || { Icon: service.workflow === 'vaccination' ? Syringe : service.workflow === 'maintenance' ? PawPrint : ShieldCheck, description: service.workflow === 'maintenance' ? 'Other services and care for your pet.' : 'Care and visit details for your pet.' })

function ServicePicker({ pet, services, selectedId, onSelect, onContinue, onClose, embedded = false }) {
  const descriptionPrefix = useId()
  const selected = services.find((entry) => entry.id === selectedId)
  return <Modal embedded={embedded} className="new-visit-picker" title="Add Record" description={`Choose a service for ${pet.name}. Next, decide how to record the visit.}`} onClose={onClose}>
    {embedded && <><h3 className="record-choice-heading">Choose a service</h3><p className="record-step-description">Select the care you want to record for {pet.name}.</p></>}
    <form onSubmit={(event) => { event.preventDefault(); if (selected) onContinue(selected) }}>
      <fieldset className="visit-service-options" role="radiogroup" aria-label="Choose a service">
        <legend className="visually-hidden">Choose a service</legend>
        {services.map((entry, index) => {
          const { Icon, description } = serviceAppearance(entry)
          const checked = entry.id === selectedId
          return <label key={entry.id} className={`visit-service-card${checked ? ' is-selected' : ''}`}>
            <span className="visit-service-art" aria-hidden="true"><Icon size={29} weight="duotone" /></span>
            <span className="visit-service-copy"><strong>{entry.name === 'Vaccination' ? 'Vaccinations and Deworming' : entry.name}</strong><span id={`${descriptionPrefix}-${index}`}>{description}</span></span>
            <span className="visit-service-select"><input type="radio" name="serviceId" value={entry.id} aria-label={entry.name === 'Vaccination' ? 'Vaccinations and Deworming' : entry.name} aria-describedby={`${descriptionPrefix}-${index}`} checked={checked} required onChange={() => onSelect(entry.id)} /><span aria-hidden="true">{checked ? 'Selected' : 'Select'}</span></span>
          </label>
        })}
        {!services.length && <p className="visit-service-empty">No active services are configured. Ask the clinic owner to add a service.</p>}
      </fieldset>
      <div className="visit-service-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={!selected}>Next <ArrowRight size={16} weight="bold" aria-hidden="true" /></button></div>
    </form>
  </Modal>
}

export function ServiceVisitEditor({ pet, service, purpose, record, onSaved, onClose, embedded = false, wizard = false }) {
  const { execute, profiles, timezone } = useClinicData()
  const historical = purpose === 'record_only'
  const [clinician, setClinician] = useState({ id: record?.veterinarianId || '', name: record?.performed_by_name || '' })
  return <RecordEditor embedded={embedded} wizard={wizard} title={`${record ? 'Edit' : 'Record'} ${service.name} for ${pet.name}`}
    description={historical ? 'Record-keeping only. Save previous service details to history without joining the queue, creating reminders, or deducting stock.' : 'Add this service to the queue. Staff can record the work performed when completing the service.'}
    initial={record || {}} onClose={onClose} submitLabel={historical ? 'Save service record' : 'Add to queue'}
    onSave={async (values) => {
      const saved = await execute(historical ? record ? 'update_record_only_service' : 'create_record_only_service' : 'add_queue_entry', {
        ...values, petId: pet.id, ownerId: pet.ownerId, serviceId: service.id,
        ...(record ? { id: record.id } : {}),
        ...(historical ? { performedAt: clinicTimestamp(values.performedAt.slice(0, 10), values.performedAt.slice(11, 16), timezone) } : {}),
      })
      onSaved?.(historical ? saved : { ...saved, queueEntryId: saved.id })
      return saved
    }} fields={[
      ...(historical ? [
        { name: 'performedAt', render: () => <DateWordsField name="performedAt" label={`Service date (${timezone})`} initial={record?.localPerformedAt || ''} includeTime required /> },
        { name: 'veterinarianId', render: () => <ClinicianField label="Performed by" value={clinician} onChange={setClinician} profiles={profiles} /> },
        { name: 'serviceNotes', label: 'Work performed / service notes', type: 'textarea', maxLength: 10000, span: true },
      ] : [
        { name: 'veterinarianId', label: 'Assigned veterinarian / staff', type: 'select', options: [{ value: '', label: 'Unassigned' }, ...profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.full_name }))] },
        { name: 'notes', label: 'Arrival notes', type: 'textarea', maxLength: 10000, span: true },
      ]),
    ]} />
}

export default function NewVisitDialog({ pet, onSaved, onClose, initialWorkflow }) {
  const { services } = useClinicData()
  const preferredService = services.find((entry) => entry.workflow === initialWorkflow)
  const [service, setService] = useState(preferredService || null)
  const [selectedId, setSelectedId] = useState(preferredService?.id || '')
  const [phase, setPhase] = useState(preferredService ? 1 : 0)
  const [modalTitle, setModalTitle] = useState('Add Record')
  const [panes, setPanes] = useState([])
  const [activeKey, setActiveKey] = useState(null)
  const activePane = panes.find((pane) => pane.key === activeKey)
  const description = phase === 2 && activePane
    ? `${activePane.service.name} for ${pet.name}. ${activePane.purpose === 'record_only' ? 'Record-keeping only: saves to history without a queue entry, live reminders, or stock changes.' : 'Queue processing: review the details before saving or completing care.'}`
    : `Record care for ${pet.name}. Complete each step, then review before saving.`
  const prefixSteps = [{ id: 'service', label: 'Service' }, { id: 'recording', label: 'Recording' }]
  const navigatePrefix = (index) => {
    setModalTitle('Add Record')
    if (index === 1) {
      const selected = services.find((entry) => entry.id === selectedId)
      if (!selected) return
      setService(selected)
    }
    setPhase(index)
  }
  const openEditor = (purpose) => {
    const key = `${service.id}:${purpose}`
    setPanes((current) => current.some((pane) => pane.key === key) ? current : [...current, { key, service, purpose }])
    setActiveKey(key); setPhase(2)
  }
  return <Modal className="new-record-modal" wide title={modalTitle} description={description} onClose={onClose}>
    {phase < 2 && <RecordStepper steps={[...prefixSteps, { id: 'details', label: 'Details' }, { id: 'review', label: 'Review' }]} current={phase} available={service ? 1 : 0} onNavigate={navigatePrefix} />}
    <div data-record-pane hidden={phase !== 0}><ServicePicker embedded pet={pet} services={services} selectedId={selectedId} onSelect={setSelectedId} onContinue={(selected) => { setService(selected); setPhase(1) }} onClose={onClose} /></div>
    {service && <div data-record-pane hidden={phase !== 1}><RecordingPurpose embedded pet={pet} kind={service.name} onSelect={openEditor} onClose={onClose} />
      <div className="new-record-choice-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="button" className="button button-secondary" onClick={() => setPhase(0)}>Back</button></div>
    </div>}
    {panes.map((pane) => {
      const Editor = pane.service.workflow === 'vaccination' ? VaccineEditor : pane.service.workflow === 'maintenance' ? ServiceVisitEditor : VisitEditor
      const active = phase === 2 && pane.key === activeKey
      return <div data-record-pane key={pane.key} hidden={!active}><RecordFlowContext.Provider value={{ prefixSteps, onNavigatePrefix: navigatePrefix, active, setTitle: setModalTitle }}>
        <Editor embedded wizard pet={pet} service={pane.service} purpose={pane.purpose} onSaved={(saved) => onSaved?.({ ...saved, serviceWorkflow: pane.service.workflow })} onClose={onClose} />
      </RecordFlowContext.Provider></div>
    })}
  </Modal>
}
