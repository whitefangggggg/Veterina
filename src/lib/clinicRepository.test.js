import { describe, expect, it, vi } from 'vitest'
import { clinicDate, clinicTime, clinicTimestamp, createMutationRunner, fetchClinicData, normalizeClinicData, unwrap } from './clinicRepository'

describe('clinic dates and persisted record projection', () => {
  it.each([['waiting', 'Waiting'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']])('shows %s care status on both linked record types', (status, label) => {
    const snapshot = normalizeClinicData({
      visits: [{ id: 'visit', visited_at: '2026-10-17T01:00:00Z' }],
      vaccinations: [{ id: 'vaccine', administered_at: '2026-10-17', next_due_at: '2027-10-17' }],
      queue_entries: [
        { id: 'checkup-ticket', visit_id: 'visit', status, arrived_at: '2026-10-17T01:00:00Z', queue_number: 1, queue_date: '2026-10-17' },
        { id: 'vaccine-ticket', vaccination_id: 'vaccine', status, arrived_at: '2026-10-17T01:01:00Z', queue_number: 2, queue_date: '2026-10-17' },
      ],
    }, new Date('2026-10-17T04:00:00Z'))
    expect(snapshot.visits[0]).toMatchObject({ careStatus: label, careQueue: { queueNumber: 'Q-001' } })
    expect(snapshot.vaccinations[0]).toMatchObject({ careStatus: label, careQueue: { queueNumber: 'Q-002' }, nextDoseStatus: 'Up to date' })
  })
  it('labels historical records without tickets as Recorded', () => {
    const snapshot = normalizeClinicData({ visits: [{ id: 'visit', visited_at: '2026-10-01' }], vaccinations: [{ id: 'vaccine', administered_at: '2026-10-01' }] })
    for (const record of [snapshot.visits[0], snapshot.vaccinations[0]]) expect(record).toMatchObject({ careStatus: 'Recorded', careQueue: null })
  })
  it('formats assigned tickets without changing their saved clinic date at midnight', () => {
    const raw = { queue_entries: [
      { id: 'early', arrived_at: '2026-10-16T15:30:00Z', queue_date: '2026-10-16', queue_number: 1 },
      { id: 'late', arrived_at: '2026-10-16T16:30:00Z', queue_date: '2026-10-17', queue_number: 1000 },
    ] }
    const entries = normalizeClinicData(raw, new Date('2026-10-17T16:30:00Z')).queueEntries
    expect(entries[0]).toMatchObject({ queueNumber: 'Q-001', queueSequence: 1, queueDate: '2026-10-16' })
    expect(entries[1]).toMatchObject({ queueNumber: 'Q-1000', queueSequence: 1000, queueDate: '2026-10-17' })
  })
  it('refreshes vaccination status at clinic midnight and after due-date edits', () => {
    const raw = { vaccinations: [{ id: 'dose', administered_at: '2026-10-01', next_due_at: '2026-10-17' }] }
    expect(normalizeClinicData(raw, new Date('2026-10-16T15:59:00Z')).vaccinations[0].nextDoseStatus).toBe('Up to date')
    expect(normalizeClinicData(raw, new Date('2026-10-16T16:00:00Z')).vaccinations[0].nextDoseStatus).toBe('Due today')
    expect(normalizeClinicData(raw, new Date('2026-10-17T16:00:00Z')).vaccinations[0].nextDoseStatus).toBe('Overdue')
    raw.vaccinations[0].next_due_at = null
    expect(normalizeClinicData(raw).vaccinations[0].nextDoseStatus).toBe('No next dose scheduled')
  })
  it('projects queue history dates using the clinic timezone', () => {
    const raw = { queue_entries: [{ id: 'queue', status: 'completed', pet_id: 'pet', service_name: 'Vaccination', arrived_at: '2026-10-16T15:30:00Z', finished_at: '2026-10-16T16:30:00Z' }] }
    expect(normalizeClinicData(raw).queueEntries[0]).toMatchObject({ petId: 'pet', service: 'Vaccination', arrivedTime: '23:30', finishedDate: '2026-10-17', veterinarian: 'Unassigned' })
  })
  it('restores partial care drafts with their version and author', () => {
    const partial = { vaccine: 'Rabies', lotNumber: '', administeredAt: '', nextDueAt: '2027-10-17' }
    const snapshot = normalizeClinicData({ profiles: [{ id: 'staff', full_name: 'Draft author' }], queue_entries: [{ id: 'queue', arrived_at: '2026-10-17T01:00:00Z', care_draft: partial, draft_version: 2, draft_saved_at: '2026-10-17T02:00:00Z', draft_saved_by: 'staff' }] })
    expect(snapshot.queueEntries[0]).toMatchObject({ careDraft: partial, draftVersion: 2, draftSavedBy: 'Draft author', draftSavedAt: '2026-10-17T02:00:00Z' })
  })
  it('uses the clinic date across midnight independently of the browser timezone', () => {
    const now = new Date('2026-10-16T16:30:00Z')
    expect(clinicDate(now)).toBe('2026-10-17')
    expect(clinicTime(now)).toBe('00:30')
    expect(clinicTimestamp('2026-10-17', '00:30')).toBe('2026-10-16T16:30:00.000Z')
  })

  it('shows empty real datasets without manufacturing records', () => {
    const snapshot = normalizeClinicData({})
    for (const name of ['owners', 'pets', 'visits', 'vaccinations', 'appointments', 'inventory', 'suppliers', 'reminders']) expect(snapshot[name]).toEqual([])
  })

  it('preserves knowledge documents from the upstream workspace without suppressing failed operations', () => {
    const documents = [{ id: 'document', title: 'Clinic checklist', status: 'published', version: 2, content: 'Approved text' }]
    expect(normalizeClinicData({ kb_documents: documents }).kbDocuments).toEqual(documents)
    expect(unwrap({ data: documents, error: null })).toEqual(documents)
    expect(() => unwrap({ data: null, error: new Error('Permission denied') })).toThrow('Permission denied')
  })

  it('derives latest weight from care chronology and excludes resolved alerts', () => {
    const snapshot = normalizeClinicData({
      pets: [{ id: 'pet', owner_id: 'owner', baseline_weight: '4' }],
      owners: [{ id: 'owner', full_name: 'Owner', is_active: true }],
      visits: [{ id: 'old', pet_id: 'pet', visited_at: '2026-10-01T00:00:00Z' }, { id: 'new', pet_id: 'pet', visited_at: '2026-10-15T00:00:00Z' }],
      visit_vitals: [{ visit_id: 'old', weight_kg: '5' }, { visit_id: 'new', weight_kg: '6', temperature_c: null }],
      pet_alerts: [{ pet_id: 'pet', alert_type: 'allergy', description: 'Active allergy', is_active: true }, { pet_id: 'pet', alert_type: 'allergy', description: 'Resolved allergy', is_active: false }],
    })
    expect(snapshot.pets[0].latestWeight).toBe(6)
    expect(snapshot.pets[0].allergies).toEqual(['Active allergy'])
    expect(snapshot.owners[0].pets).toEqual(['pet'])
    expect(snapshot.visits[0].temperatureC).toBeNull()
  })

  it('keeps historical clinician names after staff profiles are renamed and orders vaccinations by care date', () => {
    const snapshot = normalizeClinicData({
      profiles: [{ id: 'doctor', full_name: 'Renamed clinician' }],
      visits: [{ id: 'visit', pet_id: 'pet', visited_at: '2026-10-01', attending_veterinarian_id: 'doctor', attending_veterinarian_name: 'Original clinician' }],
      vaccinations: [{ id: 'old', administered_at: '2026-09-01' }, { id: 'new', administered_at: '2026-10-01' }],
    })
    expect(snapshot.visits[0].veterinarian).toBe('Original clinician')
    expect(snapshot.vaccinations.map((row) => row.id)).toEqual(['new', 'old'])
  })

  it('computes reminder display state from the clinic date and keeps terminal states', () => {
    const raw = { reminder_worklist: [
      { id: 'old', due_at: '2026-10-15T16:00:00Z', status: 'upcoming', reminder_type: 'appointment' },
      { id: 'today', due_at: '2026-10-16T16:00:00Z', status: 'upcoming', reminder_type: 'custom' },
      { id: 'done', due_at: '2026-10-15T16:00:00Z', status: 'completed' },
      { id: 'cancelled', due_at: '2026-10-15T16:00:00Z', status: 'cancelled' },
    ] }
    const snapshot = normalizeClinicData(raw, new Date('2026-10-17T04:00:00Z'))
    expect(snapshot.reminders.map((row) => row.status)).toEqual(['Overdue', 'Due', 'Completed', 'Cancelled'])
    expect(snapshot.reminders[0].type).toBe('Checkup')
  })

  it('uses ledger balances and ignores depleted expiry batches', () => {
    const snapshot = normalizeClinicData({
      inventory_items: [{ id: 'item', minimum_stock: '2', is_active: true }],
      inventory_batches: [{ id: 'depleted', item_id: 'item', expiration_date: '2026-01-01' }, { id: 'stocked', item_id: 'item', expiration_date: '2027-01-01' }],
      inventory_movements: [{ item_id: 'item', batch_id: 'depleted', quantity_delta: 3, created_at: '2026-01-01' }, { item_id: 'item', batch_id: 'depleted', quantity_delta: -3, created_at: '2026-01-02' }, { item_id: 'item', batch_id: 'stocked', quantity_delta: 5, created_at: '2026-01-03' }],
    })
    expect(snapshot.inventory[0]).toMatchObject({ quantity: 5, nearestExpiry: '2027-01-01', minimumStock: 2 })
  })
})

describe('database transport', () => {
  it('reuses a retry key after a lost response and retires it after acknowledgement', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: 'Network failure' } }).mockResolvedValue({ data: { id: 'saved' } })
    const run = createMutationRunner({ rpc })
    await expect(run('create_owner', { fullName: 'Owner' })).rejects.toMatchObject({ message: 'Network failure' })
    await run('create_owner', { fullName: 'Owner' })
    expect(rpc.mock.calls[0][1].p_key).toBe(rpc.mock.calls[1][1].p_key)
    await run('create_owner', { fullName: 'Owner' })
    expect(rpc.mock.calls[2][1].p_key).not.toBe(rpc.mock.calls[1][1].p_key)
  })

  it('paginates past the API limit and respects the supplier link composite key', async () => {
    const ordering = []
    const client = { from: (table) => {
      const query = { select: () => query, order: (column) => { ordering.push([table, column]); return query }, range: async (start) => ({ data: table === 'pets' && start === 0 ? Array.from({ length: 500 }, (_, id) => ({ id })) : table === 'pets' ? [{ id: 500 }] : [], error: null }) }
      return query
    } }
    const result = await fetchClinicData(client)
    expect(result.pets).toHaveLength(501)
    expect(ordering).toContainEqual(['item_suppliers', 'item_id'])
    expect(ordering).toContainEqual(['item_suppliers', 'supplier_id'])
  })

  it('propagates failed reads instead of substituting fixtures', async () => {
    const query = { select: () => query, order: () => query, range: async () => ({ data: null, error: { message: 'Permission denied' } }) }
    await expect(fetchClinicData({ from: () => query })).rejects.toMatchObject({ message: 'Permission denied' })
  })
})
