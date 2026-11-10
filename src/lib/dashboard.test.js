import { describe, expect, it } from 'vitest'
import { appointmentTime, clinicShift, dashboardWork, incompleteCharts } from './dashboard'

describe('clinic shift uses configured local hours', () => {
  const settings = { timezone: 'Asia/Singapore', business_hours: { mon: { open: '09:00', close: '18:00' } } }
  it('handles opening and closing boundaries in the clinic timezone', () => {
    expect(clinicShift(settings, new Date('2026-11-09T00:59:00Z'))).toMatchObject({ status: 'closed', label: 'Opens at 9 AM', greeting: 'Good morning' })
    expect(clinicShift(settings, new Date('2026-11-09T01:00:00Z'))).toMatchObject({ status: 'open', label: 'Open until 6 PM' })
    expect(clinicShift(settings, new Date('2026-11-09T10:00:00Z'))).toMatchObject({ status: 'closed', label: 'Closed for today', greeting: 'Good evening' })
  })
  it('does not infer an open clinic from clock time when hours are absent or invalid', () => {
    for (const hours of [undefined, {}, { mon: { open: 'bad', close: '18:00' } }, { mon: { open: '18:00', close: '09:00' } }]) {
      expect(clinicShift({ ...settings, business_hours: hours }, new Date('2026-11-09T02:00:00Z')).status).toBe('unknown')
    }
    expect(clinicShift({ ...settings, business_hours: { mon: { closed: true } } }, new Date('2026-11-09T02:00:00Z')).label).toBe('Closed today')
  })
  it('uses the local day across a UTC date boundary and daylight-saving time', () => {
    const result = clinicShift({ timezone: 'America/Los_Angeles', business_hours: { sun: { open: '09:00', close: '18:00' } } }, new Date('2026-11-09T01:00:00Z'))
    expect(result).toMatchObject({ status: 'open', greeting: 'Good afternoon', date: 'Sun, Nov 8' })
  })
})

describe('operational dashboard selection', () => {
  it('deduplicates an unfinished chart and its queue draft, with own assigned care first', () => {
    const entries = [{ id: 'queue', visit_id: 'visit', petId: 'pet', status: 'in_progress', veterinarianId: 'me', draftSavedAt: '2026-11-09T01:00:00Z', careDraft: { complaint: 'Retained draft complaint' } }]
    const cards = incompleteCharts({ queueEntries: entries, visits: [{ id: 'visit', petId: 'pet', visitedAt: '2026-11-09', veterinarianId: 'me' }, { id: 'other', visitedAt: '2026-11-08', veterinarianId: 'other' }] }, 'me')
    expect(cards.map((card) => card.id)).toEqual(['visit-visit', 'visit-other'])
    expect(cards[0]).toMatchObject({ draft: true, mine: true, description: 'Retained draft complaint', entry: entries[0] })
  })
  it('includes standalone and other-service drafts while excluding finalized, cancelled and inpatient charts', () => {
    const cards = incompleteCharts({ visits: [
      { id: 'final', finalizedAt: '2026-11-09' }, { id: 'cancel', careQueue: { status: 'cancelled' } },
      { id: 'hospital', admissionId: 'stay' }, { id: 'historical', recordingPurpose: 'record_only' },
    ], queueEntries: [{ id: 'vaccine', category: 'vaccination', status: 'in_progress', draftSavedAt: '2026-11-09' },
      { id: 'cancelled-draft', status: 'cancelled', draftSavedAt: '2026-11-09' }] }, 'me')
    expect(cards.map((card) => card.id)).toEqual(['draft-vaccine', 'visit-historical'])
  })
  it('keeps overnight arrivals and uses only explicit live ready-for-discharge admissions', () => {
    const data = { today: '2026-11-09', queueEntries: [{ id: 'q', status: 'waiting', arrivedAt: '2026-11-08T23:00:00Z' }],
      visits: [{ id: 'finished', finalizedAt: '2026-11-09' }], admissions: [
        { id: 'ready', status: 'ready_for_discharge' }, { id: 'past', status: 'ready_for_discharge', is_historical: true }, { id: 'closed', status: 'discharged' }], inventory: [] }
    const result = dashboardWork(data, 'me', new Date('2026-11-09T01:00:00Z'))
    expect(result.waiting[0].waitMinutes).toBe(120)
    expect(result.ready.map((stay) => stay.id)).toEqual(['ready'])
    expect(result.charts).toEqual([])
  })
  it('prioritizes expired products, clinical stockouts and vaccines with a supplier fallback', () => {
    const item = (id, category, quantity, batches = []) => ({ id, name: id, category, quantity, batches, minimumStock: 5, isActive: true })
    const result = dashboardWork({ today: '2026-11-09', inventory: [item('supplies', 'Consumables', 3), item('medicine', 'Medicine', 0), item('vaccine', 'Vaccines', 0), item('expired', 'Other', 10, [{ quantity: 1, expiration_date: '2026-11-08' }]), { ...item('archived', 'Vaccines', 0), isActive: false }] }, 'me')
    expect(result.stock.map((row) => row.item.id)).toEqual(['expired', 'vaccine', 'medicine', 'supplies'])
  })
  it('orders today’s stream, derives arrivals and retains completed appointments without inventing pickup', () => {
    const result = dashboardWork({ today: '2026-11-09', inventory: [], appointments: [
      { id: 'late', date: '2026-11-09', time: '15:00', status: 'Confirmed' }, { id: 'early', date: '2026-11-09', time: '09:00', status: 'Completed' },
      { id: 'cancel', date: '2026-11-09', time: '08:00', status: 'Cancelled' }, { id: 'tomorrow', date: '2026-11-10', time: '08:00', status: 'Confirmed' },
    ], queueEntries: [{ id: 'arrival', status: 'in_progress', appointmentId: 'late', arrivedAt: '2026-11-09T06:00:00Z' }] }, 'me')
    expect(result.appointments.map((row) => row.id)).toEqual(['early', 'late'])
    expect(result.appointments[1].arrival.id).toBe('arrival')
    expect(result.ready).toEqual([])
  })
})

it('formats clinic-local appointment slots without a second timezone conversion', () => {
  expect(appointmentTime('00:05')).toBe('12:05 AM')
  expect(appointmentTime('12:30')).toBe('12:30 PM')
  expect(appointmentTime('19:00')).toBe('7:00 PM')
  expect(appointmentTime('25:70')).toBe('Time unavailable')
})
