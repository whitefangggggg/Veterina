import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001', patient = '20000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, full_name: 'Completion clinician', role: 'clinical_staff', is_active: true }],
  clinic_settings: [{ id: 'settings', clinic_name: 'Completion clinic', timezone: 'Asia/Manila' }],
  owners: [{ id: 'household', full_name: 'Test household', phone: '09171234567', is_active: true }],
  pets: [{ id: patient, owner_id: 'household', name: 'Indo', record_number: 'VET-1', species: 'Dog', breed: 'Mixed', status: 'Active', baseline_weight: 3 }],
  service_types: [{ id: 'checkup', name: 'Wellness check', workflow: 'checkup', is_active: true }],
  visits: ['older-1','older-2'].map((id) => ({ id, pet_id: patient, visit_type: 'Wellness check', chief_complaint: 'Older visit', visited_at: '2026-10-20T04:00:00Z', attending_veterinarian_id: actor, finalized_at: null })),
  queue_entries: [], prescriptions: [], visit_vitals: [],
}
const calls = [], errors = [], receipts = new Map()
let failCompletion = true, failPrescription = true
const app = await browserServer(5187)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'completion@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, (route) => {
    const url = new URL(route.request().url()), request = route.request()
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: data, p_key: key } = request.postDataJSON(); calls.push({ action, data, key })
      if (receipts.has(key)) return reply(receipts.get(key))
      if (['complete_checkup', 'save_checkup_progress'].includes(action)) {
        if (failCompletion) { failCompletion = false; return reply({ message: 'Completion interrupted. Please retry.' }, 400) }
        const id = crypto.randomUUID(), ticket = crypto.randomUUID()
        raw.visits.push({ id, pet_id: patient, visit_type: data.type, chief_complaint: data.complaint, clinical_notes: data.clinicalNotes, visited_at: data.encounteredAt, attending_veterinarian_id: actor })
        raw.queue_entries.push({ id: ticket, pet_id: patient, category: 'checkup', service_name: data.type, status: action === 'complete_checkup' ? 'completed' : 'in_progress', draft_version: 1, visit_id: id, arrived_at: new Date().toISOString(), finished_at: action === 'complete_checkup' ? new Date().toISOString() : null, queue_date: '2026-10-25', queue_number: raw.queue_entries.length + 1 })
        const result = { id, queueEntryId: ticket, draftVersion: 1 }; receipts.set(key, result); return reply(result)
      }
      if (action === 'prescribe_and_complete_checkup') {
        if (failPrescription) { failPrescription = false; return reply({ message: 'Prescription interrupted. Please retry.' }, 400) }
        Object.assign(raw.queue_entries.find((entry) => entry.id === data.checkup.queueEntryId), { status: 'completed', finished_at: new Date().toISOString() })
        const id = crypto.randomUUID(); raw.prescriptions.push({ id, visit_id: data.visitId, medications: data.medications, prescribed_at: new Date().toISOString() }); return reply({ id })
      }
      throw new Error(`Unexpected completion action ${action}`)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  const page = await context.newPage(); page.on('pageerror', (failure) => errors.push(failure.message))
  await page.goto(`${app.origin}/patients/${patient}`)
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await page.getByRole('button', { name: 'Complete Checkup', exact: true }).click()
  assert.equal(calls.length, 0, 'Invalid care was persisted')
  await page.getByLabel('Chief complaint').fill('Today’s checkup')
  await page.getByLabel('Clinical notes').fill('Keep these notes after cancelling confirmation')
  await page.getByRole('button', { name: 'Complete Checkup', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Complete this checkup?')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Clinical notes')).toHaveValue('Keep these notes after cancelling confirmation')
  assert.equal(calls.length, 0, 'Cancel saved a checkup')
  await page.getByRole('button', { name: 'Complete Checkup', exact: true }).click()
  await page.getByRole('button', { name: 'Add Prescription', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Completion interrupted')
  await page.getByRole('button', { name: 'Add Prescription', exact: true }).click()
  const encounter = page.getByLabel('Open encounter', { exact: false })
  await expect(encounter).toBeDisabled()
  const visitId = raw.visits.at(-1).id
  await expect(encounter).toHaveValue(visitId)
  assert.equal(calls[0].key, calls[1].key, 'Preparation retry changed its key')
  assert.equal(raw.queue_entries[0].status, 'in_progress', 'Opening prescription completed care')
  await page.getByRole('combobox', { name: 'Medication name 1', exact: true }).fill('Custom medication')
  await page.getByRole('option', { name: 'Use custom medication: Custom medication', exact: true }).click()
  await page.getByRole('combobox', { name: 'Route 1', exact: true }).fill('Oral')
  await page.getByRole('option', { name: 'Oral', exact: true }).click()
  await page.getByLabel('Dose 1', { exact: true }).fill('Recorded dose')
  await page.getByLabel('Frequency 1', { exact: true }).fill('Recorded frequency')
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Prescription interrupted')
  await expect(page.getByLabel('Dose 1', { exact: true })).toHaveValue('Recorded dose')
  assert.equal(raw.queue_entries[0].status, 'in_progress', 'Failed prescription completed care')
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.prescriptions[0].visit_id, visitId)
  assert.equal(raw.queue_entries.length, 1)
  assert.equal(raw.queue_entries[0].status, 'completed')
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await page.getByLabel('Chief complaint').fill('Complete without prescription')
  await page.getByRole('button', { name: 'Complete Checkup', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('button', { name: 'Complete Checkup', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.queue_entries.length, 2)
  assert.equal(raw.prescriptions.length, 1)
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await page.getByLabel('Chief complaint').fill('Leave prescription unfinished')
  await page.getByRole('button', { name: 'Complete Checkup', exact: true }).click()
  await page.getByRole('button', { name: 'Add Prescription', exact: true }).click()
  await expect(page.getByLabel('Open encounter', { exact: false })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.visit-card').filter({ hasText: 'Leave prescription unfinished' })).toContainText('In progress')
  assert.equal(raw.queue_entries.at(-1).status, 'in_progress')
  assert.equal(raw.prescriptions.length, 1)
  assert.deepEqual(errors, [])
  console.log('PASS checkup confirmation, cancel/value retention, required fields, completion retry, current-visit prescription, prescription retry, completion without prescription and mobile layout')
} finally { await app.close() }
