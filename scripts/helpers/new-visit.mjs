export async function openNewVisit(page, service = 'Wellness check') {
  await page.getByRole('button', { name: 'Add Record', exact: true }).click()
  await page.getByRole('radio', { name: service === 'Vaccination' ? 'Vaccinations and Deworming' : service, exact: true }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
}
