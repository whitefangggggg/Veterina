# KAN-23 — global clinic search

## Behavior

The header search button and Ctrl/Cmd+K open an accessible search dialog on desktop
and mobile. Input is debounced by 250 ms. Up/Down selects suggestions; Enter opens
the selected record, or full results when no suggestion is selected. Clear keeps
focus in the input; Escape closes and restores focus. There are at most 12
suggestions, grouped and labeled by record type. Full results use `/search`,
25-row server pages, a record-type filter, deterministic cursors and retry/refresh.

Search accepts 2–120 characters and up to eight whitespace-separated terms. It
normalizes whitespace and case, treats SQL wildcard characters literally and
requires all terms to match. A term may match an allowed record field or its
linked patient, owner or stock item. Exact titles/IDs rank first, followed by title
prefixes, title substrings and context matches. This is substring search, without
fuzzy spelling, stemming or semantic matching. Two-character searches work but
may scan the active clinic's index; use three or more characters for selective
trigram lookups. Supported dates are source date/ISO timestamp text. Event times
display in the clinic timezone; vaccination, deworming and batch dates remain
explicitly date-only, without inventing an event time. It does not reinterpret
arbitrary natural-language dates.

Each response computes rows, total and per-type counts in the same database
statement snapshot. Cursors include rank, normalized title, source and UUID, so
ties do not drop/duplicate records in an unchanged dataset. Edits between requests
can move records or change totals; Refresh resets pagination to current results.

## Searchable field allowlist

All rows below require active, approved membership in the current clinic and an
active clinic/subscription. Owner contact information has the same staff-only
boundary as the existing patient registry. Snippets are capped at 200 characters,
titles at 160. Search documents contain deliberately selected details, never raw
source JSON. Dose details may appear in an authenticated focused record view but
are not part of medication name search text.

| Domain / source | Searchable fields and context |
| --- | --- |
| Patients / `pets` | Name, UUID, record number, microchip, species, breed; current owner name/contact matching. |
| Owners / `owners` | Name, UUID, phone, normalized/national phone and email. No owner notes or emergency contacts. |
| Visits / `visits` | Type/service, UUID, complaint, diagnosis summary, saved veterinarian name and date. Detailed clinical notes, SOAP fields and laboratory content are excluded. |
| Diagnoses / `diagnoses` | Description, code, UUID; linked patient/owner. |
| Services / `treatments`, `patient_service_records` | Treatment/service name, UUID, date and saved performer where present; linked patient/owner. Detailed service notes are excluded. |
| Vaccinations / `vaccinations` | Vaccine, brand/manufacturer, lot, saved veterinarian, UUID, administration/next-dose dates; linked patient/owner. Legacy and grouped item UUIDs remain distinct. |
| Deworming / `deworming_administrations` | Product, brand, lot, UUID and administration/next-dose dates; parent record's patient and recording purpose. |
| Prescriptions / `prescriptions` | Medication names, UUID, saved prescriber/date; linked patient/owner. No dose/instruction text in the search haystack. |
| Appointments / `appointments` | Current service name, UUID and scheduled date/time; linked patient/owner. Booking notes are excluded. |
| Queue / `queue_entries` | Service, UUID, queue number/date, category and status; linked patient/owner. Drafts/internal notes are excluded. |
| Follow-ups / `reminders` | Title, type, UUID, due date and status; linked patient/owner. Internal reminder notes are excluded. |
| Inventory / `inventory_items` | Name, SKU, UUID, category and brand. |
| Batches / `inventory_batches` | Lot, UUID, expiry/received dates; linked item's searchable fields. |
| Suppliers / `suppliers` | Name, UUID, contact person, phone and email. Ordering notes are excluded. |
| Documents / `travel_certificates` | Control/reference, UUID, issued/travel dates, saved pet/owner names and destination. Private clinic documents remain available to approved staff; public visibility is not changed by searching. Snapshot JSON and QR tokens are excluded. |
| Admissions / `admissions` | Reference, UUID, admission date/workflow; linked patient/owner. Clinical condition is visible only in the authenticated admission detail, not indexed as a public tracking field. |
| Inpatient tasks / `admission_tasks` | Order title, UUID, due date and outcome/status; linked admission patient/owner. No medication schedule/dose details in search text. |
| Corrections / `visit_corrections` | Retained correction text/reason and UUID, distinctly labeled; linked encounter/patient/owner. Before/after snapshots are excluded. |
| Navigation | Clinic workspaces and appearance/profile settings. Staff administration, service configuration and Reports are generated only for owners. No platform administration destinations. |

