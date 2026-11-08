import { chooseSelectOption, selectControl } from './helpers/select.mjs'
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
  owners: [{ id: 'owner', full_name: 'José & Ana', phone: '0926 121 3497', address: 'Sta. Cruz <Town>', is_active: true }],
  pets: [{ id: petId, owner_id: 'owner', name: 'Ming', record_number: 'VET-1', species: 'Cat', breed: 'Mixed', color_markings: 'Tri-Color', sex: 'Male', baseline_weight: 7.5, microchip_number: null, birth_date: '2020-01-01', birth_date_estimated: true, status: 'Active' }],
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
const certificateOwner = { name: 'Ma. Niña <Abes>', address: 'Purok 2\nBarangay San José <Cebu>', contactNumber: '+63 926 121 3497' }
raw.owners.push({ id: 'second-owner', full_name: 'Second owner', phone: '0918 222 3333', address: 'Second address', is_active: true })
raw.pets.push({ id: '20000000-0000-4000-8000-000000000002', owner_id: 'second-owner', name: 'Yuki', species: 'Dog', status: 'Active' })
let loseIssueAcknowledgement = true, loseVisibilityAcknowledgement = true, loseDetailsAcknowledgement = true, detailFailure = false, photoFailure = true, patientPhotoDataUrl = ''
raw.profiles.push({ id: '10000000-0000-4000-8000-000000000003', full_name: 'Undesignated staff', role: 'clinical_staff', is_active: true, is_veterinarian: false, prc_license_number: 'SAVED-PRC' },
  { id: '10000000-0000-4000-8000-000000000004', full_name: 'Inactive vet', role: 'clinical_staff', is_active: false, is_veterinarian: true })
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
    if (url.pathname === '/rest/v1/rpc/owner_veterina_code') return reply({ code: 'VET-AAAAAAAAAAAAAAAAAAAA' })
    if (url.pathname === '/functions/v1/admin-staff') return reply({ accounts: [] })
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
      const records = certificates.filter((entry) => !search || [entry.control_number, entry.reference_number, entry.pet_name, entry.owner_name].join(' ').toLowerCase().includes(search))
      return reply(records, 200, { 'content-range': records.length ? `0-${records.length - 1}/${records.length}` : '*/0' })
    }
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: data, p_key: key } = route.request().postDataJSON()
      calls.push({ action, data, key })
      if (receipts.has(key)) return reply(receipts.get(key))
      if (action === 'save_settings') {
        raw.clinic_settings[0].clinic_name = data.clinicName
        const result = { id: raw.clinic_settings[0].id }; receipts.set(key, result); return reply(result)
      }
      if (action === 'save_veterinarian_details') {
        const member = raw.profiles.find((entry) => entry.id === data.id)
        Object.assign(member, { full_name: data.fullName, is_veterinarian: data.isVeterinarian, tin_number: data.tinNumber || null, prc_license_number: data.prcLicenseNumber || null, ptr_number: data.ptrNumber || null, license_expires_on: data.licenseExpiresOn || null })
        const result = { id: member.id }; receipts.set(key, result)
        if (loseDetailsAcknowledgement) { loseDetailsAcknowledgement = false; return reply({ message: 'Details acknowledgement interrupted' }, 500) }
        return reply(result)
      }
      if (action === 'issue_travel_certificate') {
        const pet = raw.pets.find((entry) => entry.id === data.petId), issuer = raw.profiles.find((entry) => entry.id === data.issuerId), clinic = raw.clinic_settings[0]
        const row = { id: crypto.randomUUID(), reference_number: `TC-2026-${String(certificates.length + 1).padStart(6, '0')}`, status: 'issued', issued_on: '2026-11-06', issued_at: '2026-11-06T04:00:00Z', travel_date: data.travelDate,
          control_number: data.controlNumber, valid_until: data.validUntil, public_token: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''), is_public: Boolean(data.isPublic),
          pet_name: pet.name, owner_name: data.ownerDetails.name, issuer_name: issuer.full_name, destination: data.destination,
          snapshot: { version: 4, controlNumber: data.controlNumber, validUntil: data.validUntil, issuedTime: '12:00', timezone: 'Asia/Manila', issuedOn: '2026-11-06', pet: { name: pet.name, species: pet.species, breed: pet.breed, recordNumber: pet.record_number, birthDate: pet.birth_date, birthDateEstimated: pet.birth_date_estimated, color: pet.color_markings, sex: pet.sex, weightKg: pet.baseline_weight, microchipNumber: pet.microchip_number, photoDataUrl: patientPhotoDataUrl }, owner: structuredClone(data.ownerDetails),
            clinic: { name: clinic.clinic_name, address: clinic.address, phone: clinic.phone, logoDataUrl: clinic.logo_data_url }, issuer: { name: issuer.full_name, title: issuer.job_title, prcLicenseNumber: issuer.prc_license_number, ptrNumber: issuer.ptr_number, tinNumber: issuer.tin_number, licenseExpiresOn: issuer.license_expires_on },
            journey: { date: data.travelDate, destination: data.destination }, rabiesVaccinationId: data.rabiesVaccinationId,
            vaccinations: raw.vaccinations.filter((entry) => !['pending', 'future'].includes(entry.id)).map((entry) => ({ id: entry.id, name: entry.vaccine_name, brand: entry.brand, lotNumber: entry.lot_number, dose: entry.dose, administeredOn: entry.administered_at, validThrough: entry.next_due_at, administeredBy: entry.administered_by_name, ...(entry.id === data.rabiesVaccinationId ? { type: 'Anti-Rabies', vaccinated: true, expirationDate: data.vaccineExpirationDate } : {}) })) } }
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
  raw.profiles[0].role = 'owner'
  await page.goto(`${app.origin}/settings`)
  await expect(page.getByLabel('Veterinarian TIN', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0)
  const unchangedProfiles = structuredClone(raw.profiles)
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Clinic settings saved.' })).toBeVisible()
  assert.deepEqual(raw.profiles, unchangedProfiles)
  await page.getByRole('button', { name: 'Veterinarian Details', exact: true }).click()
  await page.getByRole('button', { name: 'Register a veterinarian', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pending staff approvals' })).toBeVisible()
  await expect(page.locator('.clinic-registration-code')).toBeVisible()
  await page.getByRole('button', { name: 'Veterinarian Details', exact: true }).click()
  const editVeterinarian = async (id, tinNumber, prc, ptr, expiry) => {
    await page.getByRole('button', { name: `Edit details for ${raw.profiles.find((entry) => entry.id === id).full_name}`, exact: true }).click()
    const form = page.getByRole('dialog')
    await chooseSelectOption(form.getByLabel('Veterinarian designation', { exact: true }), 'true')
    await form.getByLabel('Veterinarian TIN', { exact: true }).fill(tinNumber)
    await form.getByLabel('PRC License Number', { exact: true }).fill(prc)
    await form.getByLabel('PTR Number', { exact: true }).fill(ptr)
    await form.getByLabel('License Expiry Date', { exact: true }).fill(expiry)
    const shouldRetry = loseDetailsAcknowledgement
    await form.getByRole('button', { name: 'Save veterinarian details', exact: true }).click()
    if (shouldRetry) {
      await expect(form.getByRole('alert')).toContainText('acknowledgement interrupted')
      await expect(form.getByLabel('Veterinarian TIN', { exact: true })).toHaveValue(tinNumber)
      await form.getByRole('button', { name: 'Save veterinarian details', exact: true }).click()
    }
    await expect(form).toHaveCount(0)
  }
  await editVeterinarian(actor, '000-111-222', '000001', '000002', '2026-11-06')
  await editVeterinarian(doctor, '736-954-286', '333444', 'PTR-TRAVEL', '2027-01-01')
  const credentialCalls = calls.filter((call) => call.action === 'save_veterinarian_details')
  assert.equal(credentialCalls[0].key, credentialCalls[1].key, 'Credential retry allocated a fresh key')
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Veterinarian Details overflow at ${width}`)
    await page.screenshot({ path: `test-artifacts.local/veterinarian-details-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await page.getByRole('button', { name: 'Veterinarian Details', exact: true }).click()
  await expect(page.getByText('736-954-286', { exact: true })).toBeVisible()
  await page.getByLabel('Search veterinarian details', { exact: true }).fill('333444')
  await expect(page.getByRole('button', { name: 'Edit details for Dr. Máya', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit details for Travel recorder', exact: true })).toHaveCount(0)
  await page.getByLabel('Search veterinarian details', { exact: true }).fill('')
  await chooseSelectOption(page.getByLabel('Show profiles', { exact: true }), 'veterinarians')
  await expect(page.getByRole('button', { name: 'Edit details for Undesignated staff', exact: true })).toHaveCount(0)
  await chooseSelectOption(page.getByLabel('Show profiles', { exact: true }), 'all')
  raw.profiles[0].role = 'clinical_staff'
  await page.goto(`${app.origin}/settings`)
  await expect(page.getByRole('button', { name: 'Veterinarian Details', exact: true })).toHaveCount(0)
  await page.goto(`${app.origin}/dashboard`)
  await page.getByRole('button', { name: 'Open workspaces', exact: true }).click()
  await expect(page.getByRole('link', { name: /Travel Certificates/ })).toBeVisible()
  await page.getByRole('link', { name: /Travel Certificates/ }).click()
  await page.getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(selectControl(page.getByLabel('Veterinarian', { exact: true }))).toHaveValue(actor)
  const petSearch = page.getByRole('combobox', { name: 'Pet for travel certificate' })
  await petSearch.fill('Ming')
  await petSearch.press('ArrowDown')
  await petSearch.press('Enter')
  await expect(petSearch).toHaveValue('Ming')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(certificates.length, 0, 'Cancelling issued a certificate')
  raw.profiles[0].role = 'owner'
  await page.goto(`${app.origin}/settings`)
  await page.getByRole('button', { name: 'Veterinarian Details', exact: true }).click()
  await page.getByRole('button', { name: 'Edit details for Travel recorder', exact: true }).click()
  await chooseSelectOption(page.getByRole('dialog').getByLabel('Veterinarian designation', { exact: true }), 'false')
  await page.getByRole('dialog').getByRole('button', { name: 'Save veterinarian details', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.profiles[0].is_veterinarian, false)
  assert.equal(raw.profiles[0].role, 'owner')
  assert.equal(raw.profiles[0].is_active, true)
  assert.equal(raw.profiles[0].tin_number, '000-111-222')
  raw.profiles[0].role = 'clinical_staff'
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
  await expect(selectControl(dialog.getByLabel('Veterinarian', { exact: true }))).toHaveValue('')
  for (const excluded of [actor, raw.profiles[2].id, raw.profiles[3].id]) await expect(selectControl(dialog.getByLabel('Veterinarian', { exact: true })).locator(`option[value="${excluded}"]`)).toHaveCount(0)
  await expect(dialog.getByLabel('Veterinarian TIN', { exact: true })).toHaveCount(0)
  await expect(selectControl(dialog.getByLabel('Certificate visibility', { exact: true }))).toHaveValue('private')
  await expect(selectControl(dialog.getByLabel('Anti-Rabies vaccination record')).locator('option', { hasText: 'Pending vaccine' })).toHaveCount(0)
  await expect(selectControl(dialog.getByLabel('Anti-Rabies vaccination record')).locator('option', { hasText: 'Future vaccine' })).toHaveCount(0)
  await expect(dialog.getByLabel('Control number', { exact: true })).toHaveValue('')
  const ownerName = dialog.getByLabel('Owner name', { exact: true }), ownerAddress = dialog.getByLabel('Address', { exact: true }), ownerContact = dialog.getByLabel('Contact number', { exact: true })
  await expect(ownerName).toHaveValue(raw.owners[0].full_name)
  await expect(ownerAddress).toHaveValue(raw.owners[0].address)
  await expect(ownerContact).toHaveValue(raw.owners[0].phone)
  await expect(dialog.getByText('Changes apply only to this certificate.', { exact: true })).toBeVisible()
  await ownerName.fill('Temporary certificate name')
  await dialog.getByRole('button', { name: 'Reset to owner details', exact: true }).click()
  await expect(ownerName).toHaveValue(raw.owners[0].full_name)
  await ownerAddress.fill('Temporary certificate address')
  const switchPet = async (name) => {
    const input = dialog.getByRole('combobox', { name: 'Pet for travel certificate' })
    await input.fill(name); await input.press('ArrowDown'); await input.press('Enter')
  }
  await switchPet('Yuki')
  await expect(ownerName).toHaveValue('Second owner')
  await expect(ownerAddress).toHaveValue('Second address')
  await switchPet('Ming')
  await expect(ownerAddress).toHaveValue(raw.owners[0].address)
  for (const [field, value] of [[ownerName, certificateOwner.name], [ownerAddress, certificateOwner.address], [ownerContact, certificateOwner.contactNumber]]) {
    await field.fill('')
    await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Issue certificate', exact: true })).toBeDisabled()
    await field.fill(value)
  }
  const originalAddress = raw.owners[0].address
  raw.owners[0].address = 'Refreshed clinic address'
  await Promise.all([page.waitForResponse((response) => new URL(response.url()).pathname === '/rest/v1/owners'), page.evaluate(() => window.dispatchEvent(new Event('focus')))])
  await expect(ownerAddress).toHaveValue(certificateOwner.address)
  raw.owners[0].address = originalAddress
  await dialog.getByLabel('Planned travel date').fill('2026-12-01')
  await dialog.getByLabel('Certificate valid until').fill('2026-12-05')
  await dialog.getByLabel('Destination', { exact: true }).fill('Cebu <Port>')
  await chooseSelectOption(dialog.getByLabel('Veterinarian', { exact: true }), doctor)
  await expect(dialog.getByText(/TIN No.: 736-954-286/)).toBeVisible()
  await chooseSelectOption(dialog.getByLabel('Anti-Rabies vaccination record'), 'expired')
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('validity must cover')
  await expect(dialog.getByRole('button', { name: 'Issue certificate', exact: true })).toBeDisabled()
  await chooseSelectOption(dialog.getByLabel('Anti-Rabies vaccination record'), 'unknown')
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('next-dose date')
  assert.equal(calls.filter((call) => call.action === 'issue_travel_certificate').length, 0)
  await chooseSelectOption(dialog.getByLabel('Anti-Rabies vaccination record'), 'valid')
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Enter a control number')
  await expect(dialog.getByRole('button', { name: 'Issue certificate', exact: true })).toBeDisabled()
  await dialog.getByLabel('Control number', { exact: true }).fill('00443')
  await dialog.getByLabel('Vaccine product expiration date').fill('2027-03-29')
  await dialog.getByRole('checkbox', { name: /selected vaccination is Anti-Rabies/ }).check()
  await dialog.getByRole('checkbox', { name: /reviewed the pet’s records/ }).check()
  const refreshProfiles = () => Promise.all([page.waitForResponse((response) => new URL(response.url()).pathname === '/rest/v1/profiles'), page.evaluate(() => window.dispatchEvent(new Event('focus')))])
  for (const [prc, expiry, warning] of [[null, null, 'PRC license number is not recorded.'], ['333444', '2026-11-05', 'The recorded license has expired.'], ['333444', '2026-11-06', null]]) {
    raw.profiles[1].prc_license_number = prc; raw.profiles[1].license_expires_on = expiry
    await refreshProfiles()
    if (warning) await expect(dialog.locator('.travel-license-warnings')).toContainText(warning)
    else await expect(dialog.locator('.travel-license-warnings')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Issue certificate', exact: true })).toBeEnabled()
  }
  raw.profiles[1].license_expires_on = '2027-01-01'
  await refreshProfiles()
  await dialog.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  const preview = dialog.frameLocator('iframe[title="Travel certificate preview"]')
  await expect(preview.locator('body')).toContainText('UNISSUED PREVIEW')
  await expect(preview.locator('body')).toContainText('Cebu <Port>')
  for (const detail of ['00443', '5 December 2026', 'Tri-Color', 'Male', '7.5 kg', certificateOwner.name, 'Barangay San José <Cebu>', certificateOwner.contactNumber, '736-954-286', '29 March 2027', 'Microchip number', '1 January 2027']) await expect(preview.locator('body')).toContainText(detail)
  await expect(preview.locator('.main-certificate')).toBeVisible()
  await expect(preview.getByAltText('Patient photo: Ming', { exact: true })).toBeVisible()
  await expect(preview.getByAltText('Patient photo: Ming', { exact: true })).toHaveAttribute('src', patientPhotoDataUrl)
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Travel certificate UI overflow at ${width}px`)
    assert.ok(await preview.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth), `Certificate preview overflow at ${width}px`)
    if (width === 375) await dialog.screenshot({ path: 'test-artifacts.local/travel-certificate-form-mobile.png' })
  }
  await mkdir('test-artifacts.local', { recursive: true })
  await dialog.screenshot({ path: 'test-artifacts.local/travel-certificate-form.png' })
  await dialog.getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('acknowledgement interrupted')
  await expect(dialog.getByLabel('Destination', { exact: true })).toHaveValue('Cebu <Port>')
  await expect(dialog.getByLabel('Control number', { exact: true })).toHaveValue('00443')
  await expect(dialog.getByLabel('Certificate valid until')).toHaveValue('2026-12-05')
  await expect(ownerName).toHaveValue(certificateOwner.name)
  await expect(ownerAddress).toHaveValue(certificateOwner.address)
  await expect(ownerContact).toHaveValue(certificateOwner.contactNumber)
  await dialog.getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Certificate TC-2026-000001')
  assert.equal(certificates.length, 1)
  const issueCalls = calls.filter((call) => call.action === 'issue_travel_certificate')
  assert.equal(issueCalls[0].key, issueCalls[1].key)
  assert.equal(issueCalls[0].data.controlNumber, '00443')
  assert.equal('veterinarianTin' in issueCalls[0].data, false)
  assert.equal(issueCalls[0].data.vaccineExpirationDate, '2027-03-29')
  assert.deepEqual(issueCalls[0].data.ownerDetails, certificateOwner)
  assert.equal(raw.owners[0].address, originalAddress, 'Certificate edit updated the clinic owner')
  assert.equal(raw.owners[0].phone, '0926 121 3497')
  assert.equal(calls.filter((call) => /owner/.test(call.action)).length, 0)
  assert.equal(certificates[0].snapshot.issuer.licenseExpiresOn, '2027-01-01')
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
  await chooseSelectOption(dialog.getByLabel('Certificate visibility', { exact: true }), 'public')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Visibility acknowledgement interrupted')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  const sharingCalls = calls.filter((call) => call.action === 'set_travel_certificate_visibility')
  assert.equal(sharingCalls[0].key, sharingCalls[1].key)
  await expect(dialog.getByRole('status')).toContainText('Public viewing enabled.')
  await publicPage.reload()
  const publicDocument = publicPage.frameLocator('iframe[title="Public travel certificate"]')
  await expect(publicDocument.locator('body')).toContainText('Ming')
  await expect(publicDocument.locator('body')).toContainText(certificateOwner.name)
  await expect(publicDocument.locator('body')).toContainText('Barangay San José <Cebu>')
  await expect(publicDocument.locator('.main-certificate')).toBeVisible()
  await expect(publicDocument.getByAltText('Patient photo: Ming', { exact: true })).toBeVisible()
  assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Public certificate overflows on mobile')
  await publicPage.screenshot({ path: 'test-artifacts.local/public-travel-certificate.png', fullPage: true })
  await chooseSelectOption(dialog.getByLabel('Certificate visibility', { exact: true }), 'private')
  await dialog.getByRole('button', { name: 'Save visibility' }).click()
  await expect(dialog.getByRole('status')).toContainText('Public viewing disabled.')
  await publicPage.reload()
  await expect(publicPage.getByRole('heading', { name: 'Certificate not available' })).toBeVisible()
  await expect(publicPage.locator('iframe')).toHaveCount(0)
  await chooseSelectOption(dialog.getByLabel('Certificate visibility', { exact: true }), 'public')
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
  for (const text of ['TC-2026-000001', certificateOwner.name, 'Dr. Máya', '333444', 'PTR-TRAVEL', 'Saved brand', 'LOT-1', 'Historical vaccination 64', '00443', '5 December 2026', 'Tri-Color', 'Male', '7.5 kg', 'Barangay San José <Cebu>', certificateOwner.contactNumber, '736-954-286', '29 March 2027']) await expect(printFrame.locator('body')).toContainText(text)
  await expect(printFrame.getByAltText('Travel clinic logo')).toBeVisible()
  await expect(printFrame.getByAltText('Patient photo: Ming', { exact: true })).toBeVisible()
  await expect(printFrame.getByAltText('Scan to view this travel certificate', { exact: true })).toHaveAttribute('src', qrDataUrl)
  const html = await printFrame.locator('html').evaluate((element) => element.outerHTML)
  const printPage = await context.newPage(); await printPage.setContent(html)
  await printPage.emulateMedia({ media: 'print' })
  // The main certificate fits A4; the full vaccination table starts on a continuation page.
  await printPage.setViewportSize({ width: Math.floor((210 - 28) * 96 / 25.4), height: 1100 })
  const mainHeight = await printPage.locator('.main-certificate').evaluate((element) => element.getBoundingClientRect().height)
  await printPage.screenshot({ path: 'test-artifacts.local/travel-certificate-a4.png', fullPage: true })
  await printPage.locator('.main-certificate').screenshot({ path: 'test-artifacts.local/travel-certificate-main.png' })
  assert.ok(mainHeight < (297 - 28) * 96 / 25.4, `Main certificate exceeds printable A4 height: ${mainHeight}px`)
  await printPage.pdf({ path: 'test-artifacts.local/travel-certificate.pdf', preferCSSPageSize: true, printBackground: true })
  const pdf = await readFile('test-artifacts.local/travel-certificate.pdf')
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1, 'Long vaccination history did not span multiple pages')
  const longRecord = structuredClone(certificates[0])
  longRecord.snapshot.owner.address = ('Purok San José, Cebu City; '.repeat(60) + 'End of owner address').trim()
  longRecord.qrDataUrl = qrDataUrl
  const longHtml = await page.evaluate(async (record) => { const { travelCertificateHtml } = await import('/src/lib/travelCertificates.js'); return travelCertificateHtml(record) }, longRecord)
  await printPage.setContent(longHtml)
  await expect(printPage.locator('.owner-details')).toContainText('End of owner address')
  assert.ok(await printPage.locator('.main-certificate').evaluate((element) => element.scrollWidth <= document.documentElement.clientWidth), 'Long owner details overflow the printed sheet')
  assert.equal(await printPage.locator('body').evaluate((element) => getComputedStyle(element).fontSize), '11px', 'Long content shrank the document text')
  await printPage.pdf({ path: 'test-artifacts.local/travel-certificate-long-details.pdf', preferCSSPageSize: true, printBackground: true })
  await printPage.close()
  assert.equal(certificates.length, 1, 'Printing allocated another certificate')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('Search certificates', { exact: true }).fill('no match')
  await expect(page.getByRole('heading', { name: 'No travel certificates found' })).toBeVisible()
  await page.getByLabel('Search certificates', { exact: true }).fill('Niña')
  await expect(page.getByRole('heading', { name: 'Control No. 00443', exact: true })).toBeVisible()
  await page.getByLabel('Search certificates', { exact: true }).fill('00443')
  await expect(page.getByRole('heading', { name: 'Control No. 00443', exact: true })).toBeVisible()
  raw.owners[0].address = 'Changed address'; raw.pets[0].baseline_weight = 99; raw.pets[0].name = 'Changed pet'; raw.profiles[1].full_name = 'Changed issuer'; raw.profiles[1].tin_number = 'Changed TIN'; raw.vaccinations[0].brand = 'Changed brand'
  raw.pets[0].has_photo = false; raw.pets[0].photo_revision = 2
  await page.reload()
  detailFailure = true
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Retry loading certificate' })).toBeVisible()
  detailFailure = false
  await dialog.getByRole('button', { name: 'Retry loading certificate' }).click()
  await expect(preview.locator('body')).toContainText('Ming')
  await expect(preview.locator('body')).not.toContainText('Changed pet')
  await expect(preview.locator('body')).toContainText('Barangay San José <Cebu>')
  await expect(preview.locator('body')).not.toContainText('Changed address')
  await expect(preview.locator('body')).toContainText('7.5 kg')
  await expect(preview.locator('body')).toContainText('Saved brand')
  await expect(preview.locator('body')).toContainText('736-954-286')
  await expect(preview.locator('body')).not.toContainText('Changed TIN')
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
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const legacy = structuredClone(certificates[0])
  Object.assign(legacy, { id: crypto.randomUUID(), reference_number: 'TC-2025-000001', control_number: 'LEGACY', status: 'issued', is_public: false })
  legacy.snapshot.version = 2
  certificates.push(legacy)
  await page.getByLabel('Search certificates', { exact: true }).fill('LEGACY')
  await expect(page.getByRole('heading', { name: 'Control No. LEGACY', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Certificate TC-2025-000001')
  await expect(preview.locator('.patient-details')).toBeVisible()
  await expect(preview.locator('.main-certificate')).toHaveCount(0)
  await publicContext.close()
  assert.deepEqual(errors, [])
  console.log('PASS travel workspace, eligibility, certificate-only owner edits/reset/pet switch/refresh, issue/visibility retries, scannable QR, public/private access, immutable snapshots, A4 format, legacy layouts, print retry, multipage PDF, owner void and mobile layouts')
} finally { await app.close() }
