# Testing Veterina

Run `npm run test:all` (`npm.cmd run test:all` in restricted Windows PowerShell).
It runs unit tests, lint, build, public-page and authenticated-connection browser
checks, queue, prescriptions, PWA, anonymous API checks and isolated database checks.
Browser suites run sequentially because prescriptions and PWA share port 5179.
Results and individual logs are saved under ignored `test-artifacts.local/`.
An unavailable database suite is reported as **BLOCKED**, and the aggregate command
exits unsuccessfully; it is never counted as a pass.

`npm run test:clinic-access` checks code validation and URL prefill, camera
permission denial, camera scanning/cancel with track cleanup, local QR image
decoding, rejected foreign links, retained signup values, owner code/QR rotation,
QR download, verified-email approval, rejection and mobile layouts with intercepted
APIs. `clinic_rbac.sql` uses two shops to test cross-shop reads, references,
exports and dispensing, metadata role forgery, owner/verified-email requirements,
last-owner protection, anonymous privileges, code rotation and immediate suspension.
The real local Auth/Edge test also signs up through a code and verifies the full
approval without MFA and suspension flow. It verifies that only pending Clinical
staff requests appear, that approved owners/staff disappear, and that a caller
cannot choose Owner during approval. No test sends staff invitations.

The clinic-access browser check also verifies confirmation resend after signup
and unconfirmed sign-in, its cooldown, preserved address, server rate-limit errors
and no duplicate signup. Unit tests cover the Auth resend arguments and failures.
`test:api` checks the hosted Auth confirmation setting without sending email;
inbox delivery requires acceptance with a real staff registration.

Checkup browser checks cover the four form sections, dates shown in words,
calendar keyboard dismissal, clinic date/time serialization, drafts and mobile
layout. Dates are stored as clinic dates/timestamps, independently of display.

`npm run test:checkup-completion` checks the completion confirmation, Cancel and
value retention, required fields, completion errors/retries, a prescription locked
to the current checkup, prescription retry, completion without prescribing, and
mobile layout. Cancelling the prescription and reloading retains In progress.
`checkup_completion.sql` checks preparation without completion, atomic prescription
completion, invalid prescription/stock rollback, retry receipts without repeated
deductions, stale drafts, private helper access, and explicit completion. The real
database browser flow retries a lost completion acknowledgement without duplicating
care. Both suites are in the aggregate checks.

`npm run test:inventory` checks item notes on create/edit, reload, cancel, failed-save
retry, clearing, literal text rendering and mobile layouts using intercepted APIs.
The `portal_workflows.sql` suite verifies persisted notes, omitted-field preservation,
empty defaults, clearing and idempotent retries against Postgres with rolled-back fixtures.

`npm run test:prescriptions` covers custom medications and the inventory combo box,
name/SKU/brand search, duplicate names, eligible batches, dispensing quantities,
historical snapshots, locked dispensing fields, added medications, keyboard/mobile
behavior, retries, print/PDF and real PNG downloads (file signature, dimensions,
image failure/retry and temporary-frame cleanup). Image downloads are checked to
perform no mutations. `prescription_inventory.sql` verifies transactional
deductions, validation, clinical edits, legacy compatibility, authorization and
deletion protection using rolled-back fixtures. `npm run test:prescription-stock`
uses two real PostgreSQL sessions to check stock contention and simultaneous retries.
It requires the otherwise empty isolated clinic, refuses remote hosts, and removes
its synthetic fixtures afterward. Both database checks are included in `test:database`.

Apply `20261024085702_prescription_inventory_dispensing.sql` and its
`20261024091117_prescription_inventory_visit_lock.sql` follow-up before releasing the
prescription UI. Existing prescriptions remain custom/history records until inventory
is explicitly selected. Saving an inventory medication dispenses the entered quantity;
saved item/batch/quantity cannot be changed or deleted, and stock corrections use
the existing Inventory workflow. There is no automatic batch splitting or restocking.

`npm run test:connections` checks every workspace for owner and clinical-staff
roles, workspace navigation, search, booking context and invalid identifiers,
patient links, supplier filtering, stock counts, exports, citation focus,
read failures, sign-out, keyboard interaction and 320/375/1440px layouts. Its API
responses are intercepted. The existing queue suite adds care completion,
concurrent drafts, saved vaccines, service workflows and retry coverage.

Use `npm run test:connections -- --daily-only` to run the new action-board,
timeline and stock-watch journeys independently of the full workspace sweep.
The workspace sweep uses the actual navigation menu; source-link and persistence
checks also reload the destination pages directly.

