import { describe, expect, it } from 'vitest'
import { filterClinicalHistory } from './clinicalHistory'

const visits = [
  { id: 'recent', type: 'Follow-up', careStatus: 'In progress', veterinarian: 'Dr. José', visitedAt: '2026-10-17T17:10:00Z',
    complaint: 'Vomiting after meals', diagnosis: 'Gastritis', subjective: 'Reduced appetite', objective: 'Tender abdomen',
    assessment: 'Mild dehydration', plan: 'Bland diet', weightKg: 34, temperatureC: 38.5, bodyConditionScore: 3, bodyConditionScale: 5,
    prescriptions: [{ medications: [{ medicationName: 'Clavamox', dose: '250 mg', frequency: 'q12h', duration: '10 days', instructions: 'With food' }] }],
    followUpDate: '2026-10-24', corrections: [] },
  { id: 'old', type: 'Emergency', careStatus: 'Recorded', veterinarian: 'Dr. Lee', visitedAt: '2026-10-16T12:00:00Z',
    complaint: 'Limping', diagnosis: 'Sprain', finalizedAt: '2026-10-16T13:00:00Z',
    prescriptions: [{ medication_name: 'Carprofen', dose: '50 mg', instructions: 'With meal' }],
    corrections: [{ reason: 'Left/right correction', correction: 'Left hind leg' }] },
  { id: 'empty', type: 'Wellness', visitedAt: '2026-10-15T00:00:00Z' },
]
const ids = (filters) => filterClinicalHistory(visits, filters, 'Asia/Manila').map((visit) => visit.id)

describe('clinical history search and filters', () => {
  it('searches across clinical fields with case, accent and whitespace normalization', () => {
    expect(ids({ query: '  VOMITING   clavamox JOSE ' })).toEqual(['recent'])
    for (const query of ['gastritis', 'appetite', 'abdomen', 'dehydration', 'bland diet', '250 mg q12h', 'with food', '34 kg', '38.5', 'BCS 3/5']) {
      expect(ids({ query })).toEqual(['recent'])
    }
  })
  it('includes legacy medications and appended corrections', () => {
    expect(ids({ query: 'carprofen 50 mg' })).toEqual(['old'])
    expect(ids({ query: 'left/right hind leg' })).toEqual(['old'])
  })
  it('combines all filters and keeps the original ordering and records', () => {
    expect(ids({ query: 'gastritis', type: 'Follow-up', status: 'In progress', veterinarian: 'Dr. José', details: 'prescription', from: '2026-10-18', to: '2026-10-18' })).toEqual(['recent'])
    expect(ids({ query: 'gastritis', type: 'Emergency' })).toEqual([])
    expect(ids({ status: 'Recorded' })).toEqual(['old', 'empty'])
    expect(visits.map((visit) => visit.id)).toEqual(['recent', 'old', 'empty'])
  })
  it('uses inclusive clinic dates for encounters across midnight UTC', () => {
    expect(ids({ from: '2026-10-18', to: '2026-10-18' })).toEqual(['recent'])
    expect(ids({ to: '2026-10-17' })).toEqual(['old', 'empty'])
    expect(ids({ from: '2026-10-18', to: '2026-10-16' })).toEqual([])
    expect(ids({ from: 'invalid', to: '2026-02-30' })).toEqual(['recent', 'old', 'empty'])
  })
  it('filters prescriptions, follow-ups, corrections and finalization independently', () => {
    expect(ids({ details: 'prescription' })).toEqual(['recent', 'old'])
    expect(ids({ details: 'follow-up' })).toEqual(['recent'])
    expect(ids({ details: 'correction' })).toEqual(['old'])
    expect(ids({ details: 'finalized' })).toEqual(['old'])
    expect(ids({ details: 'open' })).toEqual(['recent', 'empty'])
    expect(ids({ query: 'unknown' })).toEqual([])
    expect(ids({ query: '   ' })).toEqual(['recent', 'old', 'empty'])
  })
})
