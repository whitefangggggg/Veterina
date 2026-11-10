import { supabase } from './supabaseClient'
import { trackingTime } from './admissionTracking'

export const searchKinds = {
  patients: 'Patients', owners: 'Owners', visits: 'Visits & checkups', diagnoses: 'Diagnoses', services: 'Services',
  vaccinations: 'Vaccinations', deworming: 'Deworming', prescriptions: 'Prescriptions', appointments: 'Appointments',
  queue: 'Queue entries', reminders: 'Follow-ups & reminders', inventory: 'Inventory', batches: 'Stock batches',
  suppliers: 'Suppliers', certificates: 'Travel certificates', admissions: 'Admissions', tasks: 'Inpatient tasks',
  corrections: 'Retained corrections', navigation: 'Workspaces & settings',
}
export const normalizeSearch = value => String(value || '').trim().replace(/\s+/gu, ' ').toLowerCase()
export const searchRecordDate = (record, timezone) => !record.date ? '' : ['vaccinations', 'deworming', 'batches'].includes(record.kind) ? `${record.date.slice(0, 10)} (date only)` : trackingTime(record.date, timezone)
export function searchValidation(value) {
  const query = normalizeSearch(value)
  if (query.length < 2) return 'Enter at least 2 characters to search clinic records.'
  if (query.length > 120) return 'Use 120 characters or fewer.'
  if (query.split(' ').length > 8) return 'Use at most 8 search terms.'
  return ''
}
// Terms may contain personal information. POST RPC + fragments keep them out
// of HTTP paths/referrers. No search terms are persisted to browser storage.
export function clinicSearchUrl(query, kind = '') {
  const params = new URLSearchParams({ q: normalizeSearch(query) })
  if (searchKinds[kind]) params.set('type', kind)
  return `/search#${params}`
}
export function readSearchLocation(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return { query: normalizeSearch(params.get('q')), kind: searchKinds[params.get('type')] ? params.get('type') : '' }
}
export function groupSearchResults(records = []) {
  const groups = new Map()
  for (const record of records) {
    if (!searchKinds[record.kind]) continue
    if (!groups.has(record.kind)) groups.set(record.kind, [])
    groups.get(record.kind).push(record)
  }
  return [...groups].map(([kind, rows]) => ({ kind, label: searchKinds[kind], records: rows }))
}
export function safeSearchHref(href) {
  return typeof href === 'string' && /^\/(?:records\/|admissions(?:\/|$)|patients(?:\?|$)|appointments(?:\?|$)|inventory(?:\?|$)|suppliers(?:\?|$)|travel-certificates(?:\?|$)|settings(?:\?|$)|reports$)/.test(href) && !/[\r\n\\]/.test(href) ? href : ''
}
export async function fetchClinicSearch(query, { kind = '', limit = 25, cursor = null, signal, client = supabase } = {}) {
  const normalized = normalizeSearch(query)
  const validation = searchValidation(normalized)
  if (validation) throw new Error(validation)
  let request = client.rpc('search_clinic_records', { p_query: normalized, p_kind: kind || null, p_limit: limit, p_cursor: cursor })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) throw new Error('Search could not be loaded. Please try again.')
  return { ...data, records: (data?.records || []).filter(record => searchKinds[record.kind] && safeSearchHref(record.href)) }
}
export async function fetchClinicSearchRecord(source, id, { signal, client = supabase } = {}) {
  if (!/^[a-z_]{3,40}$/.test(source || '') || !/^[a-f0-9-]{36}$/i.test(id || '')) return null
  let request = client.rpc('clinic_search_record', { p_source: source, p_id: id })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) throw new Error('This record could not be loaded. Please try again.')
  return data ? { ...data, related: (data.related || []).filter(record => safeSearchHref(record.href)) } : null
}
