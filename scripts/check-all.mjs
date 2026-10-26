import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

// Keep browser suites sequential: prescriptions and PWA both own port 5179.
const suites = ['test', 'lint', 'build', 'test:browser', 'test:connections', 'test:queue', 'test:checkup-completion', 'test:clinical-history', 'test:appointments', 'test:prescriptions', 'test:inventory', 'test:registration', 'test:clinic-access', 'test:pwa', 'test:api', 'test:database']
// Invoke installed Node entrypoints without an extra npm/shell process for each
// suite, keeping process ownership and exit codes predictable on Windows.
const commands = {
  test: ['node_modules/vitest/vitest.mjs', 'run'],
  lint: ['node_modules/oxlint/bin/oxlint'],
  build: ['node_modules/vite/bin/vite.js', 'build'],
  'test:browser': ['scripts/check-frontend.mjs'],
  'test:connections': ['scripts/check-connections.mjs'],
  'test:queue': ['scripts/check-queue.mjs'],
  'test:clinical-history': ['scripts/check-clinical-history.mjs'],
  'test:appointments': ['scripts/check-appointments.mjs'],
  'test:prescriptions': ['scripts/check-prescriptions.mjs'],
  'test:inventory': ['scripts/check-inventory.mjs'],
  'test:registration': ['scripts/check-registration.mjs'],
  'test:clinic-access': ['scripts/check-clinic-access.mjs'],
  'test:checkup-completion': ['scripts/check-checkup-completion.mjs'],
  'test:pwa': ['scripts/check-pwa.mjs'],
  'test:api': ['scripts/check-supabase.mjs'],
  'test:database': ['scripts/check-database.mjs'],
}
const results = []
await mkdir('test-artifacts.local', { recursive: true })
for (const suite of suites) {
  console.log(`\nRunning ${suite}`)
  const started = Date.now()
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, commands[suite], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk) })
    child.on('error', (error) => resolve({ code: 1, output: output + error.message }))
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
  await writeFile(`test-artifacts.local/${suite.replaceAll(':', '-')}.log`, result.output)
  results.push({ suite, status: result.code === 0 ? 'PASS' : suite === 'test:database' && result.code === 2 ? 'BLOCKED' : 'FAIL', seconds: Math.round((Date.now() - started) / 1000), exitCode: result.code })
}
const limits = 'Intercepted browser checks validate UI behavior. The isolated database suite uses real local Auth, Postgres and Edge Functions, with one deliberately lost save acknowledgement to test retries. Recovery-email delivery, physical-device installation, hosted infrastructure and load testing remain outside these results.'
const report = `# Veterina test report\n\nRun: ${new Date().toISOString()}\n\n| Check | Result | Seconds |\n| --- | --- | --- |\n${results.map((row) => `| ${row.suite} | ${row.status} | ${row.seconds} |`).join('\n')}\n\n${limits}\n\nFeature coverage includes the unified patient care timeline, daily action board, stock watch, saved filters and historical source links.\n`
await writeFile('test-artifacts.local/test-report.md', report)
await writeFile('test-artifacts.local/test-report.json', JSON.stringify({ checkedAt: new Date().toISOString(), results, limits }, null, 2))
console.log('\n' + results.map((row) => `${row.status} ${row.suite} (${row.seconds}s)`).join('\n'))
console.log('Report: test-artifacts.local/test-report.md')
if (results.some((row) => row.status !== 'PASS')) process.exitCode = 1
