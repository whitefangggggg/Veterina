# Veterina

Staff-only veterinary clinic management for a single clinic in the Philippines. Supabase Auth and Postgres back the portal. Clinic pages load real database rows; there is no fixture fallback. Empty tables show empty states. The backend requirements are in [PRD.md](PRD.md); the frontend requirements are preserved in [PRD.frontend.md](PRD.frontend.md).

## Run locally

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and configure:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`VITE_SUPABASE_ANON_KEY` remains a fallback for existing deployments. Restart Vite after changing environment variables, and set the same variables in the hosting build environment. Never put a service-role or secret key in a `VITE_` variable.

The connected development project is `yerrtkosxksacqxznrhk`. It already contains the backend migrations from October 8, 2026 and the portal migrations from October 17, 2026. **Do not replay local migrations `001`–`008` against this project.** They describe an earlier backend snapshot, not a clean rebuild of the connected database. Take a schema export before creating a separate staging/production environment.

## Account creation and first owner

Create a login at `/create-account` and sign in at `/sign-in`. A login alone does not grant access: every clinic page requires an active `public.profiles` row with role `owner` or `clinical_staff`. Registration stores a display name and an application marker in user metadata; neither grants roles. Accounts awaiting approval see `/access-pending` with a retry and sign-out control.

Email/password signup is enabled on the connected project; email confirmation is currently disabled. These settings intentionally follow the approved signup-and-staff-approval workflow, overriding the draft PRD's invite-only proposal. If confirmation is enabled later, configure the localhost/deployed `/sign-in` redirect URLs (including the `next` query parameter) in Supabase Authentication → URL Configuration. Registration handles confirmation-required responses.

The **first owner must be explicitly selected by a database administrator**. Register that account, verify its identity and email, then use the Supabase SQL Editor or MCP:

```sql
select id, email, email_confirmed_at
from auth.users
where lower(email) = lower('approved.owner@your-clinic.example');

-- Only succeeds while public.profiles is empty and this Auth email is confirmed.
select public.bootstrap_clinic_owner(
  'approved.owner@your-clinic.example',
  'Approved owner full name'
);
```

The first registrant is never automatically promoted. Existing registered accounts can also be approved by a database administrator by inserting their verified Auth UUID, approved name, role, and active flag into `public.profiles`. The browser has no direct insert/update grants on profiles.

After initial setup, the clinic owner can open **Settings → Staff accounts**, set up a TOTP authenticator, verify the six-digit code, load registered Veterina accounts, and approve or manage staff access. The deployed `admin-staff` Edge Function verifies the caller's JWT, active owner role, and `aal2` assurance on every request. The last active owner cannot be deactivated or demoted. Inactive users lose database access on their next request.

Staff invitations remain available after authenticator verification. Set the Edge secret `AUTH_REDIRECT_URL` to the allowed application `/login` or `/reset-password` URL before sending invitations. Invitation callbacks open password setup. Accounts with an enrolled authenticator are challenged during sign-in. Existing `/login` links lead into the current account flow; old `/demo` links lead to sign-in.

## Password recovery

Choose **Forgot your password?** on `/sign-in`, or open `/forgot-password`. Supabase sends the recovery email with a link back to `/reset-password`, where the user enters and confirms a new password (at least 8 characters; the server also enforces its configured password policy). The request page gives the same success message whether an account exists. Expired links, rate limits, weak/reused passwords, and failed requests have retry instructions.

Supabase handles token verification and session creation. The recovery page waits for the URL exchange and verifies the user with Auth before enabling the form; clinic-profile approval is not required to reset a password. Recovery callbacks arriving at another app route are sent to the password form. A user with an existing valid session can also open `/reset-password` to change their password. Resetting a password never changes staff roles or approval.

In Supabase **Authentication → URL Configuration**, allow the app's reset destination, including its `next` query parameter. The connected development project accepts `http://localhost:5173/reset-password?next=%2Fdashboard` and `http://127.0.0.1:5173/reset-password?next=%2Fdashboard` (verified against the Auth redirect endpoint). Local-development patterns such as `http://localhost:5173/**` can cover other safe return paths. For deployment, set the Site URL to the real application origin and add that origin's `/reset-password` destinations. Keep the standard recovery email link using `{{ .ConfirmationURL }}` so Supabase verifies the one-time token before redirecting. Do not point the email directly at the form without verification.

Email delivery uses the project's existing SMTP configuration. Supabase's default mail service only sends to organization team addresses and has low send limits; configure custom SMTP for other clinic staff. See [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) and [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp). No email-confirmation, SMTP, or authorization settings are changed by this frontend feature.

## Saved workflows

