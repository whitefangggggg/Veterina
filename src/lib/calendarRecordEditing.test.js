import { describe, expect, it } from 'vitest'
import { calendarEditActions } from './calendarRecordEditing'

const visit = { id: 'visit', petId: 'pet', prescriptions: [{ id: 'rx' }], corrections: [{ id: 'correction' }] }
const vaccine = { id: 'vaccine', petId: 'pet' }
const data = {
  visits: [visit], vaccinations: [vaccine],
  queueEntries: [{ id: 'service', category: 'maintenance', status: 'completed' }, { id: 'waiting', category: 'checkup', status: 'waiting' }, { id: 'care', category: 'checkup', status: 'in_progress' }, { id: 'cancelled', category: 'checkup', status: 'cancelled' }],
  appointments: [{ id: 'booked', status: 'Confirmed' }, { id: 'done', status: 'Completed' }],
  reminders: [{ id: 'due', status: 'Due', activity: [] }, { id: 'closed', status: 'Completed', activity: [{ id: 'contact' }] }],
}
const actions = (kind, sourceId, role = 'clinical_staff', overrides = {}) => calendarEditActions('timeline', { kind, sourceId }, { ...data, ...overrides }, role)

describe('calendar preview edit actions', () => {
  it('resolves records behind timeline events to their existing editors', () => {
    expect(actions('Checkup', 'visit')[0]).toMatchObject({ type: 'visit', record: visit, petId: 'pet' })
    expect(actions('Prescription', 'rx')[0]).toMatchObject({ type: 'prescription', record: visit.prescriptions[0], petId: 'pet' })
    expect(actions('Vaccination', 'vaccine')[0]).toMatchObject({ type: 'vaccine', record: vaccine })
    expect(actions('Queue outcome', 'service')[0]).toMatchObject({ type: 'service-notes' })
    expect(actions('Care draft', 'care')[0]).toMatchObject({ type: 'queue-care' })
    expect(actions('Arrival', 'waiting')[0]).toMatchObject({ type: 'queue-start' })
  })
  it('protects finalized notes, prescriptions and immutable corrections', () => {
    const finalized = { ...visit, finalizedAt: '2026-10-20' }
    expect(calendarEditActions('checkup', finalized, data, 'clinical_staff')).toEqual([])
    expect(calendarEditActions('checkup', finalized, data, 'owner')[0].type).toBe('correct')
    expect(actions('Prescription', 'rx', 'clinical_staff', { visits: [finalized] })).toEqual([])
    expect(actions('Prescription', 'rx', 'owner', { visits: [finalized] })[0].type).toBe('correct')
    expect(actions('Correction', 'correction')).toEqual([])
    expect(actions('Correction', 'correction', 'owner')[0].type).toBe('correct')
  })
  it('does not edit terminal bookings/reminders or recreate cancelled care', () => {
    expect(actions('Appointment', 'booked')[0].type).toBe('appointment')
    expect(actions('Appointment', 'done')).toEqual([])
    expect(actions('Reminder', 'due')[0].type).toBe('reminder')
    expect(actions('Reminder', 'closed')).toEqual([])
    expect(actions('Reminder activity', 'contact')).toEqual([])
    expect(actions('Arrival', 'cancelled')).toEqual([])
    expect(actions('Checkup', 'missing')).toEqual([])
  })
})
