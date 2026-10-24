import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useClinicData } from '../context/ClinicDataContext'
import { isClinicDate } from '../lib/dailyWorkflow'
import { filterPatientRecords, patientCalendarEntries } from '../lib/patientRecordHistory'
import ClinicalHistoryFilters from './ClinicalHistoryFilters'
import ClinicalHistoryCalendar from './ClinicalHistoryCalendar'
import { EmptyState } from './ui'
import CalendarDayPreview from './CalendarDayPreview'
import CalendarRecordDetails from './CalendarRecordDetails'

export default function PatientRecordBrowser({ records, scope, label, itemName, itemPlural, fields, dateLabel, placeholder, emptyTitle, emptyDescription, previewKind,
  pageSize = Infinity, moreLabel, children }) {
  const { today, timezone } = useClinicData()
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const [page, setPage] = useState(null)
  const [previewDay, setPreviewDay] = useState(null)
  const paramName = (field) => `${scope}${field.charAt(0).toUpperCase()}${field.slice(1)}`
  const names = ['query', ...fields.map((field) => field.name), 'from', 'to']
  const filters = Object.fromEntries(names.map((name) => [name, params.get(paramName(name)) || '']))
  const filtered = filterPatientRecords(records, filters)
  const view = !hash && params.get(paramName('view')) === 'calendar' ? 'calendar' : 'cards'
  const dates = filtered.map((record) => record.date).filter(Boolean).sort().reverse()
  const requestedDay = params.get(paramName('day'))
  const requestedMonth = params.get(paramName('month'))
  const month = isClinicDate(`${requestedMonth}-01`) ? requestedMonth : (isClinicDate(requestedDay) ? requestedDay : dates[0] || today).slice(0, 7)
  const day = isClinicDate(requestedDay) && requestedDay.startsWith(month) ? requestedDay : dates.find((date) => date.startsWith(month)) || `${month}-01`
  const visible = view === 'calendar' ? filtered.filter((record) => record.date === day) : filtered
  const signature = JSON.stringify([filters, view, day])
  const limit = page?.signature === signature ? page.limit : pageSize
  const update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(paramName(name), value)
      else next.delete(paramName(name))
    }
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const clear = () => update(Object.fromEntries(names.map((name) => [name, ''])))
  const previewRecords = filtered.filter((record) => record.date === previewDay).map((entry) => entry.record)
  return <div className="patient-record-browser">
    <ClinicalHistoryFilters visits={records} filters={filters} count={filtered.length} timezone={timezone} label={label} itemName={itemName} itemPlural={itemPlural}
      advancedFields={fields} dateLabel={dateLabel} placeholder={placeholder} view={view} onViewChange={(value) => update({ view: value === 'calendar' ? value : '' })} onChange={(name, value) => update({ [name]: value })} onClear={clear} />
    {view === 'calendar' && <>
      <ClinicalHistoryCalendar entries={patientCalendarEntries(filtered, previewKind, timezone)} month={month} day={day} today={today} timezone={timezone}
        label={label} itemName={itemName} itemPlural={itemPlural} onMonthChange={(value) => update({ month: value, day: '' })} onDayChange={(value) => update({ day: value, month: value.slice(0, 7) })} onDayPreview={setPreviewDay} />
      <div className="clinical-history-day-heading"><h2>{format(parseISO(day), 'd MMMM yyyy')}</h2><span>{visible.length} {visible.length === 1 ? itemName : itemPlural}</span></div>
    </>}
    {children(visible.slice(0, limit).map((entry) => entry.record))}
    {!records.length && <EmptyState title={emptyTitle} description={emptyDescription} />}
    {records.length > 0 && !filtered.length && <div className="empty-inline"><h3>No matching {itemPlural}</h3><p>Try another search or clear the filters.</p><button type="button" className="button button-secondary" onClick={clear}>Show all {itemPlural}</button></div>}
    {filtered.length > 0 && !visible.length && <EmptyState title={`No ${itemPlural} on this day`} description="Select a marked day to view its records." />}
    {visible.length > limit && <button type="button" className="button button-secondary record-browser-more" onClick={() => setPage({ signature, limit: limit + pageSize })}>{moreLabel || `Show more ${itemPlural}`}</button>}
    {previewDay && <CalendarDayPreview label={label} day={previewDay} count={previewRecords.length} itemName={itemName} itemPlural={itemPlural} timezone={timezone} onClose={() => setPreviewDay(null)}>
      <CalendarRecordDetails records={previewRecords} kind={previewKind} />
    </CalendarDayPreview>}
  </div>
}
