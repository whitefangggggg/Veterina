// Visual contracts use intercepted APIs; this suite never changes clinic data.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { browserServer, frontendEnvironment } from './helpers/browser.mjs'
import { mockAccessToken } from './helpers/mock-auth.mjs'
import { mockAccountAccess } from './helpers/mock-access.mjs'
import { clinicThemes } from '../src/lib/clinicPersonalization.js'

const api = new URL(frontendEnvironment().VITE_SUPABASE_URL)
const actor = '10000000-0000-4000-8000-000000000001'
const patient = '20000000-0000-4000-8000-000000000001'
const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((part) => parseInt(part, 16)).join(', ')})`
const luminance = (hex) => hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
const errors = []
const app = await browserServer(5198)

async function scenario(mode = 'clinic') {
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', colorScheme: 'light' })
  // Appearance contracts do not depend on the external font CDN being reachable.
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
  const state = {
    themeKeys: [], failThemeSave: false, failThemeRefresh: false,
    profile: { id: actor, clinic_id: 'clinic', full_name: 'Theme owner', role: 'owner', is_active: true },
    settings: { id: 'settings', clinic_id: 'clinic', clinic_name: 'Theme clinic', address: 'Test address', phone: '09171234567', timezone: 'Asia/Manila', brand_color: clinicThemes[0].color, onboarding_completed_at: '2026-11-01T00:00:00Z', onboarding_step: 1 },
  }
  const session = () => ({ access_token: mockAccessToken(state.profile.id), refresh_token: 'theme-test', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id: state.profile.id, role: 'authenticated', email: 'theme@example.org', app_metadata: {}, user_metadata: {} } })
  if (mode !== 'public') await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${api.hostname.split('.')[0]}-auth-token`, session: session() })
  await context.route(`${api.origin}/**`, (route) => {
    const url = new URL(route.request().url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/rest/v1/rpc/account_access') return reply(mockAccountAccess(mode === 'pending' ? null : state.profile, mode === 'platform' ? { isPlatformAdmin: true } : mode === 'registration' ? { needsRegistration: true } : {}))
    if (url.pathname === '/auth/v1/user') return reply(session().user)
    if (url.pathname === '/auth/v1/token') return reply(session())
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname === '/rest/v1/rpc/portal_mutation') {
      const { p_action, p_data, p_key } = route.request().postDataJSON()
      if (p_action === 'set_clinic_theme') {
        state.themeKeys.push(p_key)
        if (state.failThemeSave) return reply({ message: 'Color save unavailable. Try again.' }, 503)
        state.settings.brand_color = p_data.brandColor
      }
      return reply({ id: state.settings.id })
    }
    if (url.pathname === '/rest/v1/rpc/owner_veterina_code') return reply({ code: 'VET-0123456789ABCDEF0123' })
    if (url.pathname === '/functions/v1/admin-staff') return reply({ accounts: [] })
    if (url.pathname === '/functions/v1/platform-admin') return reply({ serverNow: new Date().toISOString(), clinics: [], codes: [] })
    if (url.pathname === '/functions/v1/pet-photo') return reply({ enabled: false })
    if (url.pathname === '/functions/v1/travel-certificate') return reply({ status: 'unavailable' })
    if (url.pathname === '/rest/v1/clinic_settings' && state.failThemeRefresh) return reply({ message: 'Refresh unavailable' }, 400)
    const raw = {
      profiles: ['pending', 'registration'].includes(mode) ? [] : [state.profile], clinic_settings: [state.settings],
      owners: [{ id: 'household', full_name: 'Theme household', phone: '09171234567', is_active: true }],
      pets: [{ id: patient, owner_id: 'household', name: 'Ming', record_number: 'VET-1', species: 'Cat', breed: 'Mixed', sex: 'Female', status: 'Active', birth_date: '2022-01-01', baseline_weight: 4 }],
      visits: [5, 6].map((day) => ({ id: `visit-${day}`, pet_id: patient, visit_type: 'Wellness Check', chief_complaint: 'Routine wellness check', visited_at: `2026-11-0${day}T01:00:00Z`, attending_veterinarian_id: actor })),
      visit_vitals: [5, 6].map((day) => ({ id: `vital-${day}`, visit_id: `visit-${day}`, measured_at: `2026-11-0${day}T01:00:00Z`, weight_kg: day - 2 })),
      service_types: [{ id: 'wellness', name: 'Wellness check', workflow: 'checkup', is_active: true }],
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply(raw[url.pathname.split('/').at(-1)] || [])
    throw new Error(`Unexpected theme request ${url.pathname}`)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => errors.push(error.message))
  return { context, page, state }
}

const rootTheme = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim())
const tokenColor = (page, token) => page.evaluate((token) => {
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}, token)
const checkBrandFill = async (locator, theme) => {
  await expect.poll(() => locator.evaluate((element, color) => {
    const style = getComputedStyle(element)
    return style.backgroundColor === color || style.backgroundImage.includes(color)
  }, rgb(theme.color))).toBe(true)
}
const checkTheme = async (page, theme) => {
  await expect.poll(() => rootTheme(page)).toBe(theme.color)
  await checkBrandFill(page.getByRole('button', { name: 'Install Veterina', exact: true }), theme)
}

