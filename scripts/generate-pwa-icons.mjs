import { chromium } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Rasterize the existing brand artwork; no external image service is needed.
const source = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const directory = new URL('../public/pwa/', import.meta.url)
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [filename, size, fullBleed] of [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, true],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    const svg = fullBleed ? source.replace('rx="16"', 'rx="0"') : source
    await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`)
    await page.screenshot({ path: fileURLToPath(new URL(filename, directory)), omitBackground: true })
    await page.close()
  }
} finally {
  await browser.close()
}
