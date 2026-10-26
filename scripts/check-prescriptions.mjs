// Browser UI checks use intercepted API responses; portal_workflows.sql covers
// persistence, validation, atomicity and finalized-record guards on Postgres.
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { frontendEnvironment } from './helpers/browser.mjs'

const origin = 'http://127.0.0.1:5179'
const env = frontendEnvironment()
const api = new URL(env.VITE_SUPABASE_URL)
const userId = '10000000-0000-4000-8000-000000000001'
const petId = '20000000-0000-4000-8000-000000000001'
const ownerId = '30000000-0000-4000-8000-000000000001'
const visitId = '40000000-0000-4000-8000-000000000001'
const profile = { id: userId, full_name: 'Dr. Alex Rivera', role: 'owner', is_active: true, prc_license_number: '123456', ptr_number: 'PTR-2026' }
const raw = {
  profiles: [profile], clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Veterina Animal Clinic', address: '24 Garden Street', phone: '+63 917 123 4567', email: 'care@example.org' }],
  pets: [{ id: petId, owner_id: ownerId, name: 'Mochi', record_number: 'VET-2026-00001', species: 'Cat', breed: 'Mixed', status: 'Active', sex: 'Male', reproductive_status: 'Intact', baseline_weight: 3, birth_date: '2024-01-10' }],
  owners: [{ id: ownerId, full_name: 'Test owner', phone: '09171234567', is_active: true }],
  visits: [{ id: visitId, pet_id: petId, visit_type: 'Wellness check', chief_complaint: 'Recorded complaint', diagnosis_summary: 'Recorded diagnosis', visited_at: '2026-10-17T04:00:00Z', attending_veterinarian_id: userId }],
  visit_vitals: [{ id: 'vitals', visit_id: visitId, weight_kg: 3.5, measured_at: '2026-10-17T04:00:00Z' }],
  prescriptions: [],
  inventory_items: [
    { id: '50000000-0000-4000-8000-000000000001', name: 'Stock medicine', sku: 'SKU-ALPHA', brand: 'Alpha', category: 'Medicine', unit: 'tablet', minimum_stock: 0, is_active: true, allows_fraction: false, notes: 'Inventory context only' },
    { id: '50000000-0000-4000-8000-000000000002', name: 'Stock medicine', sku: 'SKU-BETA', brand: 'Beta', category: 'Other', unit: 'ml', minimum_stock: 0, is_active: true, allows_fraction: true },
    { id: '50000000-0000-4000-8000-000000000003', name: 'Archived medicine', sku: 'SKU-ARCHIVED', category: 'Medicine', unit: 'unit', minimum_stock: 0, is_active: false },
  ],
  inventory_batches: [
    { id: '60000000-0000-4000-8000-000000000001', item_id: '50000000-0000-4000-8000-000000000001', lot_number: 'ALPHA-LIVE', expiration_date: '2035-12-31', is_active: true },
    { id: '60000000-0000-4000-8000-000000000002', item_id: '50000000-0000-4000-8000-000000000002', lot_number: 'BETA-LIVE', is_active: true },
    { id: 'expired-batch', item_id: '50000000-0000-4000-8000-000000000001', lot_number: 'EXPIRED', expiration_date: '2000-01-01', is_active: true },
    { id: 'inactive-batch', item_id: '50000000-0000-4000-8000-000000000001', lot_number: 'INACTIVE', is_active: false },
  ],
  inventory_movements: [
    { id: 'initial-alpha', item_id: '50000000-0000-4000-8000-000000000001', batch_id: '60000000-0000-4000-8000-000000000001', quantity_delta: 8, movement_type: 'stock_in', created_at: '2026-10-17T04:00:00Z' },
    { id: 'initial-beta', item_id: '50000000-0000-4000-8000-000000000002', batch_id: '60000000-0000-4000-8000-000000000002', quantity_delta: 2, movement_type: 'stock_in', created_at: '2026-10-17T04:00:00Z' },
    { id: 'initial-expired', item_id: '50000000-0000-4000-8000-000000000001', batch_id: 'expired-batch', quantity_delta: 10, movement_type: 'stock_in', created_at: '2026-10-17T04:00:00Z' },
  ],
}
const calls = [], errors = []
let failOnce = true
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5179', '--strictPort'], { stdio: 'pipe', windowsHide: true })
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch { /* Wait for Vite. */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(ready, 'Vite did not start')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const session = { access_token: mockAccessToken(userId), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'prescriptions@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = request.postDataJSON()
      calls.push({ action, payload, key })
      if (failOnce) { failOnce = false; return reply({ message: 'Save interrupted. Please retry.', code: 'P0001' }, 400) }
      const record = action === 'create_prescription' ? { id: `prescription-${raw.prescriptions.length}`, visit_id: payload.visitId, prescribed_by: userId, prescribed_by_name: profile.full_name, prescribed_at: '2026-10-17T04:00:00Z' } : raw.prescriptions.find((record) => record.id === payload.id)
      const medications = payload.medications.map((medication) => {
        if (!medication.inventoryItemId || record.medications?.some((row) => row.medicationId === medication.medicationId && row.inventoryItemId)) return medication
        const item = raw.inventory_items.find((row) => row.id === medication.inventoryItemId)
        raw.inventory_movements.push({ id: crypto.randomUUID(), item_id: item.id, batch_id: medication.batchId, quantity_delta: -medication.dispenseQuantity, movement_type: 'stock_out', created_at: new Date().toISOString() })
        return { ...medication, medicationName: item.name, dispenseUnit: item.unit }
      })
      Object.assign(record, { medication_name: medications[0].medicationName, dose: payload.dose, frequency: payload.frequency, duration: payload.duration, instructions: payload.instructions, medications })
      if (action === 'create_prescription') raw.prescriptions.push(record)
      return reply({ id: record.id })
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/patients/${petId}`)
  await expect(page.getByRole('heading', { name: 'Mochi', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add prescription', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Open encounter', { exact: true })).toHaveValue(visitId)
  await dialog.getByLabel('Medication name 1', { exact: true }).fill('Medicine A')
  await dialog.getByLabel('Dose 1', { exact: true }).fill('Recorded dose A')
  await dialog.getByLabel('Frequency 1', { exact: true }).fill('Recorded frequency A')
  await dialog.getByRole('combobox', { name: 'Route 1', exact: true }).fill('Oral')
  await dialog.getByLabel('Duration 1', { exact: true }).fill('7 days')
  await dialog.getByLabel('Instructions 1', { exact: true }).fill('First instructions')
  await dialog.getByRole('button', { name: 'Add medication', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  assert.equal(calls.length, 0, 'Incomplete medication reached the server')
  await dialog.getByLabel('Medication name 2', { exact: true }).fill('Medicine B')
  await dialog.getByLabel('Dose 2', { exact: true }).fill('Recorded dose B')
  await dialog.getByLabel('Frequency 2', { exact: true }).fill('Recorded frequency B')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  assert.equal(calls.length, 0, 'Missing route reached the server')
  await dialog.getByRole('combobox', { name: 'Route 2', exact: true }).fill('Custom route')
  await dialog.getByLabel('Duration 2', { exact: true }).fill('3 days')
  await dialog.getByLabel('Instructions 2', { exact: true }).fill('With food & water')
  await dialog.getByRole('button', { name: 'Add medication', exact: true }).click()
  await dialog.getByRole('button', { name: 'Remove medication 3', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Prescription form overflows on mobile')
  mkdirSync('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/prescription-form-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Save interrupted. Please retry.')
  await expect(dialog.getByLabel('Medication name 2', { exact: true })).toHaveValue('Medicine B')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(calls[0].key, calls[1].key, 'Retry changed its idempotency key')
  assert.equal(calls[1].payload.medications.length, 2)
  await expect(page.locator('.prescription-row')).toContainText('Medicine B')
  await page.evaluate(() => {
    const createElement = document.createElement.bind(document)
    document.createElement = (...args) => {
      const element = createElement(...args)
      if (args[0] === 'iframe') element.addEventListener('load', () => { element.contentWindow.print = () => { window.prescriptionPrinted = true } })
      return element
    }
  })
  await page.getByRole('button', { name: 'Print prescription / PDF' }).click()
  await page.waitForFunction(() => window.prescriptionPrinted)
  const printFrame = page.frameLocator('iframe[title="Prescription"]')
  for (const text of ['Medicine A', 'Medicine B', 'Route: Oral', 'Route: Custom route', 'Dr. Alex Rivera', '123456', 'PTR-2026', 'Recorded diagnosis', '3.5 kg', '24 Garden Street', 'Veterina Animal Clinic']) await expect(printFrame.locator('body')).toContainText(text)
  const html = await printFrame.locator('html').evaluate((element) => element.outerHTML)
  const preview = await context.newPage()
  await preview.setContent(html)
  await preview.screenshot({ path: 'test-artifacts.local/prescription-print.png', fullPage: true })
  await preview.emulateMedia({ media: 'print' })
  await preview.pdf({ path: 'test-artifacts.local/prescription.pdf', preferCSSPageSize: true, printBackground: true })
  await preview.close()
  // Image failures leave a retryable action and remove the temporary document.
  await page.evaluate(() => {
    window.originalCanvasToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null) }
  })
  const photoButton = page.getByRole('button', { name: 'Download prescription photo (PNG)', exact: true })
  await photoButton.click()
  await expect(page.getByRole('alert')).toContainText('image could not be downloaded')
  await expect(page.locator('iframe[title="Prescription image export"]')).toHaveCount(0)
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalCanvasToBlob })
  const beforeImage = calls.length
  const [download] = await Promise.all([page.waitForEvent('download'), photoButton.click()])
  assert.equal(download.suggestedFilename(), 'prescription-Mochi-2026-10-17.png')
  await download.saveAs('test-artifacts.local/prescription-photo.png')
  const png = readFileSync('test-artifacts.local/prescription-photo.png')
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.ok(png.readUInt32BE(16) >= 1400 && png.readUInt32BE(20) >= 1900, 'Prescription photo is too small')
  assert.ok(png.length > 20000, 'Prescription photo appears blank')
  await expect(page.locator('iframe[title="Prescription image export"]')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  assert.equal(calls.length, beforeImage, 'Downloading an image must not write or dispense again')
  await page.getByRole('button', { name: 'Edit prescription', exact: true }).click()
  await expect(dialog.getByLabel('Medication name 2', { exact: true })).toHaveValue('Medicine B')
  await dialog.getByRole('button', { name: 'Remove medication 1', exact: true }).click()
  await expect(dialog.getByLabel('Medication name 1', { exact: true })).toHaveValue('Medicine B')
  await dialog.getByLabel('Duration 1', { exact: true }).fill('5 days')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(calls.at(-1).action, 'update_prescription')
  assert.equal(calls.at(-1).payload.medications.length, 1)
  await expect(page.locator('.prescription-row')).not.toContainText('Medicine A')
  await expect(page.locator('.prescription-row')).toContainText('5 days')
  // Inventory selection shares the existing multi-medication editor and retry flow.
  await page.getByRole('button', { name: 'Add prescription', exact: true }).click()
  const combo = dialog.getByRole('combobox', { name: 'Medication name 1', exact: true })
  await combo.fill('Stock medicine')
  await expect(dialog.getByRole('option', { name: /^Stock medicine/ })).toHaveCount(2)
  await combo.fill('SKU-ALPHA')
  await combo.press('Enter')
  await expect(combo).toHaveValue('Stock medicine')
  await expect(dialog.getByLabel('Instructions 1', { exact: true })).toHaveValue('')
  await expect(dialog).toContainText('Inventory context only')
  await expect(dialog.getByLabel('Stock batch 1').locator('option')).toHaveCount(2)
  await dialog.getByLabel('Dose 1', { exact: true }).fill('Prescribed dose')
  await dialog.getByLabel('Frequency 1', { exact: true }).fill('Prescribed frequency')
  await dialog.getByRole('combobox', { name: 'Route 1', exact: true }).fill('Oral')
  const callsBeforeValidation = calls.length
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  assert.equal(calls.length, callsBeforeValidation, 'Missing dispensing fields reached server')
  await dialog.getByLabel('Stock batch 1').selectOption(raw.inventory_batches[0].id)
  await dialog.getByLabel('Dispensing quantity 1').fill('0.5')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  assert.equal(calls.length, callsBeforeValidation, 'Fractional whole-unit quantity reached server')
  await dialog.getByLabel('Dispensing quantity 1').fill('9')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  assert.equal(calls.length, callsBeforeValidation, 'Overdraw reached server')
  await dialog.getByLabel('Dispensing quantity 1').fill('3')
  await dialog.getByRole('button', { name: 'Add medication', exact: true }).click()
  await dialog.getByLabel('Medication name 2', { exact: true }).fill('External medicine')
  await expect(dialog).toContainText('No matching inventory items')
  await dialog.getByRole('option', { name: 'Use custom medication: External medicine', exact: true }).click()
  await dialog.getByLabel('Dose 2', { exact: true }).fill('Custom dose')
  await dialog.getByLabel('Frequency 2', { exact: true }).fill('Custom frequency')
  await dialog.getByRole('combobox', { name: 'Route 2', exact: true }).fill('Oral')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Dispensed 3 tablet from inventory' })).toBeVisible()
  assert.equal(calls.at(-1).payload.medications[0].inventoryItemId, raw.inventory_items[0].id)
  assert.ok(!calls.at(-1).payload.medications[1].inventoryItemId)
  assert.equal(raw.inventory_movements.filter((row) => row.movement_type === 'stock_out').length, 1)
  raw.inventory_items[0].name = 'Renamed and archived medicine'
  raw.inventory_items[0].is_active = false
  await page.reload()
  await page.getByRole('button', { name: 'Edit prescription', exact: true }).last().click()
  await expect(combo).toHaveValue('Stock medicine')
  await expect(combo).toHaveAttribute('readonly', '')
  await expect(dialog.getByLabel('Stock batch 1')).toBeDisabled()
  await expect(dialog.getByLabel('Dispensing quantity 1')).toHaveAttribute('readonly', '')
  await expect(dialog.getByRole('button', { name: 'Remove medication 1', exact: true })).toHaveCount(0)
  await dialog.getByLabel('Instructions 1', { exact: true }).fill('Updated clinical instructions')
  await dialog.getByRole('button', { name: 'Add medication', exact: true }).click()
  const thirdCombo = dialog.getByRole('combobox', { name: 'Medication name 3', exact: true })
  await thirdCombo.fill('Beta')
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Inventory combo overflows at ${width}px`)
    if (width === 375) await page.screenshot({ path: 'test-artifacts.local/prescription-inventory-mobile.png', fullPage: true })
  }
  await thirdCombo.press('Escape')
  await expect(dialog).toBeVisible()
  await thirdCombo.press('ArrowDown')
  await thirdCombo.press('ArrowUp')
  await thirdCombo.press('Enter')
  await dialog.getByLabel('Stock batch 3').selectOption(raw.inventory_batches[1].id)
  await dialog.getByLabel('Dispensing quantity 3').fill('0.25')
  await dialog.getByLabel('Dose 3', { exact: true }).fill('Recorded liquid dose')
  await dialog.getByLabel('Frequency 3', { exact: true }).fill('Recorded liquid frequency')
  await dialog.getByRole('combobox', { name: 'Route 3', exact: true }).fill('Oral')
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(raw.inventory_movements.filter((row) => row.movement_type === 'stock_out').length, 2)
  await page.reload()
  await expect(page.locator('.prescription-row').last()).toContainText('Updated clinical instructions')
  await expect(page.getByRole('link', { name: 'Dispensed 0.25 ml from inventory' })).toBeVisible()
  raw.visits[0].finalized_at = '2026-10-17T05:00:00Z'
  await page.reload()
  await expect(page.getByRole('button', { name: 'Print prescription / PDF' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit prescription', exact: true })).toHaveCount(0)
  assert.deepEqual(errors, [])
  console.log('PASS prescriptions: custom/inventory combo, search/name collisions, batches, quantities, snapshots, immutable dispensing, added rows, keyboard/mobile, retry, print/PDF, real PNG download/retry and finalized controls')
} finally {
  await browser?.close()
  server.kill()
}
