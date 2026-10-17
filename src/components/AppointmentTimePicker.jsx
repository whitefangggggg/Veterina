import { useId, useState } from 'react'
import { appointmentTimeOptions } from '../lib/appointmentScheduling'

export default function AppointmentTimePicker({ date, timezone, clock, initialTime = '', onRefresh }) {
  const labelId = useId()
  const hintId = useId()
  const [selection, setSelection] = useState(initialTime)
  const options = appointmentTimeOptions(date, timezone, clock)
  const selectedHour = options.find((option) => option.value === selection.slice(0, 2))
  const hour = selectedHour?.value || ''
  const minute = selectedHour?.minutes.includes(selection.slice(3)) ? selection.slice(3) : ''
  const periods = [...new Set(options.map((option) => Number(option.value) < 12 ? 'AM' : 'PM'))]
  const period = selectedHour ? (Number(hour) < 12 ? 'AM' : 'PM') : periods[0] || ''
  const periodHours = options.filter((option) => (Number(option.value) < 12 ? 'AM' : 'PM') === period)

  const changeHour = (event) => {
    // Recheck against the real clock if the user left a dropdown open across
    // a minute boundary. A stale option must never become the selected value.
    const latest = appointmentTimeOptions(date, timezone).find((option) => option.value === event.target.value)
    if (latest) setSelection(`${latest.value}:${latest.minutes.includes(minute) ? minute : latest.minutes[0]}`)
    onRefresh()
  }
  const changeMinute = (event) => {
    const latest = appointmentTimeOptions(date, timezone).find((option) => option.value === hour)
    if (latest?.minutes.includes(event.target.value)) setSelection(`${hour}:${event.target.value}`)
    onRefresh()
  }
  const changePeriod = (event) => {
    const latest = appointmentTimeOptions(date, timezone).filter((option) => (Number(option.value) < 12 ? 'AM' : 'PM') === event.target.value)
    const target = String((Number(hour || 0) % 12) + (event.target.value === 'PM' ? 12 : 0)).padStart(2, '0')
    const next = latest.find((option) => option.value === target) || latest[0]
    if (next) setSelection(`${next.value}:${next.minutes.includes(minute) ? minute : next.minutes[0]}`)
    onRefresh()
  }

  return <div className="field" role="group" aria-labelledby={labelId}>
    <span id={labelId}>Time<b aria-hidden="true"> *</b></span>
    <div className="appointment-time-controls">
      <select aria-label="Appointment hour" aria-describedby={hintId} required value={hour} onFocus={onRefresh} onChange={changeHour} disabled={!options.length}>
        <option value="" disabled>Hour</option>
        {periodHours.map((option) => <option key={option.value} value={option.value}>{option.label.split(' ')[0]}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label="Appointment minute" aria-describedby={hintId} required value={minute} onFocus={onRefresh} onChange={changeMinute} disabled={!hour}>
        <option value="" disabled>Min</option>
        {selectedHour?.minutes.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <select aria-label="Appointment period" aria-describedby={hintId} value={period} onFocus={onRefresh} onChange={changePeriod} disabled={periods.length < 2}>
        {!periods.length && <option value="">AM/PM</option>}
        {periods.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <input type="hidden" name="time" value={hour && minute ? `${hour}:${minute}` : ''} />
    <small id={hintId}>{options.length ? `Clinic time: ${timezone}. Only upcoming times are available.` : 'No upcoming times on this date. Choose a later date.'}</small>
  </div>
}
