import { describe, expect, it } from 'vitest'
import { appointmentSource, buildDailyWork, buildPatientTimeline, dateInClinic, isClinicDate, queueSource, stockAttention } from './dailyWorkflow'

describe('patient care timeline', () => {
  const data = {
    timezone: 'Asia/Manila',
    appointments: [{ id: 'a', petId: 'p', date: '2026-10-20', starts_at: '2026-10-20T02:00:00Z', service: 'Checkup', status: 'Completed' }],
    queueEntries: [{ id: 'q', petId: 'p', arrivedAt: '2026-10-20T01:00:00Z', draftSavedAt: '2026-10-20T01:05:00Z', finished_at: '2026-10-20T02:30:00Z', queueDate: '2026-10-20', finishedDate: '2026-10-20', service: 'Checkup', status: 'completed' }],
    visits: [{ id: 'v', petId: 'p', visitedAt: '2026-10-20T02:00:00Z', type: 'Checkup', prescriptions: [{ id: 'rx', prescribed_at: '2026-10-20T02:10:00Z' }], corrections: [{ id: 'c', created_at: '2026-10-20T03:00:00Z', reason: 'Clarification' }] },
      { id: 'other', petId: 'another-pet', visitedAt: '2026-10-21', prescriptions: [{ id: 'private-rx' }] }],
    vaccinations: [{ id: 'vac', petId: 'p', administeredAt: '2026-10-19', vaccine: 'Rabies' }],
    reminders: [{ id: 'r', petId: 'p', dueDate: '2026-10-21', title: 'Follow-up', status: 'Completed', activity: [{ id: 'contact', created_at: '2026-10-20T04:00:00Z', action: 'contact_attempt', note: 'Reached owner' }] }],
  }
  it('combines every source and retains terminal activity without leaking another patient', () => {
    const events = buildPatientTimeline(data, 'p')
    expect(new Set(events.map((event) => event.kind))).toEqual(new Set(['Appointment', 'Arrival', 'Care draft', 'Queue outcome', 'Checkup', 'Prescription', 'Correction', 'Vaccination', 'Reminder', 'Reminder activity']))
    expect(events).toHaveLength(10)
    expect(events.some((event) => event.id.includes('private-rx'))).toBe(false)
    expect(events.find((event) => event.kind === 'Reminder').status).toBe('Completed')
    expect(events[0].date).toBe('2026-10-21')
  })
  it('opens historical dates, completed reminders, correct tabs and prescription anchors', () => {
    const events = buildPatientTimeline(data, 'p')
    expect(events.find((event) => event.kind === 'Appointment').href).toBe('/appointments?date=2026-10-20#appointment-a')
    expect(events.find((event) => event.kind === 'Reminder').href).toBe('/reminders?status=All#reminder-r')
    expect(events.find((event) => event.kind === 'Vaccination').href).toBe('/patients/p?tab=vaccines#vaccination-vac')
    expect(events.find((event) => event.kind === 'Prescription').href).toBe('/patients/p?tab=history#prescription-rx')
    expect(queueSource(data.queueEntries[0])).toBe('/queue?status=All&date=2026-10-20#queue-q')
  })
  it('keeps date-only vaccines on their clinic day and orders offset timestamps by instant', () => {
    const events = buildPatientTimeline({ timezone: 'Asia/Manila', vaccinations: [{ id: 'v', petId: 'p', administeredAt: '2026-10-20' }], visits: [
      { id: 'early', petId: 'p', visitedAt: '2026-10-20T12:00:00+08:00' },
      { id: 'late', petId: 'p', visitedAt: '2026-10-20T06:00:00Z' },
    ] }, 'p')
    expect(events.map((event) => event.id)).toEqual(['Checkup-late', 'Checkup-early', 'Vaccination-v'])
    expect(events.every((event) => event.date === '2026-10-20')).toBe(true)
    expect(dateInClinic('2026-10-19T16:00:00Z', 'Asia/Manila')).toBe('2026-10-20')
  })
  it('handles empty histories and ignores malformed source dates', () => {
    expect(buildPatientTimeline({}, 'p')).toEqual([])
    expect(buildPatientTimeline({ visits: [{ id: 'v', petId: 'p', visitedAt: 'invalid' }] }, 'p')).toEqual([])
    expect(buildPatientTimeline({ visits: [{ id: 'v', petId: 'p', visitedAt: '2026-02-30' }] }, 'p')).toEqual([])
  })
  it('shows recorded medication names and uses the actual reminder completion time when available', () => {
    const events = buildPatientTimeline({ timezone: 'Asia/Manila', visits: [{ id: 'v', petId: 'p', visitedAt: '2026-10-20', prescriptions: [{ id: 'rx', medications: [{ medicationName: 'Recorded A' }, { medicationName: 'Recorded B' }] }] }],
      reminders: [{ id: 'r', petId: 'p', dueDate: '2026-10-25', completed_at: '2026-10-20T02:00:00Z', status: 'Completed' }],
    }, 'p')
    expect(events.find((event) => event.kind === 'Prescription').detail).toBe('Recorded A, Recorded B')
    expect(events.find((event) => event.kind === 'Reminder')).toMatchObject({ date: '2026-10-20', detail: 'Due: 2026-10-25' })
  })
})

