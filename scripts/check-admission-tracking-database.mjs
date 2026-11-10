import { localAdmissionDatabase } from './helpers/admission-db.mjs'
localAdmissionDatabase().file('supabase/tests/admission_tracking.sql')
localAdmissionDatabase().file('supabase/tests/admission_tracking_clinical.sql')
console.log('PASS admission tracking SQL: approvals, secrets, retries, revocation, disclosure, staff/tenant permissions, audit, discharge, expiry and lookup limits')
