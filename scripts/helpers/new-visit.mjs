export async function openNewVisit(page, service = 'Wellness check') {
  await page.getByRole('button', { name: 'Add Record', exact: true }).click()
  await page.getByRole('radio', { name: service === 'Vaccination' ? 'Vaccinations and Deworming' : service, exact: true }).check()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
}

export async function reviewRecord(page) {
  for (let step = 0; step < 55; step++) {
    const next = page.getByRole('dialog').getByRole('button', { name: 'Next', exact: true })
    if (!await next.count()) return
    await next.click()
    if (await page.getByRole('dialog').getByRole('alert').count()) throw new Error('Complete required record fields before requesting review')
  }
  throw new Error('Record wizard did not reach review')
}

export async function recordStep(page, id) {
  const form = page.locator('form.record-wizard:visible')
  if (!await form.count()) return
  for (let step = 0; step < 55; step++) {
    const panel = form.locator(`[data-record-step="${id}"]`)
    if (!await panel.count() || await panel.isVisible()) return
    const tab = form.locator(`[data-record-nav="${id}"]`)
    if (await tab.count() && await tab.isEnabled()) { await tab.click(); return }
    await form.getByRole('button', { name: 'Next', exact: true }).click()
    if (await form.getByRole('alert').count()) throw new Error('Complete the current step before navigating to ' + id)
  }
  throw new Error('Record step not found: ' + id)
}
