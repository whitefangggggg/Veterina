import { useState } from 'react'
import { useClinicData } from '../context/ClinicDataContext'
import { Badge, SectionCard } from './ui'
import { RecordEditor } from './RecordForm'

const workflows = [{ value: 'checkup', label: 'Checkup' }, { value: 'vaccination', label: 'Vaccination' }, { value: 'maintenance', label: 'Maintenance' }]

export default function ServiceSettings() {
  const { allServices, appointments, queueEntries, execute } = useClinicData()
  const [editor, setEditor] = useState(null)
  const record = editor?.record
  const used = record && (appointments.some((row) => row.service_type_id === record.id) || queueEntries.some((row) => row.serviceTypeId === record.id))
  return <SectionCard title="Services" description="Manage booking durations and the form staff use to complete each service." action={<button className="button button-primary" onClick={() => setEditor({})}>Add service</button>}>
    <div className="record-directory">{[...allServices].sort((a, b) => a.name.localeCompare(b.name)).map((service) => <article className="directory-card" key={service.id}>
      <div><h3>{service.name}</h3><p>{service.default_duration_minutes} minutes · {workflows.find((workflow) => workflow.value === service.workflow)?.label || 'Checkup'}</p><Badge tone={service.is_active ? 'success' : 'neutral'}>{service.is_active ? 'Active' : 'Archived'}</Badge></div>
      <button className="button button-secondary small-button" onClick={() => setEditor({ record: service })}>Edit service</button>
    </article>)}</div>
    {editor && <RecordEditor title={record ? 'Edit service' : 'Add service'} onClose={() => setEditor(null)}
      initial={record ? { name: record.name, duration: record.default_duration_minutes, workflow: record.workflow, isActive: String(record.is_active) } : { duration: 30, workflow: 'checkup' }}
      onSave={(values) => execute(record ? 'update_service' : 'create_service', { ...values, ...(record ? { id: record.id, ...(used ? { workflow: record.workflow } : {}) } : {}) })}
      submitLabel="Save service" fields={[
        { name: 'name', label: 'Service name', required: true, maxLength: 120 },
        { name: 'duration', label: 'Default duration (minutes)', type: 'number', min: '5', max: '480', step: '1', required: true },
        { name: 'workflow', label: 'Workflow', type: 'select', options: workflows, required: true, disabled: used, hint: used ? 'This service has been used. Archive it and create a replacement to change its workflow.' : 'Checkup uses clinical notes; Maintenance uses service notes.' },
        ...(record ? [{ name: 'isActive', label: 'Status', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Archived' }] }] : []),
      ]} />}
  </SectionCard>
}