Paused Knowledge/AI documents, attachments, patient photos, public admission
credentials, activation/subscription secrets, audit snapshots and platform records
are not indexed. New record types or narrower field/role policies must update
this matrix, the projector, server authorization and permission tests together.

## Freshness and navigation

The migration backfills existing persisted records. Source insert/update/delete
triggers maintain the private index in the same transaction; truncation clears the
corresponding source documents. Parent names/contact details are joined from live
index references, so a patient/owner rename updates related matches immediately.
Service-name and parent metadata changes refresh affected dependent projections.
Source records and clinical/stock/document workflows are not modified by searching.

Most results open `/records/:source/:recordId`, a focused, read-only selection
with allowlisted saved fields, current workflow state and bounded related links.
This view reads through the server and works on direct navigation/reload without
requiring the record in `ClinicDataContext`. Patient selections offer **Open patient
chart** for the existing full workspace and its clinical actions. Admissions use
their existing independent detail loader. Certificate links use
`/travel-certificates?certificateId=...` to open the persisted document viewer.
Owner-only settings links use a validated `tab` parameter; staff cannot force an
administration tab by changing that parameter.

Record-only/historical entries keep their recording purpose and never create
queue, reminder or stock activity. Returned clinical workflow labels are resolved
from current authorized queue rows for the bounded page, so a waiting vaccine or
checkup is not presented as completed. Inpatient encounters remain distinct.
Encounter views include up to ten newest retained correction links; original
evidence is retained, and search also finds corrections as their own record type.

`/search` and `/records/...` mount a minimal clinic provider: one settings row and
the current user's profile, followed by bounded search/selected-record RPCs. The
notification hub is omitted on these focused routes because its datasets are not
loaded. Returning to a clinical workspace mounts its normal provider. Existing
full-workspace startup/refresh downloads remain a separate UPG-04 improvement;
KAN-23 does not claim to have bounded every existing module or export.

## Authorization and privacy

`public.search_clinic_records` and `public.clinic_search_record` are authenticated,
read-only wrappers around private guarded readers. There is no caller-supplied
clinic or role selector. Both readers require `auth.uid()`, approved staff role and
the server's active clinic/subscription. Every index lookup, candidate expansion,
parent join, detail and related-record lookup is explicitly tenant-scoped.
Browser roles cannot read/write the index or invoke its maintenance helpers.

The non-login `veterina_search` role owns only the private index and its two guarded
readers and has no `BYPASSRLS` attribute. Ownership permits trigram planning on
this index: ordinary LIKE cannot be pushed across its RLS security barrier.
Explicit server tenant checks therefore guard index reads; reads of actual source
tables still use ordinary tenant RLS inherited through `authenticated`. The role
has explicit schema/helper access and SELECT grants for its bounded queue, vaccine,
deworming and stock queries. Migration setup removes legacy mutation-role
memberships, so it also works on restored projects without `veterina_rpc`. Neither
authenticated nor service-role clients can assume the search role. The maintenance
trigger is a separate, non-callable private definer so trusted migration/service
writes without a user session can keep the index current. Its source identifiers
come from attached triggers and a fixed allowlist, never arbitrary API SQL.

Search terms travel in POST bodies and in the `/search` URL fragment, not HTTP
query strings. They are not written to local/session storage or application logs.
Sign-in redirects strip the search fragment instead of copying personal terms
into a `next` query parameter.
Avoid adding body capture or fragment analytics to this feature. HTTP hosting
headers mark search/detail pages `no-store`, `noindex` and `no-referrer`; service
workers cache only public build assets and never cache POST results. Request
cancellation and query/generation keys prevent old results appearing after clear,
query changes, close or navigation. UI failures use generic messages rather than
raw database detail. Existing authentication/subscription gates remain in force.

## Verification and rollout

