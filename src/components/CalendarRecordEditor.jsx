import { useClinicData } from '../context/ClinicDataContext'
import { VisitEditor, VaccineEditor, PrescriptionEditor } from './ClinicalEditors'
import { AppointmentEditor, ReminderEditor } from './OperationEditors'
import { QueueDialog, ServiceNotesEditor } from './QueueEditors'
import { ActionDialog } from './RecordForm'
import { Modal } from './ui'

export default function CalendarRecordEditor({ action, onClose }) {
  const { getPet, visits, vaccinations, queueEntries, appointments, reminders } = useClinicData()
  const pet = getPet(action.petId)
  const record = action.record
  if (action.type === 'visit') {
    const visit = visits.find((visit) => visit.id === record.id) || record
    if (visit.finalizedAt) return <Modal title="Checkup finalized" onClose={onClose}><p>This checkup has been finalized. Return to the preview to view it or append an owner correction.</p><button type="button" className="button button-secondary" onClick={onClose}>Back to preview</button></Modal>
    if (visit.careStatus === 'In progress' && visit.careQueue) return <QueueDialog modal={{ type: 'care', entry: visit.careQueue }} onClose={onClose} />
    return <VisitEditor pet={pet} record={visit} onClose={onClose} />
  }
  if (action.type === 'vaccine') {
    const vaccine = vaccinations.find((vaccine) => vaccine.id === record.id) || record
    if (vaccine.careStatus === 'In progress' && vaccine.careQueue) return <QueueDialog modal={{ type: 'care', entry: vaccine.careQueue }} onClose={onClose} />
    return <VaccineEditor pet={pet} record={vaccine} onClose={onClose} />
  }
  if (action.type === 'prescription') return <PrescriptionEditor pet={pet} record={record} onClose={onClose} />
  if (action.type === 'service-notes') return <ServiceNotesEditor entry={queueEntries.find((entry) => entry.id === record.id) || record} onClose={onClose} />
  if (action.type === 'queue-care' || action.type === 'queue-start') return <QueueDialog modal={{ type: action.type === 'queue-start' ? 'start' : 'care', entry: record }} onClose={onClose} />
  if (action.type === 'appointment') return <AppointmentEditor record={appointments.find((appointment) => appointment.id === record.id) || record} onClose={onClose} />
  if (action.type === 'reminder') return <ReminderEditor record={reminders.find((reminder) => reminder.id === record.id) || record} onClose={onClose} />
  if (action.type === 'correct') return <ActionDialog title="Append clinical correction" action="correct_encounter" data={{ id: record.id }} fields={[{ name: 'reason', label: 'Reason', required: true }, { name: 'correction', label: 'Correction', type: 'textarea', required: true, span: true }]} onClose={onClose} />
  return null
}
