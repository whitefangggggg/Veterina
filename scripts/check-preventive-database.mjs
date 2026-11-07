import { openNewVisit } from './helpers/new-visit.mjs'
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
  checked(await admin.from('profiles').insert({id:owner.id,full_name:'Isolated preventive owner',role:'owner',is_active:true}))
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
    const count = kind === 'vaccination' ? 2 : 1
    for (let index = 1; index <= count; index++) {
      if (index > 1) await page.getByRole('button', { name: 'Add another vaccine' }).click()
      await page.getByLabel(`Inventory product ${index}`, { exact: true }).selectOption(product.id)
      await page.getByLabel(`Stock batch ${index}`, { exact: true }).selectOption(stockBatch.id)
      await page.getByLabel(`Stock quantity ${index}`, { exact: true }).fill('1')
      await page.getByLabel(`Dose ${index}`, { exact: true }).fill('Recorded clinical dose')
    }
    if (kind === 'deworming') await expect(page.getByRole('button', { name: 'Add another vaccine' })).toHaveCount(0)
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
    await page.getByRole('button', { name: 'Save record', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    assert.equal(balance(), 5 - count, 'Clinical edits must not consume stock again')
  }
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
