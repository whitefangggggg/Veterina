import { localAdmissionDatabase } from './helpers/admission-db.mjs'
localAdmissionDatabase().file('supabase/tests/clinic_search.sql')
console.log('PASS global search SQL: normalization, rank, grouping, cursor totals, clinical sources, live edits, field allowlists, roles, clinic isolation and focused reads')
