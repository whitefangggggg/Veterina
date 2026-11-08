// Keep the existing storage keys while presenting the current clinical sections.
export const clinicalObservationFields = [
  { name: 'subjective', label: 'History' },
  { name: 'objective', label: 'Clinical Assessment' },
  { name: 'plan', label: 'Treatment Plan' },
]

export function clinicalAssessmentText(record) {
  return [record.objective, record.assessment].filter((value) => typeof value === 'string' && value.trim()).join('\n\n')
}

export function clinicalObservationRows(record) {
  return clinicalObservationFields.map(({ name, label }) => [label, name === 'objective' ? clinicalAssessmentText(record) : record[name]])
}
