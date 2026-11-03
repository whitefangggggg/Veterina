// Read-only hosted acceptance: never signs in a user or changes provider settings.
import assert from 'node:assert/strict'
import { loadEnv } from 'vite'

const env = loadEnv('development', process.cwd(), 'VITE_')
const origin = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
if (!origin || !key) throw new Error('Configure the Supabase URL and publishable key first.')

const settingsResponse = await fetch(`${origin}/auth/v1/settings`, { headers: { apikey: key }, cache: 'no-store' })
assert.ok(settingsResponse.ok, `Auth settings returned ${settingsResponse.status}`)
const settings = await settingsResponse.json()
console.log(`Google provider enabled: ${settings.external?.google === true}`)

const registration = await fetch(`${origin}/functions/v1/google-registration`, {
  method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}',
})
assert.equal(registration.status, 401, 'Google registration must reject unauthenticated requests')
console.log('PASS hosted Google registration rejects unauthenticated requests')

const target = new URL(`${origin}/auth/v1/authorize`)
target.searchParams.set('provider', 'google')
target.searchParams.set('redirect_to', 'http://localhost:5173/sign-in?next=%2Fdashboard&auth=google')
const authorization = await fetch(target, { redirect: 'manual', cache: 'no-store' })
if (!settings.external?.google || ![302, 303].includes(authorization.status)) {
  console.error(`BLOCKED Google OAuth: authorization returned HTTP ${authorization.status}. Enable and save Google in Supabase project ${new URL(origin).hostname.split('.')[0]}.`)
  process.exitCode = 2
} else {
  const provider = new URL(authorization.headers.get('location'))
  assert.equal(provider.hostname, 'accounts.google.com', 'Authorization must redirect to Google')
  assert.equal(provider.searchParams.get('redirect_uri'), `${origin}/auth/v1/callback`, 'Google callback must return through this Supabase project')
  assert.ok(provider.searchParams.get('client_id')?.endsWith('.apps.googleusercontent.com'), 'Google must use a Web OAuth client')
  console.log('PASS hosted Google authorization redirects to Google')
  console.log('PASS Google Web client and Supabase callback URL; real login/callback persistence still requires interactive acceptance')
}
