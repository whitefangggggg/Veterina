import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabaseClient', () => ({ supabase: {} }))
import { historyHtml } from './reports'
import { csvCell, csvStream, reportCsv } from '../../supabase/functions/_shared/csv'

describe('clinical exports', () => {
  it('neutralizes spreadsheet formulas and preserves quotes, newlines and Unicode', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r']) expect(csvCell(prefix + 'value')).toBe('"\'' + prefix + 'value"')
    expect(reportCsv([{ name: 'María "Mia"', note: 'line 1\nline 2' }])).toContain('"María ""Mia"""')
    expect(reportCsv([])).toBe('')
  })

  it('prints every clinical section independently of the currently selected UI tab and escapes record text', () => {
    const html = historyHtml({ patient: { name: '<script>alert(1)</script>' }, owner: { full_name: 'Owner' }, visits: [{ complaint: 'First' }, { complaint: 'Second' }, { complaint: 'Third' }], vitals: [{ weight: 2 }], alerts: [{ description: 'Allergy' }], vaccinations: [], prescriptions: [], corrections: [], reminders: [] })
    expect(html).not.toContain('<script>')
    for (const text of ['Owner', 'First', 'Second', 'Third', 'Vitals', 'Care alerts', 'Vaccinations', 'Prescriptions', 'Corrections', 'Reminders']) expect(html).toContain(text)
  })

  it('streams UTF-8 CSV with spreadsheet protections applied on the server', async () => {
    const rows = [{ name: 'María', notes: '  =HYPERLINK("test")' }]
    const response = new Response(csvStream(rows))
    const output = await response.text()
    expect(output).toBe(reportCsv(rows))
    expect(output).toContain('María')
    expect(output).toContain("'  =HYPERLINK")
  })
})
