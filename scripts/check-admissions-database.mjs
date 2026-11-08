import { localAdmissionDatabase } from './helpers/admission-db.mjs'
const db = localAdmissionDatabase()
db.file('supabase/tests/admissions.sql')
console.log('PASS isolated admission SQL permissions, lifecycle, stock, corrections, historical care and discharge evidence')
