// Real parallel requests on an empty, synthetic LOCAL database. Never targets a hosted clinic.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { loadEnv } from 'vite'

const { TEST_DATABASE_URL: connection } = loadEnv('test', process.cwd(), 'TEST_')
assert.ok(connection, 'Configure the isolated test database')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection).hostname), 'Remote database writes refused')
const args = [connection, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
const sql = (input) => { const result = spawnSync('psql', args, { input, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
assert.equal(sql('select clinic_name from public.clinic_settings limit 1'), 'Veterina isolated test clinic')
for (const table of ['auth.users', 'public.profiles', 'public.pets', 'public.owners', 'public.travel_certificates']) assert.equal(sql(`select count(*) from ${table}`), '0', `${table} must be empty`)
const actor = randomUUID(), claims = JSON.stringify({ sub: actor, role: 'authenticated' })
const pending = []
let setup = false
const session = (input) => {
  const child = spawn('psql', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const completed = new Promise((resolve, reject) => {
    let output = '', error = ''
    const timer = setTimeout(() => child.kill(), 30000)
    child.stdout.on('data', (chunk) => { output += chunk }); child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', (failure) => { clearTimeout(timer); reject(failure) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output, error }) })
  })
  child.stdin.end(input); pending.push(completed); return completed
}
try {
  const payload = JSON.parse(sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${actor}','travel-concurrency-${actor}@veterina-test.invalid',now());
    insert into public.profiles(id,full_name,role,is_active) values('${actor}','Concurrent issuer','clinical_staff',true);
    do $$ declare person uuid; patient uuid; vaccine uuid; day date; begin
      perform set_config('request.jwt.claims','${claims}',true);
      select (now() at time zone timezone)::date into day from public.clinic_settings limit 1;
      person:=(public.portal_mutation('create_owner','{"fullName":"Concurrent owner","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
      patient:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',person,'name','Concurrent pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
      insert into public.vaccinations(pet_id,vaccine_name,brand,lot_number,administered_at,next_due_at,administered_by)
        values(patient,'Rabies','Brand','LOT',day-30,day+365,'${actor}') returning id into vaccine;
      perform set_config('travel.concurrent_payload',jsonb_build_object('petId',patient,'issuerId','${actor}','rabiesVaccinationId',vaccine,'travelDate',day+1,'destination','Cebu','rabiesConfirmed',true,'eligibilityConfirmed',true)::text,true);
    end $$;
    select current_setting('travel.concurrent_payload'); commit;`))
  setup = true
  const keys = Array.from({ length: 6 }, () => randomUUID())
  const inputs = [...keys, keys[0]]
  const results = await Promise.all(inputs.map((key) => session(`begin; set local role authenticated;
    do $$ begin perform set_config('request.jwt.claims','${claims}',true); end $$;
    select public.portal_mutation('issue_travel_certificate','${JSON.stringify(payload)}','${key}'); commit;`)))
  for (const result of results) assert.equal(result.code, 0, result.error)
  const issued = results.map((result) => JSON.parse(result.output.trim()))
  assert.deepEqual(issued[0], issued.at(-1), 'Concurrent retry allocated a second certificate')
  assert.equal(new Set(issued.map((result) => result.referenceNumber)).size, 6)
  assert.equal(sql('select count(*) from public.travel_certificates'), '6')
  assert.equal(sql('select last_number from private.travel_certificate_counters'), '6')
  console.log('PASS concurrent travel issuance: unique references, duplicate-request receipt and exactly six saved certificates')
} finally {
  await Promise.allSettled(pending)
  if (setup) {
    // The empty-stack guards above ensure that every nonconfiguration row is synthetic.
    sql("do $$ declare targets text; begin select string_agg(format('%I.%I',schemaname,tablename),', ') into targets from pg_tables where schemaname in ('public','private') and tablename not in ('clinic_settings','service_types','pet_photo_config','rag_schedule_config','clinics','legacy_clinic','clinic_codes','clinic_subscriptions'); execute 'truncate '||targets||' restart identity cascade'; end $$;")
    sql(`delete from auth.users where id='${actor}';`)
    assert.equal(sql('select count(*) from public.travel_certificates'), '0')
    console.log('PASS synthetic travel concurrency fixtures removed')
  }
}
