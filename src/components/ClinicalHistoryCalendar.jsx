import { createContext, useContext } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { DayButton, DayPicker } from '@daypicker/react'
import '@daypicker/react/style.css'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { clinicalCalendarEntries } from '../lib/patientRecordHistory'

const CalendarEntriesContext = createContext(new Map())
const eventColors = { 'Follow-up': '#8b78c7', Emergency: '#d477a1', Surgery: '#d79b53', Wellness: '#578ba9', Vaccination: '#6487c9', Prescription: '#8b78c7', Reminder: '#d79b53' }

function CalendarDayButton(props) {
  const entriesByDate = useContext(CalendarEntriesContext)
  const entries = entriesByDate.get(format(props.day.date, 'yyyy-MM-dd')) || []
  const summary = entries.map((entry) => [entry.time, entry.type, entry.title].filter(Boolean).join(' · ')).join('; ')
  return <DayButton {...props} aria-label={`${props['aria-label']}${entries.length ? `, ${entries.length} ${entries.length === 1 ? 'record' : 'records'}: ${summary}` : ', no records'}`}>
    <span className="record-calendar-day-number" aria-hidden="true">{props.children}</span>
    <span className="record-calendar-day-events" aria-hidden="true">{entries.slice(0, 3).map((entry) => <span className="record-calendar-event" key={entry.id}
      style={{ '--calendar-event-color': entry.color || eventColors[entry.type] || '#6b9d90' }} title={[entry.time, entry.type, entry.title].filter(Boolean).join(' · ')}>
      {entry.time && <span className="record-calendar-event-time">{entry.time}</span>}<strong>{entry.type}</strong><span className="record-calendar-event-title">{entry.title}</span>
    </span>)}{entries.length > 3 && <span className="record-calendar-more">+{entries.length - 3} more</span>}</span>
  </DayButton>
}

export default function ClinicalHistoryCalendar({ visits, entries: providedEntries, month, day, today, timezone, onMonthChange, onDayChange, onDayPreview, label = 'Clinical history', itemName = 'checkup', itemPlural = 'checkups' }) {
  const entries = providedEntries || clinicalCalendarEntries(visits, timezone)
  const entriesByDate = new Map()
  for (const entry of entries) {
    if (!entry.date) continue
    if (!entriesByDate.has(entry.date)) entriesByDate.set(entry.date, [])
    entriesByDate.get(entry.date).push(entry)
  }
  for (const dayEntries of entriesByDate.values()) dayEntries.sort((a, b) => a.timestamp - b.timestamp)
  const dates = [...entriesByDate.keys()]
  const monthCount = entries.filter((entry) => entry.date.startsWith(month)).length
  const monthDate = parseISO(`${month}-01`)
  return <section className="clinical-history-calendar section-card" aria-label={`${label} calendar`}>
    <header>
      <h2 aria-live="polite">{format(monthDate, 'MMMM yyyy')}</h2>
      <div>
        <button type="button" className="text-link" disabled={!dates.length} onClick={() => onDayChange([...dates].sort().at(-1))}>Latest {itemName}</button>
        <button type="button" className="calendar-nav-button" aria-label={`Previous ${itemName} month`} onClick={() => onMonthChange(format(addMonths(monthDate, -1), 'yyyy-MM'))}><CaretLeft size={18} aria-hidden="true" /></button>
        <button type="button" className="calendar-nav-button" aria-label={`Next ${itemName} month`} onClick={() => onMonthChange(format(addMonths(monthDate, 1), 'yyyy-MM'))}><CaretRight size={18} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="record-calendar-scroll" role="region" aria-label={`${label} month grid`} tabIndex={0}>
    <CalendarEntriesContext.Provider value={entriesByDate}>
    <DayPicker mode="single" required selected={parseISO(day)} onSelect={(date) => { if (date) { const value = format(date, 'yyyy-MM-dd'); onDayChange(value); onDayPreview?.(value) } }} month={monthDate} onMonthChange={(date) => onMonthChange(format(date, 'yyyy-MM'))}
      today={parseISO(today)} hideNavigation showOutsideDays
      components={{ DayButton: CalendarDayButton }} formatters={{ formatWeekdayName: (date) => format(date, 'EEEE') }}
      modifiers={{ hasAppointments: dates.map((date) => parseISO(date)) }}
      modifiersClassNames={{ hasAppointments: 'calendar-has-appointments' }} className="record-month-calendar" />
    </CalendarEntriesContext.Provider>
    </div>
    <p className="record-calendar-scroll-hint">Swipe horizontally to see the full week.</p>
    <footer><span><i aria-hidden="true" /> Days with {itemPlural}</span><span>{monthCount} matching this month</span></footer>
  </section>
}
