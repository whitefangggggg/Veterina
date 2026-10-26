import { describe, expect, it } from 'vitest'
import { clinicalCalendarEntries, filterPatientRecords, patientCalendarEntries, recordHistoryFields, serviceHistoryRecords, timelineHistoryRecords, vaccinationHistoryRecords } from './patientRecordHistory'

describe('patient record filters and calendar dates', () => {
  it('keeps visit types, diagnoses, saved colors and clinic times in calendar mini previews', () => {
    const [entry] = clinicalCalendarEntries([{ id: 'checkup', visitedAt: '2026-10-17T17:10:00Z', type: 'Follow-up', diagnosis: 'Gastritis', cardColor: '#cc5599' }], 'Asia/Manila')
    expect(entry).toMatchObject({ date: '2026-10-18', type: 'Follow-up', title: 'Gastritis', color: '#cc5599', time: '1:10 AM' })
    const records = timelineHistoryRecords([{ id: 'rx', date: '2026-10-18', at: '2026-10-17T17:10:00Z', kind: 'Prescription', visitType: 'Follow-up', detail: 'Clavamox' }])
    expect(patientCalendarEntries(records, 'timeline', 'Asia/Manila')[0]).toMatchObject({ type: 'Follow-up', title: 'Prescription · Clavamox', time: '1:10 AM' })
    expect(filterPatientRecords(records, { query: 'Follow-up' })).toHaveLength(1)
  })
  it('keeps date-only vaccinations as all-day events and labels service mini previews', () => {
    const records = vaccinationHistoryRecords([{ id: 'v', vaccine: 'Rabies', administeredAt: '2026-10-18' }], [], 'America/Los_Angeles')
    expect(patientCalendarEntries(records, 'vaccination', 'America/Los_Angeles')[0]).toMatchObject({ type: 'Vaccination', title: 'Rabies', date: '2026-10-18', time: '' })
    const services = serviceHistoryRecords([{ id: 's', service: 'Grooming', arrivedAt: '2026-10-18T02:00:00Z', status: 'completed', serviceNotes: 'Bath and trim' }], 'Asia/Manila')
    expect(patientCalendarEntries(services, 'service', 'Asia/Manila')[0]).toMatchObject({ type: 'Grooming', title: 'Bath and trim', time: '10:00 AM' })
  })
  it('searches vaccination snapshots, lot numbers and doses without shifting date-only records', () => {
    const records = vaccinationHistoryRecords([
      { id: 'old', vaccine: 'Rabies', brand: 'Nobivac', administeredAt: '2026-10-16', dose: '1 mL', lotNumber: 'RAB-001', careStatus: 'Recorded', nextDoseStatus: 'Overdue', administered_by_name: 'Dr. José' },
      { id: 'recent', vaccine: 'DHPP', administeredAt: '2026-10-18', veterinarianId: 'staff', nextDoseStatus: 'Up to date' },
    ], [{ id: 'staff', full_name: 'Dr. Lee' }], 'America/Los_Angeles')
    expect(records.map((record) => record.date)).toEqual(['2026-10-18', '2026-10-16'])
    expect(filterPatientRecords(records, { query: 'RAB-001 jose 1 ml', due: 'Overdue', from: '2026-10-16', to: '2026-10-16' }).map((record) => record.id)).toEqual(['old'])
    expect(filterPatientRecords(records, { veterinarian: 'Dr. Lee', due: 'Overdue' })).toEqual([])
    expect(recordHistoryFields(records, [['brand', 'Brand', 'All brands']])[0].options).toEqual(['Nobivac', 'Not recorded'])
  })
  it('uses saved service dates, retains cancelled history and searches notes and tickets', () => {
    const records = serviceHistoryRecords([
      { id: 'saved', queueDate: '2026-10-17', arrivedAt: '2026-10-17T17:00:00Z', service: 'Grooming', status: 'cancelled', veterinarian: 'Dr. Lee', serviceNotes: 'Bath and trim', queueNumber: 'Q-003' },
      { id: 'arrival', arrivedAt: '2026-10-17T17:00:00Z', service: 'Nail trim', status: 'waiting', serviceNotes: '' },
    ], 'Asia/Manila')
    expect(records.map((record) => record.date)).toEqual(['2026-10-18', '2026-10-17'])
    expect(filterPatientRecords(records, { query: 'bath Q-003', status: 'Cancelled', notes: 'With service notes' }).map((record) => record.id)).toEqual(['saved'])
    expect(filterPatientRecords(records, { notes: 'Without service notes' }).map((record) => record.id)).toEqual(['arrival'])
  })
  it('combines timeline activity/status/date filters and preserves source links and record order', () => {
    const events = [
      { id: 'rx', date: '2026-10-18', kind: 'Prescription', status: 'Finalized', title: 'Prescription recorded', detail: 'Carprofen', href: '/patients/p?tab=history#prescription-rx' },
      { id: 'vaccine', date: '2026-10-16', kind: 'Vaccination', status: 'Recorded', title: 'Rabies' },
    ]
    const records = timelineHistoryRecords(events)
    const filtered = filterPatientRecords(records, { query: 'CARPROFEN', kind: 'Prescription', status: 'Finalized', from: '2026-10-18', to: '2026-10-18' })
    expect(filtered.map((record) => record.id)).toEqual(['rx'])
    expect(filtered[0].record).toBe(events[0])
    expect(filtered[0].record.href).toContain('#prescription-rx')
    expect(filterPatientRecords(records, { from: '2026-10-18', to: '2026-10-16' })).toEqual([])
    expect(filterPatientRecords(records, { query: '   ', from: 'invalid' })).toEqual(records)
    expect(events.map((event) => event.id)).toEqual(['rx', 'vaccine'])
  })
})
