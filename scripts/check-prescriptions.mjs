// Browser UI checks use intercepted API responses; portal_workflows.sql covers
// persistence, validation, atomicity and finalized-record guards on Postgres.
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const origin = 'http://127.0.0.1:5179'
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]
}))
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
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = request.postDataJSON()
      calls.push({ action, payload, key })
      if (failOnce) { failOnce = false; return reply({ message: 'Save interrupted. Please retry.', code: 'P0001' }, 400) }
      const record = action === 'create_prescription' ? { id: 'prescription', visit_id: payload.visitId, prescribed_by: userId, prescribed_by_name: profile.full_name, prescribed_at: '2026-10-17T04:00:00Z' } : raw.prescriptions.find((record) => record.id === payload.id)
      Object.assign(record, { medication_name: payload.medicationName, dose: payload.dose, frequency: payload.frequency, duration: payload.duration, instructions: payload.instructions, medications: payload.medications })
      if (action === 'create_prescription') raw.prescriptions.push(record)
      return reply({ id: record.id })
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/patients/${petId}`)
  await page.getByRole('button', { name: 'Add prescription', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Open encounter', { exact: true })).toHaveValue(visitId)
  await dialog.getByLabel('Medication name 1', { exact: true }).fill('Medicine A')
  await dialog.getByLabel('Dose 1', { exact: true }).fill('Recorded dose A')
  await dialog.getByLabel('Frequency 1', { exact: true }).fill('Recorded frequency A')
  await dialog.getByLabel('Duration 1', { exact: true }).fill('7 days')
  await dialog.getByLabel('Instructions 1', { exact: true }).fill('First instructions')
  await dialog.getByRole('button', { name: 'Add medication', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save prescription', exact: true }).click()
  assert.equal(calls.length, 0, 'Incomplete medication reached the server')
  await dialog.getByLabel('Medication name 2', { exact: true }).fill('Medicine B')
  await dialog.getByLabel('Dose 2', { exact: true }).fill('Recorded dose B')
  await dialog.getByLabel('Frequency 2', { exact: true }).fill('Recorded frequency B')
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
  for (const text of ['Medicine A', 'Medicine B', 'Dr. Alex Rivera', '123456', 'PTR-2026', 'Recorded diagnosis', '3.5 kg', '24 Garden Street', 'Veterina Animal Clinic']) await expect(printFrame.locator('body')).toContainText(text)
  const html = await printFrame.locator('html').evaluate((element) => element.outerHTML)
  const preview = await context.newPage()
  await preview.setContent(html)
  await preview.screenshot({ path: 'test-artifacts.local/prescription-print.png', fullPage: true })
  await preview.emulateMedia({ media: 'print' })
  await preview.pdf({ path: 'test-artifacts.local/prescription.pdf', preferCSSPageSize: true, printBackground: true })
  await preview.close()
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
  raw.visits[0].finalized_at = '2026-10-17T05:00:00Z'
  await page.reload()
  await expect(page.getByRole('button', { name: 'Print prescription / PDF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit prescription', exact: true })).toHaveCount(0)
  assert.deepEqual(errors, [])
  console.log('PASS prescription add/remove, required fields, mobile layout, retry, edit, print/PDF, clinic settings and finalized controls')
} finally {
  await browser?.close()
  server.kill()
}
