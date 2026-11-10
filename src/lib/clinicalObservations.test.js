import { describe, expect, it } from 'vitest'
import { clinicalAssessmentText, clinicalObservationFields, clinicalObservationRows } from './clinicalObservations'

describe('clinical observation presentation', () => {
  it('keeps the existing sections and adds optional laboratory fields in order', () => {
    expect(clinicalObservationFields).toEqual([
      { name: 'subjective', label: 'History' },
      { name: 'objective', label: 'Clinical Assessment' },
      { name: 'plan', label: 'Treatment Plan' },
      { name: 'laboratoryRequests', label: 'Laboratory Requests', storageName: 'laboratory_requests', maxLength: 10000, span: true },
      { name: 'laboratoryResults', label: 'Laboratory Results', storageName: 'laboratory_results', maxLength: 10000, span: true },
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
  it('reads normalized or raw laboratory notes and omits empty legacy fields', () => {
    for (const record of [
      { laboratoryRequests: 'CBC\nUrinalysis', laboratoryResults: 'Findings <pending>' },
      { laboratory_requests: 'CBC\nUrinalysis', laboratory_results: 'Findings <pending>' },
    ]) expect(clinicalObservationRows(record).slice(3)).toEqual([
      ['Laboratory Requests', 'CBC\nUrinalysis'], ['Laboratory Results', 'Findings <pending>'],
    ])
    expect(clinicalObservationRows({ laboratoryRequests: '', laboratory_requests: 'Do not restore cleared text', laboratoryResults: '  ' })).toHaveLength(3)
  })
})
