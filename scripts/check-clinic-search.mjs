// Real local Auth + PostgREST + Chrome. Search and record routes must not load
// full source tables into ClinicDataContext, even on direct navigation/reload.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { expect } from '@playwright/test'
import { browserServer } from './helpers/browser.mjs'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'
import { chooseSelectOption } from './helpers/select.mjs'

const { env, sql } = localAdmissionDatabase()
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.TEST_SUPABASE_URL).hostname))
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.admissions']) assert.equal(sql(`select count(*) from ${table}`), '0', 'An empty synthetic stack is required')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, options)
const client = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, options)
const checked = ({ data, error }) => { if (error) throw error; return data }
const users = [], errors = [], calls = [], requests = []
let app, page, failNext = false, delay = 0
await mkdir('test-artifacts.local', { recursive: true })
try {
  const password = 'Clinic-search-test-71!'
  for (const role of ['owner', 'clinical_staff']) {
    const { user } = checked(await admin.auth.admin.createUser({ email: `search-${role}-${Date.now()}@veterina-test.invalid`, password, email_confirm: true }))
    users.push(user)
    checked(await admin.from('profiles').insert({ id: user.id, full_name: `Search ${role}`, role, is_active: true, is_veterinarian: true }))
  }
  checked(await client.auth.signInWithPassword({ email: users[0].email, password }))
  const rpc = async (action, data) => checked(await client.rpc('portal_mutation', { p_action: action, p_data: data, p_key: crypto.randomUUID() }))
  const owner = await rpc('create_owner', { fullName: 'Bluewater household', phone: '09171234567', address: 'Synthetic address' })
  const pet = await rpc('create_pet', { ownerId: owner.id, name: 'Mochi Beyondloaded', species: 'Cat', breed: 'Siamese', sex: 'Female', reproductiveStatus: 'Unknown' })
  await rpc('create_record_only_checkup', { petId: pet.id, type: 'Medical Concern', complaint: 'Dermatitis follow-up', diagnosis: 'Allergic dermatitis', encounteredAt: '2024-04-05T03:00:00Z', veterinarianName: 'Dr. Search', prescription: { medications: [{ medicationName: 'Search antibiotic', dose: '1 tablet', route: 'Oral' }] } })
  sql(`begin; select set_config('request.jwt.claims','${JSON.stringify({ sub: users[0].id, role: 'authenticated' })}',true);
    insert into public.pets(owner_id,name,species,breed,sex,reproductive_status,created_by)
    select '${owner.id}','Searchkitten '||lpad(n::text,3,'0'),'Cat','Mixed','Female','Unknown','${users[0].id}' from generate_series(1,61) n; commit;`)
  const { session } = checked(await client.auth.signInWithPassword({ email: users[1].email, password }))
  app = await browserServer(5193, { VITE_SUPABASE_URL: env.TEST_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.TEST_SUPABASE_ANON_KEY })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${new URL(env.TEST_SUPABASE_URL).hostname.split('.')[0]}-auth-token`, session })
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }))
  await context.route('**/rest/v1/rpc/search_clinic_records', async route => {
    const input = route.request().postDataJSON(); calls.push(input)
    if (failNext) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"PRIVATE BACKEND ERROR"}' })
    const wait = delay; if (wait) await new Promise(resolve => setTimeout(resolve, wait))
    await route.continue()
  })
  page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.goto(app.origin + '/search')
  await expect(page.getByRole('heading', { name: 'Search clinic records', exact: true })).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Search clinic records', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Search clinic records', exact: true })
  const input = dialog.getByRole('combobox', { name: 'Search clinic records', exact: true })
  await expect(input).toBeFocused()
  await input.fill('mo'); await input.fill('moch'); await input.fill('  MOCHI   ')
  await expect(dialog.getByRole('option')).toHaveCount(3)
  assert.equal(calls.length, 1, 'Typing was not debounced')
  assert.equal(calls[0].p_query, 'mochi'); assert.equal(calls[0].p_limit, 12)
  await expect(dialog.getByRole('group', { name: 'Patients', exact: true })).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Prescriptions', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${app.origin}/records/pets/${pet.id}`)
  await expect(page.getByRole('heading', { name: 'Mochi Beyondloaded', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mochi Beyondloaded', exact: true })).toBeVisible()
  assert.ok(requests.filter(url => url.includes('/rest/v1/') && !url.includes('/rpc/')).every(url => /\/(?:profiles|clinic_settings)\?/.test(url)), 'Search downloaded unrelated source tables')
  await expect(page.getByRole('button', { name: 'Refresh record', exact: true })).toBeVisible()
  await page.keyboard.press('Control+k'); await expect(input).toBeFocused()
  await input.fill('mochi'); await expect(dialog.getByRole('option')).toHaveCount(3)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/search#q=mochi$/)
  await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Visits & checkups', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prescriptions', exact: true })).toBeVisible()
  await chooseSelectOption(page.getByRole('combobox', { name: 'Record type', exact: true }), 'prescriptions')
  await expect(page.locator('.clinic-search-result-link')).toHaveCount(1)
  await expect(page).toHaveURL(/type=prescriptions/)
  await chooseSelectOption(page.getByRole('combobox', { name: 'Record type', exact: true }), '')
  await expect(page.locator('.clinic-search-result-link')).toHaveCount(3)
  const formInput = page.getByRole('searchbox', { name: 'Search terms', exact: true })
  await formInput.fill('Searchkitten'); await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('61 matching records')
  await expect(page.locator('.clinic-search-result-link')).toHaveCount(25)
  const firstPage = await page.locator('.clinic-search-result-link').evaluateAll(links => links.map(link => link.getAttribute('href')))
  await page.getByRole('button', { name: 'Next results', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('page 2')
  const nextPage = await page.locator('.clinic-search-result-link').evaluateAll(links => links.map(link => link.getAttribute('href')))
  assert.ok(!firstPage.some(href => nextPage.includes(href)))
  assert.ok(calls.at(-1).p_cursor)
  await page.getByRole('button', { name: 'Previous results', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('page 1')
  await formInput.fill('not-present-anywhere'); await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('No results found')
  failNext = true
  await formInput.fill('mochi'); await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Search could not be loaded')
  assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE BACKEND'))
  failNext = false
  await page.getByRole('button', { name: 'Retry search', exact: true }).click()
  await expect(page.locator('.clinic-search-result-link')).toHaveCount(3)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('veterina-appearance', value); window.dispatchEvent(new StorageEvent('storage', { key: 'veterina-appearance', newValue: value })) }, theme)
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme)
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Search overflow ${theme}/${width}`)
      await page.screenshot({ path: `test-artifacts.local/global-search-results-${theme}-${width}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 375, height: 1000 })
  await trigger.click(); await input.fill('mochi'); await expect(dialog.getByRole('option')).toHaveCount(3)
  await page.screenshot({ path: 'test-artifacts.local/global-search-mobile-dialog.png' })
  await dialog.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(input).toHaveValue(''); await expect(input).toBeFocused(); await expect(dialog.getByRole('option')).toHaveCount(0)
  delay = 600
  await input.fill('mochi'); await expect(dialog.getByRole('status')).toContainText('Searching')
  await dialog.getByRole('button', { name: 'Clear search', exact: true }).click()
  await page.waitForTimeout(900)
  await expect(dialog.getByRole('option')).toHaveCount(0)
  delay = 0
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  await page.goto(app.origin + '/search#q=reports&type=navigation')
  await expect(page.getByRole('status')).toContainText('No results found')
  assert.ok(!requests.some(url => url.includes('Searchkitten') || /[?&]q=/.test(url)), 'Query leaked into an HTTP request URL')
  const guest = await app.browser.newContext({ serviceWorkers: 'block' })
  const signedOut = await guest.newPage(), guestRequests = []
  signedOut.on('request', request => guestRequests.push(request.url()))
  await signedOut.goto(app.origin + '/search#q=SensitivePhoneTerm')
  await expect(signedOut).toHaveURL(app.origin + '/sign-in?next=%2Fsearch')
  assert.ok(!guestRequests.some(url => url.includes('SensitivePhoneTerm')), 'Sign-in return URL leaked a search term')
  await guest.close()
  assert.deepEqual(errors, [])
  console.log('PASS real global search: bounded persisted reads, debounce/grouping, keyboard/manual entry, focused record reload, Enter full results, cursor pagination, empty/error/retry/cancellation, role-aware navigation and responsive light/dark layouts')
} catch (error) {
  if (page) { await page.screenshot({ path: 'test-artifacts.local/global-search-failure.png', fullPage: true }); await writeFile('test-artifacts.local/global-search-failure.txt', await page.locator('body').innerText()) }
  throw error
} finally {
  await app?.close()
  if (users.length) {
    sql('begin; truncate public.owners,public.profiles restart identity cascade; commit;')
    for (const user of users) checked(await admin.auth.admin.deleteUser(user.id))
    assert.equal(sql('select count(*) from private.clinic_search_documents'), '0', 'Truncate left stale search documents')
  }
}
