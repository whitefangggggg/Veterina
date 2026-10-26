export async function saveCheckup(page, withPrescription = false) {
  const confirmation = page.getByRole('dialog', { name: 'Complete this checkup?', exact: true })
  if (await confirmation.count()) {
    await confirmation.getByRole('button', { name: withPrescription ? 'Add Prescription' : 'Complete Checkup', exact: true }).click()
    return
  }
  const save = page.getByRole('button', { name: 'Save clinical entry', exact: true })
  await (await save.count() ? save : page.getByRole('button', { name: 'Complete Checkup', exact: true })).click()
  if (await confirmation.count()) await confirmation.getByRole('button', { name: withPrescription ? 'Add Prescription' : 'Complete Checkup', exact: true }).click()
}
