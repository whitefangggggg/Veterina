import { saveCheckup } from './helpers/checkup.mjs'
// This suite writes only to a dedicated, loopback Supabase stack. No API mocks.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { loadEnv } from 'vite'
import { createClient } from '@supabase/supabase-js'
import { expect } from '@playwright/test'
import { browserServer } from './helpers/browser.mjs'

const env = loadEnv('test', process.cwd(), 'TEST_')
const required = ['TEST_DATABASE_URL', 'TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY']
if (required.some((name) => !env[name])) {
  console.error('BLOCKED isolated database tests: configure ' + required.join(', ') + ' in ignored .env.test.local. See TESTING.md.')
  process.exit(2)
}
for (const name of ['TEST_DATABASE_URL', 'TEST_SUPABASE_URL']) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env[name]).hostname), `${name} must target the isolated local stack; remote writes are refused`)
}
const sql = (query) => {
  const result = spawnSync('psql', [env.TEST_DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
assert.equal(sql('select clinic_name from public.clinic_settings limit 1'), 'Veterina isolated test clinic', 'Refusing writes: this is not the synthetic isolated test clinic')
assert.equal(sql("select count(*) from auth.users where email not like '%@veterina-test.invalid'"), '0', 'Isolated stack contains unrelated accounts')
assert.equal(sql('select count(*) from public.owners'), '0', 'Start with an empty isolated clinic')
const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const checked = ({ data, error }) => { if (error) throw error; return data }
await mkdir('test-artifacts.local', { recursive: true })
for (const suite of ['security_and_workflows', 'portal_workflows', 'queue_workflows', 'clinical_patient_services', 'visit_card_colors', 'service_note_edits', 'prescription_inventory', 'registration_clinical', 'follow_up_arrivals', 'clinic_rbac', 'checkup_completion']) {
  const result = spawnSync('psql', [env.TEST_DATABASE_URL, '-X', '-v', 'ON_ERROR_STOP=1', '-f', `supabase/tests/${suite}.sql`], { encoding: 'utf8', windowsHide: true })
  await writeFile(`test-artifacts.local/${suite}.log`, (result.stdout || '') + (result.stderr || ''))
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${suite} failed; see its log in test-artifacts.local`)
  console.log(`PASS isolated Postgres ${suite} (fixtures rolled back)`)
}

const stockConcurrency = spawnSync(process.execPath, ['scripts/check-prescription-stock.mjs'], { encoding: 'utf8', windowsHide: true })
await writeFile('test-artifacts.local/prescription-stock.log', (stockConcurrency.stdout || '') + (stockConcurrency.stderr || ''))
assert.equal(stockConcurrency.status, 0, 'Prescription stock concurrency failed; see test-artifacts.local/prescription-stock.log')
console.log('PASS isolated prescription stock concurrency')
const followUpConcurrency = spawnSync(process.execPath, ['scripts/check-follow-up-arrivals.mjs'], { encoding: 'utf8', windowsHide: true })
await writeFile('test-artifacts.local/follow-up-arrivals.log', (followUpConcurrency.stdout || '') + (followUpConcurrency.stderr || ''))
assert.equal(followUpConcurrency.status, 0, 'Follow-up concurrency failed; see test-artifacts.local/follow-up-arrivals.log')
console.log('PASS isolated follow-up arrival concurrency')
// Local Edge Functions must be running with the source in supabase/functions.
const edge = await fetch(`${env.TEST_SUPABASE_URL}/functions/v1/export-report`, { method: 'POST', headers: { apikey: env.TEST_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}' })
assert.equal(edge.status, 401, 'Start the matching local Edge Functions before running database browser checks')
for (const action of ['capabilities', 'read', 'remove']) {
  const response = await fetch(`${env.TEST_SUPABASE_URL}/functions/v1/pet-photo`, { method: 'POST', headers: { apikey: env.TEST_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
  assert.equal(response.status, 401, 'Anonymous photo access must be denied')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
}
const password = 'Isolated-veterina-test-87!'
const users = []
let app
let page
const errors = []
try {
  for (const [name, role, active] of [['owner', 'owner', true], ['staff', 'clinical_staff', true], ['inactive', 'clinical_staff', false], ['pending', null, true]]) {
    const { user } = checked(await admin.auth.admin.createUser({ email: `${name}-${Date.now()}@veterina-test.invalid`, password, email_confirm: true }))
    users.push({ ...user, testName: name })
    if (role) checked(await admin.from('profiles').insert({ id: user.id, full_name: `Isolated ${name}`, role, is_active: active }))
  }
  const owner = users.find((user) => user.testName === 'owner')
  const timezone = new Date().getUTCHours() < 20 ? 'UTC' : 'America/Los_Angeles'
  checked(await admin.from('clinic_settings').update({ timezone }).eq('clinic_name', 'Veterina isolated test clinic'))
  app = await browserServer(5183, { VITE_SUPABASE_URL: env.TEST_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.TEST_SUPABASE_ANON_KEY })
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  const signIn = async (user) => {
    await page.goto(app.origin + '/sign-in')
    await page.getByLabel('Email address', { exact: true }).fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  await signIn(owner)
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/)
  await expect(page.locator('main h1')).toContainText('Welcome back')
  await page.goto(app.origin + '/patients')
  await page.getByRole('button', { name: 'Add owner', exact: true }).click()
  await page.getByLabel('Full name', { exact: false }).fill('Integration household')
  await page.getByLabel('Mobile number', { exact: false }).fill('09171234567')
  await page.getByLabel('Home address', { exact: false }).fill('Synthetic test address')
  await page.getByRole('button', { name: 'Save owner', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Register pet', exact: true }).click()
  await page.getByRole('combobox', { name: 'Owner', exact: true }).fill('Integration household')
  await page.getByRole('option', { name: /^Integration household/ }).click()
  await page.getByLabel('Pet name', { exact: false }).fill('Integration Mochi')
  await page.getByLabel('Breed', { exact: false }).fill('Mixed')
  await page.getByLabel('Sex', { exact: false }).selectOption('Male')
  await page.getByRole('button', { name: 'Register patient', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const patient = checked(await admin.from('pets').select('*').eq('name', 'Integration Mochi').single())
  await page.getByRole('link', { name: /Integration Mochi/ }).first().click()
  await page.getByRole('link', { name: 'Book appointment', exact: true }).click()
  await expect(page.getByLabel('Patient', { exact: true })).toHaveValue(patient.id)
  const future = new Date(Date.now() + 10 * 60000)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(future)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(future)
  await page.getByLabel('Date', { exact: false }).fill(date)
  const period = Number(time.slice(0, 2)) < 12 ? 'AM' : 'PM'
  if (await page.getByLabel('Appointment period').inputValue() !== period) await page.getByLabel('Appointment period').selectOption(period)
  await page.getByLabel('Appointment hour').selectOption(time.slice(0, 2))
  await page.getByLabel('Appointment minute').selectOption(time.slice(3, 5))
  await page.getByRole('button', { name: 'Create appointment', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(app.origin + '/queue')
  await page.getByRole('button', { name: 'Start care', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('button', { name: 'Record checkup', exact: true }).click()
  await page.getByLabel('Chief complaint', { exact: false }).fill('Synthetic follow-up check')
  await page.getByLabel('Clinical notes', { exact: true }).fill('Observed gait improving after rest.')
  await page.getByLabel('Weight (kg)', { exact: false }).fill('4.5')
  const followUp = new Date(future.getTime() + 86400000)
  await page.getByLabel('Follow-up date', { exact: false }).fill(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(followUp))
  await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Resume checkup', exact: true }).click()
  await expect(page.getByLabel('Chief complaint', { exact: false })).toHaveValue('Synthetic follow-up check')
  await expect(page.getByLabel('Clinical notes', { exact: true })).toHaveValue('Observed gait improving after rest.')
  // Lose one acknowledgement after the real RPC commits; retry must not duplicate care.
  let dropAcknowledgement = true
  await page.route('**/rest/v1/rpc/portal_mutation', async (route) => {
    if (dropAcknowledgement && route.request().postDataJSON().p_action === 'complete_queue_entry') {
      dropAcknowledgement = false
      const response = await route.fetch()
      assert.ok(response.ok(), 'The actual database save must succeed before simulating response loss')
      return route.abort('failed')
    }
    return route.continue()
  })
  await saveCheckup(page)
  await expect(page.getByRole('alert')).toBeVisible()
  await saveCheckup(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.unroute('**/rest/v1/rpc/portal_mutation')
  const visits = checked(await admin.from('visits').select('*').eq('pet_id', patient.id))
  const reminders = checked(await admin.from('reminders').select('*').eq('pet_id', patient.id))
  const appointments = checked(await admin.from('appointments').select('*').eq('pet_id', patient.id))
  assert.equal(visits.length, 1)
  assert.equal(visits[0].clinical_notes, 'Observed gait improving after rest.')
  assert.equal(reminders.length, 1)
  assert.equal(appointments.length, 1)
  assert.equal(appointments[0].status, 'completed')
  await page.goto(app.origin + '/patients/' + patient.id)
  await expect(page.locator('.visit-card')).toContainText('Synthetic follow-up check')
  await expect(page.locator('.visit-card')).toContainText('Observed gait improving after rest.')
  await page.getByRole('button', { name: 'Care timeline', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Care timeline', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Advanced/ }).click()
  await page.getByLabel('Timeline activity').selectOption('Checkup')
  await expect(page.locator('.care-event')).toHaveCount(1)
  await page.locator('.care-event').getByRole('link', { name: 'View source', exact: true }).click()
  await expect(page.locator('.visit-card')).toBeFocused()
  await page.goto(app.origin + '/reminders')
  await page.getByRole('link', { name: 'Integration Mochi', exact: true }).click()
  await expect(page).toHaveURL(app.origin + '/patients/' + patient.id)
  console.log('PASS real owner → patient → booking → check-in → queue draft/reload → care retry → history/reminder; one saved encounter and reminder')

  await page.goto(app.origin + '/suppliers')
  await page.getByRole('button', { name: 'Add supplier', exact: true }).click()
  await page.getByLabel('Supplier name', { exact: false }).fill('Integration supplier')
  await page.getByLabel('Phone', { exact: false }).fill('09171234568')
  await page.getByRole('button', { name: 'Save supplier', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const supplier = checked(await admin.from('suppliers').select('*').eq('name', 'Integration supplier').single())
  await page.goto(app.origin + '/inventory')
  await page.getByRole('button', { name: 'New item', exact: true }).click()
  await page.getByLabel('Item name', { exact: false }).fill('Integration medicine')
  await page.getByLabel('Category', { exact: true }).selectOption('Medicine')
  await page.getByLabel('Unit', { exact: true }).fill('tablet')
  await page.getByLabel('Minimum stock', { exact: false }).fill('5')
  await page.getByLabel('Preferred supplier').selectOption(supplier.id)
  await page.getByLabel('Initial batch / lot number').fill('INITIAL')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(app.origin + '/suppliers')
  await page.getByRole('link', { name: '1 linked items' }).click()
  await expect(page.locator('.inventory-record')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add batch', exact: true }).click()
  await page.getByLabel('Batch / lot number').fill('DELIVERY')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Update stock', exact: true }).click()
  const batchId = checked(await admin.from('inventory_batches').select('id').eq('lot_number', 'DELIVERY').single()).id
  await page.getByLabel('Batch', { exact: false }).selectOption(batchId)
  await page.getByLabel('Quantity', { exact: false }).fill('8')
  await page.getByLabel('Reason', { exact: false }).selectOption('Supplier delivery')
  await page.getByRole('button', { name: 'Record movement', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.inventory-record')).toContainText('8 tablet')
  const ledger = checked(await admin.from('inventory_movements').select('quantity_delta').eq('batch_id', batchId))
  assert.equal(ledger.reduce((total, row) => total + Number(row.quantity_delta), 0), 8)
  await page.goto(app.origin + '/dashboard')
  await expect(page.locator('.glance-metrics > div').nth(0)).toContainText('1')
  await expect(page.locator('.glance-metrics > div').nth(2)).toContainText('0')
  await expect(page.locator('.next-patients a')).toHaveCount(0)
  await expect(page.locator('.daily-work-grid')).toContainText('Care at the clinic (0)')
  await expect(page.locator('.daily-work-grid')).toContainText('Stock watch (0)')
  await page.goto(app.origin + '/reports')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.report-card').filter({ hasText: 'Inventory status' }).getByRole('button', { name: 'Prepare report' }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'veterina-inventory.csv')
  const stream = await download.createReadStream()
  let csv = ''
  for await (const chunk of stream) csv += chunk
  const csvRows = csv.trim().split(/\r?\n/).map((row) => row.split(',').map((value) => value.replace(/^"|"$/g, '')))
  const columns = csvRows[0]
  const exportedItem = csvRows.slice(1).find((row) => row[columns.indexOf('name')] === 'Integration medicine')
  assert.ok(exportedItem, 'The saved inventory item must appear in the real CSV')
  assert.equal(Number(exportedItem[columns.indexOf('quantity_on_hand')]), 8)
  assert.equal(checked(await admin.from('export_events').select('id')).length, 1)
  console.log('PASS real supplier → inventory → batch → stock ledger → dashboard → audited CSV export')

  await page.goto(app.origin + '/patients/' + patient.id)
  await page.getByRole('button', { name: 'Add prescription', exact: true }).click()
  await page.getByRole('combobox', { name: 'Medication name 1', exact: true }).fill('Integration medicine')
  await page.getByRole('option', { name: /^Integration medicine/ }).click()
  await page.getByLabel('Stock batch 1').selectOption(batchId)
  await page.getByLabel('Dispensing quantity 1').fill('3')
  await page.getByLabel('Dose 1', { exact: true }).fill('Recorded test dose')
  await page.getByLabel('Frequency 1', { exact: true }).fill('Recorded test frequency')
  await page.getByRole('combobox', { name: 'Route 1', exact: true }).fill('Oral')
  let dropPrescriptionAcknowledgement = true
  await page.route('**/rest/v1/rpc/portal_mutation', async (route) => {
    if (dropPrescriptionAcknowledgement && route.request().postDataJSON().p_action === 'create_prescription') {
      dropPrescriptionAcknowledgement = false
      const response = await route.fetch()
      assert.ok(response.ok(), 'Prescription and dispensing must commit before simulating acknowledgement loss')
      return route.abort('failed')
    }
    return route.continue()
  })
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.unroute('**/rest/v1/rpc/portal_mutation')
  await page.reload()
  await expect(page.getByRole('link', { name: 'Dispensed 3 tablet from inventory' })).toBeVisible()
  const prescriptions = checked(await admin.from('prescriptions').select('*').eq('visit_id', visits[0].id))
  assert.equal(prescriptions.length, 1)
  assert.equal(prescriptions[0].medications[0].batchId, batchId)
  assert.equal(prescriptions[0].route, 'Oral')
  assert.equal(prescriptions[0].medications[0].route, 'Oral')
  await page.getByRole('button', { name: 'Edit prescription', exact: true }).click()
  await expect(page.getByLabel('Stock batch 1')).toBeDisabled()
  await expect(page.getByLabel('Dispensing quantity 1')).toHaveAttribute('readonly', '')
  await page.getByLabel('Instructions 1', { exact: true }).fill('Updated test instructions')
  await page.getByRole('combobox', { name: 'Route 1', exact: true }).fill('Custom clinical route')
  await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(checked(await admin.from('prescriptions').select('route').eq('id', prescriptions[0].id).single()).route, 'Custom clinical route')
  await page.getByRole('link', { name: 'Dispensed 3 tablet from inventory' }).click()
  await expect(page.locator('.inventory-record')).toContainText('5 tablet')
  const dispensingLedger = checked(await admin.from('inventory_movements').select('quantity_delta,reference').eq('batch_id', batchId).eq('reason', 'Dispensed to patient'))
  assert.equal(dispensingLedger.length, 1)
  assert.equal(Number(dispensingLedger[0].quantity_delta), -3)
  assert.ok(dispensingLedger[0].reference.includes(prescriptions[0].id))
  console.log('PASS real prescription combo → committed dispensing → lost acknowledgement/retry → immutable reload/edit → inventory balance; one stock deduction')

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  await page.goto(app.origin + '/patients/' + patient.id)
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  for (const name of ['pending', 'inactive', 'staff']) {
    await signIn(users.find((user) => user.testName === name))
    if (name !== 'staff') {
      await expect(page).toHaveURL(/\/access-pending/)
      const client = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      checked(await client.auth.signInWithPassword({ email: users.find((user) => user.testName === name).email, password }))
      assert.equal(checked(await client.from('pets').select('id')).length, 0)
      for (const body of [{ action: 'read', petId: patient.id }, new FormData()]) {
        const { error } = await client.functions.invoke('pet-photo', { body })
        assert.equal(error?.context?.status, 403, 'Pending/inactive accounts must not retrieve or upload photos')
      }
      await client.auth.signOut()
    } else {
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/)
      await page.goto(app.origin + '/reports')
      await expect(page.getByRole('button', { name: 'Prepare report' })).toHaveCount(0)
      const client = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      checked(await client.auth.signInWithPassword({ email: users.find((user) => user.testName === name).email, password }))
      const { error } = await client.functions.invoke('export-report', { body: { report: 'patients' } })
      assert.ok(error, 'Staff must be denied by the real export endpoint')
      await client.auth.signOut()
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  }
  assert.deepEqual(errors, [])
  console.log('PASS real pending/inactive access, staff export denial, sign-out isolation and no browser JavaScript errors')

  // Exercise Auth's actual signup trigger and the deployed local owner endpoint.
  // Only synthetic local accounts are used; no invitation/confirmation is sent.
  const applicant = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const code = sql('select code from private.clinic_codes where clinic_id=private.legacy_clinic_id()')
  const signup = checked(await applicant.auth.signUp({ email: `code-signup-${Date.now()}@veterina-test.invalid`, password,
    options: { data: { application: 'veterina', full_name: 'Code signup applicant', veterina_code: code, role: 'owner' } } }))
  users.push({ ...signup.user, testName: 'code-signup' })
  assert.equal(checked(await applicant.from('profiles').select('id')).length, 0)
  assert.equal(checked(await applicant.from('pets').select('id')).length, 0)
  assert.ok((await applicant.rpc('portal_mutation', { p_action: 'create_owner', p_data: { fullName: 'Unapproved', phone: '09171234567', address: 'Test' }, p_key: crypto.randomUUID() })).error)
  const approver = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  checked(await approver.auth.signInWithPassword({ email: owner.email, password }))
  const accountList = checked(await approver.functions.invoke('admin-staff', { body: { action: 'list' } }))
  assert.equal(checked(await approver.auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel, 'aal1')
  assert.ok(accountList.accounts.some((account) => account.id === signup.user.id && account.email_confirmed && account.role === 'clinical_staff' && account.status === 'pending'))
  checked(await approver.functions.invoke('admin-staff', { body: { action: 'approve', id: signup.user.id, full_name: 'Approved code staff', role: 'clinical_staff' } }))
  assert.equal(checked(await applicant.from('profiles').select('role').eq('id', signup.user.id).single()).role, 'clinical_staff')
  assert.ok(!checked(await approver.functions.invoke('admin-staff', { body: { action: 'list' } })).accounts.some((account) => account.id === signup.user.id))
  assert.ok(checked(await applicant.from('pets').select('id')).some((row) => row.id === patient.id))
  assert.equal((await applicant.functions.invoke('admin-staff', { body: { action: 'list' } })).error?.context.status, 403)
  checked(await approver.functions.invoke('admin-staff', { body: { action: 'update', id: signup.user.id, role: 'clinical_staff', is_active: false } }))
  assert.equal(checked(await applicant.from('pets').select('id')).length, 0, 'Deactivation must revoke the existing JWT immediately')
  await applicant.auth.signOut(); await approver.auth.signOut()
  console.log('PASS real Veterina Code signup → pending-only listing → owner approval without MFA → immediate suspension; forged owner metadata ignored')
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'test-artifacts.local/database-failure.png', fullPage: true }).catch(() => {})
    await writeFile('test-artifacts.local/database-failure.txt', await page.locator('body').innerText().catch(() => 'Page unavailable'))
  }
  throw error
} finally {
  await app?.close()
  // The guards above restrict this cleanup to an otherwise empty local test stack.
  // Preserve configuration/services; every other public/private row is synthetic.
  if (users.length) {
    sql("do $$ declare targets text; begin select string_agg(format('%I.%I',schemaname,tablename),', ') into targets from pg_tables where schemaname in ('public','private') and tablename not in ('clinic_settings','service_types','pet_photo_config','rag_schedule_config','clinics','legacy_clinic','clinic_codes'); execute 'truncate '||targets||' restart identity cascade'; end $$;")
    for (const user of users) checked(await admin.auth.admin.deleteUser(user.id))
    checked(await admin.from('clinic_settings').update({ timezone: 'Asia/Manila' }).eq('clinic_name', 'Veterina isolated test clinic'))
    assert.equal(sql('select count(*) from public.owners'), '0')
    console.log('PASS isolated browser fixtures removed')
  }
}
