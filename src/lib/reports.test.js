import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabaseClient', () => ({ supabase: {} }))
import { historyHtml } from './reports'
import { csvCell, csvStream, reportCsv } from '../../supabase/functions/_shared/csv'

describe('clinical exports', () => {
  it('prints the current observation headings and preserves historical assessment notes', () => {
    const html = historyHtml({ patient: { name: 'Pet' }, visits: [{ subjective: 'History <note>', objective: 'Current finding', assessment: 'Legacy finding', plan: 'Treatment <instructions>' }] })
    for (const text of ['History', 'Clinical Assessment', 'Treatment Plan', 'History &lt;note&gt;', 'Current finding', 'Legacy finding', 'Treatment &lt;instructions&gt;']) expect(html).toContain(text)
    for (const label of ['Subjective', 'Objective', 'Assessment', 'Plan']) expect(html).not.toContain(`<strong>${label}:</strong>`)
  })
  it('prints every vaccine and deworming product on a white document', () => {
    const html = historyHtml({ patient: { name: 'Pet' }, preventive_care: [
      { kind: 'vaccination', vaccines: [{ vaccine_name: 'First vaccine', brand: 'First brand' }, { vaccine_name: 'Second vaccine', dose: 'Recorded dose' }] },
      { kind: 'deworming', deworming: { product_name: 'Dewormer', lot_number: 'Lot <one>' } },
    ] })
    for (const text of ['First vaccine', 'Second vaccine', 'Dewormer', 'Lot &lt;one&gt;', 'Vaccinations and Deworming']) expect(html).toContain(text)
    expect(html).toMatch(/background:\s*#fff/)
  })
  it('includes every medication in grouped prescriptions alongside historical prescriptions', () => {
    const html = historyHtml({ patient: { name: 'Pet' }, prescriptions: [
      { medication_name: 'Historical medicine', dose: 'Historical dose', frequency: 'Historical frequency' },
      { medication_name: 'First medicine', medications: [
        { medicationName: 'First medicine', dose: 'First dose', frequency: 'First frequency', duration: 'First duration' },
        { medicationName: 'Second medicine', dose: 'Second dose', route: 'Custom <route>', frequency: 'Second frequency', instructions: 'Second <instructions>' },
      ] },
    ] })
    for (const text of ['Historical medicine', 'First medicine', 'Second medicine', 'Second dose', 'First duration', 'Second &lt;instructions&gt;', 'Custom &lt;route&gt;', 'Not recorded']) expect(html).toContain(text)
  })
  it('prints diet, estimated dates, score scales, brands and maintenance notes', () => {
    const html = historyHtml({ patient: { name: 'Pet', diet: 'Diet <plan>', birth_date_estimated: true }, vitals: [{ body_condition_score: 3, body_condition_scale: 5 }, { body_condition_score: 7, body_condition_scale: 9 }], vaccinations: [{ brand: 'Brand A', lot_number: 'Old lot' }], maintenance: [{ service_name: 'Grooming', service_notes: 'Trimmed & brushed', status: 'completed' }] })
    for (const value of ['Diet &lt;plan&gt;', 'Birth date estimated', 'Body condition (1–5)', 'Body condition (1–9)', 'Brand A', 'Old lot', 'Grooming', 'Trimmed &amp; brushed']) expect(html).toContain(value)
  })
  it('neutralizes spreadsheet formulas and preserves quotes, newlines and Unicode', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r']) expect(csvCell(prefix + 'value')).toBe('"\'' + prefix + 'value"')
    expect(reportCsv([{ name: 'María "Mia"', note: 'line 1\nline 2' }])).toContain('"María ""Mia"""')
    expect(reportCsv([])).toBe('')
  })

  it('prints every clinical section independently of the currently selected UI tab and escapes record text', () => {
    const html = historyHtml({ patient: { name: '<script>alert(1)</script>' }, owner: { full_name: 'Owner' }, visits: [{ complaint: 'First', clinical_notes: 'Notes <observations>\nSecond line' }, { complaint: 'Second' }, { complaint: 'Third' }], vitals: [{ weight: 2 }], alerts: [{ description: 'Allergy' }], vaccinations: [], prescriptions: [], corrections: [], reminders: [] })
    expect(html).not.toContain('<script>')
    for (const text of ['Owner', 'First', 'Second', 'Third', 'Vitals', 'Care alerts', 'Vaccinations', 'Prescriptions', 'Corrections', 'Reminders', 'Clinical notes', 'Notes &lt;observations&gt;\nSecond line']) expect(html).toContain(text)
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
