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
const saves = []
let releaseSave, failReads = false, saveFailures = 1
const app = await browserServer(5209)
try {
  await mkdir('test-artifacts.local', { recursive: true })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', colorScheme: 'light' })
  context.setDefaultTimeout(12000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'ui@example.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname.endsWith('/rpc/account_access')) return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname.endsWith('/rpc/search_clinic_records')) {
      const q = route.request().postDataJSON().p_query
      const rows = raw.pets.filter(patient => [patient.name, raw.owners.find(owner => owner.id === patient.owner_id)?.full_name].some(value => value?.toLowerCase().includes(q)))
        .map(patient => ({ id: patient.id, source: 'pets', kind: 'patients', title: patient.name, context: patient.record_number, status: patient.status, href: `/records/pets/${patient.id}` }))
      return reply({ total: rows.length, records: rows, groups: { patients: rows.length }, nextCursor: null })
    }
    if (url.pathname.endsWith('/rpc/clinic_search_record')) {
      const patient = raw.pets.find(row => row.id === route.request().postDataJSON().p_id)
      return reply(patient ? { id: patient.id, source: 'pets', kind: 'patients', title: patient.name, fields: { Species: patient.species }, related: [] } : null)
    }
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname.endsWith('/rpc/portal_mutation')) {
      const input = route.request().postDataJSON()
      assert.equal(input.p_action, 'create_owner')
      saves.push(input)
      if (saveFailures > 0) {
        await new Promise((resolve) => { releaseSave = resolve })
        saveFailures--
        return reply({ code: 'P0001', message: 'VALIDATION_FAILED: check the submitted details' }, 400)
      }
      raw.owners.push({ id: 'new-owner', full_name: input.p_data.fullName, phone: input.p_data.phone, address: input.p_data.address, is_active: true })
      failReads = true
      return reply({ id: 'new-owner' })
    }
    assert.equal(route.request().method(), 'GET', `Unexpected write: ${url.pathname}`)
    if (failReads && url.pathname.endsWith('/owners')) return reply({ message: 'Temporarily unavailable' }, 503)
    return reply(raw[url.pathname.split('/').at(-1)] || [])
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-09T02:00:00Z'))
  page.on('pageerror', (error) => errors.push(error.message))
  const noOverflow = async () => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.goto(`${app.origin}/dashboard`)
  await expect(page.locator('.shift-brand h1')).toHaveText('Harbor clinic')
  await expect(page.locator('.spaces-section')).toHaveCount(0)
  await expect(page.locator('.shift-brand p')).toContainText('Dr. Rivera')
  await expect(page.locator('.home-hero')).toHaveCount(0)
  await expect(page.locator('.stream-appointment')).toHaveCount(3)
  const skip = page.getByRole('link', { name: 'Skip to clinic workspace', exact: true })
  await skip.focus(); await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  const workspaceTrigger = page.getByRole('button', { name: 'Open workspaces', exact: true })
  await workspaceTrigger.click()
  const ownerWorkspace = page.getByRole('dialog', { name: 'Choose a workspace' })
  await expect(ownerWorkspace.getByRole('link', { name: /Reports/ })).toHaveCount(1)
  await page.keyboard.press('Shift+Tab')
  await expect(ownerWorkspace.getByRole('link', { name: /Settings/ })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(ownerWorkspace.getByRole('button', { name: 'Close workspace menu' })).toBeFocused()
  await page.keyboard.press('Escape'); await expect(workspaceTrigger).toBeFocused()
  const searchTrigger = page.getByRole('button', { name: 'Search clinic records', exact: true })
  await searchTrigger.click()
  const globalSearch = page.getByRole('dialog', { name: 'Search clinic records', exact: true })
  const globalInput = globalSearch.getByRole('combobox', { name: 'Search clinic records', exact: true })
  await expect(globalInput).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(globalSearch.getByRole('button', { name: 'Close search' })).toBeFocused()
  await page.keyboard.press('Tab'); await expect(globalInput).toBeFocused()
  // Programmatic focus and keyboard tabbing both stay inside the modal.
  await searchTrigger.evaluate((element) => element.focus())
  await expect(globalInput).toBeFocused()
  await globalInput.fill('Alex Santos')
  await expect(globalSearch.getByRole('option')).toHaveCount(2)
  await globalInput.fill('Mochi')
  await expect(globalSearch.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await expect(globalSearch.getByRole('option')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/records/pets/${pet}$`))
  await expect(globalSearch).toHaveCount(0)
  await expect(searchTrigger).toBeFocused()
  await page.goto(`${app.origin}/dashboard`)
  await expect(page.locator('.shift-brand h1')).toHaveText('Harbor clinic')
  const findPatient = page.getByRole('button', { name: 'Quick Walk-In', exact: true })
  await findPatient.focus()
  await page.keyboard.press('Control+k'); await expect(globalInput).toBeFocused()
  await globalInput.fill('no matching patient')
  await expect(globalSearch.getByRole('status')).toContainText('No results found')
  await page.keyboard.press('Escape'); await expect(findPatient).toBeFocused()
  const bell = page.getByRole('button', { name: '4 clinic notifications', exact: true })
  await bell.click()
  const agenda = page.getByRole('dialog', { name: 'Clinic notifications' })
  await expect(agenda.locator('.notif-item')).toHaveCount(2)
  await expect(agenda.locator('.notif-task-item')).toHaveCount(2)
  await expect(agenda.locator('time').first()).toHaveText('10:00')
  await expect(agenda).toContainText('Alex Santos')
  await page.keyboard.press('Escape')
  await expect(bell).toBeFocused()
  await bell.click()
  await page.locator('.shift-brand h1').click()
  await expect(agenda).toHaveCount(0)
  raw.appointments[0].status = 'completed'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: '3 clinic notifications', exact: true })).toBeVisible()

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
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(selectControl(page.getByLabel('Filter patient status'))).toHaveValue('All')
  await expect(page.getByRole('group', { name: 'Patient species' }).getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
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
  await page.getByLabel('Search inventory').fill('no matching inventory')
  await expect(page.locator('.inventory-record')).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page).not.toHaveURL(/supplierId=/)
  await expect(page.getByLabel('Search inventory')).toHaveValue('')
  await expect(page.locator('.inventory-record')).toHaveCount(1)
  await page.goto(`${app.origin}/queue?status=completed&date=2026-10-01`)
  await page.getByRole('button', { name: 'Reset queue filters' }).click()
  await expect(selectControl(page.getByLabel('Queue status'))).toHaveValue('Active')
  await expect(page).not.toHaveURL(/status=|date=/)

  // Shared form contract: retained input, one in-flight request, honest refresh recovery.
  await page.goto(`${app.origin}/patients`)
  const addOwner = page.getByRole('button', { name: 'Add owner', exact: true })
  await addOwner.click()
  const ownerForm = page.getByRole('dialog', { name: 'Add pet owner', exact: true })
  await ownerForm.getByLabel('Full name', { exact: true }).fill('Jordan Test')
  await ownerForm.getByLabel('Mobile number', { exact: true }).fill('09175551234')
  await ownerForm.getByLabel('Home address', { exact: true }).fill('Synthetic test address')
  await ownerForm.locator('form').evaluate((form) => { form.requestSubmit(); form.requestSubmit() })
  await expect.poll(() => saves.length).toBe(1)
  await expect(ownerForm.getByRole('status')).toContainText('Saving changes')
  await page.keyboard.press('Escape'); await expect(ownerForm).toBeVisible()
  await ownerForm.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(ownerForm).toBeVisible()
  releaseSave()
  await expect(ownerForm.getByRole('alert')).toBeVisible()
  await expect(ownerForm.getByLabel('Full name', { exact: true })).toHaveValue('Jordan Test')
  await expect(ownerForm.getByLabel('Home address', { exact: true })).toHaveValue('Synthetic test address')
  await ownerForm.getByRole('button', { name: 'Save owner', exact: true }).click()
  // PostgREST retries transient 503 reads before reporting the refresh failure.
  await expect(ownerForm).toHaveCount(0, { timeout: 25000 })
  await expect(page.locator('.database-error')).toContainText('Saved records could not be refreshed')
  assert.equal(saves.length, 2)
  assert.equal(saves[0].p_key, saves[1].p_key, 'Retry must retain its payload-bound request key')
  failReads = false
  await page.getByRole('button', { name: 'Retry refresh', exact: true }).click()
  await expect(page.locator('.database-error')).toHaveCount(0)
  await expect(page.locator('.record-directory')).toContainText('Jordan Test')
  assert.equal(saves.length, 2, 'Refreshing must not repeat the save')

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
      await page.getByRole('button', { name: '3 clinic notifications', exact: true }).click()
      await expect(agenda).toBeVisible(); await noOverflow(); await page.keyboard.press('Escape')
      await searchTrigger.click(); await globalInput.fill('Mochi')
      await expect(globalSearch.getByRole('option')).toHaveCount(1)
      await noOverflow()
      const recordNumber = await globalSearch.locator('.search-result code').boundingBox()
      assert.ok(recordNumber.height < 26, 'A short patient record number must not wrap vertically')
      await page.screenshot({ path: `test-artifacts.local/kan18-search-${colorScheme}-${width}.png` })
      await page.keyboard.press('Escape'); await expect(searchTrigger).toBeFocused()
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
  await page.getByRole('button', { name: '0 clinic notifications', exact: true }).click()
  await expect(agenda).toContainText('No remaining appointments today.')
  await expect(agenda).toContainText('All follow-ups up to date!')
  await page.keyboard.press('Escape')
  await page.goto(`${app.origin}/dashboard`)
  await expect(page.locator('.appointment-stream-card')).toContainText('Completed')

  raw.profiles[0].role = 'clinical_staff'
  await page.goto(`${app.origin}/reports`)
  await expect(page.getByRole('heading', { name: 'Authorized paws only', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open workspaces', exact: true }).click()
  const workspace = page.getByRole('dialog', { name: 'Choose a workspace' })
  await expect(workspace.getByRole('link', { name: /Reports/ })).toHaveCount(0)
  await expect(workspace.getByRole('link', { name: /Settings/ })).toContainText('Display mode and clinic information')
  await workspace.getByRole('link', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Display mode', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save clinic color', exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: /^Dark/ }).check()
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
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
  console.log('PASS keyboard search/focus/skip link, owner/staff navigation and appearance, filter resets, duplicate submission lock, retained input/retry keys and saved-but-refresh-failed recovery; agenda, reports, patient history, suppliers, errors and all workspaces at 320/375/1440px in light/dark/reduced motion (intercepted API)')
} finally { await app.close() }
