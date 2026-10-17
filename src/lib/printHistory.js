import { fetchReport, printPatientHistory } from './reports'

export async function printHistory(patientId, profiles = []) {
  const [history] = await fetchReport('history', patientId)
  printPatientHistory(history, { profiles })
}
