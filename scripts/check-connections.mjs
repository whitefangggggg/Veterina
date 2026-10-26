// Stateful intercepted API checks: UI contracts, never proof of database integrity.
import { expect as baseExpect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const userId = '10000000-0000-4000-8000-000000000001'
const petId = '20000000-0000-4000-8000-000000000001'
const ownerId = '30000000-0000-4000-8000-000000000001'
const now = new Date('2026-10-17T04:00:00Z')
const profile = { id: userId, full_name: 'Connection clinician', role: 'owner', is_active: true }
const raw = {
  profiles: [profile], clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Veterina', ai_enabled: true }],
  owners: [{ id: ownerId, full_name: 'Test owner', phone: '09171234567', is_active: true }],
  pets: [{ id: petId, owner_id: ownerId, name: 'Mochi', record_number: 'VET-2026-00001', species: 'Cat', breed: 'Mixed', status: 'Active', sex: 'Male' },
    { id: 'inactive-pet', owner_id: ownerId, name: 'Inactive pet', status: 'Inactive', species: 'Cat' }],
  service_types: [{ id: 'service', name: 'Wellness check', workflow: 'checkup', default_duration_minutes: 30, is_active: true }],
  appointments: [{ id: 'completed', pet_id: petId, service_type_id: 'service', veterinarian_id: userId, status: 'completed', starts_at: '2026-10-17T01:00:00Z', ends_at: '2026-10-17T01:30:00Z' }],
  reminder_worklist: [{ id: 'reminder', pet_id: petId, title: 'Follow-up', reminder_type: 'follow_up', status: 'upcoming', due_at: now.toISOString() }],
  suppliers: [{ id: 'supplier-a', name: 'Clinic supplier', phone: '09171234567', is_active: true }, { id: 'supplier-b', name: 'Other supplier', phone: '09171234568', is_active: true }],
  inventory_items: [{ id: 'item-a', name: 'Linked medicine', sku: 'SKU-000001', category: 'Medicine', unit: 'tablet', minimum_stock: 5, is_active: true },
    { id: 'item-b', name: 'Other medicine', sku: 'SKU-000002', category: 'Medicine', unit: 'tablet', minimum_stock: 0, is_active: true },
    { id: 'archived', name: 'Archived medicine', sku: 'SKU-000003', category: 'Medicine', unit: 'tablet', minimum_stock: 10, is_active: false }],
  item_suppliers: [{ item_id: 'item-a', supplier_id: 'supplier-a', is_preferred: true }, { item_id: 'item-b', supplier_id: 'supplier-b', is_preferred: true }],
  inventory_batches: [], inventory_movements: [],
  kb_documents: Array.from({ length: 5 }, (_, i) => ({ id: `doc-${i}`, title: `Clinic checklist ${i}`, content: 'Approved instructions. '.repeat(50), status: 'published', version: 1 })),
}
const calls = [], errors = []
const expect = baseExpect.configure({ timeout: 15000 })
await mkdir('test-artifacts.local', { recursive: true })
let failBooking = true
let failRead = false
const app = await browserServer(5182)
let page
const failedRequests = []
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const session = { access_token: mockAccessToken(userId), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'connections@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => {
    if (!sessionStorage.getItem('signed-out')) localStorage.setItem(key, JSON.stringify(session))
  }, { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
    if (url.pathname === '/functions/v1/assistant-query') return reply({ answer: 'Use the published checklist.', interaction_id: 'answer', citations: [{ source_type: 'kb_document', source_id: 'doc-4', label: 'Clinic checklist 4', version: 1 }] })
    if (url.pathname === '/functions/v1/export-report') return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'X-Row-Count': '2' }, body: 'name,quantity\nLinked medicine,8\nOther medicine,0\n' })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = request.postDataJSON()
      calls.push({ action, payload, key })
      if (action === 'book_appointment') {
        if (failBooking) { failBooking = false; return reply({ message: 'Booking interrupted. Retry.', code: 'P0001' }, 400) }
        raw.appointments.push({ id: 'new-booking', pet_id: payload.petId, service_type_id: 'service', veterinarian_id: userId, status: 'confirmed', starts_at: `${payload.date}T05:00:00Z`, ends_at: `${payload.date}T05:30:00Z` })
        return reply({ id: 'new-booking' })
      }
      if (action === 'create_batch') {
        raw.inventory_batches.push({ id: 'new-batch', item_id: payload.itemId, supplier_id: payload.supplierId, lot_number: payload.lotNumber, expiration_date: payload.expirationDate, is_active: true })
        return reply({ id: 'new-batch' })
      }
      if (action === 'record_inventory_movement') {
        raw.inventory_movements.push({ id: `movement-${raw.inventory_movements.length}`, item_id: payload.id, batch_id: payload.batchId, quantity_delta: payload.delta, movement_type: payload.delta > 0 ? 'stock_in' : 'stock_out', reason: payload.reason, created_at: now.toISOString() })
        return reply({ id: 'movement' })
      }
      throw new Error(`Unexpected mutation ${action}`)
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (failRead && !url.pathname.endsWith('/profiles')) return reply({ message: 'Database unavailable', code: 'P0001' }, 400)
      return reply(raw[url.pathname.split('/').at(-1)] || [])
    }
    throw new Error(`Unexpected API request ${request.method()} ${url.pathname}`)
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`))
  await page.clock.install({ time: now })
  if (!process.argv.includes('--daily-only')) {
  const routes = ['/dashboard', '/queue', '/patients', `/patients/${petId}`, '/appointments', '/reminders', '/inventory', '/suppliers', '/reports', '/settings', '/knowledge']
  for (const role of ['clinical_staff', 'owner']) {
    profile.role = role
    for (const route of routes) {
      console.log(`CHECK ${role} ${route}`)
      if (route === '/dashboard') {
        await page.goto(app.origin + route)
      } else if (route === `/patients/${petId}`) {
        await page.locator(`.patient-table a[href="${route}"]`).click()
      } else {
        await page.getByRole('button', { name: 'Open workspaces', exact: true }).click()
        await page.getByRole('dialog', { name: 'Choose a workspace' }).locator(`a[href="${route}"]`).click()
      }
      await expect(page.locator('main h1').first()).toBeVisible()
      assert.equal(new URL(page.url()).pathname, route)
      for (const width of [1440, 375, 320]) {
        await page.setViewportSize({ width, height: 900 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${role} ${route} overflows at ${width}`)
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.getByRole('button', { name: 'Open workspaces', exact: true }).click()
      const menu = page.getByRole('dialog', { name: 'Choose a workspace' })
      await expect(menu).toBeVisible()
      assert.deepEqual((await menu.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).sort(), routes.filter((route) => route !== '/dashboard' && !route.startsWith('/patients/')).sort())
      await page.keyboard.press('Escape')
      if (role === 'clinical_staff' && route === '/reports') await expect(page.getByRole('button', { name: 'Prepare report' })).toHaveCount(0)
      if (role === 'clinical_staff' && route === '/settings') await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
    }
  }
  console.log('PASS every workspace and menu for both roles; desktop and 320/375px mobile; owner-only controls')

  await page.goto(app.origin + '/dashboard')
  await expect(page.locator('.glance-metrics > div').nth(0)).toContainText('1')
  await expect(page.locator('.glance-metrics > div').nth(2)).toContainText('2')
  await expect(page.locator('.next-patients a')).toHaveCount(0)
  await page.getByRole('link', { name: 'New appointment', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New appointment', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  assert.equal(new URL(page.url()).search, '')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Appointments', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Search clinic records', exact: true }).click()
  await page.getByPlaceholder('Search any patient, owner or record...').fill('Test owner')
  await page.getByRole('button', { name: /Mochi/ }).click()
  await expect(page).toHaveURL(app.origin + `/patients/${petId}`)
  await page.getByRole('link', { name: 'Book appointment', exact: true }).click()
  await expect(page.getByLabel('Patient', { exact: true })).toHaveValue(petId)
  await page.reload()
  await expect(page.getByLabel('Patient', { exact: true })).toHaveValue(petId)
  await page.getByRole('button', { name: 'Create appointment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Booking interrupted')
  await expect(page.getByLabel('Patient', { exact: true })).toHaveValue(petId)
  await page.getByRole('button', { name: 'Create appointment', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const saves = calls.filter((call) => call.action === 'book_appointment')
  assert.equal(saves.length, 2)
  assert.equal(saves[0].key, saves[1].key)
  await page.reload()
  await page.locator('.flow-appointment-card').last().getByRole('link', { name: 'Mochi', exact: true }).click()
  await expect(page).toHaveURL(app.origin + `/patients/${petId}?appointmentId=new-booking#patient-appointment-new-booking`)
  await expect(page.locator('#patient-appointment-new-booking')).toBeFocused()
  for (const id of ['missing', 'inactive-pet', '']) {
    await page.goto(app.origin + '/appointments?new=1&petId=' + id)
    await expect(page.getByRole('alert')).toContainText('unavailable or inactive')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  assert.equal(calls.filter((call) => call.action === 'book_appointment').length, 2)
  await page.goto(app.origin + '/reminders')
  await page.getByRole('link', { name: 'Mochi', exact: true }).click()
  await expect(page).toHaveURL(app.origin + `/patients/${petId}`)
  await page.goto(app.origin + '/patients/missing')
  await expect(page.getByRole('heading', { name: 'Patient not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to patients' }).click()
  await page.getByPlaceholder('Search pet, owner, phone or record number...').fill('No such patient')
  await expect(page.getByRole('heading', { name: 'No matching patients' })).toBeVisible()
  console.log('PASS patient booking context, reload, retry keys, invalid/inactive IDs, patient links, missing patients and search empty state')

  await page.goto(app.origin + '/suppliers')
  await page.locator('#supplier-a').getByRole('link', { name: '1 linked items' }).click()
  await expect(page.locator('.inventory-record')).toHaveCount(1)
  await expect(page.locator('.inventory-record')).toContainText('Linked medicine')
  await page.reload()
  await expect(page.locator('.inventory-record')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add batch', exact: true }).click()
  await page.getByLabel('Batch / lot number').fill('CONNECTION-LOT')
  await page.getByLabel('Expiry date').fill('2027-12-31')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Update stock', exact: true }).click()
  await page.getByLabel('Quantity', { exact: false }).fill('8')
  await page.getByLabel('Reason', { exact: false }).selectOption('Supplier delivery')
  await page.getByRole('button', { name: 'Record movement', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.inventory-record')).toContainText('8 tablet')
  await page.getByRole('link', { name: 'Clinic supplier (preferred)', exact: true }).click()
  await expect(page.locator('#supplier-a')).toBeFocused()
  await page.goto(app.origin + '/dashboard')
  await expect(page.locator('.glance-metrics > div').nth(2)).toContainText('1')
  await page.goto(app.origin + '/inventory?supplierId=missing')
  await expect(page.getByRole('alert')).toContainText('supplier is unavailable')
  await expect(page.locator('.inventory-record')).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear supplier filter' }).click()
  await expect(page.locator('.inventory-record')).toHaveCount(2)
  await page.goto(app.origin + '/reports')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.report-card').filter({ hasText: 'Inventory status' }).getByRole('button', { name: 'Prepare report' }).click()
  assert.equal((await downloadPromise).suggestedFilename(), 'veterina-inventory.csv')
  console.log('PASS supplier/inventory navigation, filter persistence, batch and ledger save/reload, dashboard reconciliation and report download')

  await page.goto(app.origin + '/knowledge')
  await page.getByLabel('Question').fill('Find the checklist')
  await page.getByRole('button', { name: 'Find evidence' }).click()
  await page.getByRole('link', { name: 'Clinic checklist 4' }).click()
  await expect(page.locator('#doc-4')).toBeFocused()
  await page.reload()
  await expect(page.locator('#doc-4')).toBeFocused()
  await page.goto(app.origin + '/knowledge#missing')
  await expect(page.getByRole('alert')).toContainText('source document is unavailable')
  await page.goto(app.origin + '/knowledge#%E0%A4%A')
  await expect(page.getByRole('alert')).toContainText('source document is unavailable')
  } else {
    raw.appointments.push({ id: 'new-booking', pet_id: petId, service_type_id: 'service', veterinarian_id: userId, status: 'confirmed', starts_at: '2026-10-17T05:00:00Z', ends_at: '2026-10-17T05:30:00Z' })
    raw.inventory_batches.push({ id: 'initial', item_id: 'item-a', is_active: true, lot_number: 'INITIAL' })
    raw.inventory_movements.push({ id: 'initial-stock', item_id: 'item-a', batch_id: 'initial', quantity_delta: 8, movement_type: 'stock_in', created_at: now.toISOString(), reason: 'Fixture' })
  }

  // Daily workflow views use the same saved rows as their source workspaces.
  raw.queue_entries = [
    { id: 'waiting', pet_id: petId, service_name: 'Wellness check', category: 'checkup', status: 'waiting', arrived_at: '2026-10-16T15:00:00Z', queue_date: '2026-10-16', queue_number: 1 },
    { id: 'draft', pet_id: petId, service_name: 'Vaccination', category: 'vaccination', status: 'in_progress', arrived_at: '2026-10-17T03:00:00Z', queue_date: '2026-10-17', queue_number: 2, veterinarian_id: userId, draft_saved_at: '2026-10-17T03:05:00Z', draft_saved_by: userId },
    { id: 'historical', pet_id: petId, service_name: 'Grooming', category: 'maintenance', status: 'completed', arrived_at: '2026-09-15T02:00:00Z', finished_at: '2026-09-15T03:00:00Z', queue_date: '2026-09-15', queue_number: 1, service_notes: 'Bath completed' },
  ]
  raw.appointments.push({ id: 'historical', pet_id: petId, service_type_id: 'service', veterinarian_id: userId, status: 'completed', starts_at: '2026-09-15T02:00:00Z', ends_at: '2026-09-15T02:30:00Z' })
  raw.visits = [{ id: 'timeline-visit', pet_id: petId, visit_type: 'Wellness check', chief_complaint: 'Timeline checkup', visited_at: now.toISOString(), attending_veterinarian_id: userId }]
  raw.prescriptions = [{ id: 'timeline-rx', visit_id: 'timeline-visit', prescribed_at: now.toISOString(), medication_name: 'Daily tablet', route: 'Oral', dose: 'As recorded', frequency: 'As recorded' }]
  raw.vaccinations = [{ id: 'timeline-vaccine', pet_id: petId, vaccine_name: 'Rabies', administered_at: '2026-10-16', next_due_at: '2027-10-16', brand: 'Clinic brand' }]
  raw.reminder_worklist.push({ id: 'closed-reminder', pet_id: petId, title: 'Historical follow-up', reminder_type: 'follow_up', status: 'completed', due_at: '2026-09-16T04:00:00Z', outcome: 'Reached owner' })
  raw.reminder_activity = [{ id: 'contact', reminder_id: 'closed-reminder', action: 'contact_attempt', note: 'Owner contacted', created_at: '2026-09-15T04:00:00Z' }]
  raw.inventory_batches.push({ id: 'expired-lot', item_id: 'item-a', lot_number: 'OLD', expiration_date: '2026-10-16', is_active: true }, { id: 'soon-lot', item_id: 'item-a', lot_number: 'SOON', expiration_date: '2026-11-10', is_active: true })
  raw.inventory_movements.push({ id: 'old-stock', item_id: 'item-a', batch_id: 'expired-lot', quantity_delta: 1, movement_type: 'stock_in', created_at: now.toISOString(), reason: 'Fixture' }, { id: 'soon-stock', item_id: 'item-a', batch_id: 'soon-lot', quantity_delta: 2, movement_type: 'stock_in', created_at: now.toISOString(), reason: 'Fixture' })
  await page.goto(app.origin + '/dashboard')
  const carePanel = page.locator('.daily-work-grid .section-card').filter({ hasText: 'Care at the clinic (2)' })
  await expect(carePanel).toContainText('Q-001')
  await expect(carePanel).toContainText('Waiting for')
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Populated action board overflows at ${width}`)
  }
  await page.locator('.daily-work-section').screenshot({ path: 'test-artifacts.local/daily-action-board.png' })
  await carePanel.getByRole('link', { name: 'Resume care', exact: true }).click()
  await expect(page.locator('#queue-draft')).toBeFocused()
  await page.reload()
  await expect(page.locator('#queue-draft')).toBeFocused()
  await page.goto(app.origin + '/dashboard')
  await page.locator('.daily-work-grid .section-card').filter({ hasText: 'Check-ins today (1)' }).getByRole('link', { name: 'Open booking', exact: true }).click()
  await expect(page.locator('#appointment-new-booking')).toBeFocused()
  await page.goto(app.origin + '/dashboard')
  await page.locator('.daily-work-grid .section-card').filter({ hasText: 'Calls due (1)' }).getByRole('link', { name: 'Open reminder', exact: true }).click()
  await expect(page.locator('#reminder-reminder')).toBeFocused()
  await page.goto(app.origin + '/dashboard')
  const stockPanel = page.locator('.daily-work-grid .section-card').filter({ hasText: 'Stock watch (2)' })
  await expect(stockPanel).toContainText('expired batch')
  await expect(stockPanel).toContainText('expiring soon')
  await stockPanel.getByRole('link', { name: 'Review item', exact: true }).first().click()
  await expect(page.locator('#inventory-item-a')).toBeFocused()
  await page.getByLabel('Stock attention', { exact: true }).selectOption('expired')
  await expect(page.locator('.inventory-record')).toHaveCount(1)
  await page.reload()
  await expect(page.getByLabel('Stock attention', { exact: true })).toHaveValue('expired')
  await page.getByLabel('Stock attention', { exact: true }).selectOption('expiring')
  await expect(page.locator('#inventory-item-a')).toBeVisible()

  const timelineUrl = app.origin + `/patients/${petId}?tab=timeline`
  await page.goto(timelineUrl)
  await expect(page.getByRole('heading', { name: 'Care timeline', exact: true })).toBeVisible()
  await page.locator('.record-main').screenshot({ path: 'test-artifacts.local/patient-care-timeline.png' })
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Care timeline overflows at ${width}`)
  }
  await page.getByRole('button', { name: /^Advanced/ }).click()
  await page.getByLabel('Timeline activity').selectOption('Prescription')
  await expect(page.locator('.care-event')).toHaveCount(1)
  await page.locator('.care-event').getByRole('link', { name: 'View source', exact: true }).click()
  await expect(page.locator('#prescription-timeline-rx')).toBeFocused()
  await page.reload()
  await expect(page.locator('#prescription-timeline-rx')).toBeFocused()
  for (const [fragment, target] of [
    ['/appointments?date=2026-09-15', '#appointment-historical'],
    ['tab=vaccines', '#vaccination-timeline-vaccine'],
    ['reminder-closed-reminder', '#reminder-closed-reminder'],
    ['queue-historical', '#queue-historical'],
  ]) {
    await page.goto(timelineUrl)
    await page.locator(`.care-event a[href*="${fragment}"]`).first().click()
    await expect(page.locator(target)).toBeFocused()
    await page.reload()
    await expect(page.locator(target)).toBeFocused()
  }
  // Paging limits large histories while retaining every source record.
  for (let i = 0; i < 30; i++) raw.reminder_worklist.push({ id: `past-${i}`, pet_id: petId, title: `Past reminder ${i}`, reminder_type: 'custom', status: 'completed', due_at: '2026-09-01T04:00:00Z' })
  await page.goto(timelineUrl)
  await expect(page.locator('.care-event')).toHaveCount(25)
  await page.getByRole('button', { name: 'Show more activity' }).click()
  assert.ok(await page.locator('.care-event').count() > 25)
  await page.goto(app.origin + '/patients/inactive-pet?tab=timeline')
  await expect(page.getByRole('heading', { name: 'No care activity yet' })).toBeVisible()
  await page.goto(app.origin + '/dashboard')
  await expect(page.getByRole('heading', { name: 'Care at the clinic (2)', exact: true })).toBeVisible()
  raw.queue_entries[0].status = 'cancelled'
  raw.queue_entries[0].finished_at = now.toISOString()
  await page.clock.fastForward(30001)
  await expect(page.getByRole('heading', { name: 'Care at the clinic (1)', exact: true })).toBeVisible()
  console.log('PASS daily action board, overnight arrivals, stock watch and filters, unified timeline, paging, mobile layout and historical source navigation/reload')

  failRead = true
  await page.goto(app.origin + '/patients')
  await expect(page.getByRole('alert')).toContainText('Database unavailable')
  failRead = false
  await page.getByRole('button', { name: 'Retry loading records' }).click()
  await expect(page.getByRole('heading', { name: 'Patients & owners' })).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('signed-out', '1'))
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  await page.goto(app.origin + '/patients/' + petId)
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  console.log('PASS citation focus on click/reload, missing sources, failed database reads/retry, and sign-out isolation; no JavaScript errors')
} catch (error) {
  if (page) {
    console.error('Browser check failed at', page.url(), 'Client errors:', errors, 'Recent request failures:', failedRequests.slice(-10))
    await page.screenshot({ path: 'test-artifacts.local/connections-failure.png', fullPage: true }).catch(() => {})
    await writeFile('test-artifacts.local/connections-failure.txt', await page.locator('body').innerText().catch(() => 'Page closed'))
  }
  throw error
} finally { await app.close() }
