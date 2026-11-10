// KAN-17: synthetic, intercepted requests only; no hosted data is changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'
import { chooseSelectOption, selectControl } from './helpers/select.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const raw = {
  profiles: [{ id: actor, clinic_id: 'expiry-clinic', full_name: 'Expiry clinician', role: 'owner', is_active: true }],
  clinic_settings: [{ id: 'expiry-clinic', clinic_name: 'Expiry test clinic', timezone: 'Asia/Singapore' }],
  inventory_items: [
    { id: 'vaccine', name: 'Vaccine stockout', category: 'Vaccines', minimum_stock: 5 },
    { id: 'medicine', name: 'Medicine stockout', category: 'Medicine', minimum_stock: 5 },
    { id: 'mixed', name: 'Diagnostic supplies', category: 'Consumables', minimum_stock: 0 },
    { id: 'later', name: 'Later expiry', category: 'Other', minimum_stock: 0 },
    { id: 'archived', name: 'Archived item', category: 'Medicine', minimum_stock: 0, is_active: false },
  ].map((item) => ({ is_active: true, unit: 'unit', sku: item.id, ...item })),
  inventory_batches: [], inventory_movements: [],
}
const addLot = (id, item, date, quantity) => {
  raw.inventory_batches.push({ id, item_id: item, lot_number: id.toUpperCase(), expiration_date: date, is_active: true })
  raw.inventory_movements.push({ id: `stock-${id}`, item_id: item, batch_id: id, quantity_delta: quantity, movement_type: 'stock_in', reason: 'Synthetic opening stock', created_at: '2026-11-09T00:00:00Z' })
}
addLot('today', 'mixed', '2026-11-09', 1)
addLot('tomorrow', 'mixed', '2026-11-10', 2)
addLot('day-30', 'mixed', '2026-12-09', 0.5)
addLot('outside', 'later', '2026-12-10', 4)
addLot('empty', 'mixed', '2026-11-08', 0)
addLot('undated', 'mixed', null, 5)
addLot('archived', 'archived', '2026-11-08', 1)
const errors = []
const app = await browserServer(5214)
try {
  await mkdir('test-artifacts.local', { recursive: true })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(15000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'expiry@example.invalid', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
  await context.route(`${api.origin}/**`, (route) => {
    const url = new URL(route.request().url())
    const reply = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname.endsWith('/rpc/account_access')) return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    assert.equal(route.request().method(), 'GET', 'Expiry alerts must not mutate stock')
    return reply(raw[url.pathname.split('/').at(-1)] || [])
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-11-09T02:00:00Z') })
  const bell = () => page.getByRole('button', { name: /\d+ clinic notifications?/ })
  const notifications = page.getByRole('dialog', { name: 'Clinic notifications' })
  const summary = page.getByRole('status', { name: 'Stock expiry warnings' })
  await page.goto(`${app.origin}/dashboard`)
  await expect(page.locator('.stock-watch-row')).toHaveCount(2)
  await expect(page.locator('.stock-watch-row')).not.toContainText(['Diagnostic supplies', 'Diagnostic supplies'])
  await expect(summary).toContainText('3 batches expiring within 30 days')
  await expect(bell()).toHaveAccessibleName('3 clinic notifications')
  await bell().click()
  await expect(notifications.locator('.notif-expiry-item')).toHaveCount(3)
  await expect(notifications).toContainText('Expires today')
  await expect(notifications).toContainText('Expires tomorrow')
  await expect(notifications).toContainText('Expires in 30 days')
  await expect(notifications).not.toContainText('Archived item')
  await notifications.getByRole('link').filter({ hasText: 'Expires today' }).click()
  await expect(page).toHaveURL(/attention=expiring#inventory-batch-today$/)
  await expect(page.locator('#inventory-batch-today')).toBeFocused()
  await expect(page.locator('#inventory-batch-today')).toBeVisible()
  await expect(page.locator('.inventory-record')).toHaveCount(1)
  await expect(page.locator('.stat-card').filter({ hasText: 'Expiring in 30 days' }).locator('strong')).toHaveText('1')
  await page.reload()
  await expect(page.locator('#inventory-batch-today')).toBeFocused()
  // An alert must remain reachable from Inventory with unrelated local filters.
  await page.goto(`${app.origin}/inventory`)
  await page.getByLabel('Search inventory', { exact: true }).fill('Vaccine')
  await chooseSelectOption(page.getByLabel('Inventory category', { exact: true }), 'Vaccines')
  await bell().click()
  await notifications.getByRole('link').filter({ hasText: 'Expires tomorrow' }).click()
  await expect(page.locator('#inventory-batch-tomorrow')).toBeFocused()
  await expect(page.getByLabel('Search inventory', { exact: true })).toHaveValue('')
  await expect(selectControl(page.getByLabel('Inventory category', { exact: true }))).toHaveValue('All')
  // Reopening the same URL must recover filters and focus too.
  await page.getByLabel('Search inventory', { exact: true }).fill('Vaccine')
  await bell().click()
  await notifications.getByRole('link').filter({ hasText: 'Expires tomorrow' }).click()
  await expect(page.locator('#inventory-batch-tomorrow')).toBeFocused()
  await expect(page.getByLabel('Search inventory', { exact: true })).toHaveValue('')
  await bell().click()
  await notifications.getByRole('link', { name: /Review all expiry warnings/ }).click()
  await expect(page).toHaveURL(/attention=expiry$/)
  await expect(page.locator('.inventory-record')).toHaveCount(1)

  addLot('expired', 'mixed', '2026-11-08', 1)
  await page.goto(`${app.origin}/dashboard`)
  await expect(summary).toContainText('1 expired batch')
  await expect(summary).toContainText('3 batches expiring within 30 days')
  await bell().click()
  await expect(notifications.locator('.notif-expiry-item').first()).toContainText('Expired 1 day ago')
  await page.keyboard.press('Escape')
  await expect(bell()).toBeFocused()
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await bell().click()
      await expect(notifications).toBeVisible()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Expiry notifications overflow at ${width}px`)
      await page.screenshot({ path: `test-artifacts.local/stock-expiry-${colorScheme}-${width}.png` })
      await page.keyboard.press('Escape')
    }
  }
  await summary.getByRole('link', { name: '1 expired batch', exact: true }).click()
  const mixed = page.locator('#inventory-mixed')
  await expect(mixed).toContainText('Expired stock')
  await expect(mixed).toContainText('Expiring soon (3)')
  // Ledger changes remove depleted warnings on the next ordinary refresh.
  for (const batch of ['today', 'tomorrow', 'day-30', 'expired']) {
    const original = raw.inventory_movements.find((row) => row.batch_id === batch)
    raw.inventory_movements.push({ ...original, id: `used-${batch}`, quantity_delta: -original.quantity_delta })
  }
  raw.profiles[0].role = 'clinical_staff'
  await page.goto(`${app.origin}/dashboard`)
  await expect(summary).toHaveCount(0)
  await expect(bell()).toHaveAccessibleName('0 clinic notifications')
  // Clinic-local midnight brings a previously day-31 batch into the window.
  await page.clock.setSystemTime(new Date('2026-11-09T15:59:30Z'))
  await page.clock.runFor(60000)
  await expect(summary).toContainText('1 batch expiring within 30 days')
  await expect(bell()).toHaveAccessibleName('1 clinic notification')
  await bell().click()
  await expect(notifications).toContainText('Later expiry')
  await expect(notifications).toContainText('Expires in 30 days')
  assert.deepEqual(errors, [])
  console.log('PASS KAN-17 30-day batch alerts, dashboard visibility beyond top-two stockouts, notification counts/order, lot deep links/reload/filter recovery, mixed expired/upcoming lots, depleted/archived/undated exclusion, owner/staff access, clinic midnight and light/dark mobile layouts')
} finally { await app.close() }
