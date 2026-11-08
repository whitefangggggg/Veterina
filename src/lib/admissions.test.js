import { describe, expect, it, vi } from 'vitest'
import { admissionLocalTime, admissionTimestamp, admissionSummaryHtml, effectiveObservations, fetchAdmissionPage, filterAdmissions, overdueTask, stayDuration } from './admissions'
import { buildPatientTimeline } from './dailyWorkflow'
import { normalizeClinicData } from './clinicRepository'

describe('admission operational projections', () => {
  const admissions = [
    { id: 'stable', status: 'admitted', condition: 'stable', admitted_at: '2026-11-01T00:00:00Z', patientName: 'Milo', veterinarianId: 'vet', unitId: 'unit', reference: 'ADM-1' },
    { id: 'critical', status: 'under_treatment', condition: 'critical', admitted_at: '2026-10-31T00:00:00Z', patientName: 'Maya', reference: 'ADM-2' },
    { id: 'old', status: 'discharged', condition: 'critical', admitted_at: '2026-10-01T00:00:00Z', closed_at: '2026-10-03T01:00:00Z', patientName: 'Milo', reference: 'ADM-3' },
  ]
  it('keeps closed critical stays out of current work and combines independent filters', () => {
    expect(filterAdmissions(admissions).map((a) => a.id)).toEqual(['critical', 'stable'])
    expect(filterAdmissions(admissions, { query: 'milo adm-1', condition: 'stable', veterinarian: 'vet', unit: 'unit' }).map((a) => a.id)).toEqual(['stable'])
    expect(filterAdmissions(admissions, { history: true, status: 'discharged' }).map((a) => a.id)).toEqual(['old'])
    expect(filterAdmissions(admissions, { unit: 'unassigned' }).map((a) => a.id)).toEqual(['critical'])
  })
  it('shows overdue pending and delayed tasks without relabeling held care', () => {
    const now = new Date('2026-11-08T00:00:00Z')
    expect(overdueTask({ status: 'delayed', due_at: '2026-11-07' }, now)).toBe(true)
    expect(overdueTask({ status: 'held', due_at: '2026-11-07' }, now)).toBe(false)
    expect(stayDuration(admissions[2], now)).toBe('2d 1h')
  })
  it('retains occurrence times and applies complete correction chains, including corrections beyond the loaded page', () => {
    const rows = [
      { id: 'old', occurred_at: '2026-11-01', recorded_at: '2026-11-01', values: { weightKg: 3 } },
      { id: 'correction', corrects_id: 'old', occurred_at: '2026-11-01', recorded_at: '2026-11-02', values: { weightKg: 4 } },
      { id: 'remote-correction', is_current: false, occurred_at: '2026-11-03', recorded_at: '2026-11-03', values: { weightKg: 5 } },
    ]
    expect(effectiveObservations(rows).map((r) => r.id)).toEqual(['correction'])
    expect(rows[0].values.weightKg).toBe(3)
  })
  it('serializes clinic timestamps independently of the browser timezone', () => {
    const time = '2026-11-08T01:30:00.000Z'
    expect(admissionLocalTime(time, 'Asia/Manila')).toBe('2026-11-08T09:30')
    expect(admissionTimestamp('2026-11-08T09:30', 'Asia/Manila')).toBe(time)
  })
  it('projects hospitalization once in the unified timeline instead of duplicating its encounter', () => {
    const raw = { admissions: [{ id: 'stay', pet_id: 'pet', visit_id: 'visit', status: 'discharged', admitted_at: '2026-11-01', closed_at: '2026-11-03' }], visits: [{ id: 'visit', pet_id: 'pet', visited_at: '2026-11-01', visit_type: 'Hospitalization' }] }
    const data = normalizeClinicData(raw)
    expect(data.visits[0].admissionId).toBe('stay')
    expect(buildPatientTimeline(data, 'pet').map((e) => e.kind)).toEqual(['Discharge', 'Admission'])
    expect(buildPatientTimeline(data, 'pet')[0].href).toBe('/admissions/stay')
  })
})

describe('private admission documents and scoped reads', () => {
  it('escapes snapshot and correction evidence, preserving original discharge text', () => {
    const snapshot = { version: 1, admission: { reference: '<ADM>', status: 'discharged', condition: 'stable', admitted_at: '2026-11-01', closed_at: '2026-11-03' }, patient: { name: '<script>x</script>' }, assessment: 'Original assessment', observations: [], prescriptions: [], administrations: [], authorizedAt: '2026-11-03' }
    const addendum = { id: 'c', kind: 'note', corrects_id: 'o', note: '<img src=x>', correction_reason: 'Corrected', occurred_at: '2026-11-02', author_name: 'Owner' }
    const html = admissionSummaryHtml(snapshot, { observations: [addendum] })
    expect(html).toContain('Original assessment')
    expect(html).toContain('Subsequent correction addenda')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).not.toContain('<img src=x>')
    expect(snapshot.observations).toEqual([])
    expect(() => admissionSummaryHtml({ version: 2 })).toThrow('Unsupported')
  })
  it('bounds selected-admission pages, uses a stable cursor and propagates failures', async () => {
    const q = { select: vi.fn(() => q), eq: vi.fn(() => q), in: vi.fn(() => q), not: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(() => q), or: vi.fn(() => q), then: (resolve) => resolve({ data: [{ id: 'two', recorded_at: '2026-11-02' }], count: 2 }) }
    const from = vi.fn(() => q)
    const page = await fetchAdmissionPage({ from }, 'stay', 'observations', { limit: 999, cursor: { id: 'one', recorded_at: '2026-11-01' } })
    expect(q.eq).toHaveBeenCalledWith('admission_id', 'stay')
    expect(q.limit).toHaveBeenCalledWith(100)
    expect(q.or).toHaveBeenCalledWith('recorded_at.gt.2026-11-01,and(recorded_at.eq.2026-11-01,id.gt.one)')
    expect(from).toHaveBeenCalledWith('admission_observation_history')
    expect(page.hasMore).toBe(true)
    await expect(fetchAdmissionPage({ from }, 'stay', 'unknown')).rejects.toThrow('Unknown')
    q.then = (resolve) => resolve({ error: new Error('Permission denied') })
    await expect(fetchAdmissionPage({ from }, 'stay', 'tasks')).rejects.toThrow('Permission denied')
  })
})
