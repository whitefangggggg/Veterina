// KAN-20 browser acceptance. Every API request is intercepted; no hosted writes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, clinic_id: 'clinic-a', full_name: 'Dr. Rivera', role: 'owner', is_active: true }],
  clinic_settings: [{ id: 'clinic-a', clinic_name: 'Harbor Veterinary Clinic', timezone: 'Asia/Singapore', brand_color: '#305b9a', onboarding_completed_at: '2026-11-01T00:00:00Z', business_hours: { mon: { open: '09:00', close: '18:00' } } }],
  owners: [{ id: 'owner', full_name: 'Alex Santos', phone: '09171234567', normalized_phone: '+639171234567', is_active: true }],
  pets: ['Mochi', 'Luna', 'Milo', 'Cooper', 'Coco', 'Max'].map((name, index) => ({ id: `pet-${index}`, owner_id: 'owner', name, record_number: `VET-00${index}`, species: 'Dog', breed: 'Mixed', sex: 'Male', status: 'Active' })),
  service_types: [{ id: 'checkup', name: 'Wellness check', workflow: 'checkup', is_active: true, default_duration_minutes: 30 }],
  visits: [{ id: 'draft-visit', pet_id: 'pet-1', chief_complaint: 'Draft complaint', visited_at: '2026-11-09T01:00:00Z', attending_veterinarian_id: actor },
    { id: 'unfinalized', pet_id: 'pet-2', chief_complaint: 'Finish these notes', visited_at: '2026-11-08T01:00:00Z', attending_veterinarian_id: actor, recording_purpose: 'record_only' },
    { id: 'finished', pet_id: 'pet-3', chief_complaint: 'Finalized outpatient checkup', visited_at: '2026-11-09T01:00:00Z', finalized_at: '2026-11-09T01:30:00Z' },
    { id: 'hospital', pet_id: 'pet-4', chief_complaint: 'Hospital stay', visited_at: '2026-11-08T01:00:00Z', attending_veterinarian_id: actor }],
  queue_entries: [{ id: 'waiting', pet_id: 'pet-0', appointment_id: 'morning', category: 'checkup', service_name: 'Wellness check', status: 'waiting', arrived_at: '2026-11-09T01:48:00Z', queue_date: '2026-11-09', queue_number: 1 },
    { id: 'consult', pet_id: 'pet-1', visit_id: 'draft-visit', category: 'checkup', service_name: 'Wellness check', status: 'in_progress', arrived_at: '2026-11-09T01:00:00Z', started_at: '2026-11-09T01:05:00Z', veterinarian_id: actor, draft_saved_at: '2026-11-09T01:10:00Z', care_draft: { complaint: 'Retained SOAP draft' }, queue_date: '2026-11-09', queue_number: 2 }],
  admissions: [{ id: 'ready-stay', pet_id: 'pet-4', visit_id: 'hospital', status: 'ready_for_discharge', admitted_at: '2026-11-08T01:00:00Z' }],
  appointments: [{ id: 'afternoon', pet_id: 'pet-2', service_type_id: 'checkup', starts_at: '2026-11-09T06:00:00Z', ends_at: '2026-11-09T06:30:00Z', status: 'confirmed' },
    { id: 'morning', pet_id: 'pet-0', service_type_id: 'checkup', starts_at: '2026-11-09T01:00:00Z', ends_at: '2026-11-09T01:30:00Z', status: 'confirmed' }],
  reminder_worklist: [0, 1, 2, 3].map((index) => ({ id: `call-${index}`, pet_id: `pet-${index}`, title: `Follow-up ${index}`, reminder_type: 'follow_up', due_at: `2026-11-0${8 + Number(index > 0)}T01:00:00Z`, status: 'pending' })),
  inventory_items: [{ id: 'vaccine', name: 'Rabies vaccine', category: 'Vaccines', unit: 'dose', minimum_stock: 5, is_active: true },
    { id: 'medicine', name: 'Clinical medicine', category: 'Medicine', unit: 'tablet', minimum_stock: 5, is_active: true }],
  inventory_batches: [{ id: 'med-batch', item_id: 'medicine', quantity: 1, is_active: true }],
  suppliers: [{ id: 'supplier', name: 'Harbor Supplies', phone: '09170000000', is_active: true }],
  item_suppliers: [{ item_id: 'vaccine', supplier_id: 'supplier', is_preferred: true }],
}
const saves = [], errors = []
let release, failFirst = true, failReads = false
const app = await browserServer(5211)
try {
  await mkdir('test-artifacts.local', { recursive: true })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'light' })
  context.setDefaultTimeout(15000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'dashboard@example.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname.endsWith('/rpc/account_access')) return reply(mockAccountAccess(raw.profiles[0], { subscription: { ...mockAccountAccess(raw.profiles[0]).subscription, clinicId: raw.profiles[0].clinic_id } }))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname.endsWith('/rpc/portal_mutation')) {
      const input = route.request().postDataJSON()
      assert.equal(input.p_action, 'complete_reminder'); assert.equal(input.p_data.outcome, 'Completed')
      saves.push(input)
      await new Promise((resolve) => { release = resolve })
      if (failFirst) { failFirst = false; return reply({ code: 'P0001', message: 'VALIDATION_FAILED: temporary completion failure. Please retry.' }, 400) }
      raw.reminder_worklist.find((task) => task.id === input.p_data.id).status = 'completed'
      failReads = true
      return reply({ id: input.p_data.id })
    }
    assert.equal(route.request().method(), 'GET', 'Unexpected real workflow mutation in dashboard acceptance')
    if (failReads && url.pathname.endsWith('/owners')) return reply({ message: 'Refresh unavailable' }, 500)
    return reply(raw[url.pathname.split('/').at(-1)] || [])
  })
  const page = await context.newPage()
  await page.clock.install({ time: new Date('2026-11-09T02:00:00Z') })
  page.on('pageerror', (error) => errors.push(error.message))
  const dashboard = () => page.goto(`${app.origin}/dashboard`)
  const noOverflow = async () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await dashboard()
  await expect(page.getByRole('heading', { name: 'Harbor Veterinary Clinic', exact: true })).toBeVisible()
  await expect(page.locator('.home-hero')).toHaveCount(0)
  await expect(page.locator('.shift-context')).toContainText('Open until 6 PM')
  const floor = page.getByRole('region', { name: 'Care in motion', exact: true })
  await expect(floor.getByRole('region', { name: 'Waiting in lobby' })).toContainText('Waiting 12 min')
  await expect(floor.getByRole('region', { name: 'In consultation' })).toContainText('Dr. Rivera')
  await expect(floor.getByRole('region', { name: 'Ready for discharge' })).toContainText('Coco')
  await expect(floor.getByRole('region', { name: 'Ready for discharge' })).not.toContainText('Cooper')
  await expect(page.locator('.chart-row')).toHaveCount(2)
  await expect(page.locator('.stock-watch-row').first()).toContainText('Rabies vaccine')
  await expect(page.getByRole('link', { name: 'Order from supplier', exact: true })).toHaveAttribute('href', '/suppliers#supplier')
  await expect(page.locator('.stream-appointment').first()).toContainText('9:00 AM')
  await expect(page.locator('.stream-appointment').first()).toContainText('Waiting')
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    const shift = await page.locator('.shift-command-bar').boundingBox()
    assert.ok(shift.height >= 80 && shift.height <= 90)
    for (const selector of ['.shift-command-bar', '.clinic-floor', '.action-radar', '.appointment-stream-card', '.recent-patients-tray']) {
      const box = await page.locator(selector).boundingBox()
      assert.ok(box.y >= 0 && box.y + box.height <= height, `${selector} falls below the fold at ${width}x${height}`)
    }
    await noOverflow()
  }
  await page.getByRole('button', { name: 'Quick Walk-In', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add walk-in', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Search clinic records from dashboard' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Refresh dashboard', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Search clinic records', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Search clinic records', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Search clinic records', exact: true })).toBeFocused()
  await page.locator('.charts-radar .chart-row').filter({ hasText: 'Milo' }).getByRole('button', { name: 'Edit SOAP' }).click()
  await expect(page.getByRole('dialog')).toContainText('Milo')
  await expect(page.getByLabel('Chief complaint', { exact: true })).toHaveValue('Finish these notes')
  await page.keyboard.press('Escape')
  await page.locator('.charts-radar .chart-row').filter({ hasText: 'Luna' }).getByRole('button', { name: 'Resume draft' }).click()
  await expect(page.getByLabel('Chief complaint', { exact: true })).toHaveValue('Retained SOAP draft')
  await page.keyboard.press('Escape')

  const task = page.locator('.call-row').filter({ hasText: 'Follow-up 0' })
  await expect(task.getByRole('link', { name: /^Call Alex/ })).toHaveAttribute('href', 'tel:+639171234567')
  await task.getByRole('checkbox').check()
  await expect.poll(() => saves.length).toBe(1)
  await expect(task.getByRole('checkbox')).toBeChecked()
  await expect(task.getByRole('checkbox')).toBeDisabled()
  assert.match(page.url(), /\/dashboard$/)
  release()
  await expect(task.getByRole('alert')).toContainText('Please retry')
  await expect(task.getByRole('checkbox')).not.toBeChecked()
  await task.getByRole('checkbox').check()
  await expect.poll(() => saves.length).toBe(2)
  release()
  await expect(task).toHaveCount(0)
  await expect(page.locator('.database-error')).toContainText('Saved records could not be refreshed')
  assert.equal(saves[0].p_key, saves[1].p_key)
  failReads = false
  await page.getByRole('button', { name: 'Retry refresh', exact: true }).click()
  await expect(page.locator('.database-error')).toHaveCount(0)
  assert.equal(saves.length, 2)

  for (let index = 0; index < 6; index++) {
    await page.goto(`${app.origin}/patients/pet-${index}`)
    await expect(page.locator('.pet-title-row h1')).toHaveText(raw.pets[index].name)
  }
  await dashboard()
  await expect(page.locator('.recent-patient-chip')).toHaveCount(5)
  await expect(page.locator('.recent-patient-chip').first()).toContainText('Max')
  const persisted = await page.evaluate(() => localStorage.getItem('vt_recent_patients:clinic-a:10000000-0000-4000-8000-000000000001'))
  assert.deepEqual(JSON.parse(persisted), ['pet-5', 'pet-4', 'pet-3', 'pet-2', 'pet-1'])
  await page.reload(); await expect(page.locator('.recent-patient-chip')).toHaveCount(5)
  await page.locator('.recent-patient-chip').first().click(); await expect(page).toHaveURL(/patients\/pet-5/)
  await dashboard()
  await expect(page.locator('.command-dashboard')).toBeVisible()
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('.command-dashboard')).toBeVisible()
      await noOverflow()
      await page.screenshot({ path: `test-artifacts.local/dashboard-${colorScheme}-${width}.png`, fullPage: true })
    }
  }
  raw.queue_entries.push({ id: 'new-arrival', pet_id: 'pet-5', service_name: 'Wellness check', category: 'checkup', status: 'waiting', arrived_at: '2026-11-09T02:00:00Z', queue_date: '2026-11-09', queue_number: 3 })
  await page.clock.runFor(30000)
  await expect(floor.getByRole('region', { name: 'Waiting in lobby' })).toContainText('Max')

  raw.profiles[0].role = 'clinical_staff'; raw.profiles[0].clinic_id = 'clinic-b'
  await page.reload(); await expect(page.locator('.recent-patient-chip')).toHaveCount(0)
  await expect(page.locator('.command-dashboard')).toBeVisible()
  raw.profiles[0].clinic_id = 'clinic-a'
  await page.reload(); await expect(page.locator('.recent-patient-chip')).toHaveCount(5)
  await page.getByRole('button', { name: 'Clear recent patients' }).click()
  await expect(page.locator('.recent-patient-chip')).toHaveCount(0)
  raw.queue_entries = []; raw.appointments = []; raw.admissions = []; raw.visits = []; raw.reminder_worklist = []; raw.inventory_items = []
  await page.reload()
  await expect(floor).toContainText('All quiet on the clinic floor!')
  await expect(page.locator('.appointment-stream-card')).toContainText('No appointments booked today')
  await expect(page.locator('.charts-radar')).toContainText('Charts are up to date')
  await expect(page.locator('.calls-radar')).toContainText('Follow-up calls are up to date')
  await page.getByRole('button', { name: 'Check-in a Walk-in Patient', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add walk-in', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-artifacts.local/dashboard-quiet.png', fullPage: true })
  await page.setViewportSize({ width: 320, height: 900 })
  await noOverflow()
  await expect(page.getByRole('button', { name: 'Check-in a Walk-in Patient', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-artifacts.local/dashboard-quiet-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS KAN-20 viewport fit, clinic hours, live floor/polling, chart/draft resume, walk-in/search, calls optimistic failure/retry/refresh recovery, clinical stock priority/supplier, appointment stream, scoped five-patient recents, staff access and quiet/mobile/light/dark states')
} finally { await app.close() }