const setMode = async (page, mode) => page.evaluate((mode) => {
  localStorage.setItem('veterina-appearance', mode)
  dispatchEvent(new StorageEvent('storage', { key: 'veterina-appearance' }))
}, mode)
const checkMode = async (page, mode) => {
  await expect(page.locator('html')).toHaveAttribute('data-appearance', mode)
  await expect(page.locator('html')).toHaveCSS('color-scheme', mode)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', mode === 'dark' ? '#111b19' : '#f3f5f2')
}
const checkReadable = async (page) => {
  const failures = await page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d')
    const rgba = (color) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1); return [...canvas.getImageData(0, 0, 1, 1).data] }
    const lum = (color) => color.slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
    return [...document.querySelectorAll('.page-header p, .auth-description, .vt-section-heading > p:last-child, .public-certificate-message p, .appearance-option small, .clinic-theme-preview p')].filter((element) => element.getBoundingClientRect().height).flatMap((element) => {
      let ancestor = element; let background; let gradient = false
      while (ancestor) {
        const style = getComputedStyle(ancestor)
        if (style.backgroundImage !== 'none') gradient = true
        const parsed = rgba(style.backgroundColor)
        if (parsed[3] === 255) { background = parsed; break }
        ancestor = ancestor.parentElement
      }
      if (!background || gradient) return []
      const foreground = lum(rgba(getComputedStyle(element).color)); const back = lum(background)
      const ratio = (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05)
      return ratio < 4.5 ? [`${element.className || element.tagName}: ${ratio.toFixed(2)}`] : []
    })
  })
  assert.deepEqual(failures, [], `Unreadable text on ${page.url()}`)
}

async function checkHeroTextContrast(page, theme) {
  const box = await page.locator('.glance-metrics > div').first().boundingBox()
  const pixel = await page.screenshot({ clip: { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + 8), width: 1, height: 1 } })
  const background = await page.evaluate(async (base64) => {
    const picture = new Image(); picture.src = `data:image/png;base64,${base64}`; await picture.decode()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0)
    return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => value.toString(16).padStart(2, '0')).join('')
  }, pixel.toString('base64'))
  await expect(page.locator('.glance-metrics span').first()).toHaveCSS('color', 'rgb(255, 255, 255)')
  assert.ok(contrast('#ffffff', background) >= 4.5, `${theme.name}: hero metric text contrast on rendered background ${background}`)
}

