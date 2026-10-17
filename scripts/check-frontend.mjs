import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const origin = 'http://127.0.0.1:5177'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], { stdio: 'pipe', windowsHide: true })
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch { /* Wait for Vite startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(ready, 'Vite did not start on the test port')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  const clinicCalls = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/supabase\.co\/(rest|functions)\//.test(request.url())) clinicCalls.push(request.url())
  })
  for (const route of ['/dashboard', '/patients', '/patients/pet-1', '/appointments', '/reminders', '/inventory', '/suppliers', '/reports', '/settings', '/knowledge']) {
    await page.goto(origin + route)
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
    const url = new URL(page.url())
    assert.equal(url.pathname, '/sign-in')
    assert.equal(url.searchParams.get('next'), route)
  }
  for (const legacy of ['/login', '/demo']) {
    await page.goto(origin + legacy)
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/sign-in')
  }
  await page.goto(origin)
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor()
  assert.equal(await page.locator('a[href="/demo"]').count(), 0)
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click()
  await page.getByRole('link', { name: 'Forgot your password?', exact: true }).click()
  await page.getByRole('heading', { name: 'Forgot your password?', exact: true }).waitFor()
  await page.getByLabel('Email address', { exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.locator(':focus').textContent(), 'Send reset link')
  await page.goto(origin + '/reset-password')
  await page.getByRole('alert').filter({ hasText: 'reset link' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save new password', exact: true }).count(), 0)
  await page.goto(origin + '/forgot-password')
  await page.goto(origin + '/reset-password#error=access_denied&error_code=otp_expired&error_description=Expired')
  await page.getByRole('alert').filter({ hasText: 'invalid or has expired' }).waitFor()
  for (const [route, heading] of [['/sign-in', 'Welcome back'], ['/create-account', 'Create your account'], ['/forgot-password', 'Forgot your password?']]) {
    await page.goto(origin + route)
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route + ' overflows on mobile')
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(clinicCalls, [], 'Signed-out visitors made a clinic API request')
  console.log('PASS protected routes, legacy links, account pages, invalid reset links, keyboard access, mobile layouts, and anonymous clinic API isolation')
} finally {
  await browser?.close()
  server.kill()
}
