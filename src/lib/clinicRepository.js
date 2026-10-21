import { vaccinationStatus } from '../utils/clinicRules'

const tableNames = ['owners', 'pets', 'pet_alerts', 'visits', 'visit_vitals', 'vaccinations', 'appointments', 'queue_entries',
  'reminder_worklist', 'reminder_activity', 'inventory_items', 'inventory_batches', 'inventory_movements',
  'item_suppliers', 'suppliers', 'service_types', 'clinic_settings', 'profiles', 'prescriptions', 'visit_corrections', 'kb_documents']

export function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export function clinicDate(now = new Date(), timezone = 'Asia/Manila') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function clinicTime(value, timezone = 'Asia/Manila') {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

export function clinicTimestamp(date, time = '00:00', timezone = 'Asia/Manila') {
  const guess = new Date(`${date}T${time}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(guess)
  const offset = parts.find((part) => part.type === 'timeZoneName').value.replace('GMT', '') || '+00:00'
  return new Date(`${date}T${time}:00${offset}`).toISOString()
}

const title = (value = '') => value.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
const number = (value) => value == null ? null : Number(value)

export function normalizeClinicData(raw, now = new Date()) {
  const get = (name) => raw[name] || []
  const settings = get('clinic_settings')[0] || null
  const timezone = settings?.timezone || 'Asia/Manila'
  const today = clinicDate(now, timezone)
  const profiles = get('profiles')
  const staffName = (id) => profiles.find((entry) => entry.id === id)?.full_name || 'Clinic staff'
  const queueEntries = get('queue_entries').map((row) => ({ ...row, petId: row.pet_id, appointmentId: row.appointment_id,
    queueDate: row.queue_date, queueSequence: row.queue_number == null ? null : Number(row.queue_number), queueNumber: row.queue_number == null ? null : `Q-${String(row.queue_number).padStart(3, '0')}`,
    careDraft: row.care_draft || {}, draftVersion: row.draft_version || 0, draftSavedAt: row.draft_saved_at,
    draftSavedBy: row.draft_saved_by ? staffName(row.draft_saved_by) : null,
    service: row.service_name, serviceTypeId: row.service_type_id, serviceNotes: row.service_notes || '', veterinarianId: row.veterinarian_id, veterinarian: row.veterinarian_id ? staffName(row.veterinarian_id) : 'Unassigned',
    arrivedAt: row.arrived_at, arrivedTime: clinicTime(row.arrived_at, timezone),
    finishedDate: row.finished_at ? clinicDate(new Date(row.finished_at), timezone) : null }))
  const careMetadata = (field, id) => {
    const careQueue = queueEntries.find((entry) => entry[field] === id) || null
    return { careQueue, careStatus: { waiting: 'Waiting', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[careQueue?.status] || 'Recorded' }
  }
  const visits = get('visits').map((row) => {
    const vital = get('visit_vitals').filter((entry) => entry.visit_id === row.id).sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0] || {}
    return { ...row, ...careMetadata('visit_id', row.id), petId: row.pet_id, type: row.visit_type, complaint: row.chief_complaint, diagnosis: row.diagnosis_summary,
      visitedAt: row.visited_at, cardColor: /^#[0-9a-f]{6}$/i.test(row.card_color) ? row.card_color.toLowerCase() : null, followUpDate: row.follow_up_date, veterinarianId: row.attending_veterinarian_id,
      veterinarian: row.attending_veterinarian_name || staffName(row.attending_veterinarian_id), weightKg: number(vital.weight_kg), temperatureC: number(vital.temperature_c),
      heartRate: number(vital.heart_rate_bpm), respiratoryRate: number(vital.respiratory_rate_rpm), bodyConditionScore: vital.body_condition_score, bodyConditionScale: vital.body_condition_scale || 9,
      hydration: vital.hydration, finalizedAt: row.finalized_at,
      prescriptions: get('prescriptions').filter((entry) => entry.visit_id === row.id),
      corrections: get('visit_corrections').filter((entry) => entry.visit_id === row.id) }
  }).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
  const pets = get('pets').map((row) => {
    const alerts = get('pet_alerts').filter((entry) => entry.pet_id === row.id && entry.is_active)
    return { ...row, ownerId: row.owner_id, recordNumber: row.record_number, reproductiveStatus: row.reproductive_status,
      birthDate: row.birth_date, birthDateEstimated: row.birth_date_estimated || false, diet: row.diet || '', environment: row.environment || '', color: row.color_markings, microchip: row.microchip_number,
      allergies: alerts.filter((entry) => entry.alert_type === 'allergy').map((entry) => entry.description),
      alerts: alerts.filter((entry) => entry.alert_type !== 'allergy').map((entry) => entry.description),
      latestWeight: visits.find((entry) => entry.petId === row.id && entry.weightKg != null)?.weightKg ?? number(row.baseline_weight) }
  })
  const owners = get('owners').map((row) => ({ ...row, fullName: row.full_name, normalizedPhone: row.normalized_phone,
    emergencyContact: row.emergency_contact, isActive: row.is_active, pets: pets.filter((pet) => pet.ownerId === row.id).map((pet) => pet.id) }))
  const batches = get('inventory_batches').map((row) => ({ ...row,
    quantity: get('inventory_movements').filter((entry) => entry.batch_id === row.id).reduce((sum, entry) => sum + Number(entry.quantity_delta), 0) }))
  const inventory = get('inventory_items').map((row) => {
    const itemBatches = batches.filter((batch) => batch.item_id === row.id)
    const expiry = itemBatches.filter((batch) => batch.quantity > 0 && batch.expiration_date).map((batch) => batch.expiration_date).sort()[0] || null
    const movements = get('inventory_movements').filter((entry) => entry.item_id === row.id).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { ...row, minimumStock: Number(row.minimum_stock), allowsFraction: row.allows_fraction, isActive: row.is_active,
      quantity: movements.reduce((sum, entry) => sum + Number(entry.quantity_delta), 0), nearestExpiry: expiry,
      supplierId: get('item_suppliers').find((link) => link.item_id === row.id && link.is_preferred)?.supplier_id || get('item_suppliers').find((link) => link.item_id === row.id)?.supplier_id || null,
      supplierIds: get('item_suppliers').filter((link) => link.item_id === row.id).map((link) => link.supplier_id), batches: itemBatches, movements }
  })
  const reminderTypes = { follow_up: 'Follow-up', vaccination: 'Vaccination', appointment: 'Checkup', custom: 'Custom', medication: 'Medication' }
  const reminders = get('reminder_worklist').map((row) => {
    const dueDate = clinicDate(new Date(row.due_at), timezone)
    const status = ['completed', 'cancelled'].includes(row.status) ? title(row.status) : dueDate < today ? 'Overdue' : dueDate === today ? 'Due' : 'Upcoming'
    return { ...row, petId: row.pet_id, type: reminderTypes[row.reminder_type] || title(row.reminder_type), dueDate, status,
      assignedTo: row.assigned_to ? staffName(row.assigned_to) : 'Unassigned',
      activity: get('reminder_activity').filter((entry) => entry.reminder_id === row.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) }
  })
  return { owners, pets, visits, inventory, reminders, settings, profiles, today, timezone, kbDocuments: get('kb_documents'),
    queueEntries,
    alerts: get('pet_alerts'), allServices: get('service_types'), services: get('service_types').filter((row) => row.is_active),
    suppliers: get('suppliers').map((row) => ({ ...row, contactPerson: row.contact_person || '', notes: row.ordering_notes, isActive: row.is_active })),
    vaccinations: get('vaccinations').map((row) => ({ ...row, ...careMetadata('vaccination_id', row.id), petId: row.pet_id, vaccine: row.vaccine_name, inventoryItemId: row.inventory_item_id || '', brand: row.brand || '', lotNumber: row.lot_number,
      administeredAt: row.administered_at, nextDueAt: row.next_due_at, nextDoseStatus: vaccinationStatus(row.next_due_at, today), veterinarianId: row.administered_by })).sort((a, b) => b.administeredAt.localeCompare(a.administeredAt)),
    appointments: get('appointments').map((row) => ({ ...row, petId: row.pet_id, date: clinicDate(new Date(row.starts_at), timezone),
      time: clinicTime(row.starts_at, timezone), service: get('service_types').find((service) => service.id === row.service_type_id)?.name || 'Clinic visit',
      veterinarianId: row.veterinarian_id, veterinarian: staffName(row.veterinarian_id), status: title(row.status),
      durationMinutes: Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000) })) }
}

export async function fetchClinicData(client) {
  const entries = await Promise.all(tableNames.map(async (name) => {
    const rows = []
    for (let offset = 0; ; offset += 500) {
      let query = client.from(name).select('*').order(name === 'item_suppliers' ? 'item_id' : 'id')
      if (name === 'item_suppliers') query = query.order('supplier_id')
      const { data, error } = await query.range(offset, offset + 499)
      if (error) throw error
      rows.push(...data)
      if (data.length < 500) break
    }
    return [name, rows]
  }))
  return Object.fromEntries(entries)
}

export function clinicErrorMessage(error) {
  const message = error?.message || 'Unable to reach the clinic database. Please try again.'
  const explanations = {
    VACCINATION_ALREADY_QUEUED: 'This patient already has a vaccination record or draft in the queue. Open the existing vaccination to continue.',
    CHECKUP_ALREADY_QUEUED: 'This patient already has a checkup record or draft in the queue. Open the existing checkup to continue.',
    CHECKUP_IN_QUEUE: 'Complete or cancel this checkup’s queue entry before finalizing its clinical record.',
    DRAFT_CONFLICT: 'A newer draft was saved by another staff member. Close and reopen this form to load it before saving.',
    RECORD_CHANGED: 'These notes were edited by another staff member. Close and reopen this form to load the latest notes before saving.',
    QUEUE_DUPLICATE: 'This patient already has an active queue entry for this service. Refresh the queue to view it.',
    CARE_RECORD_REQUIRED: 'Save the checkup or vaccination record from the queue to complete this visit.',
    APPOINTMENT_CONFLICT: 'This veterinarian already has a booking during that time. Choose another slot.',
    APPOINTMENT_IN_PAST: 'Choose a future appointment date and time. Past dates and times cannot be booked.',
    INSUFFICIENT_STOCK: 'This batch does not have enough stock for that withdrawal.',
    DUPLICATE_MICROCHIP: 'This microchip is already registered to another patient.',
    EXPIRED_BATCH: 'This batch has expired. Choose another batch or record expired/damaged disposal.',
    FORBIDDEN: 'Your account does not have permission for this action.',
    RECORD_FINALIZED: 'This encounter is finalized. An owner can append a correction.',
    IMMUTABLE_LEDGER: 'Stock history must be retained. Archive the item or record a correcting movement.',
    BATCH_HAS_STOCK: 'Dispense or dispose of the remaining stock before archiving this batch.',
    HAS_DEPENDENTS: 'Reassign or delete linked patients before deleting this owner.',
    HAS_ATTACHMENTS: 'Stored attachments must be removed before this patient can be deleted.',
    INVALID_TRANSITION: 'This record has changed status. Refresh and choose an available action.',
    NOT_FOUND: 'This record is no longer available. Refresh the workspace.',
  }
  for (const [code, explanation] of Object.entries(explanations)) if (message.includes(code)) return explanation
  if (error?.code === '23505') return message.includes('microchip') ? explanations.DUPLICATE_MICROCHIP : 'This identifier is already in use.'
  if (['23514', '23502', '22P02', '22007', '22008'].includes(error?.code)) return 'Check the required fields, dates, phone number, and numeric values before saving.'
  return message.replace(/^VALIDATION_FAILED:\s*/, '')
}

export function createMutationRunner(client) {
  const retryKeys = new Map()
  return async (action, payload) => {
    const signature = JSON.stringify([action, payload])
    const key = retryKeys.get(signature) || crypto.randomUUID()
    retryKeys.set(signature, key)
    const { data, error } = await client.rpc('portal_mutation', { p_action: action, p_data: payload, p_key: key })
    if (error) throw error
    retryKeys.delete(signature)
    return data
  }
}
