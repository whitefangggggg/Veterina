import { chooseSelectOption } from './helpers/select.mjs'
// Browser contracts are intercepted; subscription authorization is tested separately in Postgres.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000077'
const code = 'VET-ACCESS-' + 'B'.repeat(40)
const app = await browserServer(5191)
const errors = []

async function scenario({ admin = false, role = 'owner', expired = false, onboarding = false, signedOut = false, seconds = null } = {}) {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  const user = { id: actor, email: 'subscription@example.org', email_confirmed_at: new Date().toISOString(), app_metadata: {},
    user_metadata: { account_type: 'owner', clinic_name: 'Activation clinic', full_name: 'Clinic owner' } }
  const session = { access_token: mockAccessToken(actor), refresh_token: 'subscription-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user }
  const state = { profile: onboarding || admin ? null : { id: actor, clinic_id: 'clinic-a', role, is_active: true, full_name: 'Clinic owner' },
    expired, expiresAt: new Date(Date.now() + (expired ? -86400000 : seconds === null ? 86400000 * 5 : seconds * 1000)).toISOString(),
    calls: [], clinicReads: [], failExtension: true, failRenewal: true, authorizations: [] }
  const clinics = [
    { id: 'clinic-a', clinicName: 'Paws clinic', timezone: 'Asia/Manila', owners: [{ name: 'Rivera', email: 'rivera@example.org' }], status: 'active', expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(), transition: true },
    { id: 'clinic-b', clinicName: 'Expired clinic', timezone: 'UTC', owners: [{ name: 'Lee', email: 'lee@example.org' }], status: 'expired', expiresAt: new Date(Date.now() - 86400000).toISOString() },
  ]
  const codes = []
  if (!signedOut) await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/auth/v1/authorize') {
      state.authorizations.push(url)
      const callback = new URL(url.searchParams.get('redirect_to'))
      callback.hash = new URLSearchParams({ access_token: session.access_token, refresh_token: session.refresh_token, expires_in: '3600', token_type: 'bearer' }).toString()
      return route.fulfill({ status: 302, headers: { location: callback.href }, body: '' })
    }
    if (url.pathname === '/auth/v1/user') return reply(user)
    if (url.pathname === '/auth/v1/token') return reply(session)
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname === '/rest/v1/profiles') return reply(state.profile ? [state.profile] : [])
    if (url.pathname === '/rest/v1/rpc/account_access') {
      if (Date.parse(state.expiresAt) <= Date.now()) state.expired = true
      const access = mockAccountAccess(state.profile, { isPlatformAdmin: admin, needsRegistration: onboarding && !state.profile, registrationType: 'owner' })
      if (access.subscription) Object.assign(access.subscription, { expiresAt: state.expiresAt, status: state.expired ? 'expired' : 'active' })
      return reply(access)
    }
    if (url.pathname === '/functions/v1/platform-admin') {
      const input = request.postDataJSON(); state.calls.push(input)
      assert.equal(input.actor, undefined); assert.equal(input.p_actor, undefined)
      assert.ok(admin, 'Non-admin called the platform API')
      if (input.action === 'list') return reply({ serverNow: new Date().toISOString(), clinics, codes })
      if (input.action === 'generate') {
        assert.deepEqual(input.data, { label: 'Clinic partners', windowDays: 90, termDays: 45 })
        codes.push({ id: 'code-a', label: input.data.label, suffix: 'BBBBBB', windowDays: 90, termDays: 45, status: 'unused', redemptions: 0 })
        return reply({ id: 'code-a', code })
      }
      if (input.action === 'extend') {
        if (state.failExtension) { state.failExtension = false; return reply({ error: 'REQUEST_FAILED' }, 400) }
        const previous = state.calls.filter((v) => v.action === 'extend')
        assert.equal(previous[0].requestId, input.requestId, 'Extension retry changed its idempotency key')
        const clinic = clinics.find((v) => v.id === input.data.clinicId)
        clinic.expiresAt = new Date(Date.parse(clinic.expiresAt) + input.data.days * 86400000).toISOString()
        return reply({ clinicId: clinic.id, expiresAt: clinic.expiresAt })
      }
      if (input.action === 'history') return reply({ events: [{ id: 'event', action: 'admin_extension', created_at: new Date().toISOString(), days: 30, note: 'Payment received', expires_at: clinics[0].expiresAt }] })
      if (input.action === 'revoke') { codes[0].status = 'revoked'; return reply({ id: codes[0].id }) }
      throw new Error('Unexpected admin action')
    }
    if (url.pathname === '/functions/v1/clinic-activation') {
      const input = request.postDataJSON(); state.calls.push(input)
      assert.equal(input.actor, undefined); assert.equal(input.clinicId, undefined)
      if (input.code !== code) return reply({ error: 'ACTIVATION_CODE_INVALID' }, 400)
      if (input.renew && state.failRenewal) { state.failRenewal = false; return reply({ error: 'ACTIVATION_CODE_USED' }, 400) }
      state.profile ||= { id: actor, clinic_id: 'clinic-a', role: 'owner', is_active: true, full_name: 'Clinic owner' }
      state.expired = false; state.expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()
      return reply({ status: 'registered', clinicId: 'clinic-a', expiresAt: state.expiresAt })
    }
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname.startsWith('/rest/v1/')) {
      state.clinicReads.push(url.pathname)
      assert.ok(!admin && !state.expired && state.profile, 'Unauthorized clinic read')
      if (url.pathname.endsWith('/clinic_settings')) return reply([{ id: 'settings', clinic_name: 'Paws clinic', timezone: 'Asia/Manila', onboarding_completed_at: onboarding ? null : new Date().toISOString() }])
      return reply([])
    }
    throw new Error(`Unexpected subscription request ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  return { context, page, state }
}

try {
  await mkdir('test-artifacts.local', { recursive: true })
  {
    const { context, page, state } = await scenario({ admin: true, signedOut: true })
    await page.goto(app.origin + '/admin')
    await expect(page).toHaveURL(app.origin + '/admin/sign-in')
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await expect(page).toHaveURL(app.origin + '/admin')
    assert.equal(new URL(state.authorizations[0].searchParams.get('redirect_to')).searchParams.get('next'), '/admin')
    await expect(page.getByRole('heading', { name: 'Clinic subscriptions', exact: true })).toBeVisible()
    await page.getByRole('searchbox').fill('lee@example.org')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody')).toContainText('Expired clinic')
    await page.getByRole('searchbox').fill('')
    await chooseSelectOption(page.getByLabel('Filter subscription status'), 'soon')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await chooseSelectOption(page.getByLabel('Filter subscription status'), 'all')
    await page.locator('tbody tr').filter({ hasText: 'Paws clinic' }).getByRole('button', { name: 'Add time' }).click()
    await page.getByLabel('Admin note').fill('Payment received')
    await page.getByRole('dialog').getByRole('button', { name: 'Add time', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Add time', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('tbody tr').filter({ hasText: 'Paws clinic' }).getByRole('button', { name: 'History' }).click()
    await expect(page.getByRole('dialog')).toContainText('Payment received')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('tab', { name: 'Activation codes' }).click()
    await page.getByLabel('Code label').fill('Clinic partners')
    await chooseSelectOption(page.getByLabel('Code availability window', { exact: true }), '90')
    await chooseSelectOption(page.getByLabel('Subscription per clinic', { exact: true }), 'custom')
    await page.getByLabel('Subscription per clinic in days').fill('45')
    await page.getByRole('button', { name: 'Generate code' }).click()
    await expect(page.getByRole('status')).toContainText(code)
    await expect(page.locator('tbody')).toContainText('Starts with first redemption')
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Admin overflow at ${width}px`)
      await page.screenshot({ path: `test-artifacts.local/subscriptions-admin-${width}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('keep their full term')
    await page.getByRole('button', { name: 'Revoke code', exact: true }).click()
    await expect(page.locator('tbody')).toContainText('revoked')
    assert.deepEqual(state.clinicReads, [])
    await context.close()
  }
  for (const role of ['owner', 'clinical_staff']) {
    const { context, page, state } = await scenario({ role })
    await page.goto(app.origin + '/admin')
    await expect(page).toHaveURL(app.origin + '/admin')
    await expect(page.getByRole('heading', { name: 'Authorized paws only', exact: true })).toBeVisible()
    assert.deepEqual(state.calls, [])
    assert.deepEqual(state.clinicReads, [])
    await context.close()
  }
  for (const role of ['owner', 'clinical_staff']) {
    const { context, page, state } = await scenario({ role, expired: true })
    await page.goto(app.origin + '/patients')
    await expect(page).toHaveURL(app.origin + '/subscription')
    await expect(page.getByRole('heading', { name: 'Your clinic subscription has expired' })).toBeVisible()
    assert.deepEqual(state.clinicReads, [])
    if (role === 'owner') {
      await page.getByLabel('Subscription activation code').fill(code)
      await page.getByRole('button', { name: 'Renew subscription' }).click()
      await expect(page.getByRole('alert')).toContainText('already used')
      await page.getByRole('button', { name: 'Renew subscription' }).click()
      await expect(page.getByRole('heading', { name: 'Your clinic subscription', exact: true })).toBeVisible()
      const redemptions = state.calls.filter((v) => v.renew)
      assert.equal(redemptions[0].requestId, redemptions[1].requestId)
      await page.getByRole('link', { name: 'Open clinic' }).click()
      await expect(page.locator('.workspace-header')).toBeVisible()
      await expect(page.locator('.subscription-strip')).toBeVisible()
    } else {
      await expect(page.getByLabel('Subscription activation code')).toHaveCount(0)
      await expect(page.getByText('Ask your clinic owner or administrator to restore access.')).toBeVisible()
    }
    await context.close()
  }
  {
    const { context, page, state } = await scenario({ onboarding: true })
    await page.goto(app.origin + '/patients')
    await expect(page).toHaveURL(/\/complete-account/)
    await expect(page.getByLabel('Create account as')).toBeDisabled()
    await page.getByLabel('Subscription activation code').fill(code)
    await page.getByRole('button', { name: 'Create clinic', exact: true }).click()
    await expect(page.getByRole('heading', { name: /meet your clinic/ })).toBeVisible()
    assert.equal(state.calls[0].renew, false)
    await context.close()
  }
  {
    const { context, page } = await scenario({ seconds: 3 })
    await page.goto(app.origin + '/patients')
    await expect(page.locator('.workspace-header')).toBeVisible()
    await expect(page).toHaveURL(app.origin + '/subscription')
    await expect(page.locator('.workspace-header')).toHaveCount(0)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS admin OAuth return, role denial, clinics/search/filters/history, code durations, extension retries, revocation, expired owner/staff, renewal, email activation, expiry unmount and mobile layout (intercepted API)')
} finally { await app.close() }
