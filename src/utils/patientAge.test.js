import { describe, expect, it } from 'vitest'
import { birthDateFromAge, visibleQueueEntries } from './clinicRules'
import { clinicDate, normalizeClinicData } from '../lib/clinicRepository'

describe('patient age entry', () => {
  it.each([
    ['2026-10-18', '2', '3', '2024-07-18'],
    ['2024-03-31', '0', '1', '2024-02-29'],
    ['2025-03-31', '0', '1', '2025-02-28'],
    ['2024-02-29', '1', '0', '2023-02-28'],
    ['2026-01-31', '', '2', '2025-11-30'],
    ['2026-10-18', '0', '0', '2026-10-18'],
    ['2026-10-18', '', '', ''],
    ['2026-10-18', '-1', '', ''],
    ['2026-10-18', '1.5', '', ''],
    ['2026-10-18', '', '12', ''],
  ])('calculates %s minus %s years and %s months', (today, years, months, expected) => {
    expect(birthDateFromAge(today, years, months)).toBe(expected)
  })
  it('uses the configured clinic date across midnight', () => {
    expect(birthDateFromAge(clinicDate(new Date('2026-03-30T15:59:59Z'), 'Asia/Manila'), 0, 1)).toBe('2026-02-28')
    expect(birthDateFromAge(clinicDate(new Date('2026-03-30T16:00:00Z'), 'Asia/Manila'), 0, 1)).toBe('2026-02-28')
    expect(birthDateFromAge(clinicDate(new Date('2026-03-31T16:00:00Z'), 'Asia/Manila'), 0, 1)).toBe('2026-03-01')
  })
})

describe('clinical and service snapshots', () => {
  it('preserves old scores, estimated dates, brands and archived services', () => {
    const data = normalizeClinicData({
      pets: [{ id: 'pet', birth_date: '2020-01-01', birth_date_estimated: true, diet: 'Renal diet' }],
      visits: [{ id: 'old', visited_at: '2026-01-01' }, { id: 'new', visited_at: '2026-01-02' }],
      visit_vitals: [{ visit_id: 'old', body_condition_score: 7 }, { visit_id: 'new', body_condition_score: 4, body_condition_scale: 5 }],
      vaccinations: [{ id: 'v', administered_at: '2026-01-01', vaccine_name: 'Original vaccine', inventory_item_id: 'sku', brand: 'Original brand', lot_number: 'OLD-LOT' }],
      service_types: [{ id: 'g', name: 'Old grooming', workflow: 'maintenance', is_active: false }],
    })
    expect(data.pets[0]).toMatchObject({ birthDateEstimated: true, diet: 'Renal diet' })
    expect(data.visits.map((v) => [v.bodyConditionScore, v.bodyConditionScale])).toEqual([[4, 5], [7, 9]])
    expect(data.vaccinations[0]).toMatchObject({ vaccine: 'Original vaccine', brand: 'Original brand', lotNumber: 'OLD-LOT', inventoryItemId: 'sku' })
    expect(data.services).toEqual([])
    expect(data.allServices).toHaveLength(1)
  })
  it('filters a specific service independently of its workflow', () => {
    const entries = [{ id: 'surgery', category: 'checkup', serviceTypeId: 's', status: 'waiting', arrivedAt: '2026-10-18T01:00:00Z' }, { id: 'checkup', category: 'checkup', serviceTypeId: 'c', status: 'waiting', arrivedAt: '2026-10-18T02:00:00Z' }]
    expect(visibleQueueEntries(entries, { service: 'service:s' }).map((v) => v.id)).toEqual(['surgery'])
    expect(visibleQueueEntries(entries, { service: 'checkup' })).toHaveLength(2)
  })
})