`npm run test:clinical-history` checks patient-specific clinical search, combined
visit/status/veterinarian/detail/date filters, prescription formats, corrections,
inclusive clinic dates, collapsed advanced options, card/calendar view switching,
month/day navigation, URL persistence, source links and mobile layouts using
intercepted API responses. This check also runs in `test:all`.
It covers the same compact filters and card/calendar views in Care timeline,
Vaccinations and Service history, including independent tab settings and
vaccine brand/due status, service notes and timeline activity filters.
Calendar day previews are checked for full record details, multiple
records, empty dates, keyboard opening, Escape/Close, focus return and mobile sizing.
The month grid checks include event mini previews with visit type and clinic time,
date-only vaccinations, busy-day overflow and opening full details from event rows.
Preview edit checks cover returning from existing editors after save/cancel,
prescription/vaccine/checkup persistence, service-note retries and conflicts,
timeline source editing and finalized-record restrictions. The isolated
`service_note_edits.sql` suite checks authenticated saves, audit/idempotency,
conflict detection and preservation of queue status, dates, drafts and assignment.

`npm run test:appointments` checks full-card and keyboard navigation to the
selected patient appointment, detail persistence after reload, independent action
buttons, patient/appointment matching, and 320/375px layouts. It also checks saved
follow-up dates appearing in the calendar, movement/removal after checkup edits,
and reload without duplicate bookings. Schedule-card editing, scheduled-day
appointment check-in/retry, prefilled follow-up arrivals, queue links and finalized
edit guards are covered too. Follow-up checks include wrong-day warnings/cancel,
rescheduling to today without changing finalized clinical notes, required current
weight, a separate clinical record on arrival, and retry/reload without duplicates.
API responses are intercepted; no clinic
records are changed. Date-only follow-ups remain clinical plans until a separate
timed appointment is booked. This suite runs in `test:all`.

`follow_up_arrivals.sql` verifies server date guards, scheduling conflicts,
transactional rollback, new encounter/vitals/queue links, idempotency, finalized
source preservation, queued completion and authorization. `npm run
test:follow-up-arrivals` uses simultaneous real Postgres sessions to verify one
new checkup and ticket across competing arrivals and retries. It requires an
empty isolated local clinic and removes its synthetic fixtures. Both run through
`test:database`. Apply `20261025035711_follow_up_arrival_records.sql` before
releasing the updated follow-up UI, followed by
`20261025040505_follow_up_arrival_retry_receipts.sql` for complete ticket receipts
across competing tabs.

## Isolated database setup

Use Docker, the Supabase CLI, PostgreSQL `psql`, and installed Chrome. Keep this
stack separate from the linked Development project. Tests refuse remote database
and API hosts and require the synthetic clinic name shown below. Never replay
historical migrations `001`–`008` to provision the current application.

1. Export the current schema with `SUPABASE_SOURCE_PROJECT` and a suitably scoped
   `SUPABASE_ACCESS_TOKEN`, then run `npm run test:schema`. This reads catalogs only
   and saves ignored `test-artifacts.local/current-schema.sql` plus a hash manifest.
   If that token cannot query the source, run the read-only query in
   `supabase/tests/schema_snapshot.sql` through authenticated Supabase MCP, then
   pass its returned section array to `node scripts/snapshot-test-schema.mjs --sections PATH`.
   Review the SQL before restore. It contains application tables, routines, views,
   generated columns, identities, indexes, triggers, policies and API grants;
   it excludes clinic rows, Auth accounts, Vault values and scheduled jobs.
   It preserves the restricted RPC role, its grants/function ownership and the
   Veterina Auth signup triggers so a restored stack enforces the same shop RLS.
   This exporter targets the current public/private application schema, not a
   general backup/restore tool for arbitrary Postgres schemas.
2. Create ignored `test-artifacts.local/isolated`, then run
   `supabase init --workdir test-artifacts.local/isolated`. Configure its generated
   `supabase/config.toml` with project ID `isolated`, API port `56321`, database
   port `56322`, shadow port `56320`, mail port `56324`, Postgres 17, local email
   signup enabled, email confirmation disabled, and `[auth.mfa.totp]` with both
   `enroll_enabled = true` and `verify_enabled = true`. These non-default ports avoid
   the Windows-reserved 54300–54399 range encountered during verification.
3. Start the stack:
   `supabase start --workdir test-artifacts.local/isolated --exclude studio,realtime,imgproxy,logflare,vector,supavisor,postgres-meta`.
