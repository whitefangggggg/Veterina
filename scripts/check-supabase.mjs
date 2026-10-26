import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const env=Object.fromEntries(readFileSync('.env.local','utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map((l)=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}))
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY
let response=await fetch(`${url}/rest/v1/pets?select=id`,{headers:{apikey:key}})
assert.ok([401,403].includes(response.status),`Anonymous clinic table access returned ${response.status}`)
console.log('PASS anonymous clinic API denied')
response=await fetch(`${url}/rest/v1/queue_entries?select=id`,{headers:{apikey:key}})
assert.ok([401,403].includes(response.status),`Anonymous queue access returned ${response.status}`)
console.log('PASS anonymous queue API denied')
for(const name of ['assistant-query','embed-worker','admin-staff','export-report','pet-photo']){
  response=await fetch(`${url}/functions/v1/${name}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}'})
  assert.equal(response.status,401,`${name} accepted an unauthenticated request: ${await response.text()}`)
  console.log(`PASS ${name} requires verified authentication`)
}
response=await fetch(`${url}/functions/v1/pet-photo-cleanup`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}'})
assert.equal(response.status,403,'Photo cleanup accepted an unauthenticated worker request')
console.log('PASS pet-photo-cleanup requires worker authentication')
response=await fetch(`${url}/auth/v1/settings`,{headers:{apikey:key}})
const settings=await response.json()
console.log(`Remote Auth public sign-up disabled: ${settings.disable_signup === true}`)
assert.equal(settings.mailer_autoconfirm,false,'Enable Confirm email in Development Auth settings; auto-confirm skips confirmation email delivery')
console.log('PASS hosted signup requires email confirmation')
