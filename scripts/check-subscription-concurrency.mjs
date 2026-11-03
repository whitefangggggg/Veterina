import { cleanupSubscriptionFixtures } from './helpers/subscription-fixtures.mjs'
// Real PostgreSQL contention checks, restricted to an empty local test stack.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), 'TEST_')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.TEST_DATABASE_URL).hostname), 'Local database required')
const args = [env.TEST_DATABASE_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
const sql = (input) => { const r = spawnSync('psql', args, { input, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
assert.equal(sql('select clinic_name from public.clinic_settings where clinic_id=private.legacy_clinic_id()'), 'Veterina isolated test clinic')
assert.equal(sql('select count(*) from auth.users'), '0', 'An empty local Auth database is required')
const admin = randomUUID(), owners = [randomUUID(), randomUUID(), randomUUID()], request = randomUUID(), extension = randomUUID()
const pending = []
let fixture
function session(input, marker = 'SUBSCRIPTION_LOCKED') {
  const child = spawn('psql', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', signal
  const marked = new Promise((resolve) => { signal = resolve })
  const timeout = setTimeout(() => child.kill(), 20000)
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes(marker)) signal(true) })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', (failure) => { clearTimeout(timeout); signal(false); reject(failure) })
    child.on('close', (code) => { clearTimeout(timeout); signal(false); resolve({ code, output, error }) })
  })
  pending.push(completed); child.stdin.end(input)
  return { marked, completed }
}
const begin = "begin; set local statement_timeout='8s'; set local role service_role;"
const redeem = (owner, token, key, renew = false) => `select public.redeem_clinic_activation('${owner}','${token}','{}','${key}',${renew});`
try {
  fixture = JSON.parse(sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${admin}','subscription-admin-${admin}@veterina-test.invalid',now());
    insert into private.platform_admins(user_id) values('${admin}');
    ${owners.map((owner) => `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${owner}','subscription-${owner}@veterina-test.invalid',now(),'${JSON.stringify({ application: 'veterina', account_type: 'owner', full_name: 'Concurrent owner', clinic_name: `Concurrent clinic ${owner}` })}');`).join('\n')}
    select public.platform_subscription_admin('${admin}','generate','{"windowDays":1,"termDays":30}'); commit;`))
  const first = session(`${begin}${redeem(owners[0], fixture.code, request)} select 'SUBSCRIPTION_LOCKED'; select pg_sleep(1); commit;`)
  assert.ok(await first.marked, 'First activation never acquired its locks')
  const second = session(`${begin}${redeem(owners[1], fixture.code, randomUUID())} commit;`)
  const retry = session(`${begin}${redeem(owners[0], fixture.code, request)} commit;`)
  const results = await Promise.all([first.completed, second.completed, retry.completed])
  results.forEach((result) => assert.equal(result.code, 0, result.error))
  const receipt = (result) => JSON.parse(result.output.split(/\r?\n/).find((line) => line.includes('clinicId')))
  assert.deepEqual(receipt(results[0]), receipt(results[2]), 'Concurrent retry changed the receipt')
  assert.notEqual(receipt(results[0]).clinicId, receipt(results[1]).clinicId)
  assert.equal(sql(`select count(*) from private.activation_redemptions where code_id='${fixture.id}'`), '2')
  assert.equal(sql(`select count(*) from public.profiles where id in ('${owners[0]}','${owners[1]}')`), '2')
  const clinic = receipt(results[0]).clinicId
  const original = Date.parse(receipt(results[0]).expiresAt)
  const extend = `select public.platform_subscription_admin('${admin}','extend','{"clinicId":"${clinic}","days":15}','${extension}');`
  const extendFirst = session(`${begin}${extend} select 'SUBSCRIPTION_LOCKED'; select pg_sleep(1); commit;`)
  assert.ok(await extendFirst.marked)
  const extendRetry = session(`${begin}${extend} commit;`)
  const extensions = await Promise.all([extendFirst.completed, extendRetry.completed])
  extensions.forEach((result) => assert.equal(result.code, 0, result.error))
  assert.deepEqual(receipt(extensions[0]), receipt(extensions[1]))
  assert.equal(Date.parse(receipt(extensions[0]).expiresAt) - original, 15 * 86400000)
  // Wait across the exact availability boundary while holding the code lock.
  sql(`update private.activation_codes set first_used_at=clock_timestamp()-interval '1 day'+interval '400 milliseconds' where id='${fixture.id}';`)
  const blocker = session(`begin; select id from private.activation_codes where id='${fixture.id}' for update; select 'SUBSCRIPTION_LOCKED'; select pg_sleep(1); commit;`)
  assert.ok(await blocker.marked)
  const expired = session(`${begin}${redeem(owners[2], fixture.code, randomUUID())} commit;`)
  const [held, rejected] = await Promise.all([blocker.completed, expired.completed])
  assert.equal(held.code, 0, held.error)
  assert.notEqual(rejected.code, 0, 'A redemption waiting past the availability deadline succeeded')
  assert.match(rejected.error, /ACTIVATION_CODE_EXPIRED/)
  assert.equal(sql(`select count(*) from public.profiles where id='${owners[2]}'`), '0')
  console.log('PASS real concurrent clinic activations, shared first-use locking, same-request retries, idempotent extensions and expiry during lock contention')
} finally {
  await Promise.allSettled(pending)
  // All identifiers are generated above. Never truncate or remove preexisting clinics.
  cleanupSubscriptionFixtures(sql, admin, owners)
  assert.equal(sql('select count(*) from auth.users'), '0')
  console.log('PASS synthetic subscription concurrency fixtures removed')
}
