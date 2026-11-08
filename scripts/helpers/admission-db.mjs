import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { loadEnv } from 'vite'

export function localAdmissionDatabase() {
  const env = loadEnv('test', process.cwd(), 'TEST_')
  assert.ok(env.TEST_DATABASE_URL, 'Configure the isolated test database in .env.test.local')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.TEST_DATABASE_URL).hostname), 'Remote writes are refused')
  const run = (args, input) => {
    const result = spawnSync('psql', [env.TEST_DATABASE_URL, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
      input, encoding: 'utf8', windowsHide: true, env: { ...process.env, PGCONNECT_TIMEOUT: '5' },
    })
    if (result.error) throw result.error
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout.trim()
  }
  assert.equal(run(['-At', '-c', 'select clinic_name from public.clinic_settings limit 1']), 'Veterina isolated test clinic', 'Refusing writes outside the synthetic test clinic')
  assert.equal(run(['-At', '-c', "select count(*) from auth.users where email not like '%@veterina-test.invalid'"]), '0', 'Unrelated accounts in isolated stack')
  return { env, sql: (input) => run(['-q', '-At'], input), file: (path) => run(['-f', path]) }
}
