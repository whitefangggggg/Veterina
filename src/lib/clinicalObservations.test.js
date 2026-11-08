import { describe, expect, it } from 'vitest'
import { clinicalAssessmentText, clinicalObservationFields, clinicalObservationRows } from './clinicalObservations'

describe('clinical observation presentation', () => {
  it('presents three sections using the existing storage keys', () => {
    expect(clinicalObservationFields).toEqual([
      { name: 'subjective', label: 'History' },
      { name: 'objective', label: 'Clinical Assessment' },
      { name: 'plan', label: 'Treatment Plan' },
    ])
  })

  it('retains legacy assessment text within Clinical Assessment without modifying the source', () => {
    const record = { subjective: 'Reduced appetite', objective: 'Tender abdomen', assessment: 'Mild dehydration', plan: 'Bland diet' }
    expect(clinicalObservationRows(record)).toEqual([
      ['History', 'Reduced appetite'], ['Clinical Assessment', 'Tender abdomen\n\nMild dehydration'], ['Treatment Plan', 'Bland diet'],
    ])
    expect(record.assessment).toBe('Mild dehydration')
    expect(record.objective).toBe('Tender abdomen')
  })

  it('supports older assessment-only records and empty observations', () => {
    expect(clinicalAssessmentText({ assessment: 'Historical finding' })).toBe('Historical finding')
    expect(clinicalAssessmentText({ objective: ' ', assessment: null })).toBe('')
  })
})
