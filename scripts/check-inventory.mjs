import { chooseSelectOption } from './helpers/select.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'
// Browser contracts use intercepted APIs; portal_workflows.sql verifies storage.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const userId = '10000000-0000-4000-8000-000000000001'
const profile = { id: userId, full_name: 'Inventory clinician', role: 'owner', is_active: true }
const raw = { profiles: [profile], clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila' }], inventory_items: [], inventory_batches: [], inventory_movements: [] }
const calls = [], errors = [], receipts = new Map()
let failUpdate = true, loseCreateAcknowledgement = true
const app = await browserServer(5184)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const session = { access_token: mockAccessToken(userId), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'inventory@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = route.request().postDataJSON()
      calls.push({ action, payload, key })
      if (receipts.has(key)) return reply(receipts.get(key))
      assert.ok(['create_inventory_item', 'update_inventory_item'].includes(action), `Unexpected mutation: ${action}`)
      if (action === 'update_inventory_item' && failUpdate) {
        failUpdate = false
        return reply({ message: 'Save interrupted. Please retry.', code: 'P0001' }, 400)
      }
      const item = action === 'create_inventory_item'
        ? { id: crypto.randomUUID(), sku: `SKU-${String(raw.inventory_items.length + 1).padStart(6, '0')}`, is_active: true, allows_fraction: payload.allowsFraction === 'true' }
        : raw.inventory_items.find((row) => row.id === payload.id)
      Object.assign(item, { name: payload.name, category: payload.category, unit: payload.unit, minimum_stock: Number(payload.minimumStock), notes: payload.notes })
      if (action === 'create_inventory_item') {
        raw.inventory_items.push(item)
        const batch = { id: crypto.randomUUID(), item_id: item.id, lot_number: payload.lotNumber, expiration_date: payload.expirationDate || null, is_active: true }
        raw.inventory_batches.push(batch)
        if (Number(payload.initialQuantity) > 0) raw.inventory_movements.push({ id: crypto.randomUUID(), item_id: item.id, batch_id: batch.id, movement_type: 'stock_in', quantity_delta: Number(payload.initialQuantity), reason: 'Initial stock', performed_by: userId, created_at: new Date().toISOString() })
      }
      const result = { id: item.id }; receipts.set(key, result)
      if (action === 'create_inventory_item' && loseCreateAcknowledgement) { loseCreateAcknowledgement = false; return reply({ message: 'Stock save acknowledgement interrupted. Please retry.' }, 400) }
      return reply(result)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected API request: ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(app.origin + '/inventory')
  await page.getByRole('button', { name: 'New item', exact: true }).click()
  await page.getByLabel('Item name', { exact: false }).fill('Storage medicine')
  const initialStock = page.getByLabel('Initial stock quantity', { exact: false })
  await expect(initialStock).toHaveValue('0')
  await expect(initialStock).toHaveAttribute('step', '1')
  await initialStock.fill('-1')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  assert.equal(calls.length, 0, 'Negative initial stock reached the save payload')
  await initialStock.fill('2.5')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  assert.equal(calls.length, 0, 'Fractional stock was accepted for a whole-unit item')
  await chooseSelectOption(page.getByLabel('Allow fractional quantities'), 'true')
  await expect(initialStock).toHaveAttribute('step', '0.01')
  await initialStock.fill('0.001')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  assert.equal(calls.length, 0, 'Excess decimal precision reached the save payload')
  await initialStock.fill('2.5')
  await page.getByLabel('Initial batch / lot number').fill('PARTIAL-INITIAL')
  const notes = 'Keep refrigerated\nProtect from light <test>'
  await page.getByLabel('Notes', { exact: true }).fill(notes)
  await mkdir('test-artifacts.local', { recursive: true })
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1100 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `New stock form overflow at ${width}px`)
  }
  await page.getByRole('dialog').screenshot({ path: 'test-artifacts.local/inventory-initial-stock.png' })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Stock save acknowledgement interrupted')
  await expect(initialStock).toHaveValue('2.5')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.inventory-item-notes')).toContainText(notes)
  assert.equal(calls[0].payload.notes, notes)
  assert.equal(calls[0].payload.initialQuantity, '2.5')
  assert.equal(calls[0].key, calls[1].key)
  assert.equal(raw.inventory_items.length, 1)
  assert.equal(raw.inventory_batches.length, 1)
  assert.equal(raw.inventory_movements.length, 1)
  await expect(page.locator('.inventory-record')).toContainText('2.5 unit')
  await page.reload()
  await page.getByRole('button', { name: 'Edit item', exact: true }).click()
  await expect(initialStock).toHaveCount(0)
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(notes)
  await page.getByLabel('Notes', { exact: true }).fill('Unsaved note')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.inventory-item-notes')).toContainText(notes)
  await page.getByRole('button', { name: 'Edit item', exact: true }).click()
  const updated = 'Store in a dry place\n' + 'UnbrokenStorageInstruction'.repeat(15)
  await page.getByLabel('Notes', { exact: true }).fill(updated)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Save interrupted')
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(updated)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const updateCalls = calls.filter((call) => call.action === 'update_inventory_item')
  assert.equal(updateCalls[0].key, updateCalls[1].key, 'Retry changed the idempotency key')
  await page.reload()
  await expect(page.locator('.inventory-item-notes')).toContainText(updated)
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Notes overflow at ${width}px`)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/inventory-notes-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Edit item', exact: true }).click()
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(updated)
  await page.getByLabel('Notes', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.inventory-item-notes')).toHaveCount(0)
  assert.equal(calls.at(-1).payload.notes, '')
  profile.role = 'clinical_staff'
  await page.reload()
  await page.getByRole('button', { name: 'New item', exact: true }).click()
  await page.getByLabel('Item name', { exact: false }).fill('Whole stock item')
  await page.getByLabel('Initial stock quantity', { exact: false }).fill('12')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.inventory-record').filter({ hasText: 'Whole stock item' })).toContainText('12 unit')
  await page.getByRole('button', { name: 'New item', exact: true }).click()
  await page.getByLabel('Item name', { exact: false }).fill('Empty stock item')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.inventory-record').filter({ hasText: 'Empty stock item' })).toContainText('0 unit')
  assert.equal(raw.inventory_movements.length, 2, 'Zero opening stock wrote a movement')
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Inventory cards overflow in ${colorScheme} at ${width}px`)
      await page.screenshot({ path: `test-artifacts.local/inventory-cards-${colorScheme}-${width}.png`, fullPage: true })
    }
  }
  const firstCard = page.locator('.inventory-record').first()
  await firstCard.locator('summary').click()
  await expect(firstCard.locator('.ledger-details')).toHaveAttribute('open', '')
  await expect(firstCard.locator('.ledger-details')).toContainText('PARTIAL-INITIAL')
  assert.deepEqual(errors, [])
  console.log('PASS initial whole/fractional/zero stock, quantity validation, owner/staff creation, lost acknowledgement retry, notes edit/reload, ledger balances and mobile layouts (intercepted API)')
} finally {
  await app.close()
}
