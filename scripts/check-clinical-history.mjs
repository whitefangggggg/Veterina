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
  const session = { access_token: mockAccessToken(actor), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, aud: 'authenticated', role: 'authenticated', email: 'history@veterina-test.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
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
  await page.goto(app.origin + `/patients/${pet}`)
  const cards = page.locator('.visit-card')
  const filters = page.getByRole('region', { name: 'Clinical history search and filters' })
  const search = page.getByRole('searchbox', { name: 'Search clinical history' })
  const clear = page.getByRole('button', { name: 'Clear filters', exact: true })
  const clearFilters = async () => { await clear.click(); await expect(filters.getByRole('status')).toHaveText('3 of 3 checkups') }
  const advanced = page.getByRole('button', { name: /^Advanced/ })
  const openAdvanced = async () => { if (await advanced.getAttribute('aria-expanded') === 'false') await advanced.click() }
  await expect(cards).toHaveCount(3)
  await expect(advanced).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Filter visit type')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Cards', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(filters.getByRole('status')).toHaveText('3 of 3 checkups')
  await expect(page.getByLabel('Filter visit type')).not.toContainText('Surgery')
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
  await page.getByLabel('Filter visit type').selectOption('Follow-up')
  await page.getByLabel('Filter care status').selectOption('In progress')
  await page.getByLabel('Filter veterinarian').selectOption('Dr. José')
  await page.getByLabel('Filter clinical details').selectOption('prescription')
  await page.getByLabel('Visit date from').fill('2026-10-18')
  await page.getByLabel('Visit date to').fill('2026-10-18')
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('id', 'recent')
  await page.reload()
  await expect(advanced).toHaveAttribute('aria-expanded', 'false')
  await expect(advanced).toContainText('6')
  await expect(search).toHaveValue('gastritis')
  await expect(page.getByLabel('Filter veterinarian')).toHaveValue('Dr. José')
  await expect(cards).toHaveCount(1)
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  await expect(filters).toHaveCount(0)
  await page.getByRole('button', { name: 'Clinical history', exact: true }).click()
  await expect(search).toHaveValue('gastritis')
  await expect(cards).toHaveCount(1)
  await openAdvanced()
  await page.getByLabel('Filter visit type').selectOption('Emergency')
  await expect(cards).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No matching checkups' })).toBeVisible()
  await page.getByRole('button', { name: 'Show all checkups' }).click()
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
  await page.getByRole('button', { name: 'Next checkup month' }).click()
  await expect(calendar.getByRole('heading')).toHaveText('November 2026')
  await expect(cards).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No checkups on this day' })).toBeVisible()
  await page.getByRole('button', { name: 'Previous checkup month' }).click()
  await expect(calendar.getByRole('heading')).toHaveText('October 2026')
  await page.getByRole('button', { name: 'Latest checkup' }).click()
  await expect(cards).toHaveAttribute('id', 'recent')
  raw.visits.push({ ...raw.visits[0], id: 'same-day', chief_complaint: 'Second checkup on the same day' })
  await page.reload()
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.clinical-history-day-heading')).toContainText('2 checkups')
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
  await expect(preview.getByRole('heading', { name: 'No checkups on this day', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Latest checkup' }).click()
  raw.visits.pop()
  await page.reload()
  await search.fill('carprofen')
  await page.getByRole('button', { name: 'Latest checkup' }).click()
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
  for (const tab of [
    { button: 'Care timeline', label: 'Care timeline', row: '.care-event', query: 'clavamox', field: 'Timeline activity', value: 'Prescription', item: 'activity', date: 'Activity date', day: '2026-10-18' },
    { button: 'Vaccinations', label: 'Vaccinations', row: '.vaccine-row', query: 'Nobivac RAB-001', field: 'Filter brand', value: 'Nobivac', item: 'vaccination', date: 'Vaccination date', day: '2026-10-18' },
    { button: 'Service history', label: 'Service history', row: '.directory-card', query: 'Bath and trim', field: 'Filter service status', value: 'Completed', item: 'service', date: 'Service date', day: '2026-10-18' },
  ]) {
    await page.getByRole('button', { name: tab.button, exact: true }).click()
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
    await expect(miniInfo.locator('strong')).toHaveText(tab.item === 'activity' ? 'Follow-up' : tab.item === 'vaccination' ? 'Vaccination' : 'Grooming')
    await expect(rows).toHaveCount(1)
    const tabDay = () => tabCalendar.locator(`[data-day="${tab.day}"] button`)
    await tabDay().focus()
    await page.keyboard.press('Enter')
    await expect(preview).toHaveAttribute('aria-label', `${tab.label} · 18 October 2026`)
    await expect(preview.locator('.calendar-preview-record')).toHaveCount(1)
    if (tab.item === 'activity') {
      await expect(preview).toContainText('250 mg')
      await expect(preview).toContainText('Bland diet')
    } else if (tab.item === 'vaccination') {
      await expect(preview).toContainText('RAB-001')
      await expect(preview).toContainText('Nobivac')
      await expect(preview).toContainText('18 Oct 2027')
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
  await expect(page.getByRole('region', { name: 'Vaccinations calendar', exact: true })).toHaveCount(0)
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
  await preview.getByLabel('Chief complaint').fill('Unsaved calendar edit')
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Clinical history · 18 October 2026')
  await expect(preview).toContainText('Vomiting after meals')
  await preview.getByRole('button', { name: 'Edit checkup', exact: true }).click()
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
  await preview.getByRole('button', { name: 'Edit vaccination', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Edit vaccination for Mochi')
  await preview.getByLabel('Dose', { exact: true }).fill('2 mL')
  await preview.getByRole('button', { name: 'Save vaccination', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Vaccinations · 18 October 2026')
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
  await expect(preview).toHaveAttribute('aria-label', 'Service history · 18 October 2026')
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
  await page.locator('.clinical-history-calendar [data-day="2026-10-18"] button').click()
  await preview.getByRole('button', { name: 'Edit prescription', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Edit prescription')
  await preview.getByLabel('Instructions 1', { exact: true }).fill('Edited through the timeline preview')
  await preview.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(preview).toHaveAttribute('aria-label', 'Care timeline · 18 October 2026')
  await expect(preview).toContainText('Edited through the timeline preview')
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  await openDay('history', 'history', '2026-10-16')
  await expect(preview.getByRole('button', { name: 'Edit checkup', exact: true })).toHaveCount(0)
  await expect(preview.getByRole('button', { name: 'Edit prescription', exact: true })).toHaveCount(0)
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('PASS calendar views/previews, existing record editors, save/cancel/return, persistence, retry/conflicts, finalized guards, source links and 320/375/1440px layouts (intercepted API)')
} finally {
  await app.close()
}
import { saveCheckup } from './helpers/checkup.mjs'
