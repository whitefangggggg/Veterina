// Browser behavior is intercepted; clinic isolation/approval is tested in Postgres.
import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const originalCode = 'VET-0123456789ABCDEF0123', rotatedCode = 'VET-ABCDEF0123456789ABCD'
const actor = '10000000-0000-4000-8000-000000000001'
const app = await browserServer(5186)
const errors = [], signups = [], actions = []
const resends = []
let rejectResend = false
let currentCode = originalCode
try {
  await mkdir('test-artifacts.local', { recursive: true })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  await context.addInitScript(() => {
    window.cameraRequests = 0; window.cameraStops = 0; window.cameraAllowed = false
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraRequests++
      if (!window.cameraAllowed) throw new DOMException('Denied', 'NotAllowedError')
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400
      const image = new Image()
      if (window.cameraQrImage) { image.src = window.cameraQrImage; await image.decode() }
      const draw = () => {
        canvas.getContext('2d').fillStyle = 'white'; canvas.getContext('2d').fillRect(0, 0, 400, 400)
        if (image.complete && image.naturalWidth) canvas.getContext('2d').drawImage(image, 80, 80, 240, 240)
      }
      draw()
      const timer = setInterval(draw, 100), stream = canvas.captureStream(10)
      stream.getTracks().forEach((track) => { const stop = track.stop.bind(track); track.stop = () => { window.cameraStops++; clearInterval(timer); stop() } })
      return stream
    }
  })
  await context.route(`${api.origin}/**`, (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'X-Supabase-Api-Version': '2024-01-01', 'Access-Control-Expose-Headers': 'X-Supabase-Api-Version' }, body: JSON.stringify(value) })
    if (url.pathname === '/rest/v1/rpc/veterina_code_info') return reply({ valid: request.postDataJSON().p_code === currentCode, clinicName: 'Isolated vetshop' })
    if (url.pathname === '/auth/v1/signup') { signups.push(request.postDataJSON()); return reply({ id: crypto.randomUUID(), email: 'staff@example.org', identities: [] }) }
    if (url.pathname === '/auth/v1/resend') {
      resends.push({ data: request.postDataJSON(), redirect: url.searchParams.get('redirect_to') })
      if (rejectResend) return reply({ code: 'over_email_send_rate_limit', msg: 'Email rate limit exceeded' }, 429)
      return reply({})
    }
    if (url.pathname === '/auth/v1/token') return reply({ code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400)
    throw new Error(`Unexpected registration request ${url.pathname}`)
  })
  const page = await context.newPage()
  await page.clock.install()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${app.origin}/create-account?code=${originalCode}`)
  await expect(page.getByLabel('Veterina Code', { exact: true })).toHaveValue(originalCode)
  await expect(page.getByRole('status')).toContainText('Isolated vetshop')
  assert.equal(await page.evaluate(() => window.cameraRequests), 0, 'Camera started before staff chose to scan')
  await page.getByLabel('Full name', { exact: true }).fill('New clinician')
  await page.getByLabel('Email address', { exact: true }).fill('staff@example.org')
  await page.getByLabel('Password', { exact: true }).fill('Browser-test-87!')
  await page.getByLabel('Confirm password', { exact: true }).fill('Browser-test-87!')
  await page.getByLabel('Veterina Code', { exact: true }).fill('VET-00000000000000000000')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('invalid or has changed')
  assert.equal(signups.length, 0)
  await page.getByRole('button', { name: 'Scan QR code', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('denied')
  await dialog.getByRole('button', { name: 'Enter code manually', exact: true }).click()
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('New clinician')
  await page.getByRole('button', { name: 'Scan QR code', exact: true }).click()
  const file = dialog.getByLabel('Or upload a QR image')
  await file.setInputFiles({ name: 'foreign-qr.png', mimeType: 'image/png', buffer: await QRCode.toBuffer(`https://elsewhere.invalid/create-account?code=${originalCode}`) })
  await expect(dialog.getByRole('alert')).toContainText('not a Veterina registration QR')
  await file.setInputFiles({ name: 'registration-qr.png', mimeType: 'image/png', buffer: await QRCode.toBuffer(`${app.origin}/create-account?code=${originalCode}`, { width: 400 }) })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('Veterina Code', { exact: true })).toHaveValue(originalCode)
  await page.evaluate(() => { window.cameraAllowed = true })
  await page.getByRole('button', { name: 'Scan QR code', exact: true }).click()
  await expect.poll(() => dialog.locator('video').evaluate((video) => video.videoWidth)).toBeGreaterThan(0)
  await dialog.getByRole('button', { name: 'Enter code manually', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBeGreaterThan(0)
  const stopsBeforeScan = await page.evaluate(() => window.cameraStops)
  await page.evaluate((qr) => { window.cameraQrImage = qr }, await QRCode.toDataURL(`${app.origin}/create-account?code=${originalCode}`, { width: 400, margin: 4 }))
  await page.getByRole('button', { name: 'Scan QR code', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBeGreaterThan(stopsBeforeScan)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: 'test-artifacts.local/staff-registration-mobile.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Signup overflowed mobile')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  assert.equal(signups.length, 1)
  assert.deepEqual(signups[0].data, { full_name: 'New clinician', application: 'veterina', account_type: 'staff', veterina_code: originalCode })
  await expect(page.getByRole('button', { name: /^Resend in/ })).toBeDisabled()
  await page.clock.fastForward(61000)
  await page.getByRole('button', { name: 'Resend confirmation email', exact: true }).click()
  await expect(page.getByText('Confirmation email requested.', { exact: false })).toBeVisible()
  assert.equal(resends.length, 1)
  assert.equal(resends[0].data.type, 'signup')
  assert.equal(resends[0].data.email, 'staff@example.org')
  assert.equal(new URL(resends[0].redirect).pathname, '/sign-in')
  assert.equal(signups.length, 1, 'Resend registered a duplicate account')
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click()
  await page.getByLabel('Email address', { exact: true }).fill('staff@example.org')
  await page.getByLabel('Password', { exact: true }).fill('Browser-test-87!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('confirm your email')
  rejectResend = true
  await page.getByRole('button', { name: 'Resend confirmation email', exact: true }).click()
  await expect(page.getByText('Too many attempts.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Resend in/ })).toBeDisabled()
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('staff@example.org')
  console.log('PASS signup and sign-in confirmation resend, cooldown, rate-limit errors, preserved address and no duplicate registration')
  console.log('PASS signup code prefill, invalid code rejection, QR decoding, foreign QR rejection, camera denial, retained values and mobile layout')
  await page.goto(`${app.origin}/create-account`)
  await page.getByLabel('Create account as', { exact: true }).selectOption('owner')
  await expect(page.getByLabel('Veterina Code', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scan QR code', exact: true })).toHaveCount(0)
  await page.getByLabel('Clinic name', { exact: true }).fill('New owner clinic')
  await page.getByLabel('Full name', { exact: true }).fill('New owner')
  await page.getByLabel('Email address', { exact: true }).fill('owner@example.org')
  await page.getByLabel('Password', { exact: true }).fill('Browser-test-87!')
  await page.getByLabel('Confirm password', { exact: true }).fill('Browser-test-87!')
  await page.getByLabel('Create account as', { exact: true }).selectOption('staff')
  await expect(page.getByLabel('Clinic name', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Veterina Code', { exact: true })).toBeVisible()
  await page.getByLabel('Create account as', { exact: true }).selectOption('owner')
  await expect(page.getByLabel('Clinic name', { exact: true })).toHaveValue('New owner clinic')
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('New owner')
  await page.setViewportSize({ width: 320, height: 812 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Owner signup overflowed mobile')
  await page.screenshot({ path: 'test-artifacts.local/owner-registration-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  assert.equal(signups.length, 2)
  assert.deepEqual(signups[1].data, { full_name: 'New owner', application: 'veterina', account_type: 'owner', clinic_name: 'New owner clinic' })
  console.log('PASS owner/staff selection, field retention, new clinic signup without a code and 320px layout')
  await context.close()

  const ownerContext = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  ownerContext.setDefaultTimeout(15000)
  const token = mockAccessToken(actor).split('.')
  token[1] = Buffer.from(JSON.stringify({ sub: actor, role: 'authenticated', aal: 'aal1', exp: 2000000000 })).toString('base64url')
  const session = { access_token: token.join('.'), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, aud: 'authenticated', role: 'authenticated', email: 'owner@example.org', app_metadata: {}, user_metadata: {}, factors: [{ id: 'existing-authenticator', factor_type: 'totp', status: 'verified' }] } }
  let accounts = [
    { id: 'verified', full_name: 'Verified staff', email: 'verified@example.org', email_confirmed: true, role: 'clinical_staff', status: 'pending' },
    { id: 'unverified', full_name: 'Unverified staff', email: 'unverified@example.org', email_confirmed: false, role: 'clinical_staff', status: 'pending' },
    { id: 'existing-owner', full_name: 'Hidden shop owner', email: 'hidden-owner@example.org', email_confirmed: true, role: 'owner', status: 'approved' },
    { id: 'existing-staff', full_name: 'Hidden approved staff', email: 'hidden-staff@example.org', email_confirmed: true, role: 'clinical_staff', status: 'approved' },
  ]
  const raw = { profiles: [{ id: actor, full_name: 'Shop owner', role: 'owner', is_active: true }], clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila', clinic_name: 'Isolated vetshop' }] }
  await ownerContext.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await ownerContext.route(`${api.origin}/**`, (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/rest/v1/rpc/owner_veterina_code') { if (request.postDataJSON().p_rotate) currentCode = rotatedCode; return reply({ code: currentCode }) }
    if (url.pathname === '/functions/v1/admin-staff') {
      const input = request.postDataJSON(); actions.push(input)
      if (input.action === 'list') return reply({ accounts })
      if (input.action === 'approve') accounts.find((row) => row.id === input.id).status = 'approved'
      if (input.action === 'reject') accounts = accounts.filter((row) => row.id !== input.id)
      return reply({ success: true })
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected owner request ${url.pathname}`)
  })
  const ownerPage = await ownerContext.newPage()
  ownerPage.on('pageerror', (error) => errors.push(error.message))
  await ownerPage.goto(app.origin + '/sign-in?next=%2Fsettings')
  await expect(ownerPage).toHaveURL(app.origin + '/settings')
  await expect(ownerPage.getByRole('heading', { name: 'Verify your sign-in' })).toHaveCount(0)
  console.log('PASS enrolled authenticator no longer blocks password sign-in')
  await expect(ownerPage.locator('.clinic-registration-code')).toHaveText(originalCode)
  const qrImage = ownerPage.getByAltText("Scan to register as staff with this shop's Veterina Code prefilled")
  await expect(qrImage).toBeVisible()
  const firstQr = await qrImage.getAttribute('src')
  await ownerPage.getByRole('button', { name: 'Generate new code', exact: true }).click()
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Generate new code', exact: true }).click()
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)
  await expect(ownerPage.locator('.clinic-registration-code')).toHaveText(rotatedCode)
  await expect(qrImage).toBeVisible()
  assert.notEqual(await qrImage.getAttribute('src'), firstQr)
  const qrDownload = ownerPage.getByRole('link', { name: 'Download registration QR' })
  await expect(qrDownload).toHaveAttribute('href', await qrImage.getAttribute('src'))
  await ownerPage.getByRole('button', { name: 'Staff accounts', exact: true }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Pending staff approvals' })).toBeVisible()
  await expect(ownerPage.getByText('Hidden shop owner')).toHaveCount(0)
  await expect(ownerPage.getByText('Hidden approved staff')).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: 'Set up authenticator' })).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: 'Invite staff' })).toHaveCount(0)
  await expect(ownerPage.getByRole('article').filter({ hasText: 'Unverified staff' }).getByRole('button', { name: 'Approve account' })).toBeDisabled()
  await ownerPage.getByRole('article').filter({ has: ownerPage.getByRole('heading', { name: 'Verified staff', exact: true }) }).getByRole('button', { name: 'Approve account' }).click()
  await expect(ownerPage.getByRole('dialog').getByLabel('Role', { exact: false })).toHaveCount(0)
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Approve staff', exact: true }).click()
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)
  assert.equal(actions.find((row) => row.action === 'approve').role, 'clinical_staff')
  await ownerPage.getByRole('button', { name: 'Reject request', exact: true }).click()
  await expect(ownerPage.getByText('Verified staff', { exact: true })).toHaveCount(0)
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Reject request', exact: true }).click()
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)
  assert.equal(actions.find((row) => row.action === 'reject').id, 'unverified')
  await expect(ownerPage.getByText('No pending staff registrations for your shop.')).toBeVisible()
  await ownerPage.getByRole('button', { name: 'Clinic profile', exact: true }).click()
  await ownerPage.setViewportSize({ width: 375, height: 812 })
  await ownerPage.screenshot({ path: 'test-artifacts.local/veterina-code-mobile.png', fullPage: true })
  assert.ok(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Settings overflowed mobile')
  assert.deepEqual(errors, [])
  console.log('PASS owner code/QR rotation and download, verified-email approval, staff-only approval role, rejection and Settings mobile layout')
} finally { await app.close() }
