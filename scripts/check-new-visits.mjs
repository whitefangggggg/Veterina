import { withDetailedHistory } from './helpers/history.mjs'
import { openNewVisit, reviewRecord } from './helpers/new-visit.mjs'
import { selectControl } from './helpers/select.mjs'
// UI acceptance uses intercepted APIs. unified_patient_visits.sql verifies persistence and isolation.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001', petId = '20000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, full_name: 'History recorder', role: 'clinical_staff', is_active: true }],
  clinic_settings: [{ id: 'settings', clinic_name: 'Historical clinic', timezone: 'Asia/Manila' }],
  owners: [{ id: 'owner', full_name: 'Patient owner', phone: '09171234567', is_active: true }],
  pets: [{ id: petId, owner_id: 'owner', name: 'Ming', record_number: 'VET-1', species: 'Cat', status: 'Active', baseline_weight: 5 }],
  service_types: [
    { id: 'vaccine', name: 'Vaccination', workflow: 'vaccination', is_active: true },
    ...['Follow-up', 'Wellness check', 'Surgery', 'Sick visit'].map((name) => ({ id: name, name, workflow: 'checkup', is_active: true })),
    { id: 'grooming', name: 'Grooming', workflow: 'maintenance', is_active: true },
    { id: 'archived', name: 'Archived service', workflow: 'maintenance', is_active: false },
  ],
  patient_service_records: [],
  visits: [], prescriptions: [], visit_vitals: [], vaccinations: [],
  queue_entries: [],
}

