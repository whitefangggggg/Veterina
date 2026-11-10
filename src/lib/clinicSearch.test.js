import { describe, expect, it, vi } from 'vitest'
import { clinicSearchUrl, fetchClinicSearch, fetchClinicSearchRecord, groupSearchResults, normalizeSearch, readSearchLocation, safeSearchHref, searchRecordDate, searchValidation } from './clinicSearch'

describe('clinic search', () => {
  it('keeps date-only evidence separate from timezone-aware event timestamps', () => {
    expect(searchRecordDate({ kind: 'vaccinations', date: '2026-11-09T00:00:00Z' }, 'America/Los_Angeles')).toBe('2026-11-09 (date only)')
    expect(searchRecordDate({ kind: 'visits', date: '2026-11-09T00:00:00Z' }, 'Asia/Singapore')).toContain('08:00 (Asia/Singapore)')
  })
  it('normalizes whitespace/case and bounds query size and term count', () => {
    expect(normalizeSearch('  MOCHI\t Santos \n ')).toBe('mochi santos')
    expect(searchValidation('a')).toContain('at least 2')
    expect(searchValidation('a'.repeat(121))).toContain('120')
    expect(searchValidation('one two three four five six seven eight nine')).toContain('8 search terms')
    expect(searchValidation('mochi 2026-11')).toBe('')
  })
  it('keeps personal terms in the fragment with functional type-filter links', () => {
    const url = clinicSearchUrl(' Alex  +63 917 ', 'owners')
    expect(url).toBe('/search#q=alex+%2B63+917&type=owners')
    expect(new URL(url, 'https://clinic.example').search).toBe('')
    expect(readSearchLocation(new URL(url, 'https://clinic.example').hash)).toEqual({ query: 'alex +63 917', kind: 'owners' })
    expect(readSearchLocation('#q=MOCHI&type=platform')).toEqual({ query: 'mochi', kind: '' })
  })
  it('groups without losing server rank within a type, and ignores unknown domains', () => {
    const records = [{ id: '1', kind: 'patients' }, { id: '2', kind: 'visits' }, { id: '3', kind: 'patients' }, { id: '4', kind: 'platform' }]
    expect(groupSearchResults(records).map(group => [group.kind, group.records.map(row => row.id)])).toEqual([['patients', ['1', '3']], ['visits', ['2']]])
    for (const url of ['https://evil.invalid', '//evil.invalid', '/admin', '/track-admission#secret', '/patients\\evil', '/search?raw=private']) expect(safeSearchHref(url)).toBe('')
    expect(safeSearchHref('/records/pets/abc')).toBe('/records/pets/abc')
  })
  it('uses a bounded RPC and abort signal without reading source tables', async () => {
    const signal = new AbortController().signal
    const abortSignal = vi.fn().mockResolvedValue({ data: { total: 1, records: [{ kind: 'patients', href: '/records/pets/id' }], nextCursor: null }, error: null })
    const rpc = vi.fn(() => ({ abortSignal })), cursor = { rank: 0, title: 'mochi', source: 'pets', id: 'id' }
    const result = await fetchClinicSearch(' MOCHI ', { client: { rpc }, kind: 'patients', limit: 12, cursor, signal })
    expect(rpc).toHaveBeenCalledWith('search_clinic_records', { p_query: 'mochi', p_kind: 'patients', p_limit: 12, p_cursor: cursor })
    expect(abortSignal).toHaveBeenCalledWith(signal); expect(result.total).toBe(1)
  })
  it('redacts backend failures and avoids a request for malformed input', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { message: 'PRIVATE DATABASE DETAIL' } }) }
    await expect(fetchClinicSearch('mochi', { client })).rejects.toThrow('Search could not be loaded')
    await expect(fetchClinicSearch('a', { client })).rejects.toThrow('at least 2')
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(await fetchClinicSearchRecord('admission_public_sharing', 'bad', { client })).toBe(null)
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })
})
