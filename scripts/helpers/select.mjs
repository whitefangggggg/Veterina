import { expect } from '@playwright/test'

// Drive the visible custom control, preserving the value-based test fixtures.
export async function chooseSelectOption(locator, value) {
  const page = locator.page()
  const trigger = locator.and(page.locator('button[role="combobox"]'))
  await expect(trigger).toBeVisible()
  const label = await trigger.locator('..').locator('select option').evaluateAll((options, value) => options.find((option) => option.value === String(value))?.label, value)
  if (label == null) throw new Error(`Select option not found: ${value}`)
  await trigger.click()
  const list = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`)
  await list.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toBeFocused()
}

// Assert form serialization separately from the visible accessible trigger.
export function selectControl(locator) {
  return locator.and(locator.page().locator('button[role="combobox"]')).locator('..').locator('select')
}
