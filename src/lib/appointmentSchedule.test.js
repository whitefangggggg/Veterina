import { describe, expect, it } from 'vitest'
import { appointmentPatientSource, upcomingFollowUps } from './appointmentSchedule'

const pets = [{ id: 'p', status: 'Active' }, { id: 'archived', status: 'Inactive' }]
const visit = { id: 'v', petId: 'p', followUpDate: '2026-10-26', type: 'Wellness', veterinarian: 'Dr. Lee', plan: 'Check wound' }

describe('appointment navigation', () => {
  it('keeps the selected appointment in patient navigation and safely encodes IDs', () => {
    expect(appointmentPatientSource({ id: 'a/1', petId: 'p/1' })).toBe('/patients/p%2F1?appointmentId=a%2F1#patient-appointment-a%2F1')
  })
})

describe('follow-up calendar sync', () => {
  it('uses the rescheduled date and removes an arrived plan without altering its clinical date', () => {
    const planned = { ...visit, followUpScheduledDate: '2026-10-25' }
    expect(upcomingFollowUps([planned], pets, '2026-10-25')).toMatchObject([{ date: '2026-10-25' }])
    expect(planned.followUpDate).toBe('2026-10-26')
    expect(upcomingFollowUps([{ ...planned, followUpArrivedAt: '2026-10-25T04:00:00Z' }], pets, '2026-10-25')).toEqual([])
  })
  it('includes today and future clinical dates without inventing a booking time', () => {
    const result = upcomingFollowUps([visit, { ...visit, id: 'today', followUpDate: '2026-10-25' }], pets, '2026-10-25')
    expect(result.map((entry) => entry.date)).toEqual(['2026-10-25', '2026-10-26'])
    expect(result[1]).toMatchObject({ visitId: 'v', petId: 'p', service: 'Wellness follow-up', notes: 'Check wound', href: '/patients/p?tab=history#v' })
    expect(result[1]).not.toHaveProperty('time')
  })
  it('moves, removes, and reloads from the saved checkup without duplicate copies', () => {
    expect(upcomingFollowUps([{ ...visit, followUpDate: '2026-10-28' }], pets, '2026-10-25')).toMatchObject([{ id: 'follow-up-v', date: '2026-10-28' }])
    expect(upcomingFollowUps([{ ...visit, followUpDate: '' }], pets, '2026-10-25')).toEqual([])
    expect(upcomingFollowUps([], pets, '2026-10-25')).toEqual([])
  })
  it('excludes past/invalid dates, missing/inactive patients, and cancelled care', () => {
    expect(upcomingFollowUps([
      { ...visit, followUpDate: '2026-10-24' }, { ...visit, followUpDate: '2026-02-30' },
      { ...visit, petId: 'archived' }, { ...visit, petId: 'missing' }, { ...visit, careStatus: 'Cancelled' },
    ], pets, '2026-10-25')).toEqual([])
  })
  it('retains finalized plans and separate checkups for the same patient/day', () => {
    expect(upcomingFollowUps([visit, { ...visit, id: 'other', finalizedAt: '2026-10-24T00:00:00Z' }], pets, '2026-10-25')).toHaveLength(2)
  })
})
