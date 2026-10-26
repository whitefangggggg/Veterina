// Real concurrent sessions; never runs against a hosted or populated clinic.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { loadEnv } from 'vite'
const env = loadEnv('test', process.cwd(), 'TEST_')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.TEST_DATABASE_URL).hostname), 'Local database required')
const args = [env.TEST_DATABASE_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
const sql = (input) => { const r = spawnSync('psql', args, { input, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
assert.equal(sql('select clinic_name from public.clinic_settings limit 1'), 'Veterina isolated test clinic')
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.pets', 'public.visits']) assert.equal(sql(`select count(*) from ${table}`), '0', `${table} must be empty`)
const actor = randomUUID(), claims = JSON.stringify({ sub: actor, role: 'authenticated' }), pending = []
let setup = false
function session(input) {
  const child = spawn('psql', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', signal
  const marked = new Promise((resolve) => { signal = resolve })
  const timeout = setTimeout(() => child.kill(), 30000)
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('ARRIVAL_CREATED')) signal(true) })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', (failure) => { clearTimeout(timeout); signal(false); reject(failure) })
    child.on('close', (code) => { clearTimeout(timeout); signal(false); resolve({ code, output, error }) })
  })
  pending.push(completed); child.stdin.end(input)
  return { marked, completed }
}
try {
  const fixture = sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${actor}','followup-${actor}@veterina-test.invalid',now());
    insert into public.profiles(id,full_name,role,is_active) values('${actor}','Concurrent follow-up clinician','clinical_staff',true);
    do $$ declare owner_id uuid; pet_id uuid; visit_id uuid; clinic_day date; service_id uuid; begin
      perform set_config('request.jwt.claims','${claims}',true);
      select (now() at time zone timezone)::date into clinic_day from public.clinic_settings limit 1;
      select id into service_id from public.service_types where workflow='checkup' and is_active limit 1;
      owner_id:=(public.portal_mutation('create_owner','{"fullName":"Concurrent follow-up household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
      pet_id:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner_id,'name','Concurrent follow-up pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
      visit_id:=(public.portal_mutation('create_encounter',jsonb_build_object('petId',pet_id,'type','Sick visit','complaint','Original complaint','weightKg',3,'veterinarianId','${actor}','followUpDate',clinic_day),gen_random_uuid())->>'id')::uuid;
      perform set_config('followup_test.data',jsonb_build_object('visitId',visit_id,'petId',pet_id,'expectedDate',clinic_day,'serviceId',service_id,'veterinarianId','${actor}','complaint','Current follow-up complaint','weightKg',3.2)::text,true);
    end $$; select current_setting('followup_test.data'); commit;`)
  setup = true
  const begin = `begin; set local statement_timeout='10s'; select set_config('request.jwt.claims','${claims}',true); set local role authenticated;`
  const arrive = (key) => `select public.portal_mutation('arrive_follow_up','${fixture}','${key}');`
  const key = randomUUID()
  const first = session(`${begin}${arrive(key)} select 'ARRIVAL_CREATED'; select pg_sleep(1.2); commit;`)
  assert.ok(await first.marked, 'First arrival did not lock its source checkup')
  const second = session(`${begin}${arrive(randomUUID())} commit;`)
  const results = await Promise.all([first.completed, second.completed])
  results.forEach((r) => assert.equal(r.code, 0, r.error))
  const receipt = (result) => JSON.parse(result.output.split(/\r?\n/).find((line) => line.includes('queueEntryId')))
  assert.deepEqual(receipt(results[0]), receipt(results[1]), 'Competing tabs received different ticket details')
  const retries = await Promise.all([session(`${begin}${arrive(key)} commit;`).completed, session(`${begin}${arrive(key)} commit;`).completed])
  retries.forEach((r) => assert.equal(r.code, 0, r.error))
  assert.equal(sql('select count(*) from public.visits'), '2')
  assert.equal(sql('select count(*) from public.queue_entries'), '1')
  console.log('PASS simultaneous follow-up arrivals and retries create one new clinical record and queue ticket')
} finally {
  await Promise.allSettled(pending)
  if (setup) {
    sql("do $$ declare targets text; begin select string_agg(format('%I.%I',schemaname,tablename),', ') into targets from pg_tables where schemaname in ('public','private') and tablename not in ('clinic_settings','service_types','pet_photo_config','rag_schedule_config','clinics','legacy_clinic','clinic_codes'); execute 'truncate '||targets||' restart identity cascade'; end $$;")
    sql(`delete from auth.users where id='${actor}';`)
    assert.equal(sql('select count(*) from public.visits'), '0')
    console.log('PASS synthetic follow-up concurrency fixtures removed')
  }
}
