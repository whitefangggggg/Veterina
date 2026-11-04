import { mockAccountAccess } from './helpers/mock-access.mjs'
// OAuth browser contracts use intercepted Auth responses; no Google account or clinic data is changed.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000099'
const code = 'VET-0123456789ABCDEF0123'
const app = await browserServer(5189)
const errors = []

async function scenario({ approved = false, failSetup = false } = {}) {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  const user = { id: actor, email: 'google@example.org', email_confirmed_at: '2026-11-03T00:00:00Z',
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: 'Google Clinician' } }
  const session = { access_token: mockAccessToken(actor), refresh_token: 'google-browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user }
  const profile = { id: actor, full_name: 'Google Clinician', role: 'owner', is_active: true, clinic_id: 'clinic' }
  const state = { profile: approved ? profile : null, registration: approved ? 'registered' : 'unregistered', authorizations: [], submissions: [], clinicReads: [] }
  await context.route(`${api.origin}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url())
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(state.profile, { needsRegistration: state.registration === 'unregistered', registrationType: 'google' }))
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
    if (url.pathname === '/rest/v1/rpc/google_account_registration') return reply({ status: state.registration })
    if (url.pathname === '/rest/v1/rpc/veterina_code_info') return reply({ valid: request.postDataJSON().p_code === code, clinicName: 'Google test clinic' })
    if (['/functions/v1/google-registration', '/functions/v1/clinic-activation'].includes(url.pathname)) {
      const input = request.postDataJSON(); state.submissions.push(input)
      assert.equal(input.p_actor, undefined, 'Browser supplied an actor ID')
      if (failSetup) { failSetup = false; return reply({ error: 'Registration interrupted. Please retry.' }, 400) }
      if (url.pathname.endsWith('/clinic-activation')) { state.profile = profile; state.registration = 'registered' }
      else {
        if (input.veterinaCode !== code) return reply({ error: 'Ask your shop owner for the current Veterina Code.' }, 400)
        state.registration = 'pending'
      }
      return reply({ status: state.registration })
    }
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname.startsWith('/rest/v1/')) {
      state.clinicReads.push(url.pathname)
      assert.ok(state.profile, 'Unapproved Google account fetched clinic data')
      if (url.pathname.endsWith('/clinic_settings')) return reply([{ id: 'settings', clinic_name: 'Google test clinic', timezone: 'Asia/Manila', onboarding_completed_at: approved ? '2026-11-03T00:00:00Z' : null, onboarding_step: 0 }])
      return reply([])
    }
    throw new Error(`Unexpected Google Auth request ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  return { context, page, state }
}

try {
  // Existing approved accounts return directly to their requested clinic route.
  {
    const { context, page, state } = await scenario({ approved: true })
    await page.goto(app.origin + '/sign-in?next=' + encodeURIComponent('/patients?from=google#records'))
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(page).toHaveURL(app.origin + '/patients?from=google#records')
    assert.equal(state.authorizations[0].searchParams.get('provider'), 'google')
    assert.equal(state.authorizations[0].searchParams.get('prompt'), 'select_account')
    assert.equal(state.submissions.length, 0)
    await context.close()
  }
  // Google signup bypasses email/password inputs, retains clinic preferences, and retries safely.
  {
    const { context, page, state } = await scenario({ failSetup: true })
    await page.goto(app.origin + '/create-account?next=%2Fpatients')
    await page.getByLabel('Create account as').selectOption('owner')
    await page.getByLabel('Clinic name', { exact: true }).fill('My Google clinic')
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Finish setting up your account' })).toBeVisible()
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Google Clinician')
    await expect(page.getByLabel('Create account as')).toHaveValue('owner')
    await expect(page.getByLabel('Clinic name', { exact: true })).toHaveValue('My Google clinic')
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
    await page.getByLabel('Subscription activation code').fill('VET-ACCESS-' + 'A'.repeat(40))
    await page.getByRole('button', { name: 'Create clinic', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Registration interrupted')
    await expect(page.getByLabel('Clinic name', { exact: true })).toHaveValue('My Google clinic')
    await page.getByRole('button', { name: 'Create clinic', exact: true }).click()
    await expect(page).toHaveURL(app.origin + '/patients')
    assert.equal(state.submissions.length, 2)
    await expect(page.getByRole('heading', { name: 'Let’s meet your clinic.' })).toBeVisible()
    await context.close()
  }
  // Staff signup requires a code and approval; reload never reopens submitted setup.
  {
    const { context, page, state } = await scenario()
    await page.goto(app.origin + '/create-account?code=' + code + '&next=%2Finventory')
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(page.getByLabel('Veterina Code', { exact: true })).toHaveValue(code)
    await page.getByLabel('Veterina Code', { exact: true }).fill('VET-BAD')
    await page.getByRole('button', { name: 'Request clinic access', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('current Veterina Code')
    await page.getByLabel('Veterina Code', { exact: true }).fill(code)
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Google account setup overflows at ${width}px`)
    }
    await page.getByRole('button', { name: 'Request clinic access', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Waiting for shop approval' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Waiting for shop approval' })).toBeVisible()
    assert.equal(state.clinicReads.length, 0)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await context.close()
  }
  // OAuth cancellation is explained without rendering provider-controlled descriptions.
  {
    const { context, page } = await scenario()
    await page.goto(app.origin + '/sign-in?auth=google#error=access_denied&error_description=untrusted-description')
    await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled')
    await expect(page.getByRole('alert')).not.toContainText('untrusted-description')
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
    for (const path of ['/sign-in', '/create-account']) {
      await page.goto(app.origin + path)
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} overflows at ${width}px`)
      }
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS Google sign-in/signup, callback return paths, owner setup/retry, staff code/approval, cancellation, sign-out and mobile layouts (intercepted OAuth)')
} finally { await app.close() }
