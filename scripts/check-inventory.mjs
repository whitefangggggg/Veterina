// Browser contracts use intercepted APIs; portal_workflows.sql verifies storage.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const userId = '10000000-0000-4000-8000-000000000001'
const profile = { id: userId, full_name: 'Inventory clinician', role: 'owner', is_active: true }
const raw = { profiles: [profile], clinic_settings: [{ id: 'settings', timezone: 'Asia/Manila' }], inventory_items: [] }
const calls = [], errors = []
let failUpdate = true
const app = await browserServer(5184)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const session = { access_token: mockAccessToken(userId), refresh_token: 'browser-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'inventory@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: payload, p_key: key } = route.request().postDataJSON()
      calls.push({ action, payload, key })
      assert.ok(['create_inventory_item', 'update_inventory_item'].includes(action), `Unexpected mutation: ${action}`)
      if (action === 'update_inventory_item' && failUpdate) {
        failUpdate = false
        return reply({ message: 'Save interrupted. Please retry.', code: 'P0001' }, 400)
      }
      const item = action === 'create_inventory_item'
        ? { id: 'inventory-item', sku: 'SKU-000001', is_active: true }
        : raw.inventory_items.find((row) => row.id === payload.id)
      Object.assign(item, { name: payload.name, category: payload.category, unit: payload.unit, minimum_stock: Number(payload.minimumStock), notes: payload.notes })
      if (action === 'create_inventory_item') raw.inventory_items.push(item)
      return reply({ id: item.id })
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected API request: ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(app.origin + '/inventory')
  await page.getByRole('button', { name: 'New item', exact: true }).click()
  await page.getByLabel('Item name', { exact: false }).fill('Storage medicine')
  const notes = 'Keep refrigerated\nProtect from light <test>'
  await page.getByLabel('Notes', { exact: true }).fill(notes)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.inventory-item-notes')).toContainText(notes)
  assert.equal(calls[0].payload.notes, notes)
  await page.reload()
  await page.getByRole('button', { name: 'Edit item', exact: true }).click()
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
  assert.equal(calls[1].key, calls[2].key, 'Retry changed the idempotency key')
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
  assert.deepEqual(errors, [])
  console.log('PASS inventory notes create/edit, reload, cancel, retry, clearing, literal text and 320/375/1440px layouts (intercepted API)')
} finally {
  await app.close()
}