4. Restore the reviewed snapshot into the **empty local database** using
   `psql LOCAL_DATABASE_URL -v ON_ERROR_STOP=1 -f test-artifacts.local/current-schema.sql`.
   Run `supabase/tests/isolated_seed.sql` the same way. This creates only the
   synthetic clinic settings and service catalog. It does not copy clinic data.
5. Copy `supabase/functions/` into the isolated workdir's `supabase/functions/`,
   then leave `supabase functions serve --workdir test-artifacts.local/isolated --no-verify-jwt`
   running. Handlers verify authentication themselves, matching the existing
   function configuration. Copy refreshed sources before subsequent test runs.
6. Use the isolated stack's `supabase status` output to configure ignored
   `.env.test.local` (never use a `VITE_` name for privileged credentials):

   ```dotenv
   TEST_SUPABASE_URL=http://127.0.0.1:56321
   TEST_SUPABASE_ANON_KEY=local-anon-key
   TEST_SUPABASE_SERVICE_ROLE_KEY=local-service-role-key
   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres
   ```

Run `npm run test:database`. The SQL suites roll back their fixtures. The
browser suite creates dedicated `@veterina-test.invalid` Auth identities and tests
owner/patient registration, patient-specific booking, check-in, queue drafts,
save/reload, loss of a real save acknowledgement and safe retry, clinical history,
reminders, supplier/item/batch creation, stock reconciliation, audited CSV exports,
pending/inactive access, staff authorization and sign-out. The privileged client
is confined to the Node test process; the browser uses the public key.

The browser suite requires an otherwise empty synthetic clinic. Its cleanup
truncates test application rows and removes its Auth identities, preserving clinic
settings and services. It rejects unrelated Auth accounts before any writes.
Do not use this test stack for other data. Failures save a screenshot and page text
under `test-artifacts.local/`. Stop the local function process and use
`supabase stop --workdir test-artifacts.local/isolated` when finished.
For subsequent runs, restart the existing local stack and function server, then
run `npm run test:all`; keep the saved `.env.test.local` and do not restore the
snapshot again into the already-provisioned database.

## Acceptance and limits

All aggregate checks must pass, and database/browser test fixtures must be removed.
The local schema is a snapshot of Development, not certification of a hosted
deployment. Physical iPhone/iPad installation, external recovery-email delivery,
hosted MFA/invitation configuration, and performance/load testing need separate
environment-specific acceptance.

The implemented daily workflow features include a patient care timeline with
source navigation, a dashboard action board, and stock watch. Regression checks
cover historical appointment/queue dates, closed reminders, prescription/vaccine
anchors, timeline pagination, overnight arrivals, and per-batch expiry filters.
See [DAILY-WORKFLOW-PLAN.md](DAILY-WORKFLOW-PLAN.md) for behavior and defaults.

## Registration, photos and clinical fields

`npm run test:registration` checks searchable owner selection (duplicate names,
email/phone and keyboard), the guided walk-in, back navigation and mobile layouts,
actual image headers and size rejection, preview, saved-patient upload retries,
failed replacement recovery, authenticated binary avatar responses, camera denial,
capture/retake/cancel/track cleanup and removal. Camera streams and provider
responses are simulated in this browser suite; physical cameras need device testing.

The registration browser suite checks one photo download across directory →
profile → editor navigation, offscreen lazy loading, and a fresh download after
sign-out/sign-in without reloading the app. Cache unit tests cover concurrent
request deduplication, byte-budget eviction, idle expiry, revision changes,
replacement/removal, failed fetch retries, account switches and late responses
after sign-out. Edge transport tests check bounded WebP uploads and stable signed
CDN originals without per-view transformations. The hosted verification probe also
checks that two reads share one provider fetch, while preserving unsigned-delivery
denial and successful deletion. Its timings describe a synthetic probe, not an
end-to-end patient-photo rendering benchmark.

`supabase/tests/registration_clinical.sql` verifies owner/pet matching, inactive
ownership rules, notes draft/completion/omitted-field updates/limits/finalization,
required/custom Route, private photo metadata grants, upload replay, atomic
replacement, removal and cleanup leases. `test:database` also exercises notes across
real draft/reload/save and a lost acknowledgement, editable Route without repeated
dispensing, anonymous/pending/inactive photo denial, and real stock concurrency.
Photo tests use synthetic metadata; they never upload clinic images.

Cloudinary acceptance uses the deployed cleanup function's worker-authenticated
verification request with the configured server secrets. Successful verification
is required before photo controls are enabled. This separately verifies the preset,
signed authenticated upload/read and denied unsigned delivery. Confirm HTTPS camera
permissions on target desktop/mobile devices and check the hourly cleanup schedule
before release. Never copy Cloudinary secrets into browser test fixtures or logs.
