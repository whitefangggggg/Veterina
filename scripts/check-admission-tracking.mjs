// Real loopback Auth + PostgREST + Edge Function + Chrome, using synthetic data only.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { expect } from '@playwright/test'
import { browserServer } from './helpers/browser.mjs'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const { env, sql } = localAdmissionDatabase()
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.TEST_SUPABASE_URL).hostname))
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.admissions']) assert.equal(sql(`select count(*) from ${table}`), '0', 'An empty synthetic stack is required')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, options)
const client = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, options)
const checked = ({ data, error }) => { if (error) throw error; return data }
const users = [], errors = []
let app, staffPage, publicPage
await mkdir('test-artifacts.local', { recursive: true })
try {
  sql('delete from private.admission_tracking_limits')
  const password = 'Admission-tracking-test-71!'
  for (const role of ['owner', 'clinical_staff']) {
    const { user } = checked(await admin.auth.admin.createUser({ email: `tracking-${role}-${Date.now()}@veterina-test.invalid`, password, email_confirm: true }))
    users.push(user)
    checked(await admin.from('profiles').insert({ id: user.id, full_name: `Tracking ${role}`, role, is_active: true, is_veterinarian: true }))
  }
  checked(await client.auth.signInWithPassword({ email: users[0].email, password }))
  const rpc = async (action, data) => checked(await client.rpc('portal_mutation', { p_action: action, p_data: data, p_key: crypto.randomUUID() }))
  const owner = await rpc('create_owner', { fullName: 'PRIVATE HOUSEHOLD', phone: '09171234567', address: 'PRIVATE HOME' })
  const pet = await rpc('create_pet', { ownerId: owner.id, name: 'Tracking Mochi', species: 'Cat', breed: 'Mixed', sex: 'Female', reproductiveStatus: 'Unknown' })
  const admission = await rpc('admission_create', { petId: pet.id, reason: 'PRIVATE MEDICAL REASON', condition: 'critical', veterinarianId: users[0].id, admittedAt: new Date(Date.now() - 3600000).toISOString() })
  const { session } = checked(await client.auth.signInWithPassword({ email: users[1].email, password }))
  app = await browserServer(5191, { VITE_SUPABASE_URL: env.TEST_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.TEST_SUPABASE_ANON_KEY })
  const staff = await app.browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await staff.addInitScript(({ key, session }) => { localStorage.setItem(key, JSON.stringify(session)); window.print = () => { window.__trackingPrinted = true } }, { key: `sb-${new URL(env.TEST_SUPABASE_URL).hostname.split('.')[0]}-auth-token`, session })
  const guest = await app.browser.newContext({ viewport: { width: 375, height: 900 } })
  for (const context of [staff, guest]) await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }))
  staffPage = await staff.newPage(); publicPage = await guest.newPage()
  await publicPage.clock.install()
  for (const page of [staffPage, publicPage]) { page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)) }
  await staffPage.goto(`${app.origin}/admissions/${admission.id}`)
  await staffPage.getByRole('button', { name: 'Public tracking', exact: true }).click()
  await expect(staffPage.getByRole('button', { name: 'Enable and generate code', exact: true })).toBeDisabled()
  await staffPage.getByRole('button', { name: 'Approve public fields', exact: true }).click()
  await expect(staffPage.getByRole('button', { name: 'Enable and generate code', exact: true })).toBeEnabled()
  const consent = staffPage.getByRole('checkbox', { name: 'I approve public access to these fields and understand that anyone with the code can view them.', exact: true })
  await consent.check()
  let lost = false
  await staffPage.route('**/rest/v1/rpc/portal_mutation', async route => {
    if (route.request().postDataJSON()?.p_action === 'tracking_generate' && !lost) {
      lost = true; await route.fetch(); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Simulated lost acknowledgment. Retry."}' })
    } else await route.continue()
  })
  await staffPage.getByRole('button', { name: 'Enable and generate code', exact: true }).click()
  await expect(staffPage.getByRole('alert')).toContainText('Simulated lost acknowledgment')
  await staffPage.getByRole('button', { name: 'Enable and generate code', exact: true }).click()
  const code = await staffPage.locator('.admission-tracking-code').innerText()
  assert.match(code, /^[A-Za-z0-9]{13}$/)
  assert.equal(sql(`select count(*) from private.admission_tracking_credentials where admission_id='${admission.id}'`), '1', 'Receipt replay created another code')
  await expect(staffPage.locator('.admission-tracking-card img')).toBeVisible()
  const qr = await staffPage.evaluate(async () => {
    const { default: QrScanner } = await import('/node_modules/qr-scanner/qr-scanner.min.js')
    return (await QrScanner.scanImage(document.querySelector('.admission-tracking-card img'), { returnDetailedScanResult: true })).data
  })
  assert.equal(qr, `${app.origin}/track-admission#${code}`)
  await staffPage.getByLabel('Update to publish', { exact: true }).fill('Resting comfortably. <script>literal owner text</script>')
  await staffPage.getByRole('checkbox', { name: 'I approve this update for anyone holding the tracking code.', exact: true }).check()
  await staffPage.getByRole('button', { name: 'Publish update', exact: true }).click()
  await expect(staffPage.getByRole('heading', { name: 'Currently published', exact: true })).toBeVisible()
  await staffPage.getByRole('button', { name: 'Print QR card', exact: true }).click()
  await expect.poll(() => staffPage.frames().some(frame => frame !== staffPage.mainFrame() && frame.url() === 'about:srcdoc')).toBe(true)
  const printed = staffPage.frames().find(frame => frame.url() === 'about:srcdoc')
  await expect.poll(() => printed.evaluate(() => window.__trackingPrinted)).toBe(true)
  assert.ok(!(await printed.locator('body').innerText()).includes('PRIVATE'))
  // QR direct navigation and manual entry use precisely the same anonymous API.
  const outbound = []
  publicPage.on('request', request => outbound.push(request.url()))
  await publicPage.goto(qr)
  await expect(publicPage.getByRole('heading', { name: 'Tracking Mochi', exact: true })).toBeVisible()
  await expect(publicPage.getByRole('button', { name: 'Install Veterina', exact: true })).toBeHidden()
  await expect(publicPage.locator('.public-admission-status')).toHaveText('Admitted')
  await expect(publicPage.getByText('Resting comfortably. <script>literal owner text</script>', { exact: true })).toBeVisible()
  assert.ok(!(await publicPage.locator('body').innerText()).includes('PRIVATE'))
  assert.ok(!outbound.some(url => url.includes(code)), 'Capability leaked into HTTP URL')
  assert.equal(await publicPage.evaluate(() => Object.keys(localStorage).filter(key => key.includes('auth-token')).length), 0)
  assert.equal(await publicPage.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow, noarchive')
  await publicPage.goto(`${app.origin}/track-admission`)
  await publicPage.getByLabel('13-character tracking code', { exact: true }).fill('bad')
  await publicPage.getByRole('button', { name: 'Track', exact: true }).click()
  await expect(publicPage.getByRole('alert')).toContainText('exactly 13')
  await expect(publicPage.getByLabel('13-character tracking code', { exact: true })).toBeFocused()
  await publicPage.getByLabel('13-character tracking code', { exact: true }).fill(code)
  await publicPage.keyboard.press('Enter')
  await expect(publicPage.getByRole('heading', { name: 'Tracking Mochi', exact: true })).toBeVisible()
  await expect(publicPage.getByRole('heading', { name: 'Monitoring & notes', exact: true })).toHaveCount(0)
  let clinicalVersion = checked(await admin.from('admissions').select('version').eq('id', admission.id).single()).version
  const clinicalRpc = async (action, payload) => {
    const result = await rpc(action, { id: admission.id, expectedVersion: clinicalVersion, ...payload })
    clinicalVersion = result.version
    return result
  }
  for (let i = 0; i < 24; i++) await clinicalRpc('admission_observe', { kind: 'note', note: `Clinical progress ${i} <script>literal</script>` })
  await clinicalRpc('admission_observe', { kind: 'vitals', values: { temperatureC: 38.5, weightKg: 4.2 }, note: 'Clinical measurements' })
  const order = await clinicalRpc('admission_order', { kind: 'medication', title: 'Clinical medicine', instructions: 'With food', dose: '2 ml', route: 'Oral', frequency: 'Once', duration: 'One day', startsAt: new Date(Date.now() + 3600000).toISOString() })
  await clinicalRpc('admission_unscheduled', { orderId: order.orderId, outcome: 'held', reason: 'Awaiting assessment' })
  await staffPage.getByRole('checkbox', { name: 'I approve sharing all existing and future clinical entries, medication doses and staff names with anyone holding the code.', exact: true }).check()
  await staffPage.getByRole('button', { name: 'Enable clinical sharing', exact: true }).click()
  await expect(staffPage.getByRole('button', { name: 'Disable clinical sharing', exact: true })).toBeVisible()
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  for (const name of ['Admission activity', 'Monitoring & notes', 'Care board']) await expect(publicPage.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(publicPage.getByText('2 ml', { exact: true })).toBeVisible()
  await expect(publicPage.getByText('Clinical progress 23 <script>literal</script>', { exact: true })).toBeVisible()
  assert.equal(await publicPage.locator('.public-clinical-sections script').count(), 0, 'Clinical text executed as HTML')
  const clinicalResponse = await fetch(`${env.TEST_SUPABASE_URL}/functions/v1/admission-tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: code }) })
  const clinicalDoc = await clinicalResponse.json()
  assert.equal(clinicalResponse.status, 200)
  assert.equal(clinicalDoc.clinical.monitoring.items.length, 20)
  assert.equal(typeof clinicalDoc.clinical.monitoring.cursor, 'string')
  assert.ok(!JSON.stringify(clinicalDoc).includes(admission.id), 'Internal admission ID exposed')
  assert.ok(!JSON.stringify(clinicalDoc).includes('PRIVATE HOUSEHOLD'), 'Structured owner details exposed')
  // Live refresh, pause during older history, and manual return to latest.
  await clinicalRpc('admission_observe', { kind: 'note', note: 'Automatically refreshed clinical note' })
  await publicPage.clock.fastForward(31000)
  await expect(publicPage.getByText('Automatically refreshed clinical note', { exact: true })).toBeVisible()
  await publicPage.getByRole('button', { name: 'Load more monitoring', exact: true }).click()
  await expect(publicPage.getByText('Automatic refresh is paused', { exact: false })).toBeVisible()
  const clinicalNoteCount = await publicPage.locator('#public-admission-monitoring').locator('..').locator('article').count()
  assert.equal(clinicalNoteCount, 27)
  await clinicalRpc('admission_observe', { kind: 'note', note: 'Note added while browsing history' })
  await publicPage.clock.fastForward(31000)
  await expect(publicPage.getByText('Note added while browsing history', { exact: true })).toHaveCount(0)
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.getByText('Note added while browsing history', { exact: true })).toBeVisible()
  assert.equal(await publicPage.locator('#public-admission-monitoring').locator('..').locator('article').count(), 20)
  // A failed page fetch clears every clinical section, rather than retaining stale notes.
  await publicPage.route('**/functions/v1/admission-tracking', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"TEMPORARILY_UNAVAILABLE"}' }), { times: 1 })
  await publicPage.getByRole('button', { name: 'Load more monitoring', exact: true }).click()
  await expect(publicPage.getByRole('heading', { name: 'Temporarily unavailable', exact: true })).toBeVisible()
  await expect(publicPage.getByRole('heading', { name: 'Care board', exact: true })).toHaveCount(0)
  await publicPage.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(publicPage.getByRole('heading', { name: 'Care board', exact: true })).toBeVisible()
  for (const appearance of ['light', 'dark']) {
    await publicPage.evaluate(value => { localStorage.setItem('veterina-appearance', value); document.documentElement.dataset.appearance = value; document.documentElement.style.colorScheme = value }, appearance)
    for (const width of [320, 375, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 1000 })
      const overflow = await publicPage.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('main *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(node => ({ tag: node.tagName, className: node.getAttribute('class'), right: node.getBoundingClientRect().right })) }))
      assert.ok(overflow.scroll <= width + 1, `Public overflow ${appearance}/${width}: ${JSON.stringify(overflow)}`)
      await publicPage.screenshot({ path: `test-artifacts.local/admission-tracking-${appearance}-${width}.png`, fullPage: true, animations: 'disabled' })
      if (width === 1440) {
        await publicPage.evaluate(() => window.scrollTo(0, 0))
        await publicPage.screenshot({ path: `test-artifacts.local/admission-tracking-${appearance}-desktop.png`, animations: 'disabled' })
      }
    }
  }
  await staffPage.getByRole('button', { name: 'Disable clinical sharing', exact: true }).click()
  await expect(staffPage.getByRole('button', { name: 'Enable clinical sharing', exact: true })).toBeVisible()
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.getByRole('heading', { name: 'Care board', exact: true })).toHaveCount(0)
  assert.ok(!(await publicPage.locator('body').innerText()).includes('PRIVATE'))
  await staffPage.setViewportSize({ width: 375, height: 1000 })
  assert.ok(await staffPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Staff sharing overflows mobile')
  await staffPage.screenshot({ path: 'test-artifacts.local/admission-sharing-mobile.png', fullPage: true, animations: 'disabled' })
  await staffPage.getByRole('button', { name: 'Unpublish update', exact: true }).click()
  await expect(staffPage.getByRole('heading', { name: 'Currently published', exact: true })).toHaveCount(0)
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.getByText('The clinic hasn’t published an update yet.', { exact: true })).toBeVisible()
  await consent.check()
  await staffPage.getByRole('button', { name: 'Replace tracking code', exact: true }).click()
  await expect(staffPage.locator('.admission-tracking-code')).not.toHaveText(code)
  const rotated = await staffPage.locator('.admission-tracking-code').innerText()
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.getByRole('heading', { name: 'Tracking is not available', exact: true })).toBeVisible()
  await publicPage.getByLabel('13-character tracking code', { exact: true }).fill(rotated)
  await publicPage.getByRole('button', { name: 'Track', exact: true }).click()
  await expect(publicPage.getByRole('heading', { name: 'Tracking Mochi', exact: true })).toBeVisible()
  let row = checked(await admin.from('admissions').select('*').eq('id', admission.id).single())
  await rpc('admission_transition', { id: row.id, expectedVersion: row.version, status: 'ready_for_discharge' })
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.locator('.public-admission-status')).toHaveText('Ready for Discharge')
  row = checked(await admin.from('admissions').select('*').eq('id', admission.id).single())
  await rpc('admission_discharge', { id: row.id, expectedVersion: row.version, condition: 'stable', assessment: 'PRIVATE ASSESSMENT', instructions: 'PRIVATE HOME INSTRUCTIONS', acknowledgeFutureTasks: true })
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.locator('.public-admission-status')).toHaveText('Discharged')
  assert.ok(!(await publicPage.locator('body').innerText()).includes('PRIVATE'))
  await staffPage.getByRole('button', { name: 'Revoke public tracking', exact: true }).click()
  await expect(staffPage.getByRole('button', { name: 'Enable and generate code', exact: true })).toBeVisible()
  await publicPage.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(publicPage.getByRole('heading', { name: 'Tracking is not available', exact: true })).toBeVisible()
  // Real Edge headers, malformed payloads, direct API bypass and distributed throttle.
  const read = token => fetch(`${env.TEST_SUPABASE_URL}/functions/v1/admission-tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
  sql('delete from private.admission_tracking_limits')
  const denied = await read(rotated)
  assert.equal(denied.status, 404); assert.match(denied.headers.get('cache-control'), /no-store/)
  assert.match(denied.headers.get('x-robots-tag'), /noindex/)
  for (let i = 0; i < 29; i++) assert.equal((await read('malformed')).status, 404)
  const limited = await read(rotated)
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60')
  assert.ok((await client.rpc('lookup_public_admission', { p_token: rotated, p_client_hash: 'a'.repeat(64) })).error)
  assert.deepEqual(errors, [])
  console.log('PASS real admission public tracking: clinical opt-in, full details, encrypted pagination, live refresh/history pause, failed-page clearing, mobile light/dark layouts, same-code disable, QR/retry, rotation/revocation, discharge and throttling')
} catch (error) {
  for (const [name, page] of [['staff', staffPage], ['public', publicPage]]) if (page) {
    await page.screenshot({ path: `test-artifacts.local/admission-tracking-failure-${name}.png`, fullPage: true })
    await writeFile(`test-artifacts.local/admission-tracking-failure-${name}.txt`, await page.locator('body').innerText())
  }
  throw error
} finally {
  await app?.close()
  if (users.length) {
    sql('begin; truncate public.owners,public.profiles restart identity cascade; delete from private.admission_tracking_limits; commit;')
    for (const user of users) checked(await admin.auth.admin.deleteUser(user.id))
  }
}
