import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { loadEnv } from 'vite'

export const frontendEnvironment = () => loadEnv('development', process.cwd(), 'VITE_')

export async function browserServer(port, env = {}) {
  const origin = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...env },
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk })
  server.stderr.on('data', (chunk) => { output += chunk })
  let browser
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`)
      try { if ((await fetch(origin)).ok) { ready = true; break } } catch { /* Wait for startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!ready) throw new Error(`Test server did not start: ${output}`)
    browser = await chromium.launch({ channel: 'chrome', headless: true,
      args: process.platform === 'win32' ? ['--disable-gpu'] : [],
    })
    return { origin, browser, async close() { await browser.close(); server.kill() } }
  } catch (error) { await browser?.close(); server.kill(); throw error }
}
