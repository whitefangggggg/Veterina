// Browser acceptance uses intercepted API responses; real database behavior is
// exercised independently by supabase/tests/queue_workflows.sql.
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const origin = 'http://127.0.0.1:5178'
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]
}))
const api = new URL(env.VITE_SUPABASE_URL)
const userId = '10000000-0000-4000-8000-000000000001'
const petId = '20000000-0000-4000-8000-000000000001'
const ownerId = '30000000-0000-4000-8000-000000000001'
const appointmentId = '40000000-0000-4000-8000-000000000001'
const now = new Date('2026-10-17T04:00:00Z')
const profile = { id: userId, full_name: 'Queue clinician', role: 'clinical_staff', is_active: true }
const raw = {
  profiles: [profile], clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Veterina' }],
  pets: [{ id: petId, owner_id: ownerId, name: 'Mochi', record_number: 'VET-2026-00001', species: 'Cat', breed: 'Mixed', status: 'Active', sex: 'Male', reproductive_status: 'Intact', baseline_weight: 3 }],
  owners: [{ id: ownerId, full_name: 'Test owner', phone: '09171234567', is_active: true }],
  service_types: [
    { id: 'service', name: 'Wellness check', workflow: 'checkup', default_duration_minutes: 30, is_active: true },
    { id: 'vaccination', name: 'Vaccination', workflow: 'vaccination', default_duration_minutes: 20, is_active: true },
    { id: 'surgery', name: 'Surgery', workflow: 'checkup', default_duration_minutes: 60, is_active: true },
    { id: 'grooming', name: 'Grooming', workflow: 'maintenance', default_duration_minutes: 60, is_active: true },
  ],
  inventory_items: ['Rabies', 'Patient-page vaccine', 'Cancelled queued vaccine'].map((name) => ({ id: name, name, brand: 'Clinic Brand', category: 'Vaccines', unit: 'dose', minimum_stock: 0, is_active: true })),
  appointments: [{ id: appointmentId, pet_id: petId, service_type_id: 'service', veterinarian_id: userId, status: 'confirmed', starts_at: '2026-10-17T05:00:00Z', ends_at: '2026-10-17T05:30:00Z' }],
  queue_entries: [],
  visits: [], visit_vitals: [],
  vaccinations: [null, '2026-10-16', '2026-10-17', '2026-10-18'].map((date, index) => ({ id: `vaccine-${index}`, pet_id: petId, vaccine_name: `Dose ${index}`, administered_at: '2026-10-01', next_due_at: date, lot_number: 'TEST', administered_by: userId })),
}
const calls = []
let failedOnce = false
let draftFailedOnce = false
let queueReads = 0
let nextQueueNumber = 0
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { stdio: 'pipe', windowsHide: true })
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
  const session = { access_token: mockAccessToken(userId), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'queue@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = request.postDataJSON()
      calls.push({ action, payload, key })
      let entry = raw.queue_entries.find((row) => row.id === payload.id)
      if (['save_queue_draft', 'complete_queue_entry'].includes(action) && (payload.draftVersion || 0) !== (entry.draft_version || 0)) return reply({ message: 'DRAFT_CONFLICT: a newer draft is available', code: 'P0001' }, 409)
      if (action === 'add_queue_entry') {
        entry = { id: `walkin-${raw.queue_entries.length + 1}`, pet_id: payload.petId, category: raw.service_types.find((service) => service.id === payload.serviceId).workflow, service_type_id: payload.serviceId, service_name: raw.service_types.find((service) => service.id === payload.serviceId).name, source: 'walk_in', status: 'waiting', arrived_at: now.toISOString(), veterinarian_id: payload.veterinarianId || null, notes: payload.notes }
        raw.queue_entries.push(entry)
      } else if (action === 'check_in_appointment') {
        entry = { id: 'booked', pet_id: petId, appointment_id: appointmentId, category: 'checkup', service_name: 'Wellness check', source: 'appointment', status: 'waiting', arrived_at: now.toISOString(), veterinarian_id: userId }
        raw.queue_entries.push(entry); raw.appointments[0].status = 'arrived'
      } else if (action === 'create_queued_encounter') {
        const visitId = 'patient-checkup'
        raw.visits.push({ id: visitId, pet_id: payload.petId, visit_type: payload.type, chief_complaint: payload.complaint, visited_at: payload.encounteredAt, attending_veterinarian_id: payload.veterinarianId, finalized_at: null })
        raw.visit_vitals.push({ id: 'patient-vitals', visit_id: visitId, measured_at: payload.encounteredAt, weight_kg: payload.weightKg, hydration: payload.hydration, body_condition_score: Number(payload.bodyConditionScore), body_condition_scale: 5 })
        entry = { id: 'patient-ticket', pet_id: payload.petId, category: 'checkup', service_name: payload.type, source: 'patient_record', visit_id: visitId, status: 'waiting', arrived_at: now.toISOString(), veterinarian_id: payload.veterinarianId, notes: payload.complaint }
        raw.queue_entries.push(entry)
      } else if (action === 'update_encounter') {
        const visit = raw.visits.find((row) => row.id === payload.id)
        assert.ok(visit, 'Edited checkup did not exist')
        visit.chief_complaint = payload.complaint
        raw.visit_vitals.find((row) => row.visit_id === visit.id).weight_kg = payload.weightKg
        if (payload.bodyConditionMode === 'replace') Object.assign(raw.visit_vitals.find((row) => row.visit_id === visit.id), { body_condition_score: Number(payload.bodyConditionScore), body_condition_scale: 5 })
        return reply({ id: visit.id })
      } else if (action === 'create_queued_vaccination') {
        const vaccinationId = `patient-vaccine-${raw.vaccinations.length}`
        raw.vaccinations.push({ id: vaccinationId, pet_id: payload.petId, vaccine_name: payload.inventoryItemId, inventory_item_id: payload.inventoryItemId, brand: 'Clinic Brand', dose: payload.dose, administered_at: payload.administeredAt, next_due_at: payload.nextDueAt, administered_by: payload.veterinarianId })
        entry = { id: `vaccine-ticket-${raw.queue_entries.length}`, pet_id: payload.petId, category: 'vaccination', service_name: 'Vaccination', source: 'patient_record', vaccination_id: vaccinationId, status: 'waiting', arrived_at: now.toISOString(), veterinarian_id: payload.veterinarianId }
        raw.queue_entries.push(entry)
      } else if (action === 'start_queue_entry') {
        entry.status = 'in_progress'; entry.veterinarian_id = payload.veterinarianId
        if (entry.appointment_id) raw.appointments[0].status = 'in_progress'
      } else if (action === 'save_queue_draft') {
        if (!draftFailedOnce) { draftFailedOnce = true; return reply({ message: 'Draft save interrupted. Please retry.', code: 'P0001' }, 400) }
        entry.care_draft = payload.record; entry.draft_version = (entry.draft_version || 0) + 1; entry.draft_saved_at = now.toISOString(); entry.draft_saved_by = userId
      } else if (action === 'complete_queue_entry') {
        if (!failedOnce) { failedOnce = true; return reply({ message: 'Save interrupted. Please retry.', code: 'P0001' }, 400) }
        assert.equal(payload.record.petId, petId)
        assert.equal(payload.record.veterinarianId, userId)
        if (entry.visit_id) {
          const visit = raw.visits.find((row) => row.id === entry.visit_id)
          visit.chief_complaint = payload.record.complaint
          raw.visit_vitals.find((row) => row.visit_id === visit.id).weight_kg = payload.record.weightKg
        }
        if (entry.vaccination_id) {
          const vaccine = raw.vaccinations.find((row) => row.id === entry.vaccination_id)
          Object.assign(vaccine, { vaccine_name: payload.record.inventoryItemId, inventory_item_id: payload.record.inventoryItemId, brand: 'Clinic Brand', dose: payload.record.dose, administered_at: payload.record.administeredAt, next_due_at: payload.record.nextDueAt })
        }
        entry.service_notes = payload.record.serviceNotes || ''; entry.status = 'completed'; entry.finished_at = now.toISOString()
        entry.care_draft = {}; entry.draft_saved_at = null; entry.draft_saved_by = null; entry.draft_version = (entry.draft_version || 0) + 1
        if (entry.appointment_id) raw.appointments[0].status = 'completed'
      } else if (action === 'create_service' || action === 'update_service') {
        const service = action === 'create_service' ? { id: 'new-service', is_active: true } : raw.service_types.find((service) => service.id === payload.id)
        Object.assign(service, { name: payload.name, default_duration_minutes: Number(payload.duration), workflow: payload.workflow, is_active: payload.isActive !== 'false' })
        if (action === 'create_service') raw.service_types.push(service)
        return reply({ id: service.id })
      } else if (action === 'create_pet' || action === 'update_pet') {
        const pet = action === 'create_pet' ? { id: 'registered-pet', status: 'Active', record_number: 'VET-2026-00002' } : raw.pets.find((pet) => pet.id === payload.id)
        Object.assign(pet, { name: payload.name, owner_id: payload.ownerId, sex: payload.sex, species: payload.species, breed: payload.breed, reproductive_status: payload.reproductiveStatus, diet: payload.diet })
        if (payload.birthMode === 'age') { pet.birth_date = '2024-07-17'; pet.birth_date_estimated = true }
        else if (payload.birthMode === 'date') { pet.birth_date = payload.birthDate; pet.birth_date_estimated = false }
        if (action === 'create_pet') raw.pets.push(pet)
        return reply({ id: pet.id })
      } else if (action === 'cancel_queue_entry') { entry.status = 'cancelled'; entry.finished_at = now.toISOString() }
      else throw new Error(`Unexpected mutation: ${action}`)
      if (['add_queue_entry', 'check_in_appointment', 'create_queued_encounter', 'create_queued_vaccination'].includes(action)) { entry.queue_number = ++nextQueueNumber; entry.queue_date = '2026-10-17' }
      if (action === 'create_queued_encounter') return reply({ id: entry.visit_id, queueEntryId: entry.id, queueNumber: entry.queue_number, queueDate: entry.queue_date })
      if (action === 'create_queued_vaccination') return reply({ id: entry.vaccination_id, queueEntryId: entry.id, queueNumber: entry.queue_number, queueDate: entry.queue_date })
      return reply({ id: entry.id })
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1)
      if (table === 'queue_entries') queueReads++
      return reply(raw[table] || [])
    }
    throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`)
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install({ time: now })
  await page.goto(origin + '/dashboard')
  await page.getByRole('link', { name: /In-site queue/ }).click()
  await expect(page.getByRole('heading', { name: 'In-site queue', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add walk-in' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)), 'Dialog lost keyboard focus')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add walk-in' })).toBeFocused()
  await page.getByRole('button', { name: 'Add walk-in' }).click()
  await page.getByLabel('Patient', { exact: true }).selectOption(petId)
  await page.getByLabel('Service', { exact: true }).selectOption('vaccination')
  await page.getByLabel('Arrival notes').fill('Here for vaccination')
  await page.getByRole('button', { name: 'Add to queue' }).click()
  await expect(page.locator('.queue-card')).toHaveCount(1)
  await expect(page.locator('.queue-ticket')).toContainText('Q-001')
  await expect(page.locator('.queue-ticket')).toContainText('2026-10-17')
  // The native patient link covers the card; action buttons remain separate.
  const careBounds = await page.locator('.queue-care').boundingBox()
  assert.ok(careBounds, 'Queue card was not visible')
  await page.mouse.click(careBounds.x + careBounds.width / 2, careBounds.y + careBounds.height / 2)
  await expect(page).toHaveURL(origin + `/patients/${petId}`)
  await page.goto(origin + '/queue')
  await page.getByRole('link', { name: 'View patient details for Mochi (Q-001)', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(origin + `/patients/${petId}`)
  await page.goto(origin + '/queue')
  await page.getByRole('button', { name: 'Start care' }).click()
  await expect(page).toHaveURL(origin + '/queue')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('button', { name: 'Record vaccination' }).click()
  await page.getByLabel('Vaccine type', { exact: true }).selectOption('Rabies')
  await page.getByLabel('Date administered').fill('')
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Draft save interrupted')
  await expect(page.getByLabel('Vaccine type', { exact: true })).toHaveValue('Rabies')
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.queue_entries[0].status, 'in_progress')
  const draftSaves = calls.filter((call) => call.action === 'save_queue_draft')
  assert.equal(draftSaves[0].key, draftSaves[1].key, 'Draft retry did not reuse its key')
  assert.equal(calls.filter((call) => call.action === 'complete_queue_entry').length, 0)
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Resume vaccination', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Q-001')
  await expect(page.getByLabel('Vaccine type', { exact: true })).toHaveValue('Rabies')
  await expect(page.getByLabel('Date administered')).toHaveValue('')
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('Clinic Brand')
  // Simulate another staff member saving while this editor remains open.
  raw.queue_entries[0].care_draft = { ...raw.queue_entries[0].care_draft, dose: 'Another clinician’s draft' }
  raw.queue_entries[0].draft_version++
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('A newer draft was saved')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Resume vaccination', exact: true }).click()
  await expect(page.getByLabel('Dose', { exact: true })).toHaveValue('Another clinician’s draft')
  await page.getByLabel('Date administered').fill('2026-10-17')
  await page.getByLabel('Next due date').fill('2027-10-17')
  await page.getByRole('button', { name: 'Save vaccination' }).click()
  await expect(page.getByRole('alert')).toContainText('Save interrupted')
  await expect(page.getByLabel('Vaccine type', { exact: true })).toHaveValue('Rabies')
  assert.equal(raw.queue_entries[0].status, 'in_progress')
  await page.getByRole('button', { name: 'Save vaccination' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const saves = calls.filter((call) => call.action === 'complete_queue_entry')
  assert.equal(saves[0].key, saves[1].key, 'Failed save did not reuse its retry key')
  await page.getByLabel('Queue status').selectOption('completed')
  await expect(page.locator('.queue-card')).toHaveCount(1)
  await page.reload()
  await page.getByLabel('Queue status').selectOption('completed')
  await expect(page.locator('.queue-card')).toHaveCount(1)
  await page.getByLabel('Queue history date').fill('2026-10-16')
  await expect(page.locator('.queue-card')).toHaveCount(0)
  await page.getByLabel('Queue status').selectOption('Active')
  await page.getByRole('button', { name: 'Check in appointment' }).click()
  await page.getByLabel('Appointment', { exact: true }).selectOption(appointmentId)
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.locator('.queue-card')).toContainText('Booked appointment')
  await expect(page.locator('.queue-ticket')).toContainText('Q-002')
  await page.goto(origin + '/appointments')
  await expect(page.getByText('Queue Q-002 · 2026-10-17', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start care', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await page.getByLabel('Chief complaint').fill('Annual wellness examination')
  await page.getByLabel('Weight (kg)').fill('')
  await page.getByLabel('Time of care (Asia/Manila)').fill('')
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.appointments[0].status, 'in_progress')
  await page.reload()
  await page.getByRole('button', { name: 'Resume checkup', exact: true }).click()
  await expect(page.getByLabel('Chief complaint')).toHaveValue('Annual wellness examination')
  await expect(page.getByLabel('Time of care (Asia/Manila)')).toHaveValue('')
  await page.getByLabel('Time of care (Asia/Manila)').fill('2026-10-17T12:00')
  await page.getByLabel('Weight (kg)').fill('3')
  await page.getByRole('button', { name: 'Save clinical entry' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.appointments[0].status, 'completed')
  await page.goto(origin + '/queue')
  await page.getByRole('button', { name: 'Add walk-in' }).click()
  await page.getByLabel('Patient', { exact: true }).selectOption(petId)
  await page.getByRole('button', { name: 'Add to queue' }).click()
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Queue overflows at ${width}px`)
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByLabel('Queue status').selectOption('cancelled')
  await expect(page.locator('.queue-card')).toHaveCount(1)
  await expect(page.locator('.queue-card')).toContainText('Wellness check')
  await expect(page.locator('.queue-ticket')).toContainText('Q-003')
  assert.equal(raw.queue_entries.filter((entry) => ['waiting', 'in_progress'].includes(entry.status)).length, 0)
  const before = queueReads
  await page.clock.fastForward(30001)
  await expect.poll(() => queueReads).toBeGreaterThan(before)
  await page.goto(origin + `/patients/${petId}`)
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  for (const label of ['Up to date', 'Due today', 'Overdue', 'No next dose scheduled']) await expect(page.locator('.vaccine-row .badge').getByText(label, { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Vaccination history overflows on mobile')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await page.getByLabel('Chief complaint').fill('Patient-page checkup')
  await expect(page.getByLabel('Body condition (1–5)', { exact: true })).toHaveAttribute('max', '5')
  await page.getByLabel('Body condition (1–5)', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Save clinical entry', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Checkup saved in queue' })).toContainText('Q-004')
  await page.getByRole('button', { name: 'Clinical history', exact: true }).click()
  await expect(page.locator('.visit-card')).toHaveCount(1)
  await expect(page.locator('.visit-card .record-care-status')).toContainText('Q-004')
  await expect(page.locator('.visit-card .record-care-status .badge')).toHaveText('Waiting')
  await expect(page.getByRole('button', { name: 'Finalize checkup', exact: true })).toHaveCount(0)
  await page.locator('.visit-edit-trigger').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Edit checkup for Mochi' })).toBeVisible()
  await expect(page.getByLabel('Chief complaint')).toHaveValue('Patient-page checkup')
  await page.getByLabel('Chief complaint').fill('Updated waiting checkup')
  await page.getByRole('button', { name: 'Save clinical entry', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.queue_entries.at(-1).status, 'waiting', 'Editing waiting care changed queue status')
  await page.getByRole('link', { name: 'Open queued checkup', exact: true }).click()
  await expect(page.locator('.queue-card')).toHaveCount(1)
  await expect(page.locator('.queue-card')).toContainText('Patient checkup')
  await expect(page.locator('.queue-ticket')).toContainText('Q-004')
  await page.getByRole('button', { name: 'Start care', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.goto(origin + `/patients/${petId}`)
  await expect(page.locator('.visit-card .record-care-status .badge')).toHaveText('In progress')
  await page.locator('.visit-card .soap-grid').scrollIntoViewIfNeeded()
  const checkupBounds = await page.locator('.visit-card .soap-grid').boundingBox()
  assert.ok(checkupBounds, 'Checkup card was not visible')
  await page.mouse.click(checkupBounds.x + checkupBounds.width / 2, checkupBounds.y + checkupBounds.height / 2)
  await expect(page).toHaveURL(origin + `/patients/${petId}`)
  await expect(page.getByRole('dialog', { name: 'Edit checkup for Mochi' })).toBeVisible()
  await expect(page.getByLabel('Chief complaint')).toHaveValue('Updated waiting checkup')
  await page.getByLabel('Chief complaint').fill('Draft from patient history')
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.queue_entries.at(-1).status, 'in_progress')
  await page.getByRole('button', { name: 'Edit checkup', exact: true }).click()
  await expect(page.getByLabel('Chief complaint')).toHaveValue('Draft from patient history')
  await page.getByLabel('Chief complaint').fill('Completed patient-page checkup')
  await page.getByRole('button', { name: 'Save clinical entry', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.visits.length, 1, 'Queue completion created a second checkup')
  assert.equal(raw.queue_entries.at(-1).status, 'completed')
  await page.goto(origin + `/patients/${petId}`)
  await expect(page.locator('.visit-card')).toHaveCount(1)
  await expect(page.locator('.visit-card')).toContainText('Completed patient-page checkup')
  await expect(page.locator('.visit-card .record-care-status .badge')).toHaveText('Completed')
  await expect(page.getByRole('button', { name: 'Finalize checkup', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Finalize checkup', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Finalize this checkup?' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  await page.getByRole('button', { name: 'Add vaccine', exact: true }).click()
  await page.getByLabel('Vaccine type', { exact: true }).selectOption('Patient-page vaccine')
  await page.getByLabel('Next due date').fill('2027-10-17')
  await page.getByRole('button', { name: 'Save vaccination', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Vaccination saved in queue' })).toContainText('Q-005')
  const patientVaccine = page.locator('.vaccine-row').filter({ hasText: 'Patient-page vaccine' })
  await expect(patientVaccine.locator('.record-care-status .badge')).toHaveText('Waiting')
  await patientVaccine.getByRole('link', { name: 'Open queued vaccination', exact: true }).click()
  await expect(page.locator('.queue-card')).toContainText('Patient vaccination')
  await expect(page.locator('.queue-ticket')).toContainText('Q-005')
  await page.getByRole('button', { name: 'Start care', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.goto(origin + `/patients/${petId}`)
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  await expect(patientVaccine.locator('.record-care-status .badge')).toHaveText('In progress')
  await patientVaccine.getByRole('link', { name: 'Open queued vaccination', exact: true }).click()
  await page.getByRole('button', { name: 'Record vaccination', exact: true }).click()
  await expect(page.getByLabel('Vaccine type', { exact: true })).toHaveValue('Patient-page vaccine')
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('Clinic Brand')
  await page.getByLabel('Dose', { exact: true }).fill('Updated dose')
  await page.getByRole('button', { name: 'Save vaccination', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.vaccinations.length, 5, 'Queue completion created a second vaccine')
  await page.goto(origin + `/patients/${petId}`)
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  await expect(patientVaccine.locator('.record-care-status .badge')).toHaveText('Completed')
  await expect(patientVaccine).toContainText('Updated dose')
  await expect(patientVaccine.getByText('Up to date', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add vaccine', exact: true }).click()
  await page.getByLabel('Vaccine type', { exact: true }).selectOption('Cancelled queued vaccine')
  await page.getByRole('button', { name: 'Save vaccination', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: 'Open queued vaccination', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.goto(origin + `/patients/${petId}`)
  await page.getByRole('button', { name: 'Vaccinations', exact: true }).click()
  await expect(page.locator('.vaccine-row').filter({ hasText: 'Cancelled queued vaccine' }).locator('.record-care-status .badge')).toHaveText('Cancelled')
  await page.setViewportSize({ width: 320, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Vaccine care statuses overflow on mobile')
  raw.visits[0].finalized_at = now.toISOString()
  await page.goto(origin + `/patients/${petId}`)
  await expect(page.locator('.visit-card')).toContainText('Finalized')
  await expect(page.locator('.visit-edit-trigger')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit checkup', exact: true })).toHaveCount(0)

  // Historical scores remain on their original scale until staff replace them.
  raw.visits[0].finalized_at = null
  Object.assign(raw.visit_vitals[0], { body_condition_score: 7, body_condition_scale: 9 })
  await page.reload()
  await expect(page.locator('.visit-card')).toContainText('BCS 7/9')
  await page.getByRole('button', { name: 'Edit checkup', exact: true }).click()
  await expect(page.getByText('Previously recorded: 7/9')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Replace with a new 1–5 assessment' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Replace with a new 1–5 assessment' }).check()
  await page.getByLabel('Body condition (1–5)', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'Save clinical entry', exact: true }).click()
  await expect(page.locator('.visit-card')).toContainText('BCS 3/5')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(origin + '/queue')
  await page.getByRole('button', { name: 'Add walk-in' }).click()
  await page.getByLabel('Patient', { exact: true }).selectOption(petId)
  await page.getByLabel('Service', { exact: true }).selectOption('surgery')
  await page.getByRole('button', { name: 'Add to queue' }).click()
  await page.getByRole('button', { name: 'Start care', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await expect(page.getByLabel('Visit type')).toHaveValue('Surgery')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.goto(origin + '/queue')
  await page.getByRole('button', { name: 'Add walk-in' }).click()
  await page.getByLabel('Patient', { exact: true }).selectOption(petId)
  await page.getByLabel('Service', { exact: true }).selectOption('grooming')
  await page.getByRole('button', { name: 'Add to queue' }).click()
  await page.getByLabel('Queue service').selectOption('service:grooming')
  await expect(page.locator('.queue-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Start care', exact: true }).click()
  await expect(page.getByLabel('Assigned staff')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('button', { name: 'Record Grooming', exact: true }).click()
  await expect(page.getByLabel('Weight (kg)')).toHaveCount(0)
  await page.getByLabel('Work performed / service notes').fill('Bath and nail trim')
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Resume Grooming', exact: true }).click()
  await expect(page.getByLabel('Work performed / service notes')).toHaveValue('Bath and nail trim')
  await page.getByRole('button', { name: 'Complete service', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(origin + `/patients/${petId}`)
  await page.getByRole('button', { name: 'Service history', exact: true }).click()
  await expect(page.getByText('Bath and nail trim', { exact: true })).toBeVisible()

  await page.goto(origin + '/settings')
  await expect(page.getByRole('button', { name: 'Services', exact: true })).toHaveCount(0)
  profile.role = 'owner'
  await page.reload()
  await page.getByRole('button', { name: 'Services', exact: true }).click()
  await page.getByRole('button', { name: 'Add service', exact: true }).click()
  await page.getByLabel('Service name').fill('Coat maintenance')
  await page.getByLabel('Default duration (minutes)').fill('45')
  await page.getByLabel('Workflow', { exact: true }).selectOption('maintenance')
  await page.getByRole('button', { name: 'Save service', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const serviceCard = page.locator('.directory-card').filter({ hasText: 'Coat maintenance' })
  await expect(serviceCard).toContainText('45 minutes')
  await serviceCard.getByRole('button', { name: 'Edit service', exact: true }).click()
  await page.getByLabel('Status', { exact: true }).selectOption('false')
  await page.getByRole('button', { name: 'Save service', exact: true }).click()
  await expect(serviceCard).toContainText('Archived')
  await page.locator('.directory-card').filter({ hasText: 'Grooming' }).getByRole('button', { name: 'Edit service', exact: true }).click()
  await expect(page.getByLabel('Workflow', { exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 375, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Service settings overflow on mobile')

  await page.goto(origin + '/patients')
  await page.getByRole('button', { name: 'Register pet', exact: true }).click()
  await page.getByLabel('Pet name').fill('New age-entry patient')
  await page.getByLabel('Breed', { exact: true }).fill('Mixed')
  await expect(page.getByLabel('Sex', { exact: true })).toHaveValue('')
  await page.getByRole('dialog').getByRole('button', { name: 'Register patient', exact: true }).click()
  assert.equal(calls.filter((call) => call.action === 'create_pet').length, 0, 'Registration accepted missing sex')
  await page.getByLabel('Sex', { exact: true }).selectOption('Female')
  await page.getByLabel('Birth information', { exact: true }).selectOption('age')
  await page.getByLabel('Age in years').fill('2')
  await page.getByLabel('Additional months').fill('3')
  await expect(page.getByRole('status').filter({ hasText: 'Estimated birth date:' })).toContainText('2024-07-17')
  await page.getByLabel('Diet / feeding notes').fill('Wet food twice daily')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Age registration overflows on mobile')
  await page.getByRole('button', { name: 'Register patient', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const savedPatient = calls.find((call) => call.action === 'create_pet').payload
  assert.equal(savedPatient.sex, 'Female')
  assert.equal(savedPatient.birthMode, 'age')
  assert.equal(savedPatient.ageYears, '2')
  assert.equal(savedPatient.ageMonths, '3')
  await page.goto(origin + '/patients/registered-pet')
  await expect(page.getByText('Wet food twice daily', { exact: true })).toBeVisible()
  await expect(page.getByText('17 Jul 2024 (estimated)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit patient', exact: true }).click()
  await expect(page.getByLabel('Birth information')).toHaveValue('preserve')
  await page.getByLabel('Diet / feeding notes').fill('Updated diet')
  await page.getByRole('button', { name: 'Save patient', exact: true }).click()
  await expect(page.getByText('17 Jul 2024 (estimated)', { exact: true })).toBeVisible()

  assert.deepEqual(errors, [])
  console.log('PASS clinical forms, inventory brands, required sex, age/diet, owner services, maintenance drafts/completion, queue workflows, keyboard and mobile layouts (intercepted API)')
} finally {
  await browser?.close()
  server.kill()
}