try {
  await mkdir('test-artifacts.local', { recursive: true })
  const { context, page, state } = await scenario()
  const routes = ['/dashboard', '/patients', `/patients/${patient}`, '/queue', '/appointments', '/reminders', '/inventory', '/suppliers', '/reports', '/travel-certificates', '/settings']
  for (const theme of clinicThemes.slice(0, 2)) {
    state.settings.brand_color = theme.color
    for (const route of routes) {
      await page.goto(app.origin + route)
      await expect(page.locator('.workspace-header')).toBeVisible()
      await checkTheme(page, theme)
      await expect(page.getByRole('button', { name: 'Refresh clinic records', exact: true })).toHaveCount(0)
      const actions = page.locator('.spacious-content .button-primary:visible')
      if (await actions.count()) await checkBrandFill(actions.first(), theme)
      if (route === '/dashboard') {
        await expect(page.locator('.home-hero')).toHaveCSS('color', 'rgb(255, 255, 255)')
        assert.ok((await page.locator('.home-hero').evaluate((element) => getComputedStyle(element).backgroundImage)).includes(rgb(theme.color)), 'Hero gradient must use the selected clinic color')
        await expect(page.locator('.workspace-icon').first()).toHaveCSS('color', rgb(theme.color))
        await page.screenshot({ path: `test-artifacts.local/theme-dashboard-${theme.name.split(' ')[0]}.png`, fullPage: true })
        await page.setViewportSize({ width: 375, height: 900 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Dashboard theme overflow on mobile')
        await page.screenshot({ path: `test-artifacts.local/theme-dashboard-${theme.name.split(' ')[0]}-mobile.png`, fullPage: true })
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      if (route === `/patients/${patient}`) {
        await expect(page.locator('.pet-summary-grid svg').first()).toHaveCSS('color', rgb(theme.color))
        await expect(page.getByRole('button', { name: 'Delete patient', exact: true })).toHaveCSS('color', 'rgb(176, 71, 71)')
        await page.screenshot({ path: `test-artifacts.local/theme-patient-${theme.name.split(' ')[0]}.png`, fullPage: true })
        await page.setViewportSize({ width: 375, height: 900 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Patient theme overflow on mobile')
        await page.screenshot({ path: `test-artifacts.local/theme-patient-${theme.name.split(' ')[0]}-mobile.png`, fullPage: true })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.getByRole('button', { name: 'Weight & vitals', exact: true }).click()
        await expect(page.locator('.recharts-area-curve')).toHaveCSS('stroke', rgb(theme.color))
      }
      if (route === '/inventory') {
        await expect(page.locator('.stat-icon-rose')).toHaveCSS('color', 'rgb(176, 71, 71)')
        await expect(page.locator('.stat-icon-amber')).toHaveCSS('color', 'rgb(154, 97, 22)')
      }
    }
    console.log(`PASS every clinic route: ${theme.name}`)
  }

  // Reload clinic settings to prove selected themes reach global siblings.
  await page.goto(`${app.origin}/patients/${patient}`)
  for (const theme of clinicThemes) {
    state.settings.brand_color = theme.color
    await page.reload()
    await checkTheme(page, theme)
    await page.getByRole('button', { name: 'Add Record', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Record', exact: true })
    const next = dialog.getByRole('button', { name: 'Continue', exact: true })
    await expect(next).toBeDisabled()
    await expect(next).toHaveCSS('cursor', 'not-allowed')
    await expect(dialog.locator('.visit-service-art')).toHaveCSS('color', rgb(theme.color))
    const radio = dialog.getByRole('radio', { name: 'Wellness check', exact: true })
    await radio.focus(); await page.keyboard.press('Space')
    await expect(radio).toBeChecked()
    await expect(radio).toHaveCSS('accent-color', rgb(theme.color))
    await expect(dialog.locator('.visit-service-card')).toHaveCSS('border-top-color', rgb(theme.color))
    await expect(next).toHaveCSS('background-color', rgb(theme.color))
    await next.hover()
    await expect(next).toHaveCSS('background-color', rgb(theme.dark))
    await page.mouse.move(0, 0)
    await next.focus()
    await expect(next).toHaveCSS('outline-color', rgb(theme.color))
    await expect(next).toHaveCSS('outline-style', 'solid')
    assert.ok(contrast(theme.color, '#ffffff') >= 4.5, `${theme.name}: white button text contrast`)
    assert.ok(contrast(theme.color, theme.soft) >= 4.5, `${theme.name}: primary text on soft surfaces`)
    assert.ok(contrast(theme.dark, '#ffffff') >= 4.5, `${theme.name}: hover text contrast`)
    await page.keyboard.down('Space')
    await expect(next).toHaveCSS('background-color', rgb(theme.dark))
    await page.keyboard.up('Space')
    await expect(page.getByRole('button', { name: /Queue processing/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Install Veterina', exact: true }).click()
    await checkBrandFill(page.getByRole('dialog', { name: 'Install Veterina', exact: true }).getByRole('button', { name: 'Done', exact: true }), theme)
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Veterina home', exact: true }).click()
    await expect(page.locator('.home-hero')).toBeVisible()
    await checkHeroTextContrast(page, theme)
    await page.goto(`${app.origin}/patients/${patient}`)
  }
  console.log('PASS all six palettes: refreshed theme, global PWA/dialogs, controls, contrast, hover, active, focus, selected and disabled states')

  state.settings.brand_color = clinicThemes[1].color
  await page.reload()
  await checkTheme(page, clinicThemes[1])
  await page.goto(app.origin + '/clinic-setup')
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('radio', { name: 'Orchid', exact: true }).check()
  await checkBrandFill(page.locator('.onboarding-card .button-primary').first(), clinicThemes[2])
  await checkTheme(page, clinicThemes[1])
  await page.goto(`${app.origin}/patients/${patient}`)
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: 'Add Record', exact: true }).click()
    await page.getByRole('radio', { name: 'Wellness check', exact: true }).check()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Theme modal overflow at ${width}px`)
    await page.screenshot({ path: `test-artifacts.local/theme-picker-${width}.png` })
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  await checkTheme(page, clinicThemes[0])
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--brand')), '', 'Signing out must remove the inline clinic override')
  state.profile = { ...state.profile, id: '10000000-0000-4000-8000-000000000002', clinic_id: 'another-clinic' }
  state.settings = { ...state.settings, clinic_id: 'another-clinic', brand_color: clinicThemes[3].color }
  await page.getByLabel('Email address', { exact: true }).fill('another@example.org')
  await page.getByLabel('Password', { exact: true }).fill('Test-only-password-123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.workspace-header')).toBeVisible()
  await checkTheme(page, clinicThemes[3])
  // A public route reached without a document reload must also clear the clinic override.
  await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.locator('.vt-page')).toBeVisible()
  await checkTheme(page, clinicThemes[0])
  await context.close()
  console.log('PASS local onboarding preview, mobile layouts, sign-out, account switch and public-route theme cleanup')

  const appearance = await scenario()
  const display = appearance.page
  await display.goto(app.origin + '/settings')
  await display.getByRole('button', { name: 'Appearance', exact: true }).click()
  await display.getByRole('radio', { name: /^System/ }).focus()
  await display.keyboard.press('ArrowLeft')
  await expect(display.getByRole('radio', { name: /^Dark/ })).toBeChecked()
  await expect(display.locator('.appearance-option').filter({ has: display.getByRole('radio', { name: /^Dark/ }) })).toHaveCSS('outline-style', 'solid')
  await display.getByRole('radio', { name: /^Dark/ }).check()
  await checkMode(display, 'dark')
  await checkReadable(display)
  await display.reload()
  await checkMode(display, 'dark')
  await display.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(display.getByRole('radio', { name: /^Dark/ })).toBeChecked()
  const sibling = await appearance.context.newPage()
  await sibling.goto(app.origin + '/')
  await checkMode(sibling, 'dark')
  await display.getByRole('radio', { name: /^Light/ }).check()
  await checkMode(sibling, 'light')
  await display.getByRole('radio', { name: /^System/ }).check()
  await display.emulateMedia({ colorScheme: 'dark' })
  await checkMode(display, 'dark')
  await display.emulateMedia({ colorScheme: 'light' })
  await checkMode(display, 'light')
  await display.getByRole('radio', { name: /^Dark/ }).check()
  await display.emulateMedia({ colorScheme: 'light' })
  await checkMode(display, 'dark')
  await setMode(display, 'invalid-mode')
  await checkMode(display, 'light')
  await display.getByRole('radio', { name: /^Dark/ }).check()
  await sibling.close()

  // The sample changes locally; failed saves retain selection and retry key.
  appearance.state.failThemeSave = true
  await display.getByRole('radio', { name: 'Orchid', exact: true }).check()
  await checkTheme(display, clinicThemes[0])
  await checkBrandFill(display.locator('.clinic-theme-preview-button'), clinicThemes[2])
  await display.getByRole('button', { name: 'Save clinic color', exact: true }).click()
  await expect(display.getByRole('alert')).toContainText('Try again')
  await expect(display.getByRole('radio', { name: 'Orchid', exact: true })).toBeChecked()
  await checkTheme(display, clinicThemes[0])
  appearance.state.failThemeSave = false
  await display.getByRole('button', { name: 'Save clinic color', exact: true }).click()
  await expect(display.getByRole('status')).toContainText('Clinic color saved')
  assert.equal(appearance.state.themeKeys[0], appearance.state.themeKeys[1], 'Failed save must reuse its retry key')
  await checkTheme(display, clinicThemes[2])
  await display.reload()
  await checkTheme(display, clinicThemes[2])
  await display.getByRole('button', { name: 'Appearance', exact: true }).click()
  await display.getByRole('radio', { name: 'Rose', exact: true }).check()
  appearance.state.failThemeRefresh = true
  await display.getByRole('button', { name: 'Save clinic color', exact: true }).click()
  await expect(display.locator('.appearance-settings [role="alert"]')).toContainText('saved, but could not be refreshed')
  await expect(display.getByRole('radio', { name: 'Rose', exact: true })).toBeChecked()
  await checkTheme(display, clinicThemes[2])
  appearance.state.failThemeRefresh = false
  await display.getByRole('button', { name: 'Retry refresh', exact: true }).click()
  await checkTheme(display, clinicThemes[3])
  await expect(display.locator('.appearance-settings [role="alert"]')).toHaveCount(0)

  for (const theme of clinicThemes) {
    appearance.state.settings.brand_color = theme.color
    for (const route of (clinicThemes.indexOf(theme) < 2 ? routes : ['/dashboard', `/patients/${patient}`, '/settings'])) {
      await display.goto(app.origin + route)
      await expect(display.locator('.workspace-header')).toBeVisible()
      await checkMode(display, 'dark')
      await checkTheme(display, theme)
      await checkReadable(display)
      await expect(display.locator('.spacious-shell')).not.toHaveCSS('background-color', 'rgb(243, 245, 242)')
      if (route === `/patients/${patient}`) {
        await display.getByRole('button', { name: 'Add Record', exact: true }).click()
        await expect(display.getByRole('dialog')).toHaveCSS('background-color', 'rgb(27, 41, 36)')
        await display.keyboard.press('Escape')
        await display.getByRole('button', { name: 'Weight & vitals', exact: true }).click()
        await expect(display.locator('.recharts-area-curve')).toHaveCSS('stroke', await tokenColor(display, '--brand-ink'))
      }
      if (route === '/settings') {
        await display.getByRole('button', { name: 'Appearance', exact: true }).click()
        await checkReadable(display)
        for (const width of [320, 375, 1440]) {
          await display.setViewportSize({ width, height: 1000 })
          assert.ok(await display.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Appearance overflow at ${width}px`)
          if (theme === clinicThemes[0]) await display.screenshot({ path: `test-artifacts.local/appearance-dark-${width}.png`, fullPage: true })
        }
      }
    }
  }
  await display.emulateMedia({ media: 'print' })
  await expect(display.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(display.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await display.emulateMedia({ media: 'screen' })
  appearance.state.settings.onboarding_completed_at = null
  await display.goto(app.origin + '/dashboard')
  await expect(display.locator('.clinic-onboarding')).toBeVisible()
  await checkMode(display, 'dark')
  await expect(display.locator('.onboarding-card')).toHaveCSS('background-color', 'rgb(27, 41, 36)')
  appearance.state.settings.onboarding_completed_at = '2026-11-01T00:00:00Z'
  appearance.state.profile.role = 'clinical_staff'
  await display.goto(app.origin + '/settings')
  await display.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(display.getByRole('radio', { name: /^Dark/ })).toBeVisible()
  await expect(display.getByRole('heading', { name: 'Clinic color theme', exact: true })).toHaveCount(0)
  await expect(display.getByRole('button', { name: 'Staff accounts', exact: true })).toHaveCount(0)
  await display.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(display.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  await checkMode(display, 'dark')
  await checkTheme(display, clinicThemes[0])
  await appearance.context.close()
  console.log('PASS display controls, persistence, OS changes, cross-tab sync, color preview/save/retry, dark clinic routes, six palettes, mobile, print and staff permissions')

  for (const [mode, paths] of [
    ['public', ['/', '/sign-in', '/create-account', '/forgot-password', '/reset-password', '/admin/sign-in', '/travel-certificate']],
    ['pending', ['/access-pending']], ['registration', ['/complete-account']],
    ['clinic', ['/subscription']], ['platform', ['/admin']],
  ]) {
    for (const appearanceMode of ['light', 'dark']) {
      const scenarioState = await scenario(mode)
      await scenarioState.context.addInitScript((mode) => localStorage.setItem('veterina-appearance', mode), appearanceMode)
      for (const route of paths) {
        await scenarioState.page.goto(app.origin + route)
        await expect(scenarioState.page.locator('h1, h2').first()).toBeVisible()
        await expect(scenarioState.page).toHaveURL(app.origin + route)
        await checkTheme(scenarioState.page, clinicThemes[0])
        await checkMode(scenarioState.page, appearanceMode)
        await checkReadable(scenarioState.page)
      }
      await scenarioState.context.close()
      console.log(`PASS ${mode} pages: ${appearanceMode}`)
    }
  }
  for (const blockedStorage of [false, true]) {
    const fallback = await scenario('public')
    await fallback.page.emulateMedia({ colorScheme: 'dark' })
    await fallback.context.addInitScript((blocked) => {
      if (blocked) {
        Storage.prototype.getItem = () => { throw new Error('Storage unavailable') }
        Storage.prototype.setItem = () => { throw new Error('Storage unavailable') }
      } else localStorage.setItem('veterina-appearance', 'invalid-mode')
    }, blockedStorage)
    await fallback.page.goto(app.origin + '/')
    await expect(fallback.page.locator('.vt-page')).toBeVisible()
    await checkMode(fallback.page, 'dark')
    await fallback.context.close()
  }
  const unavailable = await scenario()
  await unavailable.context.addInitScript(() => {
    const read = Storage.prototype.getItem; const write = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) { if (key === 'veterina-appearance') throw new Error('Storage unavailable'); return read.call(this, key) }
    Storage.prototype.setItem = function (key, value) { if (key === 'veterina-appearance') throw new Error('Storage unavailable'); return write.call(this, key, value) }
  })
  await unavailable.page.goto(app.origin + '/settings')
  await unavailable.page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await unavailable.page.getByRole('radio', { name: /^Dark/ }).check()
  await checkMode(unavailable.page, 'dark')
  await unavailable.page.getByRole('link', { name: 'Veterina home', exact: true }).click()
  await expect(unavailable.page.locator('.home-hero')).toBeVisible()
  await checkMode(unavailable.page, 'dark')
  await unavailable.context.close()
  const bootstrap = await scenario('public')
  await bootstrap.context.route((url) => url.pathname === '/src/main.jsx', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export {}' }))
  await bootstrap.page.emulateMedia({ colorScheme: 'dark' })
  await bootstrap.page.goto(app.origin + '/')
  await expect(bootstrap.page.locator('#root')).toBeEmpty()
  await checkMode(bootstrap.page, 'dark')
  await bootstrap.context.close()
  assert.deepEqual(errors, [])
  console.log('PASS public/auth/account/subscription/platform pages in both modes, invalid/unavailable storage, in-memory selection and pre-React appearance; no browser errors')
} catch (error) { console.error('Browser errors:', errors); for(const context of app.browser.contexts()) for(const page of context.pages()) console.error('Failed page', page.url(), (await page.locator('body').innerText().catch(()=>'' )).slice(0,1200)); throw error } finally { await app.close() }