- `npm run test:global-search-database`: normalization/ranking, grouping, literal
  wildcards, cursor bounds/completeness, clinical and scheduling source coverage,
  live renames, stock reads, safe fields, historical semantics, direct API denials,
  other-clinic names/UUIDs, owner/staff/platform/inactive/expired personas.
- `npm run test:global-search-scale`: creates 10,000 patients and 10,000 historical
  visits before the migration, then rehearses populated backfill, checks patient
  fingerprints, inspects the selective query plan for trigram index use and checks
  broad-result totals/cursor pages. All catalog/data changes roll back.
- `npm run test:global-search`: real local Auth/PostgREST/Chrome coverage of bounded
  startup, debounce, grouped suggestions, keyboard/full-result navigation, focused
  reloads, pagination, error/retry, clear/cancellation and responsive Light/Dark
  layouts at 320/375/768/1440px. The existing UI-refinement and connected-workflow
  suites also exercise the new search flow and the link back to clinical actions.

The isolated database runner includes these suites sequentially. Unit tests cover
normalization, query URLs, grouping, safe links, RPC bounds/abort signals and error
redaction. Screenshot/plan artifacts are under `test-artifacts.local/global-search-*`.
On the local 20,001-document rehearsal, selective search took about 13 ms, a broad
first page about 427 ms, and a 25-result response about 7.2 KB. These are local
observations, not hosted latency guarantees or a load-test result.

Verification on 9 November 2026 includes 300 unit tests, lint (the pre-existing
unused `icons` warning remains), production build, the complete isolated database
runner, the updated connected/UI-refinement browser suites and current search
SQL/browser/rollout checks. Database advisors report no issues. Broader physical
device/staff acceptance, hosted latency and production rollout remain separate.

Apply `20261109091730_clinic_global_search.sql` after the existing clinic/admission
schema, then deploy the matching frontend and hosting headers. No new Edge Function
or frontend secret is required. The initial backfill and GIN creation run inside
the migration transaction and take locks; rehearse and schedule the rollout for
the target clinic's actual volume. Verify source counts, query plans, permissions
and current-record searches on that target. Local verification is distinct from
the hosted rollout recorded below.

## Hosted missing-RPC fix — 9 November 2026

The configured `Veterina_Demo` project (`xuyvlfsoovptklldqydt`) had neither search
RPC, the private index nor the KAN-23 migration. The frontend's parameter names
matched the SQL contract; `PGRST202` was caused by the missing backend deployment.
This restored project also lacks `veterina_rpc`.

The migration now provisions its own restricted `veterina_search` role with only
the authenticated parent role and the required schema, helper and read grants.
Existing parent memberships are removed before granting authenticated membership.
Source RLS, explicit tenant guards and private maintenance functions are retained.
No frontend API arguments, Edge Functions or application secrets changed.

Applied `clinic_global_search` as hosted migration `20261109110126`, including
transactional projection backfill, indexes, maintenance triggers, both RPCs and
the schema-cache reload. Backfill produced 211 documents with exact counts for
all 19 supported source tables. Counts and aggregate fingerprints matched across
26 source/configuration/sharing tables before and after deployment. No hosted
fixtures were created and no clinical or sharing rows were modified. The frontend
remains local; future Vercel deployment is separate.

`npm run test:global-search-migration` rehearses fresh migration plus the complete
search SQL suite with `veterina_rpc` present and genuinely absent (renamed within
an isolated rollback transaction). It also seeds legacy mutation membership and
verifies its removal. Both layouts passed. Existing SQL and real browser suites
passed, as did six focused unit tests and lint on the changed test scripts.
The populated 20,001-document rehearsal used the trigram index, returning a
selective search in about 9 ms, broad search in 429 ms and a 25-result page of
7,232 bytes. These timings describe this local run only.

Hosted authenticated checks found persisted patients and their focused records,
resolved clinical workflow state and read stock quantities under the search role.
PostgREST resolves both exact RPC signatures and denies anonymous execution with
`42501`. The index and maintenance helpers remain inaccessible to browser roles;
the reader has no login, superuser or BYPASSRLS capability. A hosted read plan
scanned the small 211-document index in approximately 0.25 ms without writes;
the larger local rehearsal verifies GIN use. Security advisory warning counts are
unchanged and health advisories remain clear.
