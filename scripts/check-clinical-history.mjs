import { mockAccountAccess } from './helpers/mock-access.mjs'
// UI acceptance with intercepted API responses; no clinic data is changed.
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const pet = '20000000-0000-4000-8000-000000000001'
const owner = '30000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, full_name: 'Dr. José', role: 'clinical_staff', is_active: true }],
  clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Veterina' }],
  pets: [{ id: pet, owner_id: owner, name: 'Mochi', record_number: 'VET-2026-00001', species: 'Dog', breed: 'Mixed', status: 'Active', sex: 'Male' }],
  owners: [{ id: owner, full_name: 'Test owner', phone: '09171234567', is_active: true }],
  visits: [
    { id: 'recent', pet_id: pet, attending_veterinarian_id: actor, visit_type: 'Follow-up', visited_at: '2026-10-17T17:10:00Z', chief_complaint: 'Vomiting after meals', diagnosis_summary: 'Gastritis', subjective: 'Reduced appetite', objective: 'Tender abdomen', assessment: 'Mild dehydration', plan: 'Bland diet', clinical_notes: 'Monitor hydration at home', follow_up_date: '2026-10-24', card_color: '#cc5599' },
    { id: 'old', pet_id: pet, attending_veterinarian_id: 'historical-clinician', attending_veterinarian_name: 'Dr. Lee', visit_type: 'Emergency', visited_at: '2026-10-16T12:00:00Z', chief_complaint: 'Limping', diagnosis_summary: 'Sprain', finalized_at: '2026-10-16T13:00:00Z' },
    { id: 'wellness', pet_id: pet, attending_veterinarian_id: actor, visit_type: 'Wellness', visited_at: '2026-10-15T04:00:00Z', chief_complaint: 'Routine wellness' },
    { id: 'other-patient', pet_id: 'other-patient', visit_type: 'Surgery', visited_at: '2026-10-18T04:00:00Z', chief_complaint: 'Foreign record' },
  ],
  visit_vitals: [{ id: 'vitals', visit_id: 'recent', measured_at: '2026-10-17T17:10:00Z', weight_kg: 34, temperature_c: 38.5, body_condition_score: 3, body_condition_scale: 5 }],
  prescriptions: [
    { id: 'rx-recent', visit_id: 'recent', medications: [{ medicationName: 'Clavamox', route: 'Oral', dose: '250 mg', frequency: 'q12h', duration: '10 days', instructions: 'With food' }] },
    { id: 'rx-old', visit_id: 'old', medication_name: 'Carprofen', route: 'Oral', dose: '50 mg', instructions: 'With meal' },
  ],
  visit_corrections: [{ id: 'correction', visit_id: 'old', reason: 'Side correction', correction: 'Left hind leg' }],
  queue_entries: [{ id: 'queue', pet_id: pet, visit_id: 'recent', category: 'checkup', service_name: 'Follow-up', status: 'in_progress', veterinarian_id: actor, arrived_at: '2026-10-17T17:00:00Z', queue_date: '2026-10-18', queue_number: 4 }],
}
raw.vaccinations = [
  { id: 'rabies', pet_id: pet, vaccine_name: 'Rabies', brand: 'Nobivac', lot_number: 'RAB-001', route: 'Oral', dose: '1 mL', administered_at: '2026-10-18', next_due_at: '2027-10-18', administered_by: actor },
  { id: 'dhpp', pet_id: pet, vaccine_name: 'DHPP', brand: 'Vanguard', lot_number: 'DHPP-002', route: 'Oral', dose: '1 mL', administered_at: '2026-10-16', next_due_at: '2026-10-01', administered_by_name: 'Dr. Lee' },
  { id: 'rabies-old', pet_id: pet, vaccine_name: 'Rabies', brand: 'Nobivac', lot_number: 'RAB-OLD', route: 'Oral', dose: '1 mL', administered_at: '2026-10-16', administered_by: actor },
  { id: 'other-vaccine', pet_id: 'other-patient', vaccine_name: 'Foreign vaccine', administered_at: '2026-10-18' },
]
raw.queue_entries.push(
  { id: 'groomed', pet_id: pet, category: 'maintenance', service_name: 'Grooming', service_notes: 'Bath and trim', veterinarian_id: actor, status: 'completed', arrived_at: '2026-10-18T02:00:00Z', finished_at: '2026-10-18T03:00:00Z', queue_date: '2026-10-18', queue_number: 1 },
  { id: 'waiting', pet_id: pet, category: 'maintenance', service_name: 'Grooming', status: 'waiting', arrived_at: '2026-10-16T02:00:00Z', queue_date: '2026-10-16', queue_number: 1 },
  { id: 'nail', pet_id: pet, category: 'maintenance', service_name: 'Nail trim', service_notes: 'Nails only', status: 'cancelled', arrived_at: '2026-10-15T02:00:00Z', finished_at: '2026-10-15T03:00:00Z', queue_date: '2026-10-15', queue_number: 1 },
  { id: 'other-service', pet_id: 'other-patient', category: 'maintenance', service_name: 'Foreign service', status: 'completed', arrived_at: '2026-10-18T02:00:00Z' },
)
const errors = []
const writes = []
let failServiceSave = true
const app = await browserServer(5185)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, aud: 'authenticated', role: 'authenticated', email: 'history@veterina-test.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/rest/v1/rpc/account_access') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(mockAccountAccess(raw.profiles[0])) })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = route.request().postDataJSON()
      writes.push({ action, payload, key })
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (action === 'complete_queue_entry') {
        const entry = raw.queue_entries.find((entry) => entry.id === payload.id)
        const visit = raw.visits.find((visit) => visit.id === entry.visit_id)
        assert.equal(entry.status, 'in_progress')
        Object.assign(visit, { chief_complaint: payload.record.complaint, diagnosis_summary: payload.record.diagnosis, subjective: payload.record.subjective, objective: payload.record.objective, assessment: payload.record.assessment, plan: payload.record.plan })
        Object.assign(entry, { status: 'completed', finished_at: '2026-10-18T03:00:00Z', care_draft: {}, draft_version: (entry.draft_version || 0) + 1 })
      } else if (action === 'update_prescription') {
        Object.assign(raw.prescriptions.find((prescription) => prescription.id === payload.id), { medications: payload.medications })
      } else if (action === 'update_preventive_care') {
        Object.assign(raw.vaccinations.find((vaccine) => vaccine.id === payload.id), { dose: payload.vaccines[0].dose, administered_at: payload.administeredAt, next_due_at: payload.vaccines[0].nextDueAt })
      } else if (action === 'update_vaccination') {
        Object.assign(raw.vaccinations.find((vaccine) => vaccine.id === payload.id), { dose: payload.dose, administered_at: payload.administeredAt, next_due_at: payload.nextDueAt })
      } else if (action === 'update_service_notes') {
        if (failServiceSave) { failServiceSave = false; return reply({ message: 'Service note save interrupted. Retry.', code: 'P0001' }, 400) }
        const entry = raw.queue_entries.find((entry) => entry.id === payload.id)
        if ((entry.notes || '') !== payload.originalNotes || (entry.service_notes || '') !== payload.originalServiceNotes) return reply({ message: 'RECORD_CHANGED', code: 'P0001' }, 409)
        Object.assign(entry, { notes: payload.notes, service_notes: payload.serviceNotes })
      } else throw new Error(`Unexpected calendar edit ${action}`)
      return reply({ id: payload.id })
    }
    if (url.pathname === '/functions/v1/pet-photo') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) })
    assert.equal(route.request().method(), 'GET', 'History filters must not write to the API')
    const data = url.pathname === '/auth/v1/user' ? session.user : raw[url.pathname.split('/').at(-1)] || []
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(app.origin + `/patients/${pet}?historyKind=checkup`)
  const cards = page.locator('.visit-card:not(.service-history-card)')
  const filters = page.getByRole('region', { name: 'Clinical history search and filters' })
  const search = page.getByRole('searchbox', { name: 'Search clinical history' })
  const clear = page.getByRole('button', { name: 'Clear filters', exact: true })
  const clearFilters = async () => { await clear.click(); await openAdvanced(); await expect(page.getByLabel('Filter clinical details')).toHaveValue(''); await expect(page.getByLabel('Filter record type')).toHaveValue(''); await page.getByLabel('Filter record type').selectOption('checkup'); await expect(filters.getByRole('status')).toHaveText('3 of 9 records') }
  const advanced = page.getByRole('button', { name: /^Advanced/ })
  const openAdvanced = async () => { if (await advanced.getAttribute('aria-expanded') === 'false') await advanced.click() }
  await expect(cards).toHaveCount(3)
  await expect(advanced).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Filter reason or service')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Cards', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(filters.getByRole('status')).toHaveText('3 of 9 records')
  await expect(page.getByLabel('Filter reason or service')).not.toContainText('Surgery')
  for (const query of ['VOMITING clavamox', 'Oral clavamox', 'Monitor hydration', 'gastritis', 'reduced appetite', 'tender abdomen', 'mild dehydration', 'bland diet', '34 kg', 'BCS 3/5', 'jose']) {
    await search.fill(query)
    await expect(cards).toHaveCount(query === 'jose' ? 2 : 1)
  }
  await search.fill('carprofen left hind leg')
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('id', 'old')
  await clearFilters()
  await search.fill('gastritis')
  await openAdvanced()
  await page.getByLabel('Filter reason or service').selectOption('Follow-up')
  await page.getByLabel('Filter care status').selectOption('In progress')
  await page.getByLabel('Filter veterinarian').selectOption('Dr. José')
  await page.getByLabel('Filter clinical details').selectOption('prescription')
  await page.getByLabel('Visit date from').fill('2026-10-18')
  await page.getByLabel('Visit date to').fill('2026-10-18')
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('id', 'recent')
  await page.reload()
  await expect(advanced).toHaveAttribute('aria-expanded', 'false')
  await expect(advanced).toContainText('7')
  await expect(search).toHaveValue('gastritis')
  await expect(page.getByLabel('Filter veterinarian')).toHaveValue('Dr. José')
  await expect(cards).toHaveCount(1)
  await page.getByRole('button', { name: 'Vaccinations and Deworming', exact: true }).click()
  await expect(filters).toHaveCount(0)
  await page.getByRole('button', { name: 'Clinical history', exact: true }).click()
  await expect(search).toHaveValue('gastritis')
  await expect(cards).toHaveCount(1)
  await openAdvanced()
  await page.getByLabel('Filter reason or service').selectOption('Emergency')
  await expect(cards).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible()
  await page.getByRole('button', { name: 'Show all records' }).click()
  await expect(cards).toHaveCount(3)
  for (const [detail, count] of [['prescription', 2], ['follow-up', 1], ['correction', 1], ['finalized', 1], ['open', 2]]) {
    await page.getByLabel('Filter clinical details').selectOption(detail)
    await expect(cards).toHaveCount(count)
  }
  await clearFilters()
  await page.getByLabel('Visit date from').fill('2026-10-18')
  await expect(page.getByLabel('Visit date from')).toHaveValue('2026-10-18')
  await page.getByLabel('Visit date to').fill('2026-10-16')
  await expect(filters.getByRole('alert')).toContainText('end date must be on or after')
  await clearFilters()
  await page.goto(app.origin + `/patients/${pet}?tab=history#prescription-rx-old`)
  await expect(page.locator('#prescription-rx-old')).toBeFocused()
  await search.fill('gastritis')
  await expect(search).toBeFocused()
  await expect(cards).toHaveCount(1)
  await clearFilters()
  // Calendar uses the same matching records and clinic dates as the card list.
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  const calendar = page.getByRole('region', { name: 'Clinical history calendar', exact: true })
  const dayButton = (day) => calendar.locator(`[data-day="${day}"] button`)
  await expect(calendar).toBeVisible()
  await expect(calendar.getByRole('heading')).toHaveText('October 2026')
  await expect(dayButton('2026-10-18').locator('.record-calendar-event strong')).toHaveText('Follow-up')
  await expect(dayButton('2026-10-18').locator('.record-calendar-event-time')).toHaveText('1:10 AM')
  await expect(calendar.locator('.rdp-weekday').first()).toHaveText('Sunday')
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('id', 'recent')
  await dayButton('2026-10-16').locator('.record-calendar-event').click()
  const preview = page.getByRole('dialog')
  await expect(preview).toHaveAttribute('aria-label', 'Clinical history · 16 October 2026')
  await expect(preview).toContainText('Carprofen')
  await expect(preview).toContainText('Left hind leg')
  await expect(preview).toContainText('With meal')
  await expect(preview.locator('input, select, textarea')).toHaveCount(0)
  await expect(preview.getByRole('button', { name: 'Edit checkup', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(dayButton('2026-10-16')).toBeFocused()
  await expect(cards).toHaveAttribute('id', 'old')
  await expect(page.locator('.clinical-history-day-heading')).toContainText('16 October 2026')
  await page.reload()
  await expect(calendar).toBeVisible()
  await expect(cards).toHaveAttribute('id', 'old')
  await page.getByRole('button', { name: 'Next record month' }).click()
  await expect(calendar.getByRole('heading')).toHaveText('November 2026')
  await expect(cards).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No records on this day' })).toBeVisible()
  await page.getByRole('button', { name: 'Previous record month' }).click()
  await expect(calendar.getByRole('heading')).toHaveText('October 2026')
  await page.getByRole('button', { name: 'Latest record' }).click()
  await expect(cards).toHaveAttribute('id', 'recent')
  raw.visits.push({ ...raw.visits[0], id: 'same-day', chief_complaint: 'Second checkup on the same day' })
  await page.reload()
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.clinical-history-day-heading')).toContainText('2 records')
  await dayButton('2026-10-18').click()
  await expect(preview.locator('.calendar-preview-record')).toHaveCount(2)
  await expect(preview).toContainText('Second checkup on the same day')
  await expect(preview).toContainText('Reduced appetite')
  await expect(preview).toContainText('250 mg · Route: Oral · q12h · 10 days')
  await expect(preview).toContainText('Bland diet')
  await expect(preview).toContainText('Monitor hydration at home')
  await expect(preview).toContainText('Oral')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(preview).toHaveCount(0)
  for (let index = 0; index < 3; index++) raw.visits.push({ ...raw.visits[0], id: `dense-day-${index}`, visit_type: ['Surgery', 'Emergency', 'Wellness'][index] })
  await page.reload()
  await expect(dayButton('2026-10-18').locator('.record-calendar-event')).toHaveCount(3)
  await expect(dayButton('2026-10-18').locator('.record-calendar-more')).toHaveText('+2 more')
  await dayButton('2026-10-18').locator('.record-calendar-more').click()
  await expect(preview.locator('.calendar-preview-record')).toHaveCount(5)
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  raw.visits.splice(-3)
  await page.reload()
  await dayButton('2026-10-17').click()
  await expect(preview.getByRole('heading', { name: 'No records on this day', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Latest record' }).click()
  raw.visits.pop()
  await page.reload()
  await search.fill('carprofen')
  await page.getByRole('button', { name: 'Latest record' }).click()
  await expect(cards).toHaveAttribute('id', 'old')
  await expect(calendar).toContainText('1 matching this month')
  await expect(calendar.locator('.calendar-has-appointments')).toHaveCount(1)
  await clearFilters()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  await expect(cards).toHaveCount(3)
  await expect(calendar).toHaveCount(0)
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await page.goto(app.origin + `/patients/${pet}?tab=history&historyView=calendar#prescription-rx-old`)
  await expect(calendar).toHaveCount(0)
  await expect(page.locator('#prescription-rx-old')).toBeFocused()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(calendar).toBeVisible()
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1100 })
    await expect(filters).toBeVisible()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Clinical calendar overflows at ${width}px`)
    await openAdvanced()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Advanced filters overflow at ${width}px`)
    await advanced.click()
  }
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/clinical-history-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.screenshot({ path: 'test-artifacts.local/clinical-history-desktop.png', fullPage: true })
  // Checkups, queued services and historical services share one ordered list and calendar.
  raw.patient_service_records = [{ id: 'recent', pet_id: pet, service_name: 'Nail trim', performed_at: '2026-10-18T01:00:00Z', performed_by_name: 'Dok sa Bukid', service_notes: 'Historical nail care' }]
  await page.goto(app.origin + `/patients/${pet}?tab=history`)
  await expect(page.getByRole('button', { name: 'Care timeline', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Service history', exact: true })).toHaveCount(0)
  await expect(page.locator('.clinical-timeline > article')).toHaveCount(10)
  assert.deepEqual(await page.locator('.clinical-timeline > article').evaluateAll((elements) => elements.slice(0, 3).map((element) => element.id)), ['service-groomed', 'service-recent', 'preventive-rabies'])
  await page.locator('.record-main').screenshot({ path: 'test-artifacts.local/combined-history-desktop.png' })
  await openAdvanced()
  await page.getByLabel('Filter record type').selectOption('service')
  await expect(page.locator('.service-history-card')).toHaveCount(4)
  await expect(cards).toHaveCount(0)
  await page.getByLabel('Filter care status').selectOption('Record only')
  await expect(page.locator('.service-history-card')).toHaveCount(1)
  await expect(page.locator('.service-history-card')).toContainText('Historical nail care')
  await expect(page.locator('.service-history-card').getByRole('button', { name: 'Edit service record' })).toBeVisible()
  await clear.click()
  await expect(filters.getByRole('status')).toHaveText('10 of 10 records')
  await search.fill('Bath Q-001')
  await expect(page.locator('.clinical-timeline > article')).toHaveCount(1)
  await search.fill('Historical nail Bukid')
  await expect(page.locator('.clinical-timeline > article')).toHaveCount(1)
  await clear.click()
  await expect(filters.getByRole('status')).toHaveText('10 of 10 records')
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await dayButton('2026-10-18').click()
  await expect(preview.locator('.calendar-preview-record')).toHaveCount(4)
  for (const text of ['Reduced appetite', 'Bath and trim', 'Historical nail care']) await expect(preview).toContainText(text)
  await expect(preview.getByRole('button', { name: 'Edit checkup', exact: true })).toHaveCount(1)
  await expect(preview.getByRole('button', { name: 'Edit service record', exact: true })).toHaveCount(1)
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto(app.origin + `/patients/${pet}?tab=services&serviceQuery=Bath&serviceStatus=Completed&serviceView=calendar#service-groomed`)
  await expect(page).toHaveURL(/tab=history/)
  await expect(page.locator('#service-groomed')).toBeFocused()
  await expect(search).toHaveValue('Bath')
  await expect(page.locator('.clinical-timeline > article')).toHaveCount(1)
  raw.patient_service_records = []

  // Actual visit points, partial vitals, baseline-only patients and responsive axes/table.
  const originalVisits = structuredClone(raw.visits), originalVitals = structuredClone(raw.visit_vitals)
  raw.pets[0].baseline_weight = 9
  raw.visit_vitals[0].weight_kg = 6.7
  raw.visit_vitals.push({ id: 'old-vitals', visit_id: 'old', measured_at: '2026-10-16T12:00:00Z', weight_kg: 8.48, heart_rate_bpm: 100 },
    { id: 'partial-vitals', visit_id: 'wellness', measured_at: '2026-10-15T04:00:00Z', temperature_c: 38.1 })
  for (const [id, at] of [['equal-weight', '2026-10-17T18:00:00Z'], ['year-boundary', '2026-12-31T17:00:00Z']]) {
    raw.visits.push({ ...raw.visits[2], id, visited_at: at })
    raw.visit_vitals.push({ id: `${id}-vitals`, visit_id: id, measured_at: at, weight_kg: 6.7 })
  }
  await page.goto(app.origin + `/patients/${pet}?tab=growth`)
  const vitalsTable = page.getByRole('region', { name: 'Visit vitals table', exact: true })
  await expect(vitalsTable.locator('tbody tr')).toHaveCount(5)
  await expect(vitalsTable.locator('tbody tr').first()).toContainText('1 Jan 2027, 01:00')
  await expect(vitalsTable.locator('tbody tr').filter({ hasText: '18 Oct 2026, 01:10' })).toContainText('3/5')
  await expect(vitalsTable.locator('tbody tr').last()).toContainText('Not recorded')
  await expect(page.locator('.recharts-area-dot')).toHaveCount(4)
  await page.locator('.recharts-area-dot').first().hover({ force: true })
  await expect(page.locator('.recharts-tooltip-wrapper')).toContainText('16 Oct 2026, 20:00')
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1100 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Vitals page overflows at ${width}px`)
    const chart = page.locator('.patient-weight-chart')
    await expect(chart.locator('.recharts-cartesian-axis-tick-value').first()).toBeVisible()
    const labelsFit = await chart.evaluate((element) => [...element.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].every((label) => label.getBoundingClientRect().left >= element.getBoundingClientRect().left))
    assert.ok(labelsFit, `Weight labels clipped at ${width}px`)
    await vitalsTable.focus()
    await expect(vitalsTable).toBeFocused()
    await page.locator('.patient-vitals').screenshot({ path: `test-artifacts.local/patient-vitals-${width}.png` })
  }
  await vitalsTable.getByRole('link', { name: '18 Oct 2026, 01:10' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#recent')).toBeFocused()
  raw.visits = []
  await page.goto(app.origin + `/patients/${pet}?tab=growth`)
  await expect(page.getByRole('heading', { name: 'No visit weights recorded' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No visit vitals recorded' })).toBeVisible()
  await expect(page.locator('.patient-baseline-weight')).toContainText('9 kg')
  await expect(page.locator('.recharts-area-dot')).toHaveCount(0)
  raw.visits = originalVisits; raw.visit_vitals = originalVitals; delete raw.pets[0].baseline_weight
  await page.setViewportSize({ width: 1440, height: 1100 })
  for (const tab of [
    { button: 'Vaccinations and Deworming', label: 'Vaccinations and Deworming', row: '.preventive-history-card', query: 'Nobivac RAB-001', field: 'Filter record type', value: 'Vaccination', item: 'record', date: 'Administration date', day: '2026-10-18' },
    { button: 'Clinical history', label: 'Clinical history', row: '.service-history-card', query: 'Bath and trim', field: 'Filter care status', value: 'Completed', item: 'record', date: 'Visit date', day: '2026-10-18' },
  ]) {
    if (tab.button === 'Clinical history') await page.goto(app.origin + `/patients/${pet}?tab=history`)
    else await page.getByRole('button', { name: tab.button, exact: true }).click()
    const toolbar = page.getByRole('region', { name: `${tab.label} search and filters`, exact: true })
    const tabSearch = toolbar.getByRole('searchbox')
    const tabCalendar = page.getByRole('region', { name: `${tab.label} calendar`, exact: true })
    const rows = page.locator(tab.row)
    await expect(toolbar.getByRole('button', { name: 'Cards', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(toolbar.getByRole('button', { name: /^Advanced/ })).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => rows.count(), { message: `${tab.label} omitted saved records` }).toBeGreaterThanOrEqual(3)
    await tabSearch.fill(tab.query)
    await expect(rows).toHaveCount(1)
    await toolbar.getByRole('button', { name: /^Advanced/ }).click()
    await page.getByLabel(tab.field, { exact: true }).selectOption(tab.value)
    await expect(rows).toHaveCount(1)
    await page.getByLabel(`${tab.date} from`, { exact: true }).fill(tab.day)
    await expect(page.getByLabel(`${tab.date} from`, { exact: true })).toHaveValue(tab.day)
    await page.getByLabel(`${tab.date} to`, { exact: true }).fill(tab.day)
    await expect(rows).toHaveCount(1)
    await toolbar.getByRole('button', { name: 'Calendar', exact: true }).click()
    await expect(tabCalendar).toBeVisible()
    await expect(tabCalendar.locator('.calendar-has-appointments')).toHaveCount(1)
    const miniInfo = tabCalendar.locator('.record-calendar-event').first()
    await expect(miniInfo.locator('strong')).toHaveText(tab.item === 'activity' ? 'Follow-up' : tab.button === 'Vaccinations and Deworming' ? 'Vaccination' : 'Grooming')
    await expect(rows).toHaveCount(1)
    const tabDay = () => tabCalendar.locator(`[data-day="${tab.day}"] button`)
    await tabDay().focus()
    await page.keyboard.press('Enter')
    await expect(preview).toHaveAttribute('aria-label', `${tab.label} · 18 October 2026`)
    await expect(preview.locator('.calendar-preview-record')).toHaveCount(1)
    if (tab.item === 'activity') {
      await expect(preview).toContainText('250 mg')
      await expect(preview).toContainText('Bland diet')
    } else if (tab.button === 'Vaccinations and Deworming') {
      await expect(preview).toContainText('RAB-001')
      await expect(preview).toContainText('Nobivac')
      await expect(preview).toContainText('2027-10-18')
    } else {
      await expect(preview).toContainText('Bath and trim')
      await expect(preview).toContainText('Q-001')
    }
    await page.keyboard.press('Tab')
    assert.ok(await preview.evaluate((element) => element.contains(document.activeElement)), 'Calendar preview lost keyboard focus')
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    await expect(tabDay()).toBeFocused()
    await page.reload()
    await expect(tabCalendar).toBeVisible()
    await expect(tabSearch).toHaveValue(tab.query)
    await expect(rows).toHaveCount(1)
    await page.getByRole('button', { name: `Next ${tab.item} month`, exact: true }).click()
    await expect(rows).toHaveCount(0)
    await page.getByRole('button', { name: `Latest ${tab.item}`, exact: true }).click()
    await expect(rows).toHaveCount(1)
    await toolbar.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await expect(tabSearch).toHaveValue('')
    await toolbar.getByRole('button', { name: 'Cards', exact: true }).click()
    await expect.poll(() => rows.count(), { message: `${tab.label} did not restore all records` }).toBeGreaterThanOrEqual(3)
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 1100 })
      await toolbar.getByRole('button', { name: 'Calendar', exact: true }).click()
      await expect(tabCalendar).toBeVisible()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab.label} calendar overflows at ${width}px`)
      await tabDay().click()
      await expect(preview).toBeVisible()
      assert.ok(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth), `${tab.label} preview overflows at ${width}px`)
      await preview.screenshot({ path: `test-artifacts.local/${tab.item}-preview-${width}.png` })
      await preview.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(tabDay()).toBeFocused()
      await toolbar.getByRole('button', { name: /^Advanced/ }).click()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab.label} advanced filters overflow at ${width}px`)
      await toolbar.getByRole('button', { name: /^Advanced/ }).click()
      await toolbar.getByRole('button', { name: 'Cards', exact: true }).click()
      await expect(toolbar.getByRole('button', { name: 'Cards', exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    await page.screenshot({ path: `test-artifacts.local/${tab.item}-history-mobile.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1100 })
    await toolbar.getByRole('button', { name: 'Calendar', exact: true }).click()
    await expect(tabCalendar).toBeVisible()
    await tabCalendar.screenshot({ path: `test-artifacts.local/${tab.item}-month-grid-desktop.png` })
  }
  // A direct vaccination citation still opens its record even with calendar selected.
  await page.goto(app.origin + `/patients/${pet}?tab=vaccines&vaccineView=calendar#vaccination-dhpp`)
  await expect(page.locator('#vaccination-dhpp')).toBeFocused()
  await expect(page.getByRole('region', { name: 'Vaccinations and Deworming calendar', exact: true })).toHaveCount(0)
  assert.equal(writes.length, 0, 'Browsing calendar previews wrote to the API')

  // Edits replace the preview dialog, then return to the refreshed day preview.
  const openDay = async (tab, scope, day = '2026-10-18') => {
    await page.goto(app.origin + `/patients/${pet}?tab=${tab}&${scope}View=calendar&${scope}Day=${day}`)
    const month = page.locator('.clinical-history-calendar')
    await month.locator(`[data-day="${day}"] button`).click()
    await expect(preview).toBeVisible()
  }
  await openDay('history', 'history')
  await preview.getByRole('button', { name: 'Edit checkup', exact: true }).click()
  await expect(preview).toHaveCount(1)
  await expect(preview).toHaveAttribute('aria-label', 'Edit checkup for Mochi')
  await expect(preview.getByLabel('Chief complaint')).toBeDisabled()
  await preview.getByRole('button', { name: 'Edit Visit details', exact: true }).click()
  await preview.getByLabel('Chief complaint').fill('Unsaved calendar edit')
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Clinical history · 18 October 2026')
  await expect(preview).toContainText('Vomiting after meals')
  await preview.getByRole('button', { name: 'Edit checkup', exact: true }).click()
  await preview.getByRole('button', { name: 'Edit Visit details', exact: true }).click()
  await preview.getByLabel('Chief complaint').fill('Updated from calendar preview')
  await saveCheckup(page)
  await expect(preview).toHaveAttribute('aria-label', 'Clinical history · 18 October 2026')
  await expect(preview).toContainText('Updated from calendar preview')
  assert.equal(raw.queue_entries[0].status, 'completed', 'Queued checkup edit bypassed the normal care save')
  await preview.getByRole('button', { name: 'Edit prescription', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Edit prescription')
  await preview.getByLabel('Medication name 1', { exact: true }).fill('Clavamox updated')
  await preview.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(preview).toContainText('Clavamox updated')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  await openDay('history', 'history')
  await expect(preview).toContainText('Updated from calendar preview')
  await expect(preview).toContainText('Clavamox updated')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()

  await openDay('vaccines', 'vaccine')
  await preview.getByRole('button', { name: 'Edit vaccination record', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Edit vaccination for Mochi')
  await preview.getByLabel('Dose 1', { exact: true }).fill('2 mL')
  await preview.getByRole('button', { name: 'Save record', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Vaccinations and Deworming · 18 October 2026')
  await expect(preview).toContainText('2 mL')
  await expect(preview).toContainText('Nobivac')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()

  const originalService = structuredClone(raw.queue_entries.find((entry) => entry.id === 'groomed'))
  await openDay('services', 'service')
  await preview.getByRole('button', { name: 'Edit service notes', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Edit Grooming notes')
  await preview.getByLabel('Work performed / service notes').fill('Bath and trim; calendar edit')
  await preview.getByRole('button', { name: 'Save service notes', exact: true }).click()
  await expect(preview.getByRole('alert')).toContainText('Service note save interrupted')
  await expect(preview.getByLabel('Work performed / service notes')).toHaveValue('Bath and trim; calendar edit')
  await preview.getByRole('button', { name: 'Save service notes', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Clinical history · 18 October 2026')
  await expect(preview).toContainText('Bath and trim; calendar edit')
  const serviceWrites = writes.filter((write) => write.action === 'update_service_notes')
  assert.equal(serviceWrites[0].key, serviceWrites[1].key, 'Service edit retry changed its idempotency key')
  const editedService = { ...raw.queue_entries.find((entry) => entry.id === 'groomed') }
  delete editedService.notes
  delete editedService.service_notes
  const expectedService = { ...originalService }
  delete expectedService.notes
  delete expectedService.service_notes
  assert.deepEqual(editedService, expectedService, 'Editing service notes changed its history')
  await preview.getByRole('button', { name: 'Edit service notes', exact: true }).click()
  raw.queue_entries.find((entry) => entry.id === 'groomed').service_notes = 'Another staff update'
  await preview.getByLabel('Work performed / service notes').fill('Stale edit')
  await preview.getByRole('button', { name: 'Save service notes', exact: true }).click()
  await expect(preview.getByRole('alert')).toContainText('edited by another staff member')
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preview).toContainText('Another staff update')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()

  await page.goto(app.origin + `/patients/${pet}?tab=timeline&timelineView=calendar&timelineDay=2026-10-18&timelineKind=Prescription`)
  await expect(page).toHaveURL(/tab=history/)
  await expect(page.locator('.clinical-history-calendar')).toHaveCount(0)
  await openDay('history', 'history')
  await preview.getByRole('button', { name: 'Edit prescription', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Edit prescription')
  await preview.getByLabel('Instructions 1', { exact: true }).fill('Edited through the clinical preview')
  await preview.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Clinical history · 18 October 2026')
  await expect(preview).toContainText('Edited through the clinical preview')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  await openDay('history', 'history', '2026-10-16')
  await expect(preview.getByRole('button', { name: 'Edit checkup', exact: true })).toHaveCount(0)
  await expect(preview.getByRole('button', { name: 'Edit prescription', exact: true })).toHaveCount(0)
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('PASS combined checkup/service history, legacy links, filters/calendar/previews/editors, weight/vitals/baseline/visit links, retries/guards, keyboard and 320/375/1440px layouts (intercepted API)')
} finally {
  await app.close()
}
import { saveCheckup } from './helpers/checkup.mjs'
