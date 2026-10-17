import { describe, expect, it } from 'vitest'
import { appointmentMinimum, appointmentTimeOptions, pastAppointmentMessage, validateAppointmentStart } from './appointmentScheduling'
import { clinicErrorMessage } from './clinicRepository'

describe('future appointments in the clinic timezone', () => {
  const timezone = 'Asia/Manila'
  const now = new Date('2026-10-17T06:30:40Z') // 14:30 in the clinic.

  it('rejects yesterday, an earlier hour today, and the current minute', () => {
    for (const [date, time] of [['2026-10-16', '23:59'], ['2026-10-17', '13:30'], ['2026-10-17', '14:30']]) {
      expect(validateAppointmentStart(date, time, timezone, now)).toBe(pastAppointmentMessage)
    }
  })

  it('accepts the next minute today and an earlier clock time on a later day', () => {
    expect(validateAppointmentStart('2026-10-17', '14:31', timezone, now)).toBe('')
    expect(validateAppointmentStart('2026-10-18', '09:00', timezone, now)).toBe('')
  })

  it('sets the first selectable minute and rejects an exactly current start', () => {
    expect(appointmentMinimum(timezone, now)).toEqual({ date: '2026-10-17', time: '14:31' })
    expect(validateAppointmentStart('2026-10-17', '14:30', timezone, new Date('2026-10-17T06:30:00Z'))).toBe(pastAppointmentMessage)
  })

  it('moves the minimum to tomorrow after the final selectable minute today', () => {
    const midnight = new Date('2026-10-17T15:59:59Z')
    expect(appointmentMinimum(timezone, midnight)).toEqual({ date: '2026-10-18', time: '00:00' })
    expect(validateAppointmentStart('2026-10-17', '23:59', timezone, midnight)).toBe(pastAppointmentMessage)
    expect(validateAppointmentStart('2026-10-18', '00:00', timezone, midnight)).toBe('')
  })

  it('uses the configured clinic day even when UTC or the browser is on another day', () => {
    const beforeUtcMidnight = new Date('2026-10-17T16:30:00Z')
    expect(appointmentMinimum(timezone, beforeUtcMidnight)).toEqual({ date: '2026-10-18', time: '00:31' })
    expect(validateAppointmentStart('2026-10-17', '23:59', timezone, beforeUtcMidnight)).toBe(pastAppointmentMessage)
    expect(appointmentMinimum('America/Los_Angeles', beforeUtcMidnight)).toEqual({ date: '2026-10-17', time: '09:31' })
  })

  it('rechecks a time that elapsed while the form remained open', () => {
    expect(validateAppointmentStart('2026-10-17', '14:31', timezone, now)).toBe('')
    expect(validateAppointmentStart('2026-10-17', '14:31', timezone, new Date('2026-10-17T06:31:01Z'))).toBe(pastAppointmentMessage)
  })

  it('requires date and minute precision and explains backend rejection', () => {
    for (const [date, time] of [['', ''], ['2026-10-17', '24:00'], ['2026-10-17', '14:31:59'], ['invalid', '14:31']]) {
      expect(validateAppointmentStart(date, time, timezone, now)).toContain('valid appointment')
    }
    expect(clinicErrorMessage({ message: 'APPOINTMENT_IN_PAST: choose a future time' })).toBe(pastAppointmentMessage)
  })

  it('offers only future hours and minutes today, including minute precision', () => {
    const options = appointmentTimeOptions('2026-10-17', timezone, now)
    expect(options[0]).toMatchObject({ value: '14', label: '02 PM' })
    expect(options[0].minutes[0]).toBe('31')
    expect(options[0].minutes).not.toContain('30')
    expect(options.find((hour) => hour.value === '15').minutes).toHaveLength(60)
    for (const hour of options) {
      for (const minute of hour.minutes) expect(validateAppointmentStart('2026-10-17', `${hour.value}:${minute}`, timezone, now)).toBe('')
    }
  })

  it('offers all hours and minutes on a later day, with correct noon and midnight labels', () => {
    const options = appointmentTimeOptions('2026-10-18', timezone, now)
    expect(options).toHaveLength(24)
    expect(options[0]).toMatchObject({ value: '00', label: '12 AM' })
    expect(options[12]).toMatchObject({ value: '12', label: '12 PM' })
    expect(options.every((hour) => hour.minutes.length === 60)).toBe(true)
  })

  it('removes elapsed options as the clock advances and offers no times on past dates', () => {
    const later = new Date('2026-10-17T07:00:01Z')
    expect(appointmentTimeOptions('2026-10-17', timezone, later)[0]).toMatchObject({ value: '15', minutes: expect.not.arrayContaining(['00']) })
    expect(appointmentTimeOptions('2026-10-16', timezone, now)).toEqual([])
    expect(appointmentTimeOptions('', timezone, now)).toEqual([])
    expect(appointmentTimeOptions('2026-10-17', timezone, new Date('2026-10-17T15:59:01Z'))).toEqual([])
  })
})
