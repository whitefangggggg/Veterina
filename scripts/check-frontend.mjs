import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const origin='http://127.0.0.1:5177'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5177','--strictPort'],{stdio:'pipe',windowsHide:true})
let browser
try{
  for(let attempt=0;attempt<80;attempt++){try{if((await fetch(origin)).ok)break}catch{}await new Promise((resolve)=>setTimeout(resolve,250))}
  browser=await chromium.launch({channel:'chrome',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  const errors=[];page.on('pageerror',(e)=>errors.push(e.message))
  const clinicCalls=[];page.on('request',(r)=>{if(/supabase\.co\/(rest|functions)\//.test(r.url()))clinicCalls.push(r.url())})
  await page.goto(`${origin}/dashboard`)
  await page.getByRole('heading',{name:'Staff sign in'}).waitFor()
  assert.ok(page.url().endsWith('/login'))
  await page.getByRole('link',{name:'Explore fictional demo'}).click()
  await page.getByText('Fictional demo · changes are temporary').waitFor()
  for(const route of ['/patients','/patients/pet-1','/appointments','/reminders','/inventory','/suppliers','/reports','/settings','/knowledge']){
    // Navigate through the router to preserve the explicit in-memory demo session.
    await page.evaluate((path)=>{window.history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'))},route)
    await page.locator('main').waitFor()
    await page.waitForTimeout(150)
    assert.ok(!(await page.locator('body').innerText()).includes('Unexpected Application Error'),`Route failed: ${route}`)
  }
  assert.deepEqual(errors,[])
  assert.deepEqual(clinicCalls,[],'Fictional demo made a clinic API request')
  await page.getByRole('link',{name:'Staff sign in'}).click()
  await page.getByRole('heading',{name:'Staff sign in'}).waitFor()
  console.log('PASS protected routes, explicit demo navigation, all workspace pages, demo API isolation, and sign-out navigation')
}finally{await browser?.close();server.kill()}
