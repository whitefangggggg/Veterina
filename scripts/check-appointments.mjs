// Intercepted UI contracts only; this suite never changes clinic data.
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const pet = '20000000-0000-4000-8000-000000000001'
const owner = '30000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, full_name: 'Test clinician', role: 'owner', is_active: true }],
  clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Veterina' }],
  pets: [{ id: pet, owner_id: owner, name: 'Chip', record_number: 'VET-TEST-01', species: 'Dog', breed: 'Aspin', status: 'Active', sex: 'Male' },
    { id: 'other-pet', owner_id: owner, name: 'Other patient', status: 'Active', species: 'Cat' }],
  owners: [{ id: owner, full_name: 'Test owner', phone: '09171234567', is_active: true }],
  service_types: [{ id: 'surgery', name: 'Surgery', workflow: 'checkup', default_duration_minutes: 30, is_active: true }, { id: 'followup-service', name: 'Follow-up', workflow: 'checkup', default_duration_minutes: 30, is_active: true }],
  appointments: [{ id: 'booking', pet_id: pet, service_type_id: 'surgery', veterinarian_id: actor, status: 'confirmed', notes: 'Fasting instructions reviewed', starts_at: '2026-10-26T01:30:00Z', ends_at: '2026-10-26T02:00:00Z' }],
  visits: [{ id: 'checkup', pet_id: pet, attending_veterinarian_id: actor, visit_type: 'Procedure', visited_at: '2026-10-24T04:00:00Z', chief_complaint: 'Wound review', diagnosis_summary: 'Healing well', plan: 'Review incision', follow_up_date: '2026-10-27' }],
  visit_vitals: [{ id: 'vitals', visit_id: 'checkup', measured_at: '2026-10-24T04:00:00Z', weight_kg: 10 }],
  queue_entries: [],
}
const errors = [], writes = []
let failArrival = true
let failFollowUp = true
const app = await browserServer(5188)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const session = { access_token: mockAccessToken(actor), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, aud: 'authenticated', role: 'authenticated', email: 'appointments@veterina-test.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const reply = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = route.request().postDataJSON()
      writes.push({ action, payload, key })
      if (action === 'update_encounter') Object.assign(raw.visits[0], { follow_up_date: payload.followUpDate, plan: payload.plan })
      else if (action === 'reschedule_appointment') Object.assign(raw.appointments[0], { notes: payload.notes })
      else if (action === 'check_in_appointment') {
        if (failArrival) { failArrival = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Arrival interrupted. Retry.', code: 'P0001' }) }) }
        assert.equal(payload.appointmentId, 'booking')
        raw.appointments[0].status = 'arrived'
        raw.queue_entries.push({ id: 'booked-arrival', pet_id: pet, appointment_id: 'booking', category: 'checkup', service_name: 'Surgery', service_type_id: 'surgery', status: 'waiting', veterinarian_id: actor, queue_number: 1, queue_date: '2026-10-26', arrived_at: '2026-10-26T04:00:00Z' })
      } else if (action === 'reschedule_follow_up') {
        assert.equal(payload.visitId, 'checkup')
        Object.assign(raw.visits[0], { follow_up_scheduled_date: payload.date })
      } else if (action === 'arrive_follow_up') {
        assert.equal(payload.petId, pet)
        assert.equal(payload.serviceId, 'followup-service')
        assert.equal(payload.expectedDate, '2026-10-26')
        if (failFollowUp) { failFollowUp = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Follow-up interrupted. Retry.', code: 'P0001' }) }) }
        Object.assign(raw.visits[0], { follow_up_arrived_at: '2026-10-26T04:10:00Z', follow_up_visit_id: 'new-followup-checkup', follow_up_queue_id: 'followup-arrival' })
        raw.visits.push({ id: 'new-followup-checkup', pet_id: pet, visit_type: 'Follow-up', chief_complaint: payload.complaint, attending_veterinarian_id: actor, visited_at: '2026-10-26T04:10:00Z' })
        raw.visit_vitals.push({ id: 'new-vitals', visit_id: 'new-followup-checkup', weight_kg: Number(payload.weightKg), measured_at: '2026-10-26T04:10:00Z' })
        raw.queue_entries.push({ id: 'followup-arrival', pet_id: pet, visit_id: 'new-followup-checkup', category: 'checkup', service_name: 'Follow-up', service_type_id: payload.serviceId, status: 'waiting', veterinarian_id: actor, notes: payload.notes, queue_number: 2, queue_date: '2026-10-26', arrived_at: '2026-10-26T04:10:00Z' })
        return reply({ id: 'new-followup-checkup', queueEntryId: 'followup-arrival', queueNumber: 2, queueDate: '2026-10-26' })
      } else throw new Error(`Unexpected schedule mutation ${action}`)
      return reply({ id: payload.id })
    }
    assert.equal(route.request().method(), 'GET')
    return reply(url.pathname === '/auth/v1/user' ? session.user : raw[url.pathname.split('/').at(-1)] || [])
  })
  const page = await context.newPage()
  await mkdir('test-artifacts.local', { recursive: true })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-10-25T04:00:00Z') })
  const calendar = (date) => app.origin + '/appointments?date=' + date
  await page.goto(calendar('2026-10-26'))
  const booking = page.locator('#appointment-booking')
  await booking.getByRole('button', { name: 'Reschedule', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Reschedule appointment', exact: true })).toBeVisible()
  assert.equal(new URL(page.url()).pathname, '/appointments')
  await page.keyboard.press('Escape')
  for (const label of ['Cancel', 'No show', 'Delete appointment']) {
    await booking.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    assert.equal(new URL(page.url()).pathname, '/appointments')
    await page.keyboard.press('Escape')
  }
  // The service text is covered by the same native link as the rest of the card.
  const service = await booking.locator('h3').boundingBox()
  await page.mouse.click(service.x + 10, service.y + service.height / 2)
  const selected = page.locator('#patient-appointment-booking')
  await expect(selected).toBeFocused()
  for (const text of ['Surgery', '26 October 2026, 9:30 AM', 'Test clinician', 'Confirmed', 'Fasting instructions reviewed']) await expect(selected).toContainText(text)
  await expect(selected.getByRole('button', { name: 'Patient arrived', exact: true })).toBeDisabled()
  await selected.getByRole('button', { name: 'Edit appointment', exact: true }).click()
  await page.getByLabel('Notes', { exact: true }).fill('Updated appointment notes')
  await page.getByRole('button', { name: 'Save appointment', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(selected).toContainText('Updated appointment notes')
  await page.locator('.patient-schedule').screenshot({ path: 'test-artifacts.local/patient-schedule-desktop.png' })
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Populated patient schedule overflows at ${width}`)
  }
  await page.locator('.patient-schedule').screenshot({ path: 'test-artifacts.local/patient-schedule-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await expect(selected).toBeFocused()
  await selected.getByRole('link', { name: 'Open in Appointments', exact: true }).click()
  await expect(booking).toBeFocused()
  await booking.getByRole('link', { name: 'Chip', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(selected).toBeFocused()
  await page.goto(app.origin + '/patients/other-pet?appointmentId=booking#patient-appointment-booking')
  await expect(page.getByRole('status').filter({ hasText: 'no longer available' })).toBeVisible()
  await expect(page.locator('#patient-appointment-booking')).toHaveCount(0)

  await page.goto(calendar('2026-10-27'))
  const followUp = page.locator('#follow-up-checkup')
  await expect(followUp).toContainText('Time not set')
  await expect(followUp).toContainText('Procedure follow-up')
  await expect(followUp.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'The day is open', exact: true })).toHaveCount(0)
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Follow-up calendar overflows at ${width}`)
  }
  await followUp.getByRole('link').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#checkup')).toBeFocused()
  await page.locator('.patient-schedule').getByRole('button', { name: 'Edit follow-up', exact: true }).click()
  await page.getByLabel('Follow-up date', { exact: true }).fill('2026-10-28')
  await page.getByRole('button', { name: 'Save clinical entry', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.patient-schedule').getByRole('link', { name: 'Open in Appointments', exact: true }).last().click()
  await expect(followUp).toBeFocused()
  assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-28')
  await page.reload()
  await expect(followUp).toHaveCount(1)
  await page.goto(calendar('2026-10-27'))
  await expect(followUp).toHaveCount(0)
  await page.goto(calendar('2026-10-28'))
  await followUp.getByRole('link').click()
  await page.getByRole('button', { name: 'Edit checkup', exact: true }).click()
  await page.getByLabel('Follow-up date', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Save clinical entry', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(calendar('2026-10-28'))
  await expect(followUp).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'The day is open', exact: true })).toBeVisible()
  await page.goto(calendar('2026-10-26'))
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await booking.getByRole('button', { name: 'Reschedule', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await booking.getByRole('link', { name: 'Chip', exact: true }).click()
    await expect(selected).toBeFocused()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Patient appointment details overflow at ${width}`)
    await selected.getByRole('link', { name: 'Open in Appointments', exact: true }).click()
  }
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/appointment-patient-card-mobile.png', fullPage: true })
  assert.equal(writes.filter((write) => write.action === 'update_encounter').length, 2)
  // Appointment check-in uses its existing authenticated mutation and retry key.
  await page.clock.fastForward(86400000)
  await page.goto(app.origin + `/patients/${pet}?appointmentId=booking#patient-appointment-booking`)
  await selected.getByRole('button', { name: 'Patient arrived', exact: true }).click()
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Arrival interrupted')
  await expect(page.getByLabel('Appointment', { exact: true })).toHaveValue('booking')
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(selected).toContainText('Arrived')
  await expect(selected.getByRole('link', { name: /Open queue/ })).toBeVisible()
  await expect(selected.getByRole('button', { name: 'Patient arrived', exact: true })).toHaveCount(0)
  const checkins = writes.filter((write) => write.action === 'check_in_appointment')
  assert.equal(checkins.length, 2)
  assert.equal(checkins[0].key, checkins[1].key)
  assert.equal(raw.queue_entries.length, 1)
  // Wrong-day follow-ups warn without writing, and can be rescheduled even
  // when their source clinical record is finalized.
  raw.queue_entries[0].status = 'completed'
  raw.appointments[0].status = 'completed'
  raw.visits[0].follow_up_date = '2026-10-28'
  raw.visits[0].finalized_at = '2026-10-26T04:00:00Z'
  await page.goto(app.origin + `/patients/${pet}`)
  await expect(page.getByRole('button', { name: 'Edit follow-up', exact: true })).toBeDisabled()
  const beforeWarning = writes.length
  await page.locator('.patient-schedule').getByRole('button', { name: 'Patient arrived', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'This follow-up is not scheduled for today', exact: true })).toBeVisible()
  await expect(page.getByLabel('Current weight (kg)', { exact: true })).toHaveCount(0)
  assert.equal(writes.length, beforeWarning)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(raw.queue_entries.length, 1)
  await page.locator('.patient-schedule').getByRole('button', { name: 'Reschedule', exact: true }).click()
  await expect(page.getByLabel('Follow-up date', { exact: true })).toHaveValue('2026-10-28')
  await page.keyboard.press('Escape')
  await page.locator('.patient-schedule').getByRole('button', { name: 'Patient arrived', exact: true }).click()
  await page.getByRole('button', { name: 'Reschedule to today', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.visits[0].follow_up_date, '2026-10-28')
  assert.equal(raw.visits[0].follow_up_scheduled_date, '2026-10-26')
  await page.reload()
  await page.locator('.patient-schedule').getByRole('button', { name: 'Patient arrived', exact: true }).click()
  await expect(page.getByLabel('Service', { exact: true })).toHaveValue('followup-service')
  await expect(page.getByLabel('Assigned veterinarian / staff', { exact: true })).toHaveValue(actor)
  await page.getByLabel('Arrival notes', { exact: true }).fill('Patient arrived for wound review')
  await expect(page.getByLabel('Current weight (kg)', { exact: true })).toHaveValue('')
  await page.getByLabel('Current weight (kg)', { exact: true }).fill('10.25')
  await page.getByLabel('Chief complaint', { exact: true }).fill('Wound review today')
  await page.getByRole('button', { name: 'Create checkup & add to queue', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Follow-up interrupted')
  await expect(page.getByLabel('Current weight (kg)', { exact: true })).toHaveValue('10.25')
  await page.getByRole('button', { name: 'Create checkup & add to queue', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Follow-up checkup saved in queue' })).toBeVisible()
  await expect(page.locator('#new-followup-checkup')).toContainText('Wound review today')
  await expect(page.locator('#new-followup-checkup')).toContainText('Waiting')
  await expect(page.locator('#new-followup-checkup')).toContainText('10.25 kg')
  const arrivals = writes.filter((write) => write.action === 'arrive_follow_up')
  assert.equal(arrivals.length, 2)
  assert.equal(arrivals[0].key, arrivals[1].key)
  await page.reload()
  await expect(page.locator('.patient-schedule').getByRole('button', { name: 'Patient arrived', exact: true })).toHaveCount(0)
  assert.equal(raw.queue_entries.length, 2)
  assert.equal(raw.visits[0].follow_up_date, '2026-10-28')
  assert.equal(raw.visits.length, 2)
  await expect(page.locator('#new-followup-checkup')).toContainText('Waiting')
  assert.deepEqual(errors, [])
  console.log('PASS appointment editing/check-in, wrong-day follow-up warnings/rescheduling, new clinical record with queue/weight, retry/reload without duplicates, finalized source preservation, and mobile layouts')
} finally { await app.close() }
