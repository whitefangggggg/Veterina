import { mockAccountAccess } from './helpers/mock-access.mjs'
// Intercepted browser acceptance; no clinic data is changed.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000088'
const app = await browserServer(5190)
const errors = []

async function scenario(role = 'owner', completed = null) {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  const profile = { id: actor, clinic_id: 'clinic', full_name: 'Dr. Rivera', role, is_active: true }
  const settings = { id: 'settings', clinic_id: 'clinic', clinic_name: 'Rivera clinic', timezone: 'Asia/Manila',
    brand_color: '#2a6f62', tagline: '', website: '', onboarding_completed_at: completed, onboarding_step: 0,
    address: '', phone: '', email: '', logo_data_url: null, business_hours: {}, reminder_lead_days: 3 }
  const session = { access_token: mockAccessToken(actor), refresh_token: 'setup-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'setup@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  const state = { settings, calls: [], failCompletion: true }
  await context.route(`${api.origin}/**`, (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(profile))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname === '/auth/v1/token') return reply(session)
    if (url.pathname === '/rest/v1/profiles') return reply([profile])
    if (url.pathname === '/rest/v1/clinic_settings') return reply([settings])
    if (url.pathname === '/rest/v1/rpc/save_clinic_onboarding') {
      assert.equal(role, 'owner')
      const payload = request.postDataJSON(); state.calls.push(payload)
      if (payload.p_complete && state.failCompletion) { state.failCompletion = false; return reply({ message: 'Save interrupted. Please retry.' }, 400) }
      const v = payload.p_data
      Object.assign(settings, { clinic_name: v.clinicName, address: v.address, phone: v.phone, email: v.email, website: v.website,
        logo_data_url: v.logoDataUrl, tagline: v.tagline, brand_color: v.brandColor, timezone: v.timezone,
        reminder_lead_days: Number(v.reminderLeadDays), business_hours: v.businessHours, onboarding_step: v.step })
      if (payload.p_complete) settings.onboarding_completed_at ||= '2026-11-03T12:00:00Z'
      return reply({ id: settings.id, completed: payload.p_complete })
    }
    if (url.pathname === '/rest/v1/rpc/owner_veterina_code') return reply({ code: 'VET-0123456789ABCDEF0123' })
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname.startsWith('/rest/v1/')) return reply([])
    throw new Error(`Unexpected setup request ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  return { context, page, state }
}

try {
  await mkdir('test-artifacts.local', { recursive: true })
  {
    const { context, page, state } = await scenario()
    await page.goto(app.origin + '/patients?from=welcome')
    await expect(page.getByRole('heading', { name: 'Let’s meet your clinic.' })).toBeVisible()
    await expect(page.locator('.workspace-header')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save & continue' }).click()
    assert.equal(state.calls.length, 0, 'Incomplete clinic contact details were persisted')
    await page.getByRole('textbox', { name: 'Clinic name' }).fill('Rivera Paws & Care')
    await page.getByRole('textbox', { name: 'Clinic address' }).fill('123 Mabini Street, Quezon City')
    await page.getByRole('textbox', { name: 'Clinic phone' }).fill('09171234567')
    await page.getByRole('textbox', { name: 'Clinic email' }).fill('hello@rivera.example')
    await page.getByRole('textbox', { name: 'Clinic website' }).fill('https://rivera.example')
    await page.getByRole('button', { name: 'Save & continue' }).click()
    await expect(page.getByRole('heading', { name: 'A familiar face for your clinic.' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'A familiar face for your clinic.' })).toBeVisible()
    const upload = page.getByLabel('Clinic image or logo')
    await upload.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') })
    await expect(page.getByRole('alert')).toContainText('PNG, JPEG or WebP')
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 60; const ctx = c.getContext('2d'); ctx.fillStyle = '#72549a'; ctx.fillRect(0, 0, 80, 60); return c.toDataURL('image/png').split(',')[1] })
    await upload.setInputFiles({ name: 'clinic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await expect(page.getByAltText('Clinic image preview')).toBeVisible()
    await page.getByRole('textbox', { name: 'Clinic tagline' }).fill('Thoughtful care for every paw')
    await page.getByRole('radio', { name: 'Orchid', exact: true }).check()
    await expect(page.getByLabel('Clinic branding preview')).toContainText('Rivera Paws & Care')
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Clinic branding overflows at ${width}px`)
      await page.screenshot({ path: `test-artifacts.local/owner-onboarding-brand-${width}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'Save & continue' }).click()
    await expect(page.getByRole('heading', { name: 'Set the rhythm of your day.' })).toBeVisible()
    await page.getByLabel('Clinic timezone').fill('Asia/Singapore')
    await page.getByLabel('Reminder lead days').fill('5')
    await page.getByLabel('Add clinic opening hours').check()
    await page.getByLabel('Monday opens').fill('18:00')
    await page.getByRole('button', { name: 'Save & continue' }).click()
    await expect(page.getByRole('alert')).toContainText('Monday: closing time must be after opening time')
    await page.getByLabel('Monday opens').fill('08:00')
    await page.getByLabel('Monday closes').fill('18:00')
    await page.getByRole('button', { name: 'Save progress for later' }).click()
    await expect(page.getByRole('status')).toContainText('Your progress is saved')
    await page.reload()
    await expect(page.getByLabel('Monday opens')).toHaveValue('08:00')
    await expect(page.getByLabel('Clinic timezone')).toHaveValue('Asia/Singapore')
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Opening hours overflow at ${width}px`)
    }
    await page.getByRole('button', { name: 'Save & continue' }).click()
    await expect(page.getByRole('heading', { name: 'Your Veterina, ready for care.' })).toBeVisible()
    await expect(page.locator('.onboarding-review')).toContainText('123 Mabini Street')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByLabel('Monday closes')).toHaveValue('18:00')
    await page.getByRole('button', { name: 'Save & continue' }).click()
    await page.getByRole('button', { name: 'Open my clinic' }).click()
    await expect(page.getByRole('alert')).toContainText('Save interrupted')
    await expect(page.locator('.onboarding-review')).toContainText('Thoughtful care for every paw')
    await page.getByRole('button', { name: 'Open my clinic' }).click()
    await expect(page.locator('.workspace-header')).toBeVisible()
    await expect(page).toHaveURL(app.origin + '/patients?from=welcome')
    await expect(page.locator('.header-brand')).toContainText('Rivera Paws & Care')
    await expect(page.locator('.header-brand img')).toBeVisible()
    assert.equal(await page.locator('.app-shell').evaluate((el) => getComputedStyle(el).getPropertyValue('--brand').trim()), '#72549a')
    await page.reload()
    await expect(page.locator('.workspace-header')).toBeVisible()
    await expect(page.locator('.clinic-onboarding')).toHaveCount(0)
    await page.goto(app.origin + '/settings')
    await page.getByRole('link', { name: 'Personalize clinic' }).click()
    await expect(page.getByRole('textbox', { name: 'Clinic name' })).toHaveValue('Rivera Paws & Care')
    await page.getByRole('button', { name: 'Back to settings' }).click()
    await expect(page.getByRole('heading', { name: 'Clinic settings' })).toBeVisible()
    assert.ok(state.settings.onboarding_completed_at)
    await context.close()
  }
  {
    const { context, page, state } = await scenario('clinical_staff')
    await page.goto(app.origin + '/patients')
    await expect(page.locator('.workspace-header')).toBeVisible()
    await expect(page.locator('.clinic-onboarding')).toHaveCount(0)
    await page.goto(app.origin + '/clinic-setup')
    await expect(page).toHaveURL(app.origin + '/dashboard')
    assert.equal(state.calls.length, 0)
    await context.close()
  }
  {
    const { context, page } = await scenario('owner', '2026-11-03T00:00:00Z')
    await page.goto(app.origin + '/patients')
    await expect(page.locator('.workspace-header')).toBeVisible()
    await expect(page.locator('.clinic-onboarding')).toHaveCount(0)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS owner onboarding, draft/resume, image validation, branding, hours, retry, completion/reload, settings revisit, staff isolation and mobile layout')
} finally { await app.close() }