const calls = [], errors = [], receipts = new Map()
let failOnce = true
const app = await browserServer(5197)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(10000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'history@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, (route) => {
    const url = new URL(route.request().url())
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: data, p_key: key } = route.request().postDataJSON()
      calls.push({ action, data, key })
      if (receipts.has(key)) return reply(receipts.get(key))
      if (action === 'create_record_only_service' && failOnce) { failOnce = false; return reply({ message: 'Service save interrupted. Please retry.' }, 400) }
      const id = data.id || crypto.randomUUID()
      let result = { id }
      if (action === 'create_record_only_service' || action === 'update_record_only_service') {
        const row = raw.patient_service_records.find((row) => row.id === id) || { id, pet_id: petId, service_type_id: data.serviceId, service_name: 'Grooming' }
        Object.assign(row, { performed_at: data.performedAt, performed_by: data.veterinarianId || null, performed_by_name: data.veterinarianName || '', service_notes: data.serviceNotes })
        if (!raw.patient_service_records.includes(row)) raw.patient_service_records.push(row)
      } else if (action === 'add_queue_entry') {
        raw.queue_entries.push({ id, pet_id: petId, category: 'maintenance', service_name: 'Grooming', service_type_id: 'grooming', status: 'waiting', arrived_at: new Date().toISOString(), queue_date: '2026-11-06', queue_number: 1 })
        result = { id, queueNumber: 1, queueDate: '2026-11-06' }
      } else throw new Error(`Unexpected action ${action}`)
      receipts.set(key, result); return reply(result)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(withDetailedHistory(`${app.origin}/patients/${petId}`))
  await expect(page.locator('.pet-hero-actions').getByRole('button', { name: 'Record checkup', exact: true })).toHaveCount(0)
  await expect(page.locator('.pet-hero-actions').getByRole('button', { name: 'Record vaccination', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add Record', exact: true }).click()
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(page.getByRole('radio')).toHaveCount(6)
  await expect(page.getByRole('radio', { name: 'Archived service', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/new-visit-picker-desktop.png' })
  await page.getByRole('radio', { name: 'Vaccinations and Deworming', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('radio', { name: 'Vaccinations and Deworming', exact: true })).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: 'Follow-up', exact: true })).toBeChecked()
  await expect(page.locator('.visit-service-card.is-selected')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 740 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Picker overflow at ${width}px`)
  }
  await page.screenshot({ path: 'test-artifacts.local/new-visit-picker-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Add Record')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  for (const service of raw.service_types.filter((entry) => entry.is_active)) {
    for (const purpose of ['Queue processing', 'Record-keeping only']) {
      await openNewVisit(page, service.name)
      await expect(page.getByLabel('Chief complaint')).toHaveCount(0)
      await expect(page.getByLabel('Vaccine type')).toHaveCount(0)
      await page.getByRole('button', { name: new RegExp(purpose) }).focus()
      await page.keyboard.press('Enter')
      if (service.workflow === 'checkup') {
        await expect(page.getByLabel('Service', { exact: true })).toHaveValue(service.name)
        await expect(selectControl(page.getByLabel('Reason for Checkup'))).toHaveValue(service.name === 'Follow-up' ? 'Follow-up Checkup' : ['Surgery', 'Sick visit'].includes(service.name) ? 'Medical Concern' : 'Wellness Check')
        assert.equal(await page.getByLabel('Weight (kg)').evaluate((input) => input.required), purpose === 'Queue processing')
      } else if (service.workflow === 'vaccination') {
        await expect(page.getByLabel(purpose === 'Queue processing' ? 'Inventory product 1' : 'Product name 1', { exact: true })).toBeHidden()
        await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeVisible()
      } else {
        await expect(page.getByLabel(purpose === 'Queue processing' ? 'Arrival notes' : 'Work performed / service notes')).toBeVisible()
        await expect(page.getByLabel('Chief complaint')).toHaveCount(0)
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
  }
  assert.equal(calls.length, 0)
  await openNewVisit(page)
  await page.getByRole('button', { name: /Record-keeping only/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.locator('[data-record-step]:visible')).toHaveCount(1)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('required fields')
  await expect(page.getByRole('heading', { name: 'Visit details', exact: true })).toBeVisible()
  await page.getByLabel('Chief complaint').fill('Original complaint')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vitals & condition', exact: true })).toBeVisible()
  await page.getByLabel('Weight (kg)').fill('4.25')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByLabel('Clinical notes', { exact: true }).fill('Notes preserved across steps')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByLabel('Diagnosis', { exact: true }).fill('Historical assessment')
  await reviewRecord(page)
  await expect(page.getByRole('heading', { name: 'Review your record', exact: true })).toBeVisible()
  await expect(page.locator('.record-review:visible')).toContainText('Original complaint')
  await expect(page.locator('.record-review:visible')).toContainText('4.25')
  await page.getByRole('button', { name: 'Edit Visit details', exact: true }).click()
  await expect(page.getByLabel('Chief complaint')).toHaveValue('Original complaint')
  await page.getByLabel('Chief complaint').fill('Revised complaint')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.locator('.record-review:visible')).toContainText('Revised complaint')
  await expect(page.locator('.record-review:visible')).toContainText('Notes preserved across steps')
  await page.getByRole('button', { name: 'Service', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Wellness check', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /Record-keeping only/ }).click()
  await expect(page.getByRole('heading', { name: 'Review your record', exact: true })).toBeVisible()
  await expect(page.locator('.record-review:visible')).toContainText('Revised complaint')
  await page.getByRole('button', { name: 'Recording', exact: true }).click()
  await page.getByRole('button', { name: /Queue processing/ }).click()
  const activePane = page.locator('[data-record-pane]:visible')
  await expect(activePane.getByLabel('Chief complaint')).toHaveValue('')
  await activePane.getByLabel('Chief complaint').fill('Separate queue details')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: /Record-keeping only/ }).click()
  await expect(page.locator('.record-review:visible')).toContainText('Revised complaint')
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: mode })
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 850 })
      await page.getByRole('button', { name: 'Edit Visit details', exact: true }).click()
      assert.ok(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth), `Record wizard overflow in ${mode} at ${width}`)
      await expect(page.locator('[data-record-step]:visible')).toHaveCount(1)
      await page.screenshot({ path: `test-artifacts.local/record-wizard-${mode}-${width}.png` })
      await page.getByRole('button', { name: 'Review', exact: true }).click()
    }
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.length, 0, 'Navigating or cancelling the wizard must not save')
  await openNewVisit(page, 'Grooming')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Grooming', exact: true })).toBeChecked()
  await page.getByRole('radio', { name: 'Grooming', exact: true }).check()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /Queue processing/ }).click()
  await page.getByLabel('Arrival notes').fill('Bath and nail trim')
  await reviewRecord(page)
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).data.petId, petId)
  assert.equal(calls.at(-1).data.serviceId, 'grooming')
  await openNewVisit(page, 'Grooming')
  await page.getByRole('button', { name: /Record-keeping only/ }).click()
  await expect(page.getByLabel('Performed by', { exact: true })).toHaveValue('')
  await page.getByLabel('Service date (Asia/Manila)').fill('January 2, 2020')
  await page.getByLabel('Care time', { exact: true }).fill('11:00')
  await page.getByLabel('Performed by', { exact: true }).fill('Dok M?ya sa Bukid')
  await page.getByLabel('Work performed / service notes').fill('Previous bath and trim')
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `New visit overflow at ${width}px`)
  }
  await reviewRecord(page)
  await page.getByRole('button', { name: 'Save service record' }).click()
  await expect(page.getByRole('alert')).toContainText('Service save interrupted')
  await expect(page.getByLabel('Work performed / service notes')).toHaveValue('Previous bath and trim')
  await page.getByRole('button', { name: 'Save service record' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).key, calls.at(-2).key)
  assert.equal(raw.patient_service_records.length, 1)
  assert.equal(raw.queue_entries.length, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Clinical history', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit service record', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit service record', exact: true }).click()
  await expect(page.getByLabel('Performed by', { exact: true })).toHaveValue('Dok M?ya sa Bukid')
  await page.getByLabel('Performed by', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Save service record' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).action, 'update_record_only_service')
  assert.equal(raw.patient_service_records[0].performed_by_name, '')
  assert.deepEqual(errors, [])
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/new-visit-services.png' })
  console.log('PASS single-modal record steps, validation, Back/clickable navigation, preserved service/purpose drafts, review/edit, focus, light/dark mobile layouts, required choice, cancellation, keyboard/mobile, live grooming, historical save/retry/reload/edit, custom staff and history')
  await context.close()
} finally { await app.close() }
