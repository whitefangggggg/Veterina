import { describe, expect, it } from 'vitest'
import { normalizeClinicData } from './clinicRepository'
import { buildPatientTimeline } from './dailyWorkflow'
import { serviceHistoryRecords } from './patientRecordHistory'
import { calendarEditActions } from './calendarRecordEditing'
import { historyHtml } from './reports'

describe('historical service visits', () => {
  const row = { id: 'service', pet_id: 'pet', service_name: 'Grooming', performed_at: '2020-01-01T18:00:00Z', performed_by: null, performed_by_name: '', service_notes: 'Original work' }
  it('keeps service history, clinic dates and timelines separate from queues', () => {
    const data = normalizeClinicData({ patient_service_records: [row] })
    expect(data.queueEntries).toEqual([])
    expect(data.serviceRecords[0]).toMatchObject({ recordingPurpose: 'record_only', queueNumber: '', localPerformedAt: '2020-01-02T02:00', veterinarian: 'Not recorded' })
    expect(serviceHistoryRecords(data.serviceRecords, data.timezone)[0]).toMatchObject({ date: '2020-01-02', facets: { status: 'Record only' } })
    const timeline = buildPatientTimeline(data, 'pet')
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({ kind: 'Service', status: 'Record only', date: '2020-01-02' })
    expect(buildPatientTimeline(data, 'another-pet')).toEqual([])
    expect(calendarEditActions('service', data.serviceRecords[0], data, 'clinical_staff')[0].type).toBe('historical-service')
    expect(calendarEditActions('timeline', timeline[0], data, 'clinical_staff')[0].type).toBe('historical-service')
  })
  it('includes original historical service details in escaped printed history', () => {
    const html = historyHtml({ patient: { name: 'Pet' }, historical_services: [{ ...row, performed_by_name: '<Dr & staff>', service_notes: '<script>alert(1)</script>' }] })
    expect(html).toContain('Historical services')
    expect(html).toContain('2020-01-01T18:00:00Z')
    expect(html).toContain('&lt;Dr &amp; staff&gt;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Record only')
  })
})