- Owners: create, search (including normalized Philippine phone numbers), edit, deactivate, and owner-only deletion after linked pets are removed or reassigned.
- Patients: register with a server-generated record number, search/filter species, edit identity/status/owner, and owner-only permanent deletion of clinical history. Empty microchips are null; supplied microchips must be unique 15-digit identifiers.
- Checkups: atomic encounter/vitals/follow-up saves, actual time of care in the clinic timezone, editing before finalization, finalization, and owner corrections with retained snapshots. Clinician names are captured with the original record. Finalized notes and prescriptions cannot be overwritten.
- Vaccinations: create/edit/delete, optional next-due dates, one live next-dose reminder, and retained history for superseded reminders.
- Scheduling: service-based durations, persisted rescheduling, appointment status transitions, and database-enforced overlap prevention per veterinarian. Booking and rescheduling require a future date/time in the configured clinic timezone. The hour/minute selectors omit elapsed times today and refresh while the dialog is open; future dates offer the full day. Supabase also enforces the rule using its server clock. Existing historical appointments remain available for viewing and status updates.
- Reminders: independent type/status filters, current clinic-date display status, custom reminders, edit/snooze/cancel/complete, and multiple contact attempts without prematurely completing a reminder.
- Inventory: items, supplier links, batches, expiry dates, stock-in/out and owner count adjustments. New items receive a database-generated SKU such as `SKU-000001` on save; existing SKUs stay unchanged and cannot be edited. Number allocation is safe for simultaneous saves; cancelled transactions can leave gaps. Balances come from the immutable ledger. Negative balances, wrong batches, fractional whole-unit stock, non-finite quantities, and expired dispensing are rejected. Archive depleted batches and items with stock history; movements cannot be erased.
- Suppliers: create, search, edit, archive, and owner-only deletion while preserving historic stock entries.
- Settings: persisted clinic identity, timezone, retention, reminder lead time, and professional details.
- Reports: server-authorized exports with patient, due-date, reminder status, category, archive, and low-stock filters. The database logs the applied filters and row count. CSV files stream from the server with spreadsheet formulas neutralized. Full printable patient histories always include every encounter and escape record text.

Forms wait for database acknowledgement before closing, block repeated submissions, retain input on errors, and reuse idempotency keys for retrying failed saves. The refresh control reloads saved data. Signing out clears the workspace; the next login fetches the same persisted database records.

Permanent deletion requires an owner and a recorded reason. Patient deletion removes dependent clinical rows and retrieval chunks. Patients with pre-existing stored attachments are protected from deletion until their files have been removed; this portal does not yet include attachment upload/removal controls.

## Verification

```sh
npm run test
npm run lint
npm run build
npm run test:browser
npm run test:api
```

Use `npm.cmd` in Windows PowerShell if script execution is restricted. Unit tests cover authentication/access transitions, password recovery and session verification, session races, internal return URLs, record mapping, timezone boundaries, retry keys, pagination, CSV safety, and complete print payloads. The browser check uses installed Chrome on port 5177 and verifies protected routes, account pages, recovery validation, and mobile layouts. The API check verifies anonymous access is denied without creating clinic data.

Run `supabase/tests/portal_workflows.sql` as a database administrator against the connected development schema (for example with the Supabase MCP `execute_sql` tool). It uses the actual `authenticated` role, exercises transactional record operations and access rules, and **rolls back every fixture and stock movement**. It checks idempotency, failed-write atomicity, encounter finalization, vaccine reminders, scheduling conflicts, ledger rules, owner deletion, staff restrictions, pending access, and inactive-account denial.

Browser acceptance should also verify signup → pending approval → approved workspace, invalid credentials, password-reset request → emailed link → new password → sign-in, expired recovery links (including with an existing session), reload persistence, CRUD forms, profile-query failures, sign-out, keyboard navigation, and mobile layouts. Use dedicated test accounts and remove their clinical records after the run.

## Deployment boundaries

The `supabase/functions/` directory contains staff administration, export, indexing, and assistant function sources. Handlers verify authentication explicitly. Configure `APP_ORIGIN` to the deployed frontend origin for production CORS. No privileged credentials belong in browser environment variables.

The upstream Knowledge workspace and patient record recall remain available inside the approved workspace. Owners can create, publish, and archive text documents and index pending sources. Only published document versions are retrieved. Patient recall uses the caller's identity and patient scope; answers contain citations and conservatively decline diagnosis or dosing questions. The clinic owner controls `ai_enabled` in Settings; merging code does not change the stored setting. PDF/DOCX parsing and document revision editing remain outside the current frontend.

The existing worker supports Vault-authenticated scheduled indexing with leases and retries. After the clinic approves an embedding model, `node scripts/prepare-hybrid.mjs APPROVED_DIMENSION APPROVED_MODEL_IDENTIFIER` prepares an unapplied migration for model-specific vectors, HNSW, hybrid retrieval, and ingestion backfill. Review that migration before applying it through Supabase MCP. Configure Edge secrets `EMBEDDING_GATEWAY_URL` and `EMBEDDING_GATEWAY_KEY` for the approved gateway, which accepts `{model, inputs: string[]}` and returns `{embeddings: number[][]}`. A generative provider, streaming answers, spending limits, retrieval evaluations, and clinical AI approval remain separate work.

The draft `PRD.md` also describes operational release gates such as isolated environments, CI drift checks, backup/restore rehearsals, performance tests, clinical/privacy review, and RAG evaluations. Wiring persistent portal workflows does not certify those release gates. Complete them before entering production clinical data.
