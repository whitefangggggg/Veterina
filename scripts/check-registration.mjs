// Stateful browser contracts. Postgres and provider checks run separately.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const firstOwner = '20000000-0000-4000-8000-000000000001'
const secondOwner = '20000000-0000-4000-8000-000000000002'
const raw = {
  profiles: [{ id: actor, full_name: 'Registration clinician', role: 'owner', is_active: true }],
  clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Test clinic' }],
  owners: [
    { id: firstOwner, full_name: 'Rivera household', phone: '09171234567', email: 'one@example.org', address: 'Test address', is_active: true },
    { id: secondOwner, full_name: 'Rivera household', phone: '09171234568', email: 'two@example.org', address: 'Other address', is_active: true },
  ],
  pets: [{ id: 'existing-pet', owner_id: firstOwner, name: 'Existing pet', record_number: 'VET-00001', species: 'Cat', breed: 'Mixed', sex: 'Female', status: 'Active' }],
  service_types: [{ id: 'checkup', name: 'Wellness check', workflow: 'checkup', is_active: true, default_duration_minutes: 30 }],
  queue_entries: [],
}
const calls = [], errors = [], photoReads = []
let uploadFailures = 1, uploads = 0, png
const app = await browserServer(5185)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const session = { access_token: mockAccessToken(actor), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, aud: 'authenticated', role: 'authenticated', email: 'registration@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.addInitScript(() => {
    window.cameraDenied = false; window.cameraStops = 0
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.cameraDenied) throw new DOMException('Denied', 'NotAllowedError')
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120
      const draw = () => { canvas.getContext('2d').fillStyle = '#438876'; canvas.getContext('2d').fillRect(0, 0, 160, 120) }
      draw()
      const stream = canvas.captureStream(10)
      const timer = setInterval(draw, 100)
      stream.getTracks().forEach((track) => { const stop = track.stop.bind(track); track.stop = () => { window.cameraStops++; clearInterval(timer); stop() } })
      return stream
    }
  })
  await context.route(`${api.origin}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname === '/auth/v1/token') return reply(session)
    if (url.pathname === '/functions/v1/pet-photo') {
      if (request.headers()['content-type']?.startsWith('multipart/form-data')) {
        uploads++
        if (uploadFailures-- > 0) return reply({ error: 'PHOTO_PROVIDER_FAILED' }, 400)
        const petId = request.postDataBuffer().toString('latin1').match(/name="petId"\r\n\r\n([^\r]+)/)[1]
        const pet = raw.pets.find((entry) => entry.id === petId)
        pet.has_photo = true; pet.photo_revision = (pet.photo_revision || 0) + 1
        return reply({ revision: pet.photo_revision })
      }
      const input = request.postDataJSON()
      if (input.action === 'capabilities') return reply({ enabled: true })
      if (input.action === 'read') {
        photoReads.push(input.petId)
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'Cache-Control': 'no-store', 'X-Pet-Photo-Type': 'image/png', 'Access-Control-Expose-Headers': 'X-Pet-Photo-Type' }, body: png })
      }
      const pet = raw.pets.find((entry) => entry.id === input.petId)
      pet.has_photo = false; pet.photo_revision++
      return reply({ revision: pet.photo_revision })
    }
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = request.postDataJSON()
      calls.push({ action, payload, key })
      if (action === 'create_owner') { const id = crypto.randomUUID(); raw.owners.push({ id, full_name: payload.fullName, phone: payload.phone, address: payload.address, is_active: true }); return reply({ id }) }
      if (action === 'create_pet') { const id = crypto.randomUUID(); raw.pets.push({ id, owner_id: payload.ownerId, name: payload.name, species: payload.species, breed: payload.breed, sex: payload.sex, reproductive_status: payload.reproductiveStatus, record_number: 'VET-NEW', status: 'Active', has_photo: false, photo_revision: 0 }); return reply({ id }) }
      if (action === 'update_pet') { Object.assign(raw.pets.find((entry) => entry.id === payload.id), { name: payload.name }); return reply({ id: payload.id }) }
      if (action === 'add_queue_entry') { const id = crypto.randomUUID(); raw.queue_entries.push({ id, pet_id: payload.petId, service_name: 'Wellness check', category: 'checkup', source: 'walk_in', status: 'waiting', arrived_at: new Date().toISOString(), queue_number: raw.queue_entries.length + 1, queue_date: '2026-10-25', veterinarian_id: actor, notes: payload.notes }); return reply({ id }) }
      throw new Error(`Unexpected mutation ${action}`)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(app.origin + '/patients')
  png = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10; return canvas.toDataURL('image/png').split(',')[1] }), 'base64')
  await page.getByRole('button', { name: 'Register pet', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const owner = dialog.getByRole('combobox', { name: 'Owner', exact: true })
  await expect(owner).toHaveValue('')
  await owner.fill('Rivera')
  await expect(dialog.getByRole('option', { name: /^Rivera household/ })).toHaveCount(2)
  await owner.fill('two@example.org')
  await owner.press('Enter')
  await dialog.getByLabel('Pet name', { exact: false }).fill('Photo patient')
  await dialog.getByLabel('Breed', { exact: true }).fill('Mixed')
  await dialog.getByLabel('Sex', { exact: true }).selectOption('Female')
  await expect(dialog.getByLabel('Upload pet photo')).toBeEnabled()
  await dialog.getByLabel('Upload pet photo').setInputFiles({ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<svg/>') })
  await expect(dialog.getByRole('alert')).toContainText('Choose a JPEG')
  await dialog.getByLabel('Upload pet photo').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5_000_001) })
  await expect(dialog.getByRole('alert')).toContainText('5 MB')
  await dialog.getByLabel('Upload pet photo').setInputFiles({ name: 'pet.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.getByAltText('Pet photo preview')).toBeVisible()
  await dialog.getByRole('button', { name: 'Register patient', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('photo service')
  assert.equal(calls.filter((call) => call.action === 'create_pet').length, 1)
  await dialog.getByRole('button', { name: 'Retry photo', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(calls.filter((call) => call.action === 'create_pet').length, 1)
  assert.equal(uploads, 2)
  const photoPet = raw.pets.find((entry) => entry.name === 'Photo patient')
  assert.equal(photoPet.owner_id, secondOwner)
  await expect(page.locator(`a[href="/patients/${photoPet.id}"] .pet-sticker img`)).toBeVisible()
  const initialReads = photoReads.filter((id) => id === photoPet.id).length
  assert.equal(initialReads, 1)
  await page.locator(`a[href="/patients/${photoPet.id}"]`).click()
  await expect(page.locator('.pet-sticker-large img')).toBeVisible()
  await page.getByRole('button', { name: 'Edit patient', exact: true }).click()
  await expect(dialog.getByAltText('Pet photo preview')).toBeVisible()
  assert.equal(photoReads.filter((id) => id === photoPet.id).length, initialReads, 'SPA navigation or editor opening downloaded the same photo again')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.goto(app.origin + '/patients/' + photoPet.id)
  await page.getByRole('button', { name: 'Edit patient', exact: true }).click()
  uploadFailures = 1
  await expect(dialog.getByLabel('Upload pet photo')).toBeEnabled()
  await dialog.getByLabel('Upload pet photo').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png })
  await dialog.getByRole('button', { name: 'Save patient', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('photo service')
  assert.equal(photoPet.has_photo, true, 'A failed replacement removed the saved photo')
  await dialog.getByRole('button', { name: 'Continue without photo', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(calls.filter((call) => call.action === 'create_pet').length, 1)
  await page.getByRole('button', { name: 'Edit patient', exact: true }).click()
  await page.evaluate(() => { window.cameraDenied = true })
  await dialog.getByRole('button', { name: 'Capture photo', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Camera access was denied')
  await page.evaluate(() => { window.cameraDenied = false })
  await dialog.getByRole('button', { name: 'Capture photo', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled()
  await expect.poll(() => dialog.locator('video').evaluate((video) => video.videoWidth)).toBeGreaterThan(0)
  await dialog.getByRole('button', { name: 'Take photo', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBeGreaterThan(0)
  await expect(dialog.getByRole('button', { name: 'Retake photo', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Retake photo', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Cancel camera', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel camera', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBeGreaterThan(1)
  await dialog.getByRole('button', { name: 'Save patient', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(photoPet.photo_revision, 2)
  await page.getByRole('button', { name: 'Edit patient', exact: true }).click()
  await expect(dialog.getByAltText('Pet photo preview')).toBeVisible()
  await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save patient', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(photoPet.has_photo, false)

  await page.goto(app.origin + '/queue')
  await page.getByRole('button', { name: 'Add walk-in', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Walk-in owner', exact: true }).fill('09171234567')
  await dialog.getByRole('option', { name: /^Rivera household/ }).click()
  await dialog.getByRole('button', { name: 'Continue to pet', exact: true }).click()
  await expect(dialog.getByLabel('Walk-in patient').locator('option')).toHaveCount(2)
  await dialog.getByLabel('Walk-in patient').selectOption('existing-pet')
  await dialog.getByRole('button', { name: 'Continue to arrival', exact: true }).click()
  await dialog.getByLabel('Arrival notes').fill('Existing household arrival')
  await dialog.getByRole('button', { name: 'Back to pet', exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue to arrival', exact: true }).click()
  await expect(dialog.getByLabel('Arrival notes')).toHaveValue('Existing household arrival')
  await dialog.getByRole('button', { name: 'Add to queue', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(calls.at(-1).payload.ownerId, firstOwner)

  await page.getByRole('button', { name: 'Add walk-in', exact: true }).click()
  await dialog.getByRole('button', { name: 'Register owner', exact: true }).click()
  await dialog.getByLabel('Full name', { exact: false }).fill('New walk-in owner')
  await dialog.getByLabel('Mobile number', { exact: false }).fill('09171234569')
  await dialog.getByLabel('Home address', { exact: false }).fill('New household address')
  await dialog.getByRole('button', { name: 'Save owner', exact: true }).click()
  await dialog.getByRole('button', { name: 'Register pet', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Owner', exact: true })).toHaveValue('New walk-in owner')
  await dialog.getByLabel('Pet name', { exact: false }).fill('New walk-in pet')
  await dialog.getByLabel('Breed', { exact: true }).fill('Mixed')
  await dialog.getByLabel('Sex', { exact: true }).selectOption('Male')
  await dialog.getByRole('button', { name: 'Register patient', exact: true }).click()
  await dialog.getByLabel('Arrival notes').fill('New household arrival')
  for (const width of [320, 375, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Walk-in overflows at ${width}px`) }
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/walkin-registration.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Add to queue', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(raw.queue_entries.length, 2)
  assert.equal(raw.pets.find((entry) => entry.name === 'New walk-in pet').owner_id, raw.owners.find((entry) => entry.full_name === 'New walk-in owner').id)
  for (let index = 0; index < 35; index++) raw.pets.push({ ...photoPet, id: `lazy-${index}`, name: `Lazy photo ${index}`, has_photo: true, photo_revision: 1 })
  await page.goto(app.origin + '/patients')
  await page.locator('a[href="/patients/lazy-0"]').scrollIntoViewIfNeeded()
  await expect(page.locator('a[href="/patients/lazy-0"] .pet-sticker img')).toBeVisible()
  assert.ok(!photoReads.includes('lazy-34'), 'Offscreen photos were eagerly downloaded')
  await page.locator('a[href="/patients/lazy-34"]').scrollIntoViewIfNeeded()
  await expect(page.locator('a[href="/patients/lazy-34"] .pet-sticker img')).toBeVisible()
  assert.equal(photoReads.filter((id) => id === 'lazy-34').length, 1)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  await page.getByLabel('Email address', { exact: true }).fill(session.user.email)
  await page.getByLabel('Password', { exact: true }).fill('mock-photo-session')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/patients$/)
  await page.locator('a[href="/patients/lazy-34"]').scrollIntoViewIfNeeded()
  await expect(page.locator('a[href="/patients/lazy-34"] .pet-sticker img')).toBeVisible()
  assert.equal(photoReads.filter((id) => id === 'lazy-34').length, 2, 'Signing back in reused photo bytes from the signed-out session')
  assert.deepEqual(errors, [])
  console.log('PASS registration, camera and walk-ins; one photo fetch across directory → profile → editor; lazy offscreen photos and revision invalidation')
} finally { await app.close() }
