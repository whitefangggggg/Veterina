import { describe, expect, it } from 'vitest'
import { appointmentCareSchedule, appointmentPatientSource, upcomingFollowUps } from './appointmentSchedule'

const pets = [{ id: 'p', status: 'Active' }, { id: 'archived', status: 'Inactive' }]
const visit = { id: 'v', petId: 'p', followUpDate: '2026-10-26', type: 'Wellness', veterinarian: 'Dr. Lee', plan: 'Check wound' }

describe('combined appointment and contact schedule', () => {
  const task = { id: 'r', petId: 'p', visit_id: 'v', type: 'Follow-up', status: 'Upcoming', dueDate: '2026-10-26' }
  const schedule = (changes = {}) => appointmentCareSchedule({ appointments: [], reminders: [task], visits: [visit], vaccinations: [], pets, today: '2026-10-25', ...changes })
  it('shows a linked follow-up and contact task once on their shared date', () => {
    const result = schedule()
    expect(result.followUps[0].tasks).toEqual([task])
    expect(result.calendarTasks).toEqual([])
    expect(result.tasks).toEqual([task])
    expect(task.status).toBe('Upcoming')
  })
  it('keeps snoozed contacts separate and combines only explicit same-pet appointment links', () => {
    const appointment = { id: 'a', petId: 'p', date: '2026-10-26', status: 'Confirmed' }
    const reminders = [{ ...task, dueDate: '2026-10-27' }, { ...task, id: 'booking-call', visit_id: null, appointment_id: 'a' }, { ...task, id: 'unrelated', visit_id: null }, { ...task, id: 'wrong-pet', petId: 'other', appointment_id: 'a', visit_id: null }]
    const result = schedule({ appointments: [appointment], reminders })
    expect(result.followUps[0].tasks).toEqual([])
    expect(result.appointmentTasks.get('a').map((task) => task.id)).toEqual(['booking-call'])
    expect(result.calendarTasks.map((task) => task.id)).toEqual(['unrelated', 'wrong-pet', 'r'])
    expect(schedule({ appointments: [{ ...appointment, status: 'Cancelled' }], reminders }).calendarTasks).toHaveLength(4)
  })
  it('retains terminal task history while keeping historical care outside the live calendar', () => {
    const result = schedule({ reminders: [task, { ...task, id: 'complete', status: 'Completed' }, { ...task, id: 'cancelled', status: 'Cancelled' }, { ...task, id: 'old', visit_id: 'old' }, { ...task, id: 'vax', visit_id: null, vaccination_id: 'vax' }],
      visits: [visit, { ...visit, id: 'old', recordingPurpose: 'record_only' }], vaccinations: [{ id: 'vax', recordingPurpose: 'record_only' }] })
    expect(result.tasks.map((task) => task.id)).toEqual(['cancelled', 'complete', 'r'])
    expect(result.openTasks).toEqual([task])
    expect(result.followUps).toHaveLength(1)
  })
})

describe('appointment navigation', () => {
  it('keeps the selected appointment in patient navigation and safely encodes IDs', () => {
    expect(appointmentPatientSource({ id: 'a/1', petId: 'p/1' })).toBe('/patients/p%2F1?appointmentId=a%2F1#patient-appointment-a%2F1')
  })
})

describe('follow-up calendar sync', () => {
  it('keeps historical follow-up dates out of live scheduling', () => {
    expect(upcomingFollowUps([{ ...visit, recordingPurpose: 'record_only' }], pets, '2026-10-25')).toEqual([])
  })
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
