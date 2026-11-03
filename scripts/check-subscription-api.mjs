// Real Auth, PostgREST and Edge Functions; never writes to a hosted project.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { loadEnv } from 'vite'
import { createClient } from '@supabase/supabase-js'
import { cleanupSubscriptionFixtures } from './helpers/subscription-fixtures.mjs'

const env = loadEnv('test', process.cwd(), 'TEST_')
for (const key of ['TEST_DATABASE_URL','TEST_SUPABASE_URL']) assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(env[key]).hostname), 'Local test stack required')
const sql = (input) => {
  const r = spawnSync('psql', [env.TEST_DATABASE_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim()
}
assert.equal(sql('select clinic_name from public.clinic_settings where clinic_id=private.legacy_clinic_id()'), 'Veterina isolated test clinic')
assert.equal(sql('select count(*) from auth.users'), '0', 'Empty local Auth required')
const makeClient = (key = env.TEST_SUPABASE_ANON_KEY) => createClient(env.TEST_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
const setup = makeClient(env.TEST_SUPABASE_SERVICE_ROLE_KEY)
const checked = ({ data, error }) => { if (error) throw error; return data }
const password = 'Subscription-acceptance-87!'
const actors = []
async function account(kind, metadata = {}) {
  const email = `subscription-${kind}-${crypto.randomUUID()}@veterina-test.invalid`
  const { user } = checked(await setup.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata }))
  actors.push(user.id)
  const client = makeClient(); checked(await client.auth.signInWithPassword({ email, password }))
  return { id: user.id, client }
}
let admin, owner, staff
try {
  admin = await account('admin')
  owner = await account('owner', { application: 'veterina', account_type: 'owner', clinic_name: 'API subscription clinic', full_name: 'API clinic owner', role: 'platform_admin', isPlatformAdmin: true })
  staff = await account('staff')
  sql(`insert into private.platform_admins(user_id) values('${admin.id}');`)
  assert.equal(checked(await owner.client.rpc('account_access')).needsRegistration, true)
  assert.equal(checked(await owner.client.rpc('account_access')).isPlatformAdmin, false)
  assert.equal(checked(await owner.client.from('profiles').select('*')).length, 0)
  assert.equal((await owner.client.functions.invoke('platform-admin', { body: { action: 'generate', actor: admin.id, p_actor: admin.id, data: { windowDays: 1, termDays: 3650 } } })).error?.context.status, 403)
  assert.ok((await owner.client.rpc('platform_subscription_admin', { p_actor: admin.id, p_action: 'list' })).error)
  const generated = checked(await admin.client.functions.invoke('platform-admin', { body: { action: 'generate', data: { label: 'API fixture', windowDays: 1, termDays: 30 } } }))
  const key = crypto.randomUUID()
  const body = { code: generated.code, renew: false, requestId: key, clinicId: sql('select private.legacy_clinic_id()'), ownerId: admin.id, termDays: 3650 }
  const first = checked(await owner.client.functions.invoke('clinic-activation', { body }))
  assert.deepEqual(checked(await owner.client.functions.invoke('clinic-activation', { body })), first)
  assert.notEqual(first.clinicId, body.clinicId)
  const status = checked(await owner.client.rpc('account_access'))
  assert.equal(status.subscription.status, 'active')
  assert.ok(Date.parse(first.expiresAt) - Date.parse(status.serverNow) <= 30 * 86400000)
  assert.equal(checked(await admin.client.from('clinic_settings').select('id')).length, 0, 'Platform admin gained clinical access')
  const list = checked(await admin.client.functions.invoke('platform-admin', { body: { action: 'list' } }))
  assert.ok(!JSON.stringify(list).includes(generated.code), 'Code list returned the full secret')
  sql(`insert into public.profiles(id,clinic_id,full_name,role,is_active) values('${staff.id}','${first.clinicId}','API staff','clinical_staff',true);`)
  assert.equal((await staff.client.functions.invoke('platform-admin', { body: { action: 'list' } })).error?.context.status, 403)
  assert.equal((await staff.client.functions.invoke('clinic-activation', { body: { code: generated.code, renew: true, requestId: crypto.randomUUID(), ownerId: owner.id } })).error?.context.status, 403)
  assert.equal((await owner.client.functions.invoke('clinic-activation', { body: { code: generated.code, renew: true, requestId: crypto.randomUUID() } })).error?.context.status, 400)
  sql(`update private.clinic_subscriptions set expires_at=clock_timestamp()-interval '1 second' where clinic_id='${first.clinicId}';`)
  for (const actor of [owner, staff]) {
    assert.equal(checked(await actor.client.rpc('account_access')).subscription.status, 'expired')
    assert.equal(checked(await actor.client.from('clinic_settings').select('id')).length, 0)
    assert.ok((await actor.client.rpc('portal_mutation', { p_action: 'create_owner', p_data: { fullName: 'Denied', phone: '09171234567' }, p_key: crypto.randomUUID() })).error)
    for (const name of ['admin-staff','assistant-query','embed-worker','export-report','pet-photo']) {
      const result = await actor.client.functions.invoke(name, { body: { action: 'capabilities', report: 'patients' } })
      assert.equal(result.error?.context.status, 403, `${name} did not reject expired ${actor === owner ? 'owner' : 'staff'}`)
    }
  }
  const renewal = checked(await admin.client.functions.invoke('platform-admin', { body: { action: 'generate', data: { windowDays: 90, termDays: 1 } } }))
  const legacyExpiry = sql('select expires_at from private.clinic_subscriptions where clinic_id=private.legacy_clinic_id()')
  checked(await owner.client.functions.invoke('clinic-activation', { body: { code: renewal.code, renew: true, requestId: crypto.randomUUID(), clinicId: body.clinicId, termDays: 3650 } }))
  assert.equal(sql('select expires_at from private.clinic_subscriptions where clinic_id=private.legacy_clinic_id()'), legacyExpiry)
  for (const actor of [owner, staff]) {
    const access = checked(await actor.client.rpc('account_access'))
    assert.equal(access.subscription.status, 'active')
    assert.ok(Date.parse(access.subscription.expiresAt) - Date.parse(access.serverNow) <= 86400000)
    assert.equal(checked(await actor.client.from('clinic_settings').select('id')).length, 1)
  }
  console.log('PASS real Auth/Edge activation, retries, forged roles/actors/clinic/durations, admin/staff separation, expired RPC/files/exports/AI and renewal restoration')
} finally {
  await Promise.allSettled([admin, owner, staff].filter(Boolean).map((actor) => actor.client.auth.signOut()))
  // Staff shares the newly created clinic; the helper removes only these actors and their clinic.
  if (admin && owner && staff) cleanupSubscriptionFixtures(sql, admin.id, [owner.id, staff.id])
  else for (const id of actors) checked(await setup.auth.admin.deleteUser(id))
  assert.equal(sql('select count(*) from auth.users'), '0')
  console.log('PASS synthetic API subscription fixtures removed')
}
