import { clinicDate, clinicTime } from './clinicRepository'

export const pastAppointmentMessage = 'Choose a future appointment date and time. Past dates and times cannot be booked.'

export function appointmentMinimum(timezone, now = new Date()) {
  // Appointments have minute precision. Advance to the first full future minute,
  // including the next clinic day when there are no minutes left today.
  const nextMinute = new Date((Math.floor(now.getTime() / 60000) + 1) * 60000)
  return { date: clinicDate(nextMinute, timezone), time: clinicTime(nextMinute, timezone) }
}

export function appointmentTimeOptions(date, timezone, now = new Date()) {
  const minimum = appointmentMinimum(timezone, now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < minimum.date) return []
  const firstHour = date === minimum.date ? Number(minimum.time.slice(0, 2)) : 0
  return Array.from({ length: 24 - firstHour }, (_, index) => {
    const hour = firstHour + index
    const firstMinute = date === minimum.date && hour === firstHour ? Number(minimum.time.slice(3)) : 0
    return {
      value: String(hour).padStart(2, '0'),
      label: `${String(hour % 12 || 12).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`,
      minutes: Array.from({ length: 60 - firstMinute }, (_, minute) => String(firstMinute + minute).padStart(2, '0')),
    }
  })
}

export function validateAppointmentStart(date, time, timezone, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return 'Choose a valid appointment date and time.'
  }
  const minimum = appointmentMinimum(timezone, now)
  return `${date}T${time}` < `${minimum.date}T${minimum.time}` ? pastAppointmentMessage : ''
}
