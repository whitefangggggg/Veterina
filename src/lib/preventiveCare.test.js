import { describe, expect, it } from 'vitest'
import { normalizeClinicData } from './clinicRepository'
import { preventiveHistoryRecords, preventivePayload } from './preventiveCare'
import { filterPatientRecords } from './patientRecordHistory'
import { buildPatientTimeline } from './dailyWorkflow'

const raw = {
  preventive_care_records: [
    { id: 'group', pet_id: 'pet', kind: 'vaccination', administered_at: '2026-11-01', administered_by: 'doctor', recording_purpose: 'queue' },
    { id: 'worm', pet_id: 'pet', kind: 'deworming', administered_at: '2020-01-02', administered_by_name: 'Outside doctor', recording_purpose: 'record_only' },
  ],
  profiles: [{ id: 'doctor', full_name: 'Clinic doctor' }],
  vaccinations: ['Anti-Rabies', 'Combination vaccine'].map((vaccine_name, index) => ({ id: `item${index}`, preventive_record_id: 'group', pet_id: 'pet', vaccine_name, administered_at: '2026-11-01', next_due_at: index ? '2027-02-01' : '2027-11-01', brand: 'Known brand' })),
  deworming_administrations: [{ id: 'worm-item', preventive_record_id: 'worm', product_name: 'Dewormer', dose: 'Recorded dose' }],
  queue_entries: [{ id: 'queue', preventive_record_id: 'group', vaccination_id: 'item0', status: 'waiting', arrived_at: '2026-11-01T00:00:00Z' }],
}

describe('preventive care projections', () => {
  it('groups vaccine evidence and shares queue status with every item', () => {
    const data = normalizeClinicData(raw, new Date('2026-11-07T00:00:00Z'))
    expect(data.preventiveCare).toHaveLength(2)
    expect(data.preventiveCare[0]).toMatchObject({ id: 'group', careStatus: 'Waiting', nextDueAt: '2027-02-01', veterinarianName: 'Clinic doctor' })
    expect(data.preventiveCare[0].items).toHaveLength(2)
    expect(data.vaccinations.every((vaccine) => vaccine.careStatus === 'Waiting')).toBe(true)
    expect(data.vaccinations).toHaveLength(2)
    expect(data.preventiveCare[1].items[0].vaccine).toBe('Dewormer')
  })

  it('searches every contained product and filters record type', () => {
    const records = preventiveHistoryRecords(normalizeClinicData(raw).preventiveCare)
    expect(filterPatientRecords(records, { query: 'combination known brand' }).map((row) => row.id)).toEqual(['group'])
    expect(filterPatientRecords(records, { kind: 'Deworming' }).map((row) => row.id)).toEqual(['worm'])
  })

  it('keeps a legacy single vaccine visible without a parent response', () => {
    const data = normalizeClinicData({ vaccinations: [{ id: 'old', pet_id: 'pet', vaccine_name: 'Old vaccine', administered_at: '2020-01-01' }] })
    expect(data.preventiveCare[0].items[0]).toMatchObject({ id: 'old', stockTracked: false })
  })

  it('emits one timeline event per record and retains vaccine deep links in evidence', () => {
    const data = normalizeClinicData(raw)
    const events = buildPatientTimeline(data, 'pet').filter((event) => ['Vaccination', 'Deworming'].includes(event.kind))
    expect(events).toHaveLength(2)
    expect(events.find((event) => event.kind === 'Vaccination').href).toContain('tab=vaccines#preventive-group')
    expect(data.vaccinations.map((item) => item.id)).toEqual(['item0', 'item1'])
  })

  it('separates stock units from clinical dose and excludes stock from history', () => {
    const items = [{ id: 'item', inventoryItemId: 'product', batchId: 'batch', dispenseQuantity: '0.25', dose: ' 1 mL ', vaccine: ' Vaccine ', brand: ' Brand ', lotNumber: 'Lot' }]
    expect(preventivePayload({ kind: 'vaccination' }, items, false).vaccines[0]).toMatchObject({ id: 'item', dispenseQuantity: 0.25, dose: '1 mL', batchId: 'batch' })
    expect(preventivePayload({ kind: 'deworming' }, items, true)).toEqual({ kind: 'deworming', deworming: { id: 'item', vaccine: 'Vaccine', brand: 'Brand', lotNumber: 'Lot', dose: '1 mL', nextDueAt: '' } })
  })
})
