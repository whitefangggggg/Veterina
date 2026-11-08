// Intercepted browser acceptance. SQL/concurrency suites verify persistence.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'
import { openNewVisit, reviewRecord } from './helpers/new-visit.mjs'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001', petId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-11-07T04:00:00Z'), today = '2026-11-07'
const raw = {
  profiles: [{ id: actor, full_name: 'Care recorder', role: 'clinical_staff', is_active: true }],
  clinic_settings: [{ id: 'settings', clinic_name: 'Preventive clinic', timezone: 'Asia/Manila' }],
  owners: [{ id: 'owner', full_name: 'Patient owner', phone: '09171234567', is_active: true }],
  pets: [{ id: petId, owner_id: 'owner', name: 'Ming', record_number: 'VET-1', species: 'Cat', status: 'Active', baseline_weight: 5 }],
  service_types: [{ id: 'vaccine-service', name: 'Vaccinations and Deworming', workflow: 'vaccination', is_active: true }],
  inventory_items: [
    { id: 'vax', name: 'Anti-Rabies', brand: 'Vaccine brand', category: 'Vaccines', unit: 'vial', is_active: true },
    { id: 'med', name: 'Dewormer', brand: 'Medicine brand', category: 'Medicine', unit: 'tablet', is_active: true },
    { id: 'archived', name: 'Archived vaccine', brand: 'Old brand', category: 'Vaccines', unit: 'vial', is_active: false },
  ],
  inventory_batches: ['vax', 'med'].map((id) => ({ id: `${id}-batch`, item_id: id, lot_number: `${id}-lot`, is_active: true, expiration_date: '2028-12-31' })),
  inventory_movements: ['vax', 'med'].map((id) => ({ id: `${id}-delivery`, item_id: id, batch_id: `${id}-batch`, quantity_delta: 10, created_at: now.toISOString() })),
  vaccinations: [], preventive_care_records: [], deworming_administrations: [], queue_entries: [],
}
const calls = [], errors = [], receipts = new Map()
let failSave = true, failCompletion = true
function saveRecord(data, completed = false) {
  const id = data.id || crypto.randomUUID()
  const parent = raw.preventive_care_records.find((row) => row.id === id) || { id, pet_id: petId, kind: data.kind, recording_purpose: data.recordingPurpose, version: -1 }
  Object.assign(parent, { administered_at: data.administeredAt, administered_by: data.veterinarianId || null, administered_by_name: data.veterinarianName || '', version: parent.version + 1 })
  if (!raw.preventive_care_records.includes(parent)) raw.preventive_care_records.push(parent)
  const table = data.kind === 'vaccination' ? raw.vaccinations : raw.deworming_administrations
  for (const item of data.kind === 'vaccination' ? data.vaccines : [data.deworming]) {
    const product = raw.inventory_items.find((entry) => entry.id === item.inventoryItemId)
    const row = table.find((entry) => entry.id === item.id) || { id: item.id, preventive_record_id: id }
    Object.assign(row, { pet_id: petId, vaccine_name: product?.name || item.vaccine, product_name: product?.name || item.vaccine, brand: product?.brand || item.brand, lot_number: item.lotNumber || (product ? `${product.id}-lot` : ''),
      dose: item.dose, administered_at: data.administeredAt, next_due_at: item.nextDueAt, administered_by: data.veterinarianId || null, administered_by_name: data.veterinarianName || '', recording_purpose: data.recordingPurpose,
      inventory_item_id: item.inventoryItemId, batch_id: item.batchId, dispense_quantity: item.dispenseQuantity, dispense_unit: product?.unit, stock_tracked: data.recordingPurpose === 'queue', consumed_at: completed ? now.toISOString() : row.consumed_at })
    if (!table.includes(row)) table.push(row)
  }
  let queue = raw.queue_entries.find((entry) => entry.preventive_record_id === id)
  if (data.recordingPurpose === 'queue' && !queue) {
    queue = { id: crypto.randomUUID(), pet_id: petId, preventive_record_id: id, category: 'vaccination', service_name: 'Vaccinations and Deworming', status: 'waiting', source: 'patient_record', veterinarian_id: actor,
      queue_number: raw.queue_entries.length + 1, queue_date: today, arrived_at: now.toISOString() }
    raw.queue_entries.push(queue)
  }
  return { id, ...(queue ? { queueEntryId: queue.id, queueNumber: queue.queue_number } : {}) }
}
const app = await browserServer(5196)
try {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  context.setDefaultTimeout(12000)
  const session = { access_token: mockAccessToken(actor), refresh_token: 'test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: actor, role: 'authenticated', email: 'care@example.org', app_metadata: {}, user_metadata: {} } }
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session })
  await context.route(`${api.origin}/**`, (route) => {
    const url = new URL(route.request().url())
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(raw.profiles[0]))
    if (url.pathname === '/auth/v1/user') return reply(session.user)
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action: action, p_data: data, p_key: key } = route.request().postDataJSON()
      calls.push({ action, data, key })
      if (receipts.has(key)) return reply(receipts.get(key))
      let result
      if (action === 'create_preventive_care' || action === 'update_preventive_care') {
        if (failSave) { failSave = false; return reply({ message: 'Save interrupted. Please retry.' }, 400) }
        result = saveRecord(data)
      } else if (action === 'save_queue_draft') {
        const queue = raw.queue_entries.find((entry) => entry.id === data.id)
        queue.care_draft = data.record; queue.draft_version = data.draftVersion + 1; queue.draft_saved_at = now.toISOString()
        result = { id: queue.id }
      } else if (action === 'complete_queue_entry') {
        if (failCompletion) { failCompletion = false; return reply({ message: 'INSUFFICIENT_STOCK' }, 400) }
        result = saveRecord(data.record, true)
        const queue = raw.queue_entries.find((entry) => entry.id === data.id)
        queue.status = 'completed'; queue.care_draft = {}; queue.draft_saved_at = null; queue.finished_at = now.toISOString()
      } else throw new Error(`Unexpected mutation ${action}`)
      receipts.set(key, result); return reply(result)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install({ time: now })
  await page.goto(`${app.origin}/patients/${petId}?tab=vaccines`)
  const add = async (historical = true) => {
    await openNewVisit(page, 'Vaccination')
    await page.getByRole('button', { name: historical ? /Record-keeping only/ : /Queue processing/ }).click()
  }
  await add()
  await expect(page.getByLabel('Date administered')).toHaveValue('')
  await expect(page.getByLabel('Veterinarian', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  assert.equal(calls.length, 0)
  await page.getByLabel('Date administered').fill('2020-01-02')
  await page.getByLabel('Veterinarian', { exact: true }).fill('Outside clinician')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByLabel('Product name 1', { exact: true }).fill('Historical Anti-Rabies')
  await page.getByLabel('Brand 1', { exact: true }).fill('Original brand')
  await page.getByLabel('Batch / lot number 1', { exact: true }).fill('OLD-01')
  await page.getByRole('button', { name: 'Add another vaccine' }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Product name 2', { exact: true }).fill('Historical combination')
  await page.getByRole('button', { name: 'Add another vaccine' }).click()
  await page.getByRole('button', { name: 'Remove vaccine 3' }).click()
  const layouts = async () => {
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode })
      for (const width of [320, 375, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow in ${mode} at ${width}: ${await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(-8).map(e => [e.tagName,e.className,e.getBoundingClientRect().width]))}`)
      }
    }
  }
  await layouts()
  await reviewRecord(page)
  await page.getByRole('button', { name: 'Save historical record' }).click()
  await expect(page.getByRole('alert')).toContainText('Save interrupted')
  await expect(page.getByLabel('Product name 2', { exact: true })).toHaveValue('Historical combination')
  await page.getByRole('button', { name: 'Save historical record' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls[0].key, calls[1].key)
  assert.equal(calls[1].action, 'create_preventive_care')
  assert.equal(calls[1].data.vaccines.length, 2)
  assert.equal(calls[1].data.vaccines[0].inventoryItemId, undefined)
  assert.equal(raw.queue_entries.length, 0)
  const historyId = raw.preventive_care_records[0].id
  await page.goto(`${app.origin}/patients/${petId}?tab=vaccines#vaccination-${raw.vaccinations[1].id}`)
  await expect(page.locator('.preventive-history-card')).toHaveCount(1)
  await expect(page.locator('.preventive-history-card')).toContainText('2 vaccines')
  await page.getByLabel('Search vaccinations and deworming').fill('combination')
  await expect(page.locator('.preventive-history-card')).toHaveCount(1)
  await page.getByLabel('Search vaccinations and deworming').fill('not found')
  await expect(page.locator('.preventive-history-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByRole('button', { name: 'Edit vaccination record', exact: true }).click()
  await expect(page.getByLabel('Product name 2', { exact: true })).toHaveValue('Historical combination')
  await page.getByLabel('Dose 2', { exact: true }).fill('Updated dose')
  await page.getByRole('button', { name: 'Save historical record' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).data.id, historyId)
  await add()
  await page.getByLabel('Record type', { exact: true }).selectOption('deworming')
  await expect(page.getByRole('button', { name: 'Add another vaccine' })).toHaveCount(0)
  await page.getByLabel('Date administered').fill('2020-02-03')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByLabel('Product name 1', { exact: true }).fill('Historical dewormer')
  await reviewRecord(page)
  await page.getByRole('button', { name: 'Save historical record' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(raw.vaccinations.length, 2)
  assert.equal(raw.deworming_administrations.length, 1)
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await page.getByLabel('Filter record type').selectOption('Deworming')
  await expect(page.locator('.preventive-history-card')).toHaveCount(1)
  await expect(page.locator('.preventive-history-card')).toContainText('Historical dewormer')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await add(false)
  await expect(page.getByLabel('Inventory product 1')).toContainText('Anti-Rabies')
  await expect(page.getByLabel('Inventory product 1')).not.toContainText('Dewormer')
  await expect(page.getByLabel('Inventory product 1')).not.toContainText('Archived')
  await page.getByLabel('Record type', { exact: true }).selectOption('deworming')
  await expect(page.getByLabel('Inventory product 1')).toContainText('Dewormer')
  await expect(page.getByLabel('Inventory product 1')).not.toContainText('Anti-Rabies')
  await page.getByLabel('Record type', { exact: true }).selectOption('vaccination')
  const fillStock = async (index) => {
    await page.getByLabel(`Inventory product ${index}`, { exact: true }).selectOption('vax')
    await page.getByLabel(`Stock batch ${index}`, { exact: true }).selectOption('vax-batch')
    await page.getByLabel(`Stock quantity ${index}`, { exact: true }).fill('1')
    await page.getByLabel(`Lot number ${index}`, { exact: true }).fill(`MANUAL-LOT-${index}`)
    await page.getByLabel(`Dose ${index}`, { exact: true }).fill('Clinical dose')
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await fillStock(1)
  await page.getByRole('button', { name: 'Add another vaccine' }).click()
  await fillStock(2)
  await reviewRecord(page)
  await page.getByRole('button', { name: 'Save record', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).data.vaccines[0].dispenseQuantity, 1)
  const queue = raw.queue_entries[0]; queue.status = 'in_progress'
  await page.goto(`${app.origin}/queue`)
  await page.getByRole('button', { name: 'Record vaccinations / deworming', exact: true }).click()
  await page.getByLabel('Dose 2', { exact: true }).fill('Draft clinical dose')
  await page.getByRole('button', { name: 'Save as draft' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).data.record.vaccines.length, 2)
  await page.getByRole('button', { name: 'Resume vaccinations / deworming', exact: true }).click()
  await expect(page.getByLabel('Dose 2', { exact: true })).toHaveValue('Draft clinical dose')
  await page.getByRole('button', { name: 'Save and complete care' }).click()
  await expect(page.getByRole('alert')).toContainText('enough stock')
  await page.getByRole('button', { name: 'Save and complete care' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(calls.at(-1).key, calls.at(-2).key)
  assert.equal(calls.at(-1).data.draftVersion, 1)
  await page.goto(`${app.origin}/patients/${petId}?tab=vaccines`)
  await page.locator(`#preventive-${queue.preventive_record_id}`).getByRole('button', { name: 'Edit vaccination record' }).click()
  await expect(page.getByLabel('Inventory product 1')).toBeDisabled()
  await expect(page.getByLabel('Stock batch 1')).toBeDisabled()
  await expect(page.getByLabel('Stock quantity 1')).toHaveJSProperty('readOnly', true)
  await expect(page.getByLabel('Dose 1', { exact: true })).toBeEditable()
  await expect(page.getByLabel('Lot number 1', { exact: true })).toHaveValue('MANUAL-LOT-1')
  await expect(page.getByLabel('Lot number 1', { exact: true })).toBeEditable()
  await expect(page.getByRole('button', { name: 'Remove vaccine 1' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add another vaccine' }).click()
  await expect(page.getByLabel('Inventory product 3')).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Delete record' })).toHaveCount(0)
  await layouts()
  await page.getByRole('group', { name: 'Vaccinations and Deworming view' }).getByRole('button', { name: 'Calendar', exact: true }).click()
  await page.locator(`[data-day="${today}"] button`).click()
  await expect(page.getByRole('dialog')).toContainText('2 vaccines')
  await expect(page.getByRole('dialog')).toContainText('Draft clinical dose')
  await page.getByRole('dialog').getByRole('button', { name: 'Edit vaccination record' }).click()
  await expect(page.getByLabel('Stock batch 2')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  raw.profiles[0].role = 'owner'
  await page.goto(`${app.origin}/patients/${petId}?tab=vaccines`)
  await expect(page.locator(`#preventive-${queue.preventive_record_id}`).getByRole('button', { name: 'Delete record' })).toBeDisabled()
  await expect(page.locator(`#preventive-${historyId}`).getByRole('button', { name: 'Delete record' })).toBeEnabled()
  assert.deepEqual(errors, [])
  await mkdir('test-artifacts.local', { recursive: true })
  await page.screenshot({ path: 'test-artifacts.local/preventive-care-dark.png', fullPage: true })
  console.log('PASS grouped vaccines, deworming, historical editing, search/type filter, inventory categories, drafts, retry, completion locks, legacy links, staff controls and light/dark mobile layouts')
  await context.close()
} finally { await app.close() }
