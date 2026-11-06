import { openNewVisit } from './helpers/new-visit.mjs'
// UI acceptance uses intercepted APIs. historical_checkups.sql verifies persistence and isolation.
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
  visits: [], prescriptions: [], visit_vitals: [],
  queue_entries: [{ id: 'active', pet_id: petId, category: 'checkup', service_name: 'Surgery', status: 'in_progress', veterinarian_id: actor, queue_date: '2026-11-06', queue_number: 1, arrived_at: '2026-11-06T00:00:00Z' }],
}
const calls = [], errors = [], receipts = new Map()
let failOnce = true
const app = await browserServer(5193)
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
      const savePrescription = (input, visitId, id = crypto.randomUUID()) => {
        const record = raw.prescriptions.find((row) => row.id === id) || { id, visit_id: visitId, is_historical: true, recorded_by: actor }
        Object.assign(record, { medications: input.medications, prescribed_by: input.prescribedById || null, prescribed_by_name: input.prescribedByName || '', prescribed_at: input.prescribedAt })
        if (!raw.prescriptions.includes(record)) raw.prescriptions.push(record)
        return id
      }
      let result
      if (action === 'create_record_only_checkup' || action === 'update_encounter') {
        const id = data.id || crypto.randomUUID()
        const visit = raw.visits.find((row) => row.id === id) || { id, pet_id: petId, recording_purpose: 'record_only', finalized_at: null }
        Object.assign(visit, { visit_type: data.type, chief_complaint: data.complaint, visited_at: data.encounteredAt, attending_veterinarian_id: data.veterinarianId || null, attending_veterinarian_name: data.veterinarianName || '', clinical_notes: data.clinicalNotes, follow_up_date: data.followUpDate })
        if (!raw.visits.includes(visit)) raw.visits.push(visit)
        result = { id }
        if (data.prescription) result.prescriptionId = savePrescription(data.prescription, id)
      } else if (action === 'create_prescription' || action === 'update_prescription') {
        result = { id: savePrescription(data, data.visitId, data.id) }
      } else throw new Error(`Unexpected history action ${action}`)
      receipts.set(key, result); return reply(result)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${app.origin}/patients/${petId}`)
  const openHistory = async () => {
    await openNewVisit(page)
    await expect(page.getByLabel('Chief complaint')).toHaveCount(0)
    await page.getByRole('button', { name: /Record-keeping only/ }).click()
  }
  await openHistory()
  await expect(page.getByLabel('Attending veterinarian', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Weight (kg)')).toHaveValue('')
  await expect(page.getByLabel('Attending veterinarian', { exact: true })).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Reason for Checkup').locator('option')).toHaveText(['Wellness Check', 'Routine Checkup', 'Follow-up Checkup', 'Medical Concern', 'Other'])
  await expect(page.getByLabel('Clinical notes')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Complete Checkup', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save historical checkup' }).click()
  assert.equal(calls.length, 0)
  await page.getByLabel('Time of care (Asia/Manila)').fill('January 2, 2020')
  await page.getByLabel('Care time', { exact: true }).fill('11:00')
  await page.getByLabel('Reason for Checkup').selectOption('Medical Concern')
  await page.getByLabel('Chief complaint').fill('Old handwritten record')
  await page.getByLabel('Attending veterinarian', { exact: true }).fill('Dok Máya sa Bukid')
  await page.getByLabel('Clinical notes').fill('Mga detalye sa karaang rekord')
  await page.getByLabel('Follow-up date', { exact: true }).fill('January 2, 2030')
  await page.getByRole('button', { name: 'Add historical prescription', exact: true }).click()
  await expect(page.getByLabel('Prescription date')).toHaveValue('2020-01-02T11:00')
  await expect(page.getByLabel('Historical prescriber', { exact: true })).toHaveValue('Dok Máya sa Bukid')
  await expect(page.getByLabel('Stock batch 1')).toHaveCount(0)
  await page.getByLabel('Medication name 1', { exact: true }).fill('Tambal sa tiyan')
  await page.getByRole('button', { name: 'Add medication', exact: true }).click()
  await page.getByLabel('Medication name 2', { exact: true }).fill('Laing tambal')
  await page.getByLabel('Frequency 2', { exact: true }).fill('Kung gikinahanglan')
  await page.getByLabel('Duration 2', { exact: true }).fill('5 days')
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `History form overflow at ${width}px`)
  }
  await mkdir('test-artifacts.local', { recursive: true })
  await page.getByRole('dialog').screenshot({ path: 'test-artifacts.local/historical-checkup-form.png' })
  await page.getByRole('button', { name: 'Save historical checkup' }).click()
  await expect(page.getByRole('alert')).toContainText('Historical save interrupted')
  await expect(page.getByLabel('Medication name 2', { exact: true })).toHaveValue('Laing tambal')
  await page.getByRole('button', { name: 'Save historical checkup' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls[0].key, calls[1].key)
  assert.equal(calls[1].data.veterinarianId, '')
  assert.equal(calls[1].data.prescription.prescribedAt, '2020-01-02T03:00:00.000Z')
  assert.equal(calls[1].data.prescription.medications[0].dose, '')
  assert.equal(raw.queue_entries.length, 1)
  assert.equal(raw.queue_entries[0].status, 'in_progress')
  await expect(page.locator('.visit-card')).toContainText('Record only')
  await expect(page.locator('.visit-card')).toContainText('Not recorded')
  await expect(page.locator('.visit-card')).toContainText('Historical prescription record')
  await page.getByRole('button', { name: 'Edit checkup', exact: true }).click()
  await expect(page.getByRole('button', { name: /Queue processing/ })).toHaveCount(0)
  await expect(page.getByLabel('Attending veterinarian', { exact: true })).toHaveValue('Dok Máya sa Bukid')
  await page.getByLabel('Chief complaint').fill('Edited historical complaint')
  await page.getByRole('button', { name: 'Save historical checkup' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit prescription', exact: true }).click()
  await expect(page.getByLabel('Prescription date')).toHaveValue('2020-01-02T11:00')
  await page.getByLabel('Historical prescriber', { exact: true }).fill('Dok José')
  await page.getByLabel('Instructions 1', { exact: true }).fill('Historical instruction')
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.prescriptions.length, 1)
  assert.equal(raw.prescriptions[0].prescribed_by_name, 'Dok José')
  await page.reload()
  await expect(page.locator('.prescription-row')).toContainText('Historical instruction')
  await page.getByRole('button', { name: 'Add prescription', exact: true }).click()
  await expect(page.getByLabel('Historical prescriber', { exact: true })).toHaveValue('Dok Máya sa Bukid')
  await expect(page.getByLabel('Stock batch 1')).toHaveCount(0)
  await page.getByLabel('Medication name 1', { exact: true }).fill('Later historical medicine')
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.prescriptions.length, 2)
  assert.equal(raw.prescriptions[1].is_historical, true)
  raw.profiles[0].role = 'owner'
  await page.reload()
  await openHistory()
  await expect(page.getByLabel('Attending veterinarian', { exact: true })).toHaveValue('')
  await page.getByLabel('Chief complaint').fill('Unknown historical details')
  await page.getByRole('button', { name: 'Save historical checkup' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.visit-card').filter({ hasText: 'Unknown historical details' })).toContainText('Not recorded')
  assert.equal(raw.queue_entries.length, 1)
  assert.deepEqual(errors, [])
  console.log('PASS historical mode, optional details, Unicode clinicians, partial medicines, prescription dates, retry, edit/reload, owner defaults and mobile layout')
} finally { await app.close() }