describe('daily action board', () => {
  it('prioritizes care in progress, carries waiting patients overnight and computes elapsed time', () => {
    const entries = [
      { id: 'waiting', petId: 'p', status: 'waiting', arrivedAt: '2026-10-19T15:00:00Z' },
      { id: 'in-care', petId: 'p', status: 'in_progress', arrivedAt: '2026-10-20T00:00:00Z' },
      { id: 'finished', petId: 'p', status: 'completed', arrivedAt: '2026-10-19T14:00:00Z' },
    ]
    const { care } = buildDailyWork({ queueEntries: entries }, new Date('2026-10-20T00:30:00Z'))
    expect(care.map((entry) => entry.id)).toEqual(['in-care', 'waiting'])
    expect(care[0].waitMinutes).toBe(30)
    expect(care[1].waitMinutes).toBe(570)
  })
  it('shows only actionable check-ins and due calls and removes completed work', () => {
    const result = buildDailyWork({ today: '2026-10-20', pets: [{ id: 'p', status: 'Active' }, { id: 'inactive', status: 'Inactive' }],
      appointments: [
        { id: 'eligible', petId: 'p', date: '2026-10-20', time: '09:00', status: 'Confirmed' },
        { id: 'checked-in', petId: 'p', date: '2026-10-20', time: '10:00', status: 'Confirmed' },
        { id: 'completed', petId: 'p', date: '2026-10-20', status: 'Completed' },
        { id: 'tomorrow', petId: 'p', date: '2026-10-21', status: 'Confirmed' },
        { id: 'inactive', petId: 'inactive', date: '2026-10-20', status: 'Pending' },
      ], queueEntries: [{ id: 'q', appointmentId: 'checked-in', status: 'cancelled' }],
      reminders: [
        { id: 'today', dueDate: '2026-10-20', status: 'Due' }, { id: 'overdue', dueDate: '2026-10-19', status: 'Overdue' },
        { id: 'done', dueDate: '2026-10-18', status: 'Completed' }, { id: 'cancelled', dueDate: '2026-10-18', status: 'Cancelled' },
        { id: 'upcoming', dueDate: '2026-10-21', status: 'Upcoming' },
      ] })
    expect(result.checkins.map((entry) => entry.id)).toEqual(['eligible'])
    expect(result.calls.map((entry) => entry.id)).toEqual(['overdue', 'today'])
  })
})

describe('stock watch', () => {
  const item = (overrides) => ({ id: 'i', name: 'Medicine', isActive: true, quantity: 10, minimumStock: 5, batches: [], ...overrides })
  it('checks every stocked batch, including later expiries hidden by an already expired lot', () => {
    const [attention] = stockAttention([item({ batches: [
      { expiration_date: '2026-10-19', quantity: 1 }, { expiration_date: '2026-11-19', quantity: 2 },
      { expiration_date: '2026-10-21', quantity: 0 }, { expiration_date: '2026-11-20', quantity: 2 },
    ] })], '2026-10-20')
    expect(attention.expired).toHaveLength(1)
    expect(attention.expiring).toHaveLength(1)
    expect(attention.expiring[0].expiration_date).toBe('2026-11-19')
  })
  it('includes expiry today, ignores invalid dates, archived items and empty lots', () => {
    expect(stockAttention([item({ batches: [{ expiration_date: '2026-10-20', quantity: 1 }, { expiration_date: 'not-a-date', quantity: 1 }] })], '2026-10-20')[0].expiring).toHaveLength(1)
    expect(stockAttention([item({ isActive: false, quantity: 0 }), item({ batches: [{ expiration_date: '2026-10-19', quantity: 0 }] })], '2026-10-20')).toEqual([])
  })
  it('prioritizes expired stock before shortages and includes the minimum boundary', () => {
    const rows = stockAttention([item({ id: 'low', quantity: 5 }), item({ id: 'expired', batches: [{ expiration_date: '2026-10-19', quantity: 1 }] })], '2026-10-20')
    expect(rows.map((row) => row.item.id)).toEqual(['expired', 'low'])
    expect(rows[1].lowStock).toBe(true)
  })
})

it('validates shareable dates and encodes identifiers in record links', () => {
  expect(isClinicDate('2026-02-30')).toBe(false)
  expect(isClinicDate('2026-10-20')).toBe(true)
  expect(isClinicDate(null)).toBe(false)
  expect(appointmentSource({ id: 'a/b', date: '2026-10-20' })).toContain('#appointment-a%2Fb')
})
