import { openNewVisit, reviewRecord } from './helpers/new-visit.mjs'
// This suite writes only to a dedicated, loopback Supabase stack. No API mocks.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
assert.equal(sql('select count(*) from public.owners'), '0', 'Start with an empty isolated clinic');assert.equal(sql('select count(*) from auth.users'),'0','Start with empty synthetic accounts')
const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const checked = ({ data, error }) => { if (error) throw error; return data }

const password = 'Isolated-preventive-test-87!'
let app, user
try {
  const owner = checked(await admin.auth.admin.createUser({email:`preventive-${Date.now()}@veterina-test.invalid`,password,email_confirm:true})).user
  user = owner
  checked(await admin.from('profiles').insert({id:owner.id,full_name:'Isolated preventive owner',role:'owner',is_active:true,is_veterinarian:true}))
  const setupClient=createClient(env.TEST_SUPABASE_URL,env.TEST_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  checked(await setupClient.auth.signInWithPassword({email:owner.email,password}))
  const mutate=async(action,data)=>checked(await setupClient.rpc('portal_mutation',{p_action:action,p_data:data,p_key:crypto.randomUUID()}))
  const household=await mutate('create_owner',{fullName:'Preventive test household',phone:'09171234567',address:'Test'})
  const created=await mutate('create_pet',{ownerId:household.id,name:'Preventive patient',species:'Cat',breed:'Mixed',sex:'Female',reproductiveStatus:'Unknown'})
  const patient=checked(await admin.from('pets').select('*').eq('id',created.id).single())
  await setupClient.auth.signOut()
  app=await browserServer(5199,{VITE_SUPABASE_URL:env.TEST_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY:env.TEST_SUPABASE_ANON_KEY})
  const context=await app.browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'})
  const page=await context.newPage();page.setDefaultTimeout(15000)
  await page.goto(app.origin+'/sign-in')
  await page.getByLabel('Email address',{exact:true}).fill(owner.email)
  await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/)
  const careClient = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  checked(await careClient.auth.signInWithPassword({ email: owner.email, password }))
  const careMutation = async (action, data) => checked(await careClient.rpc('portal_mutation', { p_action: action, p_data: data, p_key: crypto.randomUUID() }))
  for (const kind of ['vaccination', 'deworming']) {
    const product = await careMutation('create_inventory_item', { name: `Integration ${kind} product`, brand: 'Integration care brand', category: kind === 'vaccination' ? 'Vaccines' : 'Medicine', unit: 'dose', minimumStock: 0 })
    const stockBatch = checked(await admin.from('inventory_batches').select('id').eq('item_id', product.id).single())
    await careMutation('record_inventory_movement', { id: product.id, batchId: stockBatch.id, delta: 5, reason: 'Synthetic care delivery' })
    await page.goto(app.origin + '/patients/' + patient.id)
    await openNewVisit(page, 'Vaccination')
    await page.getByRole('button', { name: /Queue processing/ }).click()
    await page.getByLabel('Record type', { exact: true }).selectOption(kind)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    const count = kind === 'vaccination' ? 2 : 1
    for (let index = 1; index <= count; index++) {
      if (index > 1) await page.getByRole('button', { name: 'Add another vaccine' }).click()
      await page.getByLabel(`Inventory product ${index}`, { exact: true }).selectOption(product.id)
      await page.getByLabel(`Stock batch ${index}`, { exact: true }).selectOption(stockBatch.id)
      await page.getByLabel(`Stock quantity ${index}`, { exact: true }).fill('1')
      if (kind === 'vaccination') await page.getByLabel(`Lot number ${index}`, { exact: true }).fill(`MANUAL-DB-${index}`)
      await page.getByLabel(`Dose ${index}`, { exact: true }).fill('Recorded clinical dose')
    }
    if (kind === 'deworming') await expect(page.getByRole('button', { name: 'Add another vaccine' })).toHaveCount(0)
    await reviewRecord(page)
    await page.getByRole('button', { name: 'Save record', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const parent = checked(await careClient.from('preventive_care_records').select('*').eq('pet_id', patient.id).eq('kind', kind).eq('recording_purpose', 'queue').single())
    const ticket = checked(await admin.from('queue_entries').select('id').eq('preventive_record_id', parent.id).single())
    const balance = () => Number(sql(`select sum(quantity_delta) from public.inventory_movements where batch_id='${stockBatch.id}'`))
    assert.equal(balance(), 5, 'Creating waiting care must not consume stock')
    await page.goto(app.origin + '/queue')
    await page.locator(`#queue-${ticket.id}`).getByRole('button', { name: 'Start care', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await page.locator(`#queue-${ticket.id}`).getByRole('button', { name: 'Record vaccinations / deworming', exact: true }).click()
    await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    assert.equal(balance(), 5, 'Saving a draft must not consume stock')
    await page.locator(`#queue-${ticket.id}`).getByRole('button', { name: 'Resume vaccinations / deworming', exact: true }).click()
    let loseCareAcknowledgement = kind === 'vaccination'
    await page.route('**/rest/v1/rpc/portal_mutation', async (route) => {
      if (loseCareAcknowledgement && route.request().postDataJSON().p_action === 'complete_queue_entry') {
        loseCareAcknowledgement = false
        const response = await route.fetch()
        assert.ok(response.ok(), 'Grouped completion must commit before response loss')
        return route.abort('failed')
      }
      return route.continue()
    })
    await page.getByRole('button', { name: 'Save and complete care', exact: true }).click()
    if (kind === 'vaccination') {
      await expect(page.getByRole('alert')).toBeVisible()
      await page.getByRole('button', { name: 'Save and complete care', exact: true }).click()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.unroute('**/rest/v1/rpc/portal_mutation')
    assert.equal(balance(), 5 - count)
    assert.equal(Number(sql(`select count(*) from private.preventive_dispenses where preventive_record_id='${parent.id}'`)), count)
    await page.goto(app.origin + '/patients/' + patient.id + '?tab=vaccines')
    const card = page.locator(`#preventive-${parent.id}`)
    await expect(card).toContainText('Completed')
    await card.getByRole('button', { name: kind === 'vaccination' ? 'Edit vaccination record' : 'Edit deworming', exact: true }).click()
    await expect(page.getByLabel('Stock batch 1')).toBeDisabled()
    await page.getByLabel('Dose 1', { exact: true }).fill('Corrected clinical details')
    if (kind === 'vaccination') await page.getByLabel('Lot number 1', { exact: true }).fill('CORRECTED-LIVE-LOT')
    await page.getByRole('button', { name: 'Save record', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    assert.equal(balance(), 5 - count, 'Clinical edits must not consume stock again')
  }
  const today = sql("select (now() at time zone timezone)::date from public.clinic_settings limit 1")
  const date = (offset) => { const at = new Date(today + 'T00:00:00Z'); at.setUTCDate(at.getUTCDate() + offset); return at.toISOString().slice(0, 10) }
  const sourceStock = sql('select count(*) from public.inventory_movements')
  const sourceReminders = sql('select count(*) from public.reminders')
  const sourceQueue = sql('select count(*) from public.queue_entries')
  const manualPet = await careMutation('create_pet', { ownerId: household.id, name: 'Manual certificate patient', species: 'Cat', breed: 'Mixed', sex: 'Female', reproductiveStatus: 'Unknown' })
  const openCertificate = async () => {
    await page.goto(app.origin + '/patients/' + manualPet.id)
    await page.getByRole('link', { name: 'Travel certificate', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }
  const fillCertificate = async (control) => {
    await page.getByLabel('Control number', { exact: true }).fill(control)
    await page.getByLabel('Planned travel date').fill(date(1))
    await page.getByLabel('Certificate valid until').fill(date(5))
    await page.getByLabel('Destination', { exact: true }).fill('Cebu')
  }
  const fillManual = async (index, name) => {
    await page.getByLabel(`Manual vaccine name ${index}`, { exact: true }).fill(name)
    await page.getByLabel(`Manual lot number ${index}`, { exact: true }).fill(`CERT-LOT-${index}`)
    await page.getByLabel(`Manual administration date ${index}`, { exact: true }).fill(date(-30))
  }
  const confirm = async () => {
    await page.getByRole('checkbox', { name: /selected vaccination is Anti-Rabies/ }).check()
    await page.getByRole('checkbox', { name: /reviewed the pet/ }).check()
    await page.getByRole('button', { name: 'Preview certificate', exact: true }).click()
  }
  await openCertificate()
  await page.getByLabel('Anti-Rabies evidence', { exact: true }).selectOption('manual')
  await fillManual(1, 'Cancelled vaccine')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(sql(`select count(*) from public.vaccinations where pet_id='${manualPet.id}'`), '0')
  await openCertificate()
  await fillCertificate('MANUAL-001')
  await page.getByLabel('Anti-Rabies evidence', { exact: true }).selectOption('manual')
  await fillManual(1, 'Manual Rabies <label>')
  await page.getByLabel('Manual next due date 1', { exact: true }).fill(date(365))
  await page.getByLabel('Manual product expiration 1', { exact: true }).fill(date(60))
  await page.getByRole('button', { name: 'Add vaccine details', exact: true }).click()
  await fillManual(2, 'Manual combination')
  await page.getByLabel('Manual product expiration 2', { exact: true }).fill(date(90))
  await page.getByLabel('Certificate visibility', { exact: true }).selectOption('public')
  await confirm()
  const document = page.getByRole('dialog').frameLocator('iframe')
  await expect(document.locator('body')).toContainText('CERT-LOT-1')
  await expect(document.locator('body')).toContainText('CERT-LOT-2')
  await page.getByLabel('Manual lot number 2', { exact: true }).fill('CORRECTED-MANUAL-2')
  await expect(page.getByRole('checkbox', { name: /selected vaccination is Anti-Rabies/ })).not.toBeChecked()
  await expect(page.getByRole('dialog').locator('iframe')).toHaveCount(0)
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: mode })
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().right <= innerWidth), `Manual form overflow: ${mode} ${width}`)
    }
  }
  await confirm()
  await page.screenshot({ path: 'test-artifacts.local/manual-certificate-preview.png', fullPage: true })
  let loseIssue = true
  await page.route('**/rest/v1/rpc/portal_mutation', async (route) => {
    if (loseIssue && route.request().postDataJSON().p_action === 'issue_travel_certificate') {
      loseIssue = false; const response = await route.fetch(); assert.ok(response.ok(), await response.text()); return route.abort('failed')
    }
    return route.continue()
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  await expect(document.locator('body')).toContainText('CORRECTED-MANUAL-2')
  await page.unroute('**/rest/v1/rpc/portal_mutation')
  const certificates = checked(await admin.from('travel_certificates').select('*').eq('pet_id', manualPet.id))
  assert.equal(certificates.length, 1, 'Lost issue response duplicated certificate')
  assert.equal(certificates[0].snapshot.vaccinations.length, 2)
  assert.equal(sql(`select count(*) from public.vaccinations where pet_id='${manualPet.id}'`), '2')
  const shared = checked(await admin.rpc('read_public_travel_certificate', { p_token: certificates[0].public_token }))
  assert.deepEqual(shared.snapshot.vaccinations, certificates[0].snapshot.vaccinations)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await openCertificate()
  await fillCertificate('MIXED-002')
  await page.getByLabel('Anti-Rabies vaccination record').selectOption(certificates[0].rabies_vaccination_id)
  await page.getByRole('button', { name: 'Add vaccine details', exact: true }).click()
  await fillManual(1, 'Additional mixed vaccine')
  await confirm()
  await page.getByRole('dialog').getByRole('button', { name: 'Issue certificate', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  assert.equal(sql(`select count(*) from public.vaccinations where pet_id='${manualPet.id}'`), '3')
  assert.equal(sql('select count(*) from public.inventory_movements'), sourceStock)
  assert.equal(sql('select count(*) from public.queue_entries'), sourceQueue)
  assert.equal(sql('select count(*) from public.reminders'), sourceReminders)
  await page.goto(app.origin + '/patients/' + manualPet.id + '?tab=vaccines')
  await page.getByLabel('Search vaccinations and deworming').fill('CORRECTED-MANUAL-2')
  await expect(page.locator('.preventive-history-card')).toHaveCount(1)
  await expect(page.locator('.preventive-history-card')).toContainText('Manual combination')
  console.log('PASS real manual/mixed certificates, cancel without history, preview/confirmation invalidation, escaped labels, lost issue retry, public snapshot parity, historical patient search and light/dark mobile layouts')
  await careClient.auth.signOut()
  console.log('PASS real grouped vaccines and single deworming: inventory selection, waiting/drafts, lost completion response/retry, stock receipts, completed locks, edits and reload')

} finally {
  await app?.close()
  if(user){
    sql("do $$ declare targets text; begin select string_agg(format('%I.%I',schemaname,tablename),', ') into targets from pg_tables where schemaname in ('public','private') and tablename not in ('clinic_settings','service_types','pet_photo_config','rag_schedule_config','clinics','legacy_clinic','clinic_codes','clinic_subscriptions'); execute 'truncate '||targets||' restart identity cascade'; end $$;")
    checked(await admin.auth.admin.deleteUser(user.id))
    console.log('PASS isolated preventive browser fixtures removed')
  }
}
