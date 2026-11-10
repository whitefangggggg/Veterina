// Keep the existing storage keys while presenting the current clinical sections.
export const clinicalObservationFields = [
  { name: 'subjective', label: 'History' },
  { name: 'objective', label: 'Clinical Assessment' },
  { name: 'plan', label: 'Treatment Plan' },
  { name: 'laboratoryRequests', label: 'Laboratory Requests', storageName: 'laboratory_requests', maxLength: 10000, span: true },
  { name: 'laboratoryResults', label: 'Laboratory Results', storageName: 'laboratory_results', maxLength: 10000, span: true },
]

export function clinicalAssessmentText(record) {
  return [record.objective, record.assessment].filter((value) => typeof value === 'string' && value.trim()).join('\n\n')
}

export function clinicalObservationRows(record) {
  return clinicalObservationFields.flatMap(({ name, label, storageName }) => {
    const value = name === 'objective' ? clinicalAssessmentText(record) : record[name] ?? record[storageName]
    return storageName && !(typeof value === 'string' && value.trim()) ? [] : [[label, value]]
  })
}
