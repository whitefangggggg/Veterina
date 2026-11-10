import { describe, expect, it } from 'vitest'
import { combinedClinicalHistory, filterClinicalHistory, normalizePatientHistoryParams } from './clinicalHistory'

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
  it('finds records by requested laboratory work and result text', () => {
    const records = [{ ...visits[0], laboratoryRequests: 'CBC and urinalysis', laboratoryResults: 'No hemoparasites detected' }, visits[1]]
    for (const query of ['urinalysis', 'hemoparasites', 'CBC detected']) {
      expect(filterClinicalHistory(records, { query }, 'Asia/Manila').map((record) => record.id)).toEqual(['recent'])
    }
  })
  const services = [
    { id: 'recent', service: 'Grooming', arrivedAt: '2026-10-17T18:00:00Z', status: 'completed', veterinarian: 'Dr. Lee', serviceNotes: 'Bath and trim', notes: 'Gentle handling', queueNumber: 'Q-003' },
    { id: 'historic', service: 'Nail trim', arrivedAt: '2026-10-17T17:10:00Z', status: 'record_only', recordingPurpose: 'record_only', veterinarian: 'Dok sa Bukid' },
  ]
  it('combines full timestamps, retains both record types with colliding IDs and deduplicates services', () => {
    const records = combinedClinicalHistory(visits, [...services, services[0]])
    expect(records.map((record) => record.historyKey)).toEqual(['service:recent', 'checkup:recent', 'service:historic', 'checkup:old', 'checkup:empty'])
    expect(records[0].sourceRecord).toBe(services[0])
    expect(records[1].sourceRecord).toBe(visits[0])
    expect(services[0].visitedAt).toBeUndefined()
    const offsets = combinedClinicalHistory([{ ...visits[0], visitedAt: '2026-10-18T02:00:00+08:00' }], [{ ...services[0], arrivedAt: '2026-10-17T19:00:00Z' }])
    expect(offsets[0].historyKind).toBe('service')
  })
  it('shares search and facets while restricting clinical detail filters to their appropriate record type', () => {
    const records = combinedClinicalHistory(visits, services)
    const matching = (filters) => filterClinicalHistory(records, filters, 'Asia/Manila').map((record) => record.historyKey)
    expect(matching({ query: 'bath gentle Q-003' })).toEqual(['service:recent'])
    expect(matching({ kind: 'service', status: 'Completed', type: 'Grooming', from: '2026-10-18', to: '2026-10-18' })).toEqual(['service:recent'])
    expect(matching({ status: 'Record only' })).toEqual(['service:historic'])
    expect(matching({ details: 'open' })).toEqual(['checkup:recent', 'checkup:empty'])
    expect(matching({ details: 'service-notes' })).toEqual(['service:recent'])
    expect(matching({ details: 'no-service-notes' })).toEqual(['service:historic'])
    expect(matching({ kind: 'checkup', details: 'service-notes' })).toEqual([])
  })
  it('merges hospital stays chronologically without repeating their admission encounters', () => {
    const stay = { id: 'stay', visit_id: 'inpatient', admitted_at: '2026-10-18T03:00:00Z', reason: 'Observation after surgery', reference: 'ADM-123', veterinarianName: 'Dr. Lee', condition: 'under_observation', status: 'under_treatment', unitName: 'Ward A' }
    const encounter = { id: 'inpatient', visitedAt: stay.admitted_at, prescriptions: [{ medication_name: 'Inpatient medicine' }] }
    const records = combinedClinicalHistory([...visits, encounter], services, [], [stay, stay])
    expect(records[0].historyKey).toBe('hospitalization:stay')
    expect(records[0].sourceRecord).toBe(stay)
    expect(records.some((record) => record.historyKey === 'checkup:inpatient')).toBe(false)
    expect(records.filter((record) => record.historyKind === 'hospitalization')).toHaveLength(1)
    expect(filterClinicalHistory(records, { kind: 'hospitalization', status: 'Under Treatment', veterinarian: 'Dr. Lee', from: '2026-10-18', to: '2026-10-18', query: 'ADM-123 observation Ward A' }).map((record) => record.historyKey)).toEqual(['hospitalization:stay'])
    expect(filterClinicalHistory(records, { query: 'Inpatient medicine', details: 'prescription' }).map((record) => record.historyKey)).toEqual(['hospitalization:stay'])
    expect(filterClinicalHistory(records, { kind: 'hospitalization', details: 'open' })).toEqual([])
    expect(stay.historyKind).toBeUndefined()
  })
  it('retains discharged, cancelled and historical stays with no encounter available', () => {
    const records = combinedClinicalHistory([{ id: 'past-visit', recordingPurpose: 'record_only' }], [], [], [
      { id: 'past', visit_id: 'past-visit', admitted_at: '2020-01-01T03:00:00Z', status: 'discharged', is_historical: true },
      { id: 'cancelled', admitted_at: '2026-10-18T03:00:00Z', status: 'cancelled' },
    ])
    expect(records.map((record) => record.careStatus)).toEqual(['Cancelled', 'Discharged'])
    expect(filterClinicalHistory(records, { status: 'Discharged' }).map((record) => record.id)).toEqual(['past'])
  })
  it('translates removed service tabs and filters without overwriting explicit clinical filters', () => {
    const params = new URLSearchParams('tab=services&serviceQuery=bath&serviceService=Grooming&serviceStatus=Completed&serviceNotes=With+service+notes&serviceView=calendar&serviceDay=2026-10-18&historySearch=trim&appointmentId=a')
    const normalized = normalizePatientHistoryParams(params)
    expect(Object.fromEntries(normalized)).toEqual({ tab: 'history', historySearch: 'trim', historyKind: 'service', historyType: 'Grooming', historyStatus: 'Completed', historyDetails: 'service-notes', historyView: 'calendar', historyDay: '2026-10-18', appointmentId: 'a' })
    expect(Object.fromEntries(normalizePatientHistoryParams(new URLSearchParams('tab=timeline&timelineKind=Prescription&timelineView=calendar&historySearch=care')))).toEqual({ tab: 'history', historySearch: 'care' })
    expect(normalizePatientHistoryParams(new URLSearchParams('tab=growth'))).toBeNull()
  })
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
