// Browser acceptance with intercepted APIs; no real clinic data is read or changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'
import { chooseSelectOption, selectControl } from './helpers/select.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const pet = '20000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, full_name: 'Dr. Rivera', role: 'owner', is_active: true }],
  clinic_settings: [{ id: 'settings', clinic_name: 'Harbor clinic', timezone: 'Asia/Singapore', brand_color: '#305b9a', onboarding_completed_at: '2026-11-01T00:00:00Z' }],
  owners: [{ id: 'owner', full_name: 'Alex Santos', phone: '09171234567', normalized_phone: '+639171234567', email: 'alex@example.invalid', is_active: true }],
  pets: [{ id: pet, owner_id: 'owner', name: 'Mochi', record_number: 'VET-01', species: 'Dog', breed: 'Mixed', sex: 'Male', status: 'Active' },
    { id: 'cat', owner_id: 'owner', name: 'Ming', record_number: 'VET-02', species: 'Cat', breed: 'Mixed', sex: 'Female', status: 'Active' }],
  service_types: [{ id: 'wellness', name: 'Wellness check', workflow: 'checkup', is_active: true }],
  appointments: ['confirmed', 'scheduled', 'completed', 'cancelled', 'no_show'].map((status, index) => ({ id: status, pet_id: pet, service_type_id: 'wellness', status, starts_at: `2026-11-09T0${index + 2}:00:00Z`, ends_at: `2026-11-09T0${index + 2}:30:00Z` })),
  reminder_worklist: ['2026-11-08', '2026-11-09', '2026-11-10'].map((day, index) => ({ id: `task-${index}`, pet_id: pet, title: `Call owner ${index}`, due_at: `${day}T01:00:00Z`, reminder_type: 'follow_up', status: 'pending' })),
  visits: [{ id: 'visit', pet_id: pet, attending_veterinarian_id: actor, visited_at: '2026-11-08T01:00:00Z', visit_type: 'Follow-up', chief_complaint: 'Reduced appetite', diagnosis_summary: 'Recovering well', subjective: 'Eating again', objective: 'Hydrated', plan: 'Continue treatment', finalized_at: '2026-11-08T02:00:00Z' }],
  visit_vitals: [{ id: 'vital', visit_id: 'visit', weight_kg: 12, temperature_c: 38.5, measured_at: '2026-11-08T01:00:00Z' }],
  visit_corrections: [{ id: 'correction', visit_id: 'visit', reason: 'Clarification', correction: 'Left forelimb examined' }],
  prescriptions: [{ id: 'rx', visit_id: 'visit', medications: [{ medicationName: 'Test medication', dose: '1 tablet', route: 'Oral', instructions: 'With food' }] }],
  patient_service_records: [{ id: 'service', pet_id: pet, service_name: 'Grooming', performed_at: '2026-11-07T01:00:00Z', performed_by_name: 'Sam', service_notes: 'Bath and trim' }],
  suppliers: [{ id: 'supplier', name: 'Harbor Supplies', contact_person: 'Jamie', phone: '09170000000', email: 'orders@example.invalid', address: '12 Clinic Lane', ordering_notes: 'Order before noon', is_active: true }],
  inventory_items: [{ id: 'item', name: 'Gauze rolls', sku: 'GAUZE', category: 'Consumables', unit: 'roll', minimum_stock: 5, is_active: true }],
  inventory_batches: [{ id: 'batch', item_id: 'item', is_active: true, quantity: 3 }],
  inventory_movements: [{ id: 'movement', item_id: 'item', batch_id: 'batch', quantity_delta: 3, movement_type: 'stock_in', reason: 'Delivery', created_at: '2026-11-08T01:00:00Z' }],
  item_suppliers: [{ item_id: 'item', supplier_id: 'supplier', is_preferred: true }],
  admissions: [{ id: 'hospital-stay', pet_id: pet, visit_id: 'hospital-visit', reference: 'ADM-TEST-STAY', status: 'under_treatment', condition: 'under_observation', admitted_at: '2026-11-08T03:00:00Z' }],
}
raw.visits.push({ id: 'hospital-visit', pet_id: pet, attending_veterinarian_id: actor, visited_at: '2026-11-08T03:00:00Z', visit_type: 'Hospitalization', chief_complaint: 'Observation and inpatient care' })
const errors = []
const app = await browserServer(5209)
try {
  await mkdir('test-artifacts.local', { recursive: true })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', colorScheme: 'light' })
  context.setDefaultTimeout(12000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'ui@example.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
  await context.route(`${api.origin}/**`, (route) => {
    const url = new URL(route.request().url())
    const reply = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname.endsWith('/rpc/account_access')) return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    assert.equal(route.request().method(), 'GET', `Unexpected write: ${url.pathname}`)
    return reply(raw[url.pathname.split('/').at(-1)] || [])
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-09T02:00:00Z'))
  page.on('pageerror', (error) => errors.push(error.message))
  const noOverflow = async () => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.goto(`${app.origin}/dashboard`)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await expect(page.locator('.spaces-section')).toHaveCount(0)
  const bell = page.getByRole('button', { name: '4 appointments and tasks for today', exact: true })
  await bell.click()
  const agenda = page.getByRole('dialog', { name: "Today's schedule and reminders" })
  await expect(agenda.locator('.notif-item')).toHaveCount(2)
  await expect(agenda.locator('.notif-task-item')).toHaveCount(2)
  await expect(agenda.locator('time').first()).toHaveText('10:00')
  await expect(agenda).toContainText('Alex Santos')
  await page.keyboard.press('Escape')
  await expect(bell).toBeFocused()
  await bell.click()
  await page.getByRole('heading', { name: /Welcome back/ }).click()
  await expect(agenda).toHaveCount(0)
  raw.appointments[0].status = 'completed'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: '3 appointments and tasks for today', exact: true })).toBeVisible()

  await page.goto(`${app.origin}/appointments?view=tasks`)
  const search = page.getByRole('searchbox', { name: 'Search follow-up tasks' })
  await search.fill('Call owner 0')
  await expect(page.locator('.schedule-task-card')).toHaveCount(1)
  await search.fill('no matching task')
  await expect(page.getByText('No follow-up tasks match', { exact: true })).toBeVisible()
  await search.fill('')
  await expect(search).toHaveCSS('border-top-width', '0px')
  const status = page.getByRole('combobox', { name: 'Task status', exact: true })
  await status.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(status).toHaveText('All')
  await expect(status).toBeFocused()
  await status.click(); await page.getByRole('heading', { name: 'Appointments', exact: true }).click()
  await expect(status).toHaveAttribute('aria-expanded', 'false')

  await page.goto(`${app.origin}/reports`)
  const history = page.locator('.report-card').filter({ hasText: 'Complete clinical history' })
  const picker = history.getByRole('combobox', { name: 'Patient for history export', exact: true })
  await expect(history.getByRole('button', { name: 'Prepare report' })).toBeDisabled()
  await picker.click()
  await page.getByRole('combobox', { name: 'Search Patient for history export', exact: true }).fill('VET-01')
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(picker).toContainText('Mochi')
  await expect(history.getByRole('button', { name: 'Prepare report' })).toBeEnabled()
  const lowStock = page.getByRole('checkbox', { name: 'Low stock only', exact: true })
  await lowStock.focus(); await page.keyboard.press('Space'); await expect(lowStock).toBeChecked()
  await expect(history.locator('.report-card-footer')).toHaveCSS('gap', '14px')

  await page.goto(`${app.origin}/patients`)
  const patientRow = page.locator('.patient-grid.table-row').filter({ hasText: 'Mochi' })
  await expect(patientRow.getByRole('link', { name: 'Call Alex Santos', exact: true })).toHaveAttribute('href', 'tel:+639171234567')
  await expect(patientRow.getByRole('link', { name: 'Text Alex Santos', exact: true })).toHaveAttribute('href', 'sms:+639171234567')
  await expect(page.locator('a a')).toHaveCount(0)
  await chooseSelectOption(page.getByLabel('Filter patient status'), 'Inactive')
  await expect(page.getByText('No matching patients', { exact: true })).toBeVisible()
  await chooseSelectOption(page.getByLabel('Filter patient status'), 'All')
  await patientRow.getByRole('link', { name: /Mochi Mixed/ }).click()
  const hospitalization = page.locator('.clinical-timeline .skim-folder-card').filter({ hasText: 'Hospitalization' })
  await expect(page.getByRole('button', { name: 'Quick Skim', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.patient-hospitalization-history')).toHaveCount(0)
  await expect(page.locator('.clinical-timeline .skim-folder-card')).toHaveCount(3)
  await expect(page.locator('.clinical-timeline .skim-folder-card').first()).toContainText('Hospitalization')
  await expect(hospitalization).toContainText('Observation and inpatient care')
  await hospitalization.click()
  await expect(page.getByRole('dialog')).toContainText('Under Observation')
  await expect(page.getByRole('dialog').getByRole('link', { name: 'View monitoring and notes', exact: true })).toHaveAttribute('href', '/admissions/hospital-stay?view=monitoring')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Vaccinations and Deworming', exact: true }).click()
  await expect(hospitalization).toHaveCount(0)
  await page.getByRole('button', { name: 'Weight & vitals', exact: true }).click()
  await expect(hospitalization).toHaveCount(0)
  await page.getByRole('button', { name: 'Clinical history', exact: true }).click()
  await expect(hospitalization).toBeVisible()
  await expect(page.locator('.skim-folder-card')).toHaveCount(3)
  await page.locator('.skim-folder-card').filter({ hasText: 'Recovering well' }).focus()
  await page.keyboard.press('Space')
  const details = page.getByRole('dialog', { name: /Clinical Record/ })
  await expect(details).toContainText('Eating again')
  await expect(details).toContainText('38.5')
  await expect(details).toContainText('Test medication')
  await expect(details).toContainText('Left forelimb examined')
  await page.keyboard.press('Escape')
  await expect(page.locator('.skim-folder-card').filter({ hasText: 'Recovering well' })).toBeFocused()
  await page.locator('.skim-folder-card').filter({ hasText: 'Grooming' }).click()
  await expect(details).toContainText('Bath and trim')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Detailed View', exact: true }).click()
  await expect(page.locator('.visit-card')).toHaveCount(3)
  await expect(page.locator('.hospitalization-history-card')).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Detailed View', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Quick Skim', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Quick Skim', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.skim-folder-card')).toHaveCount(3)
  const historySearch = page.getByRole('searchbox', { name: 'Search clinical history', exact: true })
  await historySearch.fill('ADM-TEST-STAY')
  await expect(page.locator('.skim-folder-card'), `Hospitalization search at ${page.url()}`).toHaveCount(1)
  await expect(hospitalization).toBeVisible()
  await historySearch.fill('')
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await chooseSelectOption(page.getByLabel('Filter record type', { exact: true }), 'hospitalization')
  await chooseSelectOption(page.getByLabel('Filter care status', { exact: true }), 'Under Treatment')
  await expect(page.locator('.skim-folder-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.locator('.skim-folder-card')).toHaveCount(3)
  await page.getByRole('group', { name: 'Clinical history view', exact: true }).getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.locator('.clinical-history-calendar')).toContainText('Hospitalization')
  await page.getByRole('group', { name: 'Clinical history view', exact: true }).getByRole('button', { name: 'Cards', exact: true }).click()

  await page.goto(`${app.origin}/suppliers`)
  const supplier = page.locator('.supplier-executive-card')
  await expect(supplier).toContainText('Order before noon')
  await expect(supplier.locator('.item-chip')).toContainText('Gauze rolls')
  await expect(supplier.locator('.item-chip')).toContainText('3 roll')
  await supplier.getByRole('link', { name: 'Manage inventory', exact: true }).click()
  await expect(page).toHaveURL(/supplierId=supplier/)
  await expect(page.locator('.inventory-record')).toHaveCount(1)

  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['/dashboard', '/patients', `/patients/${pet}`, '/appointments?view=tasks', '/inventory', '/suppliers', '/reports', '/queue', '/admissions', '/settings', '/travel-certificates']) {
        await page.goto(app.origin + route)
        await expect(page.locator('.workspace-header')).toBeVisible()
        await noOverflow()
        await expect(page.locator('.workspace-page-transition')).toHaveCSS('animation-name', 'none')
      }
      await page.getByRole('button', { name: '3 appointments and tasks for today', exact: true }).click()
      await expect(agenda).toBeVisible(); await noOverflow(); await page.keyboard.press('Escape')
      console.log(`PASS workspace layouts: ${colorScheme}, ${width}px`)
    }
    await page.goto(`${app.origin}/suppliers`)
    await expect(supplier).toBeVisible()
    await page.screenshot({ path: `test-artifacts.local/ui-suppliers-${colorScheme}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto(`${app.origin}/reports`)
  await expect(history).toBeVisible()
  await picker.click()
  const dropdown = page.getByRole('listbox', { name: 'Patient for history export', exact: true })
  const bounds = await dropdown.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375, 'Select overflows viewport')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-artifacts.local/ui-reports-mobile.png', fullPage: true })
  await expect(selectControl(page.getByLabel('Patient for history export'))).toHaveValue('')

  raw.appointments.forEach((appointment) => { appointment.status = 'completed' })
  raw.reminder_worklist.forEach((task) => { task.status = 'completed' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('button', { name: '0 appointments and tasks for today', exact: true }).click()
  await expect(agenda).toContainText('No remaining appointments today.')
  await expect(agenda).toContainText('All follow-ups up to date!')
  await page.keyboard.press('Escape')

  raw.profiles[0].role = 'clinical_staff'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Authorized paws only', exact: true })).toBeVisible()
  await page.goto(`${app.origin}/admin`)
  await expect(page.getByRole('heading', { name: 'Authorized paws only', exact: true })).toBeVisible()
  await page.goto(`${app.origin}/unknown-page`)
  await expect(page.getByRole('heading', { name: 'This trail went cold', exact: true })).toBeVisible()
  await noOverflow()
  assert.deepEqual(errors, [])

  // Simulate a failed route module; diagnostics must not expose the error message.
  const crashPage = await context.newPage()
  await crashPage.route('**/src/pages/Dashboard.jsx*', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("Private clinical diagnostic text")' }))
  await crashPage.goto(`${app.origin}/dashboard`)
  await expect(crashPage.getByRole('heading', { name: 'Taking a quick catnap', exact: true })).toBeVisible()
  await expect(crashPage.locator('body')).not.toContainText('Private clinical diagnostic text')
  await crashPage.getByRole('button', { name: 'Copy Diagnostic Code', exact: true }).click()
  await expect(crashPage.getByRole('status')).toContainText(/Diagnostic code copied|Copy this code/)
  await crashPage.close()
  await context.close()
  console.log('PASS agenda counts/refresh/dismissal, search/filter keyboard use, report validation/spacing, custom checkboxes, patient contacts/skim details, linked supplier stock, 404/403/500, and every workspace at 320/375/1440px in light/dark/reduced motion (intercepted API)')
} finally { await app.close() }
