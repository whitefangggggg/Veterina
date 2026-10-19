# Testing Veterina

Run `npm run test:all` (`npm.cmd run test:all` in restricted Windows PowerShell).
It runs unit tests, lint, build, public-page and authenticated-connection browser
checks, queue, prescriptions, PWA, anonymous API checks and isolated database checks.
Browser suites run sequentially because prescriptions and PWA share port 5179.
Results and individual logs are saved under ignored `test-artifacts.local/`.
An unavailable database suite is reported as **BLOCKED**, and the aggregate command
exits unsuccessfully; it is never counted as a pass.

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
   This exporter targets the current public/private application schema, not a
   general backup/restore tool for arbitrary Postgres schemas.
2. Create ignored `test-artifacts.local/isolated`, then run
   `supabase init --workdir test-artifacts.local/isolated`. Configure its generated
   `supabase/config.toml` with project ID `isolated`, API port `56321`, database
   port `56322`, shadow port `56320`, mail port `56324`, Postgres 17, local email
   signup enabled, and email confirmation disabled. These non-default ports avoid
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

Run `npm run test:database`. The four SQL suites roll back their fixtures. The
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
