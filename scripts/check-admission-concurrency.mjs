import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const { env, sql } = localAdmissionDatabase()
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.pets', 'public.admissions', 'public.inventory_items', 'public.admission_wards']) {
  assert.equal(sql(`select count(*) from ${table}`), '0', `Concurrency fixtures require an empty synthetic stack: ${table}`)
}
const actor = randomUUID(), claims = JSON.stringify({ sub: actor, role: 'authenticated' })
const literal = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
const call = (action, data, key = randomUUID()) => `select public.portal_mutation('${action}',${literal(data)},'${key}');`
const begin = `begin; set local statement_timeout='15s'; select set_config('request.jwt.claims','${claims}',true); set local role authenticated;`
const pending = []
function session(input) {
  const child = spawn('psql', [env.TEST_DATABASE_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', signal
  const ready = new Promise((resolve) => { signal = resolve })
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); signal(false); reject(new Error('Concurrent admission request timed out')) }, 20000)
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('LOCK_READY')) signal(true) })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', (e) => { clearTimeout(timer); signal(false); reject(e) })
    child.on('close', (code) => { clearTimeout(timer); signal(false); resolve({ code, output, error }) })
  })
  child.stdin.end(input)
  pending.push(completed)
  return { ready, completed }
}
async function race(action, firstData, secondData, expected, { secondAction = action, key = randomUUID(), secondKey = randomUUID() } = {}) {
  const first = session(`${begin}${call(action, firstData, key)}select 'LOCK_READY'; select pg_sleep(0.8); commit;`)
  assert.ok(await first.ready, 'First request did not reach its locked transaction')
  const second = session(`${begin}${call(secondAction, secondData, secondKey)}commit;`)
  const results = await Promise.all([first.completed, second.completed])
  assert.equal(results[0].code, 0, results[0].error)
  if (expected) { assert.notEqual(results[1].code, 0, 'Both conflicting operations succeeded'); assert.match(results[1].error, expected) }
  else assert.equal(results[1].code, 0, results[1].error)
}
let setup = false
try {
  const fixture = JSON.parse(sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${actor}','admission-race-${actor}@veterina-test.invalid',now());
    insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values('${actor}','Admission race owner','owner',true,true);
    select set_config('request.jwt.claims','${claims}',true);
    do $$ declare owner uuid; pet uuid; pet2 uuid; ward uuid; unit uuid; item uuid; begin
      owner:=(public.portal_mutation('create_owner','{"fullName":"Admission race owner","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
      pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Race patient','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
      pet2:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner,'name','Race patient 2','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
      ward:=(public.portal_mutation('facility_ward','{"name":"Race ward"}',gen_random_uuid())->>'id')::uuid;
      unit:=(public.portal_mutation('facility_unit',jsonb_build_object('name','Race cage','kind','cage','wardId',ward),gen_random_uuid())->>'id')::uuid;
      item:=(public.portal_mutation('create_inventory_item','{"name":"Race medicine","category":"Medicine","unit":"tablet","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
      perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',(select id from public.inventory_batches where item_id=item),'delta',1,'reason','Race delivery'),gen_random_uuid());
      perform set_config('admission.fixture',jsonb_build_object('pet',pet,'pet2',pet2,'unit',unit,'item',item,'batch',(select id from public.inventory_batches where item_id=item))::text,true);
    end $$;
    select current_setting('admission.fixture'); commit;`).split('\n').at(-1))
  setup = true
  const intake = (pet) => ({ petId: pet, reason: 'Concurrency admission', condition: 'stable', veterinarianId: actor, admittedAt: new Date(Date.now() - 3600000).toISOString() })
  await race('admission_create', intake(fixture.pet), intake(fixture.pet), /ADMISSION_ACTIVE/)
  const a = sql(`select id from public.admissions where pet_id='${fixture.pet}'`)
  sql(`${begin}${call('admission_create', intake(fixture.pet2))}commit;`)
  const b = sql(`select id from public.admissions where pet_id='${fixture.pet2}'`)
  await race('admission_transfer', { id: a, expectedVersion: 0, unitId: fixture.unit }, { id: b, expectedVersion: 0, unitId: fixture.unit }, /UNIT_UNAVAILABLE/)
  assert.equal(sql('select count(*) from public.admission_occupancy where released_at is null'), '1')
  const version = (id) => Number(sql(`select version from public.admissions where id='${id}'`))
  const order = (id) => {
    sql(`${begin}${call('admission_order', { id, expectedVersion: version(id), kind: 'medication', title: 'Race medicine', dose: 'Ordered dose', route: 'Oral', frequency: 'Once', inventoryItemId: fixture.item, startsAt: new Date().toISOString() })}commit;`)
    return sql(`select t.id from public.admission_tasks t where t.admission_id='${id}'`)
  }
  const ta = order(a), tb = order(b)
  const dose = (id, taskId) => ({ id, expectedVersion: version(id), taskId, taskVersion: 0, outcome: 'given', inventoryItemId: fixture.item, batchId: fixture.batch, stockQuantity: 1 })
  const firstDose = dose(a, ta), secondDose = dose(b, tb), key = randomUUID()
  await race('admission_task', firstDose, secondDose, /INSUFFICIENT_STOCK/, { key })
  await race('admission_task', firstDose, firstDose, null, { key, secondKey: key })
  assert.equal(sql('select count(*) from public.admission_administrations where movement_id is not null'), '1')
  assert.equal(sql(`select sum(quantity_delta) from public.inventory_movements where item_id='${fixture.item}'`), '0.00')
  sql(`${begin}${call('admission_transition', { id: b, expectedVersion: version(b), status: 'ready_for_discharge' })}commit;`)
  const discharge = { id: b, expectedVersion: version(b), condition: 'stable', assessment: 'Approved', instructions: 'Home care', overdueReason: 'Reviewed at discharge', acknowledgeFutureTasks: true }
  await race('admission_discharge', discharge, { ...secondDose, expectedVersion: version(b), outcome: 'held', reason: 'No longer indicated', inventoryItemId: undefined, batchId: undefined, stockQuantity: undefined }, /RECORD_CHANGED|RECORD_FINALIZED/, { secondAction: 'admission_task' })
  assert.equal(sql(`select count(*) from public.admission_discharge_summaries where admission_id='${b}'`), '1')
  assert.equal(sql(`select count(*) from public.admission_tasks where admission_id='${b}' and status in ('pending','delayed')`), '0')
  console.log('PASS concurrent admission creation, cage assignment, stock contention, dose receipt replays and discharge versus administration')
} finally {
  await Promise.allSettled(pending)
  if (setup) {
    // Every table was empty before these synthetic fixtures were created.
    sql(`begin; truncate public.owners,public.inventory_items,public.profiles,public.admission_wards restart identity cascade; delete from auth.users where id='${actor}'; commit;`)
  }
}
