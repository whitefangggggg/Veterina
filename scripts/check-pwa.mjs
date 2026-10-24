import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Test the production build: development deliberately does not install a worker.
const origin = 'http://127.0.0.1:5179'
const workerPath = new URL('../dist/sw.js', import.meta.url)
const originalWorker = await readFile(workerPath, 'utf8')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5179', '--strictPort'], { stdio: 'pipe', windowsHide: true })
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch { /* Wait for preview startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(ready, 'Production preview did not start; run npm run build first')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin + '/sign-in')
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  const devtools = await context.newCDPSession(page)
  const { errors: manifestErrors } = await devtools.send('Page.getAppManifest')
  assert.deepEqual(manifestErrors, [], 'Chrome could not parse the installed page manifest')
  const { installabilityErrors } = await devtools.send('Page.getInstallabilityErrors')
  // Playwright contexts are private sessions, where Chrome disallows OS installation.
  assert.deepEqual(installabilityErrors.filter((error) => error.errorId !== 'in-incognito'), [], 'Chrome reported an app installability problem')

  const manifest = await (await fetch(origin + '/manifest.webmanifest')).json()
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/dashboard')
  assert.equal(manifest.scope, '/')
  for (const icon of manifest.icons) {
    const response = await fetch(origin + icon.src)
    assert.ok(response.ok)
    const png = Buffer.from(await response.arrayBuffer())
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes)
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'))
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').count(), 1)

  // The entry must be visible even before the browser offers its native prompt.
  await page.getByRole('button', { name: 'Install Veterina', exact: true }).click()
  await page.getByRole('dialog', { name: 'Install Veterina', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Install Veterina', exact: true }).waitFor()

  // A dismissed native prompt must not remove the entry for a later attempt.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = async () => {}
    event.userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
  })
  await page.getByRole('button', { name: 'Install Veterina', exact: true }).click()
  await page.getByRole('button', { name: 'Install Veterina', exact: true }).waitFor({ state: 'visible' })

  // Exercise our install UI without accepting an OS installation in automation.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = async () => { window.pwaPromptCalled = true }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
  })
  await page.getByRole('button', { name: 'Install Veterina', exact: true }).click()
  assert.equal(await page.evaluate(() => window.pwaPromptCalled), true)
  assert.equal(await page.getByRole('button', { name: 'Install Veterina', exact: true }).count(), 0)

  await page.getByLabel('Email address', { exact: true }).fill('unsaved@clinic.example')
  await context.setOffline(true)
  await page.getByText("You're offline", { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'unsaved@clinic.example')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Offline notice overflows on mobile')
  await page.reload()
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
  // A previously unvisited lazy route must also load from precached assets.
  await page.goto(origin + '/forgot-password')
  await page.getByRole('heading', { name: 'Forgot your password?', exact: true }).waitFor()
  const cachedUrls = await page.evaluate(async () => {
    const urls = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      urls.push(...(await cache.keys()).map((request) => request.url))
    }
    return urls
  })
  assert.ok(cachedUrls.some((url) => new URL(url).pathname === '/index.html'))
  assert.ok(cachedUrls.every((url) => new URL(url).origin === origin), 'An external API response entered Cache Storage')
  assert.ok(cachedUrls.every((url) => !/\/(rest|auth|functions|storage)\/v1\//.test(url)), 'Private data entered Cache Storage')
  await context.setOffline(false)
  await page.getByText("You're offline", { exact: true }).waitFor({ state: 'hidden' })

  // Change only the worker in the disposable build to exercise a real waiting update.
  await page.goto(origin + '/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill('keep-my-work@clinic.example')
  await writeFile(workerPath, `${originalWorker}\n// PWA lifecycle test ${Date.now()}\n`)
  await page.evaluate(async () => { const worker = await navigator.serviceWorker.getRegistration(); await worker.update() })
  await page.getByRole('region', { name: 'App update available' }).waitFor({ timeout: 20000 })
  assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'keep-my-work@clinic.example')
  await page.getByRole('button', { name: 'Later', exact: true }).click()
  assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'keep-my-work@clinic.example')
  await page.reload()
  await page.getByRole('button', { name: 'Reload and update', exact: true }).waitFor()
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Reload and update', exact: true }).click(),
  ])
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
  await page.getByRole('region', { name: 'App update available' }).waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])

  const iosContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 320, height: 812 }, isMobile: true, hasTouch: true,
  })
  const iosPage = await iosContext.newPage()
  await iosPage.goto(origin + '/sign-in')
  await iosPage.getByRole('button', { name: 'Install Veterina', exact: true }).click()
  await iosPage.getByText(/In Safari, open Share/).waitFor()
  assert.ok(await iosPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Installation guidance overflows on mobile')
  await iosPage.getByRole('button', { name: 'Done', exact: true }).click()
  assert.equal(await iosPage.getByRole('dialog', { name: 'Install Veterina' }).count(), 0)
  await iosPage.getByRole('button', { name: 'Install Veterina', exact: true }).waitFor()
  await iosContext.close()
  console.log('PASS PWA manifest and PNG icons, install UI, mobile guidance, offline reload and lazy routes, private-data cache isolation, reconnect, deferred update and accepted update')
} finally {
  await browser?.close()
  await writeFile(workerPath, originalWorker)
  server.kill()
}
