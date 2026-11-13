import { vaccinationStatus } from '../utils/clinicRules'

export const preventiveLabel = (kind) => kind === 'deworming' ? 'Deworming' : 'Vaccination'
export const emptyPreventiveItem = () => ({ id: crypto.randomUUID(), inventoryItemId: '', batchId: '', dispenseQuantity: '', vaccine: '', brand: '', lotNumber: '', dose: '', nextDueAt: '' })

const optionalNumber = (value) => value === '' || value == null ? null : Number(value)
const preventiveVitals = (vitals = {}) => ({
  weightKg: optionalNumber(vitals.weightKg), temperatureC: optionalNumber(vitals.temperatureC),
  heartRate: optionalNumber(vitals.heartRate), respiratoryRate: optionalNumber(vitals.respiratoryRate),
  bodyConditionScore: optionalNumber(vitals.bodyConditionScore), hydration: vitals.hydration || null,
})

export function normalizePreventiveCare(raw, vaccinations, queues, profiles, today) {
  const source = raw.preventive_care_records || []
  const groups = source.length ? source : vaccinations.map((item) => ({ id: item.id, pet_id: item.petId, kind: 'vaccination', administered_at: item.administeredAt, administered_by: item.veterinarianId, administered_by_name: item.veterinarianName, recording_purpose: item.recordingPurpose, version: 0 }))
  return groups.map((row) => {
    const vitals = (raw.preventive_record_vitals || []).find((item) => item.preventive_record_id === row.id)
    const queue = queues.find((entry) => entry.preventive_record_id === row.id || entry.vaccination_id === row.id)
    const items = row.kind === 'deworming' ? (raw.deworming_administrations || []).filter((item) => item.preventive_record_id === row.id).map((item) => ({ ...item, vaccine: item.product_name, inventoryItemId: item.inventory_item_id || '', batchId: item.batch_id || '', dispenseQuantity: item.dispense_quantity, dispenseUnit: item.dispense_unit, stockTracked: item.stock_tracked, consumed: Boolean(item.consumed_at), lotNumber: item.lot_number, nextDueAt: item.next_due_at }))
      : vaccinations.filter((item) => item.preventive_record_id === row.id || (!item.preventive_record_id && item.id === row.id))
    items.forEach((item) => { item.nextDoseStatus = row.recording_purpose === 'record_only' ? 'Historical record' : vaccinationStatus(item.nextDueAt, today) })
    const dueDates = items.map((item) => item.nextDueAt).filter(Boolean).sort()
    return { ...row, petId: row.pet_id, recordingPurpose: row.recording_purpose, administeredAt: row.administered_at,
      vitals: vitals ? { weightKg: vitals.weight_kg == null ? '' : String(vitals.weight_kg), temperatureC: vitals.temperature_c == null ? '' : String(vitals.temperature_c),
        heartRate: vitals.heart_rate_bpm == null ? '' : String(vitals.heart_rate_bpm), respiratoryRate: vitals.respiratory_rate_rpm == null ? '' : String(vitals.respiratory_rate_rpm),
        bodyConditionScore: vitals.body_condition_score == null ? '' : String(vitals.body_condition_score), hydration: vitals.hydration || '', measuredBy: vitals.measured_by || '',
        measuredByName: profiles.find((profile) => profile.id === vitals.measured_by)?.full_name || '', measuredAt: vitals.measured_at || '' }
        : { weightKg: '', temperatureC: '', heartRate: '', respiratoryRate: '', bodyConditionScore: '', hydration: '' },
      veterinarianId: row.administered_by || '', veterinarianName: row.administered_by_name || profiles.find((p) => p.id === row.administered_by)?.full_name || '',
      careQueue: queue || null, careStatus: row.recording_purpose === 'record_only' ? 'Recorded' : ({ waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[queue?.status] || 'Recorded'),
      items, vaccine: items.map((item) => item.vaccine).join(', '), nextDueAt: dueDates[0] || '', nextDoseStatus: row.recording_purpose === 'record_only' ? 'Historical record' : vaccinationStatus(dueDates[0], today),
    }
  }).sort((a, b) => b.administeredAt.localeCompare(a.administeredAt) || a.id.localeCompare(b.id))
}

export function preventiveHistoryRecords(records) {
  return records.map((record) => ({ id: record.id, date: record.administeredAt, record,
    facets: { kind: preventiveLabel(record.kind), status: record.recordingPurpose === 'record_only' ? 'Record only' : record.careStatus, veterinarian: record.veterinarianName || 'Not recorded', due: record.nextDoseStatus },
    search: [preventiveLabel(record.kind), record.administeredAt, record.veterinarianName, record.careStatus, record.careQueue?.queueNumber,
      record.vitals?.weightKg && `${record.vitals.weightKg} kg`, record.vitals?.temperatureC && `${record.vitals.temperatureC} °C`,
      record.vitals?.heartRate && `${record.vitals.heartRate} bpm`, record.vitals?.respiratoryRate && `${record.vitals.respiratoryRate} breaths/minute`,
      record.vitals?.bodyConditionScore && `body condition ${record.vitals.bodyConditionScore}/5`, record.vitals?.hydration,
      ...record.items.flatMap((item) => [item.vaccine, item.brand, item.dose, item.lotNumber, item.nextDueAt])].filter(Boolean).join(' '),
  }))
}

export function preventivePayload(values, items, historical) {
  const vitals = preventiveVitals(values.vitals)
  const prepared = items.map((item) => ({ id: item.id, dose: item.dose.trim(), nextDueAt: item.nextDueAt || '',
    ...(historical ? { vaccine: item.vaccine.trim(), brand: item.brand?.trim() || '', lotNumber: item.lotNumber?.trim() || '' }
      : { inventoryItemId: item.inventoryItemId || '', batchId: item.batchId || '', dispenseQuantity: item.dispenseQuantity === '' || item.dispenseQuantity == null ? null : Number(item.dispenseQuantity), ...(values.kind === 'vaccination' ? { lotNumber: item.lotNumber?.trim() || '' } : {}) }),
  }))
  return { ...values, vitals, ...(values.kind === 'deworming' ? { deworming: prepared[0] } : { vaccines: prepared }) }
}
