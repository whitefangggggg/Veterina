import { openNewVisit } from './helpers/new-visit.mjs'
// UI acceptance uses intercepted APIs. historical_vaccinations.sql verifies persistence and isolation.
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
  service_types: [{ id: 'checkup', name: 'Wellness check', workflow: 'checkup', is_active: true }, { id: 'vaccine-service', name: 'Vaccination', workflow: 'vaccination', is_active: true }],
  visits: [], prescriptions: [], visit_vitals: [], vaccinations: [],
  queue_entries: [{ id: 'active', pet_id: petId, category: 'checkup', service_name: 'Surgery', status: 'in_progress', veterinarian_id: actor, queue_date: '2026-11-06', queue_number: 1, arrived_at: '2026-11-06T00:00:00Z' }],
}
const calls = [], errors = [], receipts = new Map()
let failOnce = true
const app = await browserServer(5196)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
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
      if (failOnce) { failOnce = false; return reply({ message: 'Historical save interrupted. Please retry.' }, 400) }
      const id = data.id || crypto.randomUUID()
      const vaccine = raw.vaccinations.find((row) => row.id === id) || { id, pet_id: petId, recording_purpose: 'record_only' }
      Object.assign(vaccine, { vaccine_name: data.vaccine, brand: data.brand, lot_number: data.lotNumber, dose: data.dose, administered_at: data.administeredAt, next_due_at: data.nextDueAt, administered_by: data.veterinarianId || null, administered_by_name: data.veterinarianName || '' })
      if (!raw.vaccinations.includes(vaccine)) raw.vaccinations.push(vaccine)
      const result = { id }; receipts.set(key, result); return reply(result)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${app.origin}/patients/${petId}`)
  await openNewVisit(page, 'Vaccination')
  await expect(page.getByLabel('Vaccine name', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Queue processing/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Vaccine type')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openNewVisit(page, 'Vaccination')
  await page.getByRole('button', { name: /Record-keeping only/ }).click()
  await expect(page.getByLabel('Vaccine type')).toHaveCount(0)
  await expect(page.getByLabel('Veterinarian', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Date administered')).toHaveValue('')
  await page.getByRole('button', { name: 'Save historical vaccination' }).click()
  assert.equal(calls.length, 0)
  await page.getByLabel('Vaccine name', { exact: true }).fill('Anti-Rabies karaang rekord')
  await page.getByLabel('Date administered').fill('2020-01-02')
  await page.getByLabel('Next due date').fill('2030-01-02')
  await page.getByLabel('Veterinarian', { exact: true }).fill('Dok Máya sa Bukid')
  await page.getByLabel('Batch / lot number').fill('OLD-01')
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`)
  }
  await page.getByRole('button', { name: 'Save historical vaccination' }).click()
  await expect(page.getByRole('alert')).toContainText('Historical save interrupted')
  await expect(page.getByLabel('Vaccine name', { exact: true })).toHaveValue('Anti-Rabies karaang rekord')
  await page.getByRole('button', { name: 'Save historical vaccination' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls[0].action, 'create_record_only_vaccination')
  assert.equal(calls[0].key, calls[1].key)
  assert.equal(raw.vaccinations.length, 1)
  assert.equal(calls[1].data.veterinarianName, 'Dok Máya sa Bukid')
  assert.equal(calls[1].data.veterinarianId, '')
  assert.equal(calls[1].data.dose, '')
  assert.equal(calls[1].data.inventoryItemId, undefined)
  await page.reload()
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  await expect(page.locator('.vaccine-row .badge').getByText('Record only', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit vaccine', exact: true }).click()
  await expect(page.getByLabel('Vaccine name', { exact: true })).toHaveValue('Anti-Rabies karaang rekord')
  await expect(page.getByLabel('Veterinarian', { exact: true })).toHaveValue('Dok Máya sa Bukid')
  await page.getByLabel('Veterinarian', { exact: true }).fill('')
  await page.getByLabel('Brand', { exact: true }).fill('Original brand')
  await page.getByRole('button', { name: 'Save vaccination', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).action, 'update_vaccination')
  assert.equal(raw.vaccinations[0].administered_by_name, '')
  assert.equal(raw.queue_entries.length, 1)
  raw.profiles[0].role = 'owner'
  await page.reload()
  await openNewVisit(page, 'Vaccination')
  await expect(page.getByRole('button', { name: /Record-keeping only/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.deepEqual(errors, [])
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/historical-vaccinations.png' })
  console.log('Historical vaccination chooser, queue mode, required fields, custom clinician, retry, editing and mobile checks passed.')
  await context.close()
} finally { await app.close() }
