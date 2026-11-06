// UI acceptance uses intercepted APIs; SQL/concurrency suites verify durable writes and isolation.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001', doctor = '10000000-0000-4000-8000-000000000002', petId = '20000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, full_name: 'Travel recorder', role: 'clinical_staff', job_title: 'Authorized staff', is_active: true }, { id: doctor, full_name: 'Dr. Máya', role: 'clinical_staff', job_title: 'Veterinarian', is_active: true, prc_license_number: '333444', ptr_number: 'PTR-TRAVEL' }],
  clinic_settings: [{ id: 'settings', clinic_name: 'Travel clinic', address: 'Clinic address', phone: '09171234567', timezone: 'Asia/Manila' }],
  owners: [{ id: 'owner', full_name: 'José & Ana', phone: '09171234567', is_active: true }],
  pets: [{ id: petId, owner_id: 'owner', name: 'Ming', record_number: 'VET-1', species: 'Cat', breed: 'Mixed', birth_date: '2020-01-01', birth_date_estimated: true, status: 'Active' }],
  vaccinations: [
    { id: 'valid', pet_id: petId, vaccine_name: 'Bakuna', brand: 'Saved brand', lot_number: 'LOT-1', dose: '1 ml', administered_at: '2026-10-01', next_due_at: '2027-10-01', administered_by: doctor, administered_by_name: 'Dr. Máya' },
    { id: 'expired', pet_id: petId, vaccine_name: 'Old rabies', brand: 'Old brand', administered_at: '2025-01-01', next_due_at: '2025-12-31' },
    { id: 'unknown', pet_id: petId, vaccine_name: 'Unknown validity', administered_at: '2026-10-01' },
    { id: 'pending', pet_id: petId, vaccine_name: 'Pending vaccine', administered_at: '2026-11-01', next_due_at: '2027-11-01' },
    { id: 'future', pet_id: petId, vaccine_name: 'Future vaccine', administered_at: '2030-01-01', next_due_at: '2031-01-01' },
  ],
  queue_entries: [{ id: 'pending-ticket', pet_id: petId, vaccination_id: 'pending', category: 'vaccination', status: 'waiting', arrived_at: '2026-11-01T00:00:00Z' }],
}
// Enough clinical history to exercise a multipage printed document.
for (let index = 0; index < 65; index++) raw.vaccinations.push({ id: `history-${index}`, pet_id: petId, vaccine_name: `Historical vaccination ${index}`, brand: 'Historical brand', lot_number: `H-${index}`, dose: 'Recorded dose', administered_at: '2024-01-01', next_due_at: '2025-01-01' })
const certificates = [], calls = [], receipts = new Map(), errors = []
let loseIssueAcknowledgement = true, loseVisibilityAcknowledgement = true, detailFailure = false, photoFailure = true, patientPhotoDataUrl = ''
const app = await browserServer(5194)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'travel@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => { if (window === window.top) localStorage.setItem(key, JSON.stringify(session)) }, { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  const handleApi = (route) => {
    const url = new URL(route.request().url())
    const reply = (value, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') {
      const input = route.request().postDataJSON()
      if (input.action === 'prepare_certificate') {
        if (photoFailure) return reply({ error: 'PHOTO_PROVIDER_FAILED' }, 400)
        return reply({ revision: raw.pets[0].photo_revision, photoDataUrl: patientPhotoDataUrl })
      }
      return reply({ enabled: false })
    }
    if (url.pathname === '/functions/v1/travel-certificate') {
      const { token } = route.request().postDataJSON()
      const row = certificates.find((entry) => entry.public_token === token && entry.is_public)
      return row ? reply({ reference_number: row.reference_number, status: row.status, void_reason: row.void_reason, snapshot: row.snapshot }) : reply({ error: 'NOT_AVAILABLE' }, 404)
    }
    if (url.pathname === '/rest/v1/profiles' && url.searchParams.has('id')) return reply(raw.profiles.filter((entry) => `eq.${entry.id}` === url.searchParams.get('id')))
    if (url.pathname === '/rest/v1/travel_certificates') {
      if (url.searchParams.has('id')) {
        if (detailFailure) return reply({ message: 'Certificate read interrupted' }, 400)
        return reply(certificates.find((entry) => `eq.${entry.id}` === url.searchParams.get('id')))
      }
      const search = (url.searchParams.get('search_text') || '').replace(/^ilike\.%|%$/g, '').toLowerCase()
      const records = certificates.filter((entry) => !search || [entry.reference_number, entry.pet_name, entry.owner_name].join(' ').toLowerCase().includes(search))
      return reply(records, 200, { 'content-range': records.length ? `0-${records.length - 1}/${records.length}` : '*/0' })
    }
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: data, p_key: key } = route.request().postDataJSON()
      calls.push({ action, data, key })
      if (receipts.has(key)) return reply(receipts.get(key))
      if (action === 'issue_travel_certificate') {
        const pet = raw.pets.find((entry) => entry.id === data.petId), owner = raw.owners.find((entry) => entry.id === pet.owner_id), issuer = raw.profiles.find((entry) => entry.id === data.issuerId), clinic = raw.clinic_settings[0]
        const row = { id: crypto.randomUUID(), reference_number: `TC-2026-${String(certificates.length + 1).padStart(6, '0')}`, status: 'issued', issued_on: '2026-11-06', issued_at: '2026-11-06T04:00:00Z', travel_date: data.travelDate,
          public_token: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''), is_public: Boolean(data.isPublic),
          pet_name: pet.name, owner_name: owner.full_name, issuer_name: issuer.full_name, destination: data.destination,
          snapshot: { issuedOn: '2026-11-06', pet: { name: pet.name, species: pet.species, breed: pet.breed, recordNumber: pet.record_number, birthDate: pet.birth_date, birthDateEstimated: pet.birth_date_estimated, photoDataUrl: patientPhotoDataUrl }, owner: { name: owner.full_name },
            clinic: { name: clinic.clinic_name, address: clinic.address, phone: clinic.phone, logoDataUrl: clinic.logo_data_url }, issuer: { name: issuer.full_name, title: issuer.job_title, prcLicenseNumber: issuer.prc_license_number, ptrNumber: issuer.ptr_number },
            journey: { date: data.travelDate, destination: data.destination }, rabiesVaccinationId: data.rabiesVaccinationId,
            vaccinations: raw.vaccinations.filter((entry) => !['pending', 'future'].includes(entry.id)).map((entry) => ({ id: entry.id, name: entry.vaccine_name, brand: entry.brand, lotNumber: entry.lot_number, dose: entry.dose, administeredOn: entry.administered_at, validThrough: entry.next_due_at, administeredBy: entry.administered_by_name })) } }
        certificates.push(row)
        const result = { id: row.id, referenceNumber: row.reference_number }; receipts.set(key, result)
        if (loseIssueAcknowledgement) { loseIssueAcknowledgement = false; return reply({ message: 'Issue acknowledgement interrupted. Please retry.' }, 500) }
        return reply(result)
      }
      if (action === 'void_travel_certificate') {
        const row = certificates.find((entry) => entry.id === data.id); row.status = 'void'; row.void_reason = data.reason
        const result = { id: row.id, referenceNumber: row.reference_number }; receipts.set(key, result); return reply(result)
      }
      if (action === 'set_travel_certificate_visibility') {
        const row = certificates.find((entry) => entry.id === data.id); row.is_public = data.isPublic
        const result = { id: row.id, isPublic: row.is_public }; receipts.set(key, result)
        if (loseVisibilityAcknowledgement) { loseVisibilityAcknowledgement = false; return reply({ message: 'Visibility acknowledgement interrupted' }, 500) }
        return reply(result)
      }
      throw new Error(`Unexpected mutation ${action}`)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  }
  await context.route(`${api.origin}/**`, handleApi)
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-11-06T04:00:00Z') })
  await page.goto(`${app.origin}/dashboard`)
  await expect(page.getByRole('link', { name: /Travel Certificates/ })).toBeVisible()
  await page.getByRole('link', { name: /Travel Certificates/ }).click()
  await page.getByRole('button', { name: 'Issue certificate', exact: true }).click()
  const petSearch = page.getByRole('combobox', { name: 'Pet for travel certificate' })
  await petSearch.fill('Ming')
  await petSearch.press('ArrowDown')
  await petSearch.press('Enter')
  await expect(petSearch).toHaveValue('Ming')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(certificates.length, 0, 'Cancelling issued a certificate')
  raw.clinic_settings[0].logo_data_url = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const brush = canvas.getContext('2d'); brush.fillStyle = '#39745e'; brush.fillRect(0, 0, 32, 32); return canvas.toDataURL('image/png') })
  patientPhotoDataUrl = raw.clinic_settings[0].logo_data_url
  raw.pets[0].has_photo = true; raw.pets[0].photo_revision = 1
  await page.goto(`${app.origin}/patients/${petId}`)
  await page.getByRole('link', { name: 'Travel certificate', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Travel Certificates', exact: true })).toBeVisible()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Retry patient photo' })).toBeVisible()
  photoFailure = false
  await dialog.getByRole('button', { name: 'Retry patient photo' }).click()
  await expect(dialog.getByRole('button', { name: 'Retry patient photo' })).toHaveCount(0)
  await expect(dialog.getByRole('combobox', { name: 'Pet for travel certificate' })).toHaveValue('Ming')
  await expect(dialog.getByLabel('Veterinarian', { exact: true })).toHaveValue(actor)
  await expect(dialog.getByLabel('Certificate visibility', { exact: true })).toHaveValue('private')
  await expect(dialog.getByLabel('Anti-Rabies vaccination record').locator('option', { hasText: 'Pending vaccine' })).toHaveCount(0)
  await expect(dialog.getByLabel('Anti-Rabies vaccination record').locator('option', { hasText: 'Future vaccine' })).toHaveCount(0)
  await dialog.getByLabel('Planned travel date').fill('2026-12-01')
  await dialog.getByLabel('Destination', { exact: true }).fill('Cebu <Port>')
  await dialog.getByLabel('Veterinarian', { exact: true }).selectOption(doctor)
  await dialog.getByLabel('Anti-Rabies vaccination record').selectOption('expired')
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('validity must cover')
  await expect(dialog.getByRole('button', { name: 'Issue certificate', exact: true })).toBeDisabled()
  await dialog.getByLabel('Anti-Rabies vaccination record').selectOption('unknown')
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('next-dose date')
  assert.equal(calls.length, 0)
  await dialog.getByLabel('Anti-Rabies vaccination record').selectOption('valid')
  await dialog.getByRole('checkbox', { name: /selected vaccination is Anti-Rabies/ }).check()
  await dialog.getByRole('checkbox', { name: /reviewed the pet’s records/ }).check()
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  const preview = dialog.frameLocator('iframe[title="Travel certificate preview"]')
  await expect(preview.locator('body')).toContainText('UNISSUED PREVIEW')
  await expect(preview.locator('body')).toContainText('Cebu <Port>')
  await expect(preview.getByAltText('Patient photo: Ming', { exact: true })).toBeVisible()
  await expect(preview.getByAltText('Patient photo: Ming', { exact: true })).toHaveAttribute('src', patientPhotoDataUrl)
  for (const width of [320, 375, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Travel certificate UI overflow at ${width}px`) }
  await mkdir('test-artifacts.local', { recursive: true })
  await dialog.screenshot({ path: 'test-artifacts.local/travel-certificate-form.png' })
  await dialog.getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('acknowledgement interrupted')
  await expect(dialog.getByLabel('Destination', { exact: true })).toHaveValue('Cebu <Port>')
  await dialog.getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Certificate TC-2026-000001')
  assert.equal(certificates.length, 1)
  assert.equal(calls[0].key, calls[1].key)
  await expect(dialog.getByRole('button', { name: 'Void certificate', exact: true })).toHaveCount(0)
  await expect(preview.locator('body')).toContainText('TC-2026-000001')
  await expect(preview.locator('body')).not.toContainText('UNISSUED PREVIEW')
  await expect(preview.locator('body')).toContainText('Veterinarian')
  await expect(preview.locator('body')).not.toContainText('Clinical staff')
  const verificationLink = await dialog.getByRole('link', { name: 'Open QR link' }).getAttribute('href')
  const qrDataUrl = await dialog.getByAltText('Scan to view this travel certificate', { exact: true }).getAttribute('src')
  const decoded = await page.evaluate(async (image) => {
    const { default: QrScanner } = await import('/node_modules/qr-scanner/qr-scanner.min.js')
    return (await QrScanner.scanImage(image, { returnDetailedScanResult: true })).data
  }, qrDataUrl)
  assert.equal(decoded, verificationLink)
  const publicContext = await app.browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: 'block' })
  await publicContext.route(`${api.origin}/**`, handleApi)
  const publicPage = await publicContext.newPage(); publicPage.on('pageerror', (error) => errors.push(error.message))
  await publicPage.goto(verificationLink)
  await expect(publicPage.getByRole('heading', { name: 'Certificate not available' })).toBeVisible()
  await expect(publicPage.getByText('Ming', { exact: true })).toHaveCount(0)
  await dialog.getByLabel('Certificate visibility', { exact: true }).selectOption('public')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Visibility acknowledgement interrupted')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  const sharingCalls = calls.filter((call) => call.action === 'set_travel_certificate_visibility')
  assert.equal(sharingCalls[0].key, sharingCalls[1].key)
  await expect(dialog.getByRole('status')).toContainText('Public viewing enabled.')
  await publicPage.reload()
  const publicDocument = publicPage.frameLocator('iframe[title="Public travel certificate"]')
  await expect(publicDocument.locator('body')).toContainText('Ming')
  await expect(publicDocument.getByAltText('Patient photo: Ming', { exact: true })).toBeVisible()
  assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Public certificate overflows on mobile')
  await publicPage.screenshot({ path: 'test-artifacts.local/public-travel-certificate.png', fullPage: true })
  await dialog.getByLabel('Certificate visibility', { exact: true }).selectOption('private')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  await expect(dialog.getByRole('status')).toContainText('Public viewing disabled.')
  await publicPage.reload()
  await expect(publicPage.getByRole('heading', { name: 'Certificate not available' })).toBeVisible()
  await expect(publicPage.locator('iframe')).toHaveCount(0)
  await dialog.getByLabel('Certificate visibility', { exact: true }).selectOption('public')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  await expect(dialog.getByRole('status')).toContainText('Public viewing enabled.')
  await page.evaluate(() => {
    window.travelFailPrint = true
    const create = document.createElement.bind(document)
    document.createElement = (...args) => {
      const element = create(...args)
      if (args[0] === 'iframe') element.addEventListener('load', () => {
        if (element.title !== 'Travel certificate print') return
        element.contentWindow.print = () => { if (window.travelFailPrint) { window.travelFailPrint = false; throw new Error('Printer not ready') } window.travelPrinted = true }
      })
      return element
    }
  })
  await dialog.getByRole('button', { name: 'Print / PDF', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('retry Print / PDF')
  await dialog.getByRole('button', { name: 'Print / PDF', exact: true }).click()
  await page.waitForFunction(() => window.travelPrinted)
  const printFrame = page.frameLocator('iframe[title="Travel certificate print"]')
  for (const text of ['TC-2026-000001', 'José & Ana', 'Dr. Máya', '333444', 'PTR-TRAVEL', 'Saved brand', 'LOT-1', 'Historical vaccination 64']) await expect(printFrame.locator('body')).toContainText(text)
  await expect(printFrame.getByAltText('Travel clinic logo')).toBeVisible()
  await expect(printFrame.getByAltText('Patient photo: Ming', { exact: true })).toBeVisible()
  await expect(printFrame.getByAltText('Scan to view this travel certificate', { exact: true })).toHaveAttribute('src', qrDataUrl)
  const html = await printFrame.locator('html').evaluate((element) => element.outerHTML)
  const printPage = await context.newPage(); await printPage.setContent(html)
  await printPage.emulateMedia({ media: 'print' })
  await printPage.pdf({ path: 'test-artifacts.local/travel-certificate.pdf', preferCSSPageSize: true, printBackground: true })
  const pdf = await readFile('test-artifacts.local/travel-certificate.pdf')
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1, 'Long vaccination history did not span multiple pages')
  await printPage.close()
  assert.equal(certificates.length, 1, 'Printing allocated another certificate')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('Search certificates', { exact: true }).fill('no match')
  await expect(page.getByRole('heading', { name: 'No travel certificates found' })).toBeVisible()
  await page.getByLabel('Search certificates', { exact: true }).fill('José')
  await expect(page.getByRole('heading', { name: 'TC-2026-000001', exact: true })).toBeVisible()
  raw.pets[0].name = 'Changed pet'; raw.profiles[1].full_name = 'Changed issuer'; raw.vaccinations[0].brand = 'Changed brand'
  raw.pets[0].has_photo = false; raw.pets[0].photo_revision = 2
  await page.reload()
  detailFailure = true
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Retry loading certificate' })).toBeVisible()
  detailFailure = false
  await dialog.getByRole('button', { name: 'Retry loading certificate' }).click()
  await expect(preview.locator('body')).toContainText('Ming')
  await expect(preview.locator('body')).not.toContainText('Changed pet')
  await expect(preview.locator('body')).toContainText('Saved brand')
  await expect(preview.getByAltText('Patient photo: Ming', { exact: true })).toHaveAttribute('src', patientPhotoDataUrl)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  raw.profiles[0].role = 'owner'
  await page.reload()
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await dialog.getByRole('button', { name: 'Void certificate', exact: true }).click()
  await dialog.getByLabel('Reason for voiding').fill('Incorrect destination')
  await dialog.getByRole('button', { name: 'Confirm void', exact: true }).click()
  await expect(dialog.getByRole('status').filter({ hasText: 'VOID CERTIFICATE' })).toBeVisible()
  await expect(preview.locator('body')).toContainText('VOID CERTIFICATE')
  await expect(preview.locator('body')).toContainText('Incorrect destination')
  assert.equal(calls.filter((call) => call.action === 'void_travel_certificate').length, 1)
  await publicPage.reload()
  await expect(publicDocument.locator('body')).toContainText('VOID CERTIFICATE')
  await publicContext.close()
  assert.deepEqual(errors, [])
  console.log('PASS travel workspace, eligibility, issue/visibility retries, scannable QR, anonymous public/private/revoked access, photo snapshots, Veterinarian label, print retry, multipage PDF, owner void and mobile layouts')
} finally { await app.close() }
