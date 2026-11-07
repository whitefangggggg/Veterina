// Real concurrent PostgreSQL sessions on an otherwise empty synthetic local stack.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), 'TEST_')
assert.ok(env.TEST_DATABASE_URL, 'Configure the isolated test database in .env.test.local')
const url = new URL(env.TEST_DATABASE_URL)
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Remote database writes are refused')
const args = [url.href, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
const sql = (input) => {
  const result = spawnSync('psql', args, { input, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
assert.equal(sql('select clinic_name from public.clinic_settings limit 1'), 'Veterina isolated test clinic')
for (const table of ['auth.users', 'public.owners', 'public.pets', 'public.profiles', 'public.inventory_items']) {
  assert.equal(sql(`select count(*) from ${table}`), '0', `Refusing concurrency fixtures: ${table} must be empty`)
}
const userId = randomUUID()
const claims = JSON.stringify({ sub: userId, role: 'authenticated' })
let setup = false
const pending = []
function session(input) {
  const child = spawn('psql', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', signal
  const marked = new Promise((resolve) => { signal = resolve })
  const timer = setTimeout(() => child.kill(), 30000)
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('FIRST_DEDUCTED')) signal(true) })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', (failure) => { clearTimeout(timer); signal(false); reject(failure) })
    child.on('close', (code) => { clearTimeout(timer); signal(false); resolve({ code, output, error }) })
  })
  child.stdin.end(input)
  pending.push(completed)
  return { completed, marked }
}
try {
  const fixture = JSON.parse(sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${userId}','preventive-stock-${userId}@veterina-test.invalid',now());
    insert into public.profiles(id,full_name,role,is_active) values('${userId}','Concurrent preventive clinician','clinical_staff',true);
    do $$ declare person uuid; patient uuid; item uuid; batch uuid; payload jsonb; response jsonb; records jsonb:='[]'; n integer; begin
      perform set_config('request.jwt.claims','${claims}',true);
      person:=(public.portal_mutation('create_owner','{"fullName":"Concurrent owner","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
      item:=(public.portal_mutation('create_inventory_item','{"name":"Concurrency vaccine","brand":"Test brand","category":"Vaccines","unit":"vial","minimumStock":0}',gen_random_uuid())->>'id')::uuid;
      select id into batch from public.inventory_batches where item_id=item;
      perform public.portal_mutation('record_inventory_movement',jsonb_build_object('id',item,'batchId',batch,'delta',5,'reason','Delivery'),gen_random_uuid());
      for n in 1..2 loop
        patient:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Concurrent patient '||n,'species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
        payload:=jsonb_build_object('kind','vaccination','recordingPurpose','queue','petId',patient,'administeredAt',(now() at time zone 'Asia/Manila')::date,'veterinarianId','${userId}','vaccines',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'inventoryItemId',item,'batchId',batch,'dispenseQuantity',4)));
        response:=public.portal_mutation('create_preventive_care',payload,gen_random_uuid());
        perform public.portal_mutation('start_queue_entry',jsonb_build_object('id',response->>'queueEntryId','veterinarianId','${userId}'),gen_random_uuid());
        records:=records||jsonb_build_array(jsonb_build_object('id',response->>'queueEntryId','draftVersion',0,'record',payload||jsonb_build_object('id',response->>'id','version',0)));
      end loop;
      perform set_config('veterina_test.concurrent',jsonb_build_object('batch',batch,'records',records)::text,true);
    end $$;
    select current_setting('veterina_test.concurrent');commit;`))
  setup = true
  const [payload, secondPayload] = fixture.records.map(JSON.stringify)
  const key = randomUUID()
  const mutation = (data, idempotencyKey) => `select public.portal_mutation('complete_queue_entry','${data}','${idempotencyKey}');`
  const begin = `begin;set local statement_timeout='10s';select set_config('request.jwt.claims','${claims}',true);set local role authenticated;`
  const first = session(`${begin}${mutation(payload,key)} select 'FIRST_DEDUCTED';select pg_sleep(1.5);commit;`)
  assert.ok(await first.marked, 'First completion did not reach its stock lock')
  const second = session(`${begin}${mutation(secondPayload,randomUUID())}commit;`)
  const [one,two] = await Promise.all([first.completed,second.completed])
  assert.equal(one.code,0,one.error)
  assert.notEqual(two.code,0,'Concurrent care oversold stock')
  assert.match(two.error,/INSUFFICIENT_STOCK/)
  assert.equal(sql(`select sum(quantity_delta) from public.inventory_movements where batch_id='${fixture.batch}'`),'1.00')
  assert.equal(sql("select count(*) from public.queue_entries where status='completed'"),'1')
  assert.equal(sql("select count(*) from public.queue_entries where status='in_progress'"),'1')
  const replays = await Promise.all([session(`${begin}${mutation(payload,key)}commit;`).completed,session(`${begin}${mutation(payload,key)}commit;`).completed])
  replays.forEach(result => assert.equal(result.code,0,result.error))
  assert.equal(sql('select count(*) from private.preventive_dispenses'),'1')
  assert.equal(sql(`select sum(quantity_delta) from public.inventory_movements where batch_id='${fixture.batch}'`),'1.00')
  console.log('PASS real concurrent care cannot oversell; failed completion remains in progress; simultaneous lost-response retries retain one stock deduction')
} finally {
  await Promise.allSettled(pending)
  if (setup) {
    // The guards require a dedicated, otherwise empty local clinic before writes.
    sql("do $$ declare targets text; begin select string_agg(format('%I.%I',schemaname,tablename),', ') into targets from pg_tables where schemaname in ('public','private') and tablename not in ('clinic_settings','service_types','pet_photo_config','rag_schedule_config','clinics','legacy_clinic','clinic_codes','clinic_subscriptions'); execute 'truncate '||targets||' restart identity cascade'; end $$;")
    sql(`delete from auth.users where id='${userId}';`)
    assert.equal(sql('select count(*) from public.inventory_items'), '0')
    console.log('PASS synthetic concurrency fixtures removed')
  }
}
