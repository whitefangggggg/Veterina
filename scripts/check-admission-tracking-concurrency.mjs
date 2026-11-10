import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { localAdmissionDatabase } from './helpers/admission-db.mjs'

const { env, sql } = localAdmissionDatabase()
for (const table of ['auth.users', 'public.profiles', 'public.owners', 'public.admissions']) assert.equal(sql(`select count(*) from ${table}`), '0', 'An empty synthetic stack is required')
const actor = randomUUID(), claims = JSON.stringify({ sub: actor, role: 'authenticated' })
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
const call = (action, payload, key) => `select public.portal_mutation('${action}',${literal(payload)},'${key}');`
const begin = `begin; set local statement_timeout='15s'; select set_config('request.jwt.claims','${claims}',true); set local role authenticated;`
const pending = []
function session(input) {
  const child = spawn('psql', [env.TEST_DATABASE_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = '', ready
  const locked = new Promise(resolve => { ready = resolve })
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); ready(false); reject(new Error('Tracking concurrency timed out')) }, 20000)
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('LOCK_READY')) ready(true) })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', e => { clearTimeout(timer); ready(false); reject(e) })
    child.on('close', code => { clearTimeout(timer); ready(false); resolve({ code, output, error }) })
  })
  child.stdin.end(input); pending.push(done); return { locked, done }
}
async function race(firstAction, firstPayload, secondAction, secondPayload, replay = false) {
  const key = randomUUID()
  const one = session(`${begin}${call(firstAction, firstPayload, key)}select 'LOCK_READY'; select pg_sleep(0.4); commit;`)
  assert.ok(await one.locked)
  const two = session(`${begin}${call(secondAction, secondPayload, replay ? key : randomUUID())}commit;`)
  const [a, b] = await Promise.all([one.done, two.done])
  assert.equal(a.code, 0, a.error)
  if (replay) {
    assert.equal(b.code, 0, b.error)
    const result = output => JSON.parse(output.split('\n').find(line => line.startsWith('{') && line.includes('"version"')))
    assert.deepEqual(result(a.output), result(b.output))
  } else { assert.notEqual(b.code, 0); assert.match(b.error, /RECORD_CHANGED/) }
}
let setup = false
try {
  const id = sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${actor}','tracking-race-${actor}@veterina-test.invalid',now());
    insert into public.profiles(id,full_name,role,is_active,is_veterinarian) values('${actor}','Tracking race owner','owner',true,true);
    select set_config('request.jwt.claims','${claims}',true);
    do $$ declare o uuid; p uuid; a uuid; begin
      o:=(public.portal_mutation('create_owner','{"fullName":"Race household","phone":"09171234567","address":"Test"}',gen_random_uuid())->>'id')::uuid;
      p:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',o,'name','Race pet','species','Cat','breed','Mixed','sex','Female','reproductiveStatus','Unknown'),gen_random_uuid())->>'id')::uuid;
      a:=(public.portal_mutation('admission_create',jsonb_build_object('petId',p,'reason','Race stay','condition','stable','admittedAt',now(),'veterinarianId',auth.uid()),gen_random_uuid())->>'id')::uuid;
      perform public.portal_mutation('tracking_configure',jsonb_build_object('id',a,'expectedVersion',0,'petDisplayName','Race pet','clinicName','Race clinic','showSpecies',false,'showAdmissionDetails',false),gen_random_uuid());
      perform set_config('tracking.race',a::text,true);
    end $$;
    select current_setting('tracking.race'); commit;`).split('\n').at(-1)
  setup = true
  const version = () => Number(sql(`select version from public.admission_public_sharing where id='${id}'`))
  let payload = { id, expectedVersion: version(), acknowledgePublic: true }
  await race('tracking_generate', payload, 'tracking_generate', payload)
  assert.equal(sql('select count(*) from private.admission_tracking_credentials'), '1')
  payload = { id, expectedVersion: version(), acknowledgePublic: true }
  await race('tracking_generate', payload, 'tracking_generate', payload, true)
  assert.equal(sql('select count(*) from private.admission_tracking_credentials'), '2')
  await race('tracking_publish', { id, expectedVersion: version(), update: 'Approved race update', acknowledgePublic: true }, 'tracking_revoke', { id, expectedVersion: version() })
  payload = { id, expectedVersion: version(), enabled: true, acknowledgePublic: true }
  await race('tracking_clinical_sharing', payload, 'tracking_clinical_sharing', { ...payload, enabled: false })
  assert.equal(sql(`select share_clinical_details from public.admission_public_sharing where id='${id}'`), 't')
  payload = { id, expectedVersion: version(), enabled: false }
  await race('tracking_clinical_sharing', payload, 'tracking_clinical_sharing', payload, true)
  assert.equal(sql(`select share_clinical_details from public.admission_public_sharing where id='${id}'`), 'f')
  // Force the allocator's ON CONFLICT path without replacing cryptographic code:
  // a BEFORE INSERT trigger suppresses the first candidate exactly as a collision
  // does (zero inserted rows). The next candidate must be freshly sampled.
  sql(`begin;
    create function pg_temp.tracking_collision() returns trigger language plpgsql as $$ begin
      if current_setting('tracking.force_collision',true)='yes' then
        perform set_config('tracking.force_collision','no',true); return null;
      end if; return new; end $$;
    create trigger tracking_test_collision before insert on private.admission_tracking_credentials for each row execute function pg_temp.tracking_collision();
    select set_config('tracking.force_collision','yes',true);
    select set_config('request.jwt.claims','${claims}',true);
    set local role authenticated;
    do $$ declare r jsonb; begin
      r:=public.portal_mutation('tracking_generate',jsonb_build_object('id','${id}','expectedVersion',${version()},'acknowledgePublic',true),gen_random_uuid());
      if r->>'token' !~ '^[A-Za-z0-9]{13}$' or current_setting('tracking.force_collision')<>'no' then raise exception 'TEST: collision recovery failed'; end if;
    end $$;
    rollback;`)
  // Sample 100 generations: all credentials remain unique, with a fresh random
  // candidate on each rotation and only the latest hash active.
  sql(`${begin}
    do $$ declare v integer:=${version()}; r jsonb; i integer; begin
      for i in 1..100 loop
        r:=public.portal_mutation('tracking_generate',jsonb_build_object('id','${id}','expectedVersion',v,'acknowledgePublic',true),gen_random_uuid());
        if r->>'token' !~ '^[A-Za-z0-9]{13}$' then raise exception 'TEST: invalid random code'; end if;
        v:=v+1;
      end loop;
    end $$; commit;`)
  assert.equal(sql('select count(*) from private.admission_tracking_credentials'), '102')
  assert.equal(sql('select count(*) from public.admission_public_sharing where enabled'), '1')
  console.log('PASS tracking concurrency: generation contention, identical receipt replay, publication/revocation ordering, collision recovery and 100 distinct rotations')
} finally {
  await Promise.allSettled(pending)
  if (setup) sql(`begin; truncate public.owners,public.profiles restart identity cascade; delete from auth.users where id='${actor}'; commit;`)
}
