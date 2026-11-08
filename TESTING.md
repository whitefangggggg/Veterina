# Testing Veterina

## Add Record steps

Patient Add Record uses one modal for service selection, recording method, the
relevant form steps, and a final review. Checkups separate visit details, vitals,
clinical notes, follow-up, and optional historical medicines. Preventive care
separates shared details from each vaccine/deworming item. The vaccination
section's add button opens the same flow with its service already selected.

Next validates the current step; Back and visited step labels preserve entered
values. Review offers an Edit action for each section. Previously opened service
and recording-method forms stay mounted until the modal closes, keeping their
unsaved values separate. Only the final save performs the existing mutation.
Existing record editing and queue drafts keep their original workflows.

`test:new-visits` checks single-dialog navigation, validation, review/edit,
retained values across service/purpose revisits, cancellation, keyboard focus,
and mobile layouts in light/dark mode. Preventive-care, historical-checkup,
checkup-completion, queue, and real database browser suites navigate these steps
and verify saved payloads, retries, completion, and stock behavior.

## Manual vaccination lots and certificate evidence

Live vaccination entries require a manually entered lot number separate from the
stock batch. Drafts may remain incomplete. Completed lots can be corrected through
the audited record editor without changing the stock ledger; issued certificate
snapshots retain their original evidence. Deworming retains its batch-based lots.

Travel certificates accept saved Anti-Rabies evidence, manual evidence, and mixed
saved/manual history. Manual rows require a name, lot, and administration date;
the selected Anti-Rabies row also needs a next-due date covering certificate
validity. Optional product expiration remains in the certificate snapshot.
Issuance atomically creates one historical vaccination group per manual row;
preview/cancel/failure create no rows, queue tickets, reminders, or stock changes.

Deploy `20261107084400_manual_vaccine_lots_and_certificate_entries.sql` before
this frontend. It is applied to Development; all 18 existing vaccine rows,
stock movements, and issued snapshots were unchanged, and the security advisor
baseline was unchanged. Existing saved-record issuance requests remain supported. New
live vaccination requests must include a nonempty `lotNumber` for each item.
`issue_travel_certificate` accepts optional `manualVaccinations` and
`manualRabiesItemId`; a saved `rabiesVaccinationId` and manual selection are
mutually exclusive. Manual row IDs are stable UUIDs and issuance uses the existing
payload-bound retry receipt.

`manual_certificate_vaccines.sql` covers manual/mixed issuance, invalid fields,
rollback, immutable snapshots, history corrections, and private helper access.
The real `test:preventive-database` browser suite covers manual entry, cancellation,
preview reset, lost issuance responses, patient history search, public snapshot
parity, and mobile dialogs in both appearance modes. The travel certificate
concurrency suite checks simultaneous retries create one certificate and vaccine.
These SQL checks also run under `test:database`.

Patients use **Vaccinations and Deworming**. A vaccination record contains one
or more vaccine items; a deworming record contains exactly one administration.
Live items require active Vaccines/Medicine inventory, an available batch and a
stock quantity separate from clinical dose. Waiting records and drafts do not
deduct stock. Completion consumes every item atomically, and completed-record
edits consume only newly added vaccines. Consumed products/batches/quantities
and their records cannot be removed; corrections go through Inventory.
Historical records accept manual details and create no operational effects.

Existing vaccine IDs, reminders and certificate references remain intact under
one-item parent records. Legacy rows are exempt from retroactive stock deduction.
The original single-vaccine APIs retain their receipt namespaces and child-ID
responses, and reject edits/deletion that would overwrite a multi-vaccine group.
Individual vaccine evidence remains available to travel certificates; deworming
is excluded. Due-date exports include both types and their record identifiers.
Printed histories group administrations and use an explicit white background.

Development (`yerrtkosxksacqxznrhk`) has migrations
`20261107043221_preventive_care_records.sql` and
`20261107043602_preventive_care_explicit_grants.sql`. Apply both before releasing
the frontend in another environment. Hosted verification preserved all 15 vaccine
rows and two issued certificates, with matching clinical, certificate, stock and
settings fingerprints. Backfilled queue links and stock exemptions were checked.
Browser writes/private helper access are denied; tenant RLS is enabled and the
security advisor baseline is unchanged.

`20261107043603_preventive_care_service_role_read.sql` grants the trusted
server-side workflow read access to the grouped parent and its private stock
ledger. Apply it with the preceding migrations before deploying this frontend.

`test:preventive-care` (also available through `test:historical-vaccinations`)
covers repeatable vaccine rows, single-product deworming, historical editing,
inventory categories, drafts, retries, completed-item locks, legacy deep links,
search/type filters, calendar previews and mobile layouts in both appearance
modes. `test:preventive-stock` uses actual concurrent PostgreSQL transactions to
check overselling and simultaneous lost-response retries. `preventive_care.sql`
adds atomic stock failures, repeated batch selections, fractional units, appends,
permissions, cancellation/deletion, reminders, reports and legacy adapters.
The real `test:database` workflow also exercises both live types through Auth,
PostgREST and the browser, including a deliberately lost completion response.

Settings > Appearance is available to every approved staff member. Light, Dark,
and System apply across clinic, public, authentication, account and platform
pages. The preference is browser-local (`veterina-appearance`), defaults to System,
syncs between tabs, and stays usable in memory when storage is unavailable.
The document head applies the resolved mode before React loads. Print and
standalone prescription/certificate exports retain white paper backgrounds.

Owners can preview and save the existing six clinic palettes in Appearance.
`portal_mutation('set_clinic_theme', { brandColor }, retryKey)` updates only the
active clinic's `brand_color`, using the existing audit and retry mechanisms.
Migration `20261107025039_clinic_appearance_theme.sql` is applied to Development
(`yerrtkosxksacqxznrhk`); the settings fingerprint and advisor baseline were
unchanged. Apply this migration before releasing the frontend elsewhere.

`test:theme` covers modes, OS changes, reloads, cross-tab sync, preview/save/retry,
retained selections and recovery when a saved color cannot be refreshed,
staff permissions, route/palette coverage, mobile layouts, keyboard focus,
contrast, unavailable storage and pre-React initialization. Appearance screenshots
are saved under ignored `test-artifacts.local/appearance-dark-*.png`.
`supabase/tests/clinic_appearance_theme.sql` rolls back its fixtures and checks
all six colors, owner/staff/anonymous/inactive/expired boundaries, clinic
isolation, unchanged settings/credentials and audited idempotent retries.

Clinic and veterinarian settings are separated. Settings > Clinic profile updates
only clinic identity/preferences. Settings > Veterinarian Details lists approved
accounts (including inactive ones), veterinarian designation, and per-person name,
TIN, PRC, PTR and license expiry. Owners edit these through the audited/idempotent
`save_veterinarian_details` action. Registration code/QR and pending approvals are
under Staff accounts, reached by the Register a veterinarian shortcut. Designation
does not change login role/status. Legacy `save_settings` professional fields are
ignored, while `set_veterinarian_tin` remains available under its old restrictions.

Migration `20261106171706_veterinarian_professional_details.sql` is applied to
Development (`yerrtkosxksacqxznrhk`). `profiles.is_veterinarian` defaults false;
existing nonblank PRC accounts were initially designated. Verified the backfill,
unchanged credential fingerprints and issued snapshots, private helper access,
clinic isolation and unchanged security advisor baseline. Apply this migration
before the updated frontend in other environments.

New certificates select only active designated veterinarians, defaulting to the
logged-in account when eligible and otherwise blank. Missing PRC/expiry and expired
licenses show nonblocking warnings; same-day expiry is current in clinic-local
dates. The server independently rechecks designation/status/clinic and snapshots
all credentials, including expiry in version 4. Version-1/2/3 documents retain
their original rendering. Other clinical staff selectors are unchanged.

Validation: 235 unit tests, Settings/certificate and clinic-access browser checks,
22 rolled-back SQL suites, four concurrency suites, the real Auth/Edge/browser
database workflow, lint and production build passed. Coverage includes separate
saves, multiple veterinarians, role/clinic/inactive-account boundaries, optional
credentials, invalid dates/text, designation removal, audit/retry safety, warning
boundaries, profile-change reprints, public QR views and mobile/keyboard controls.
Settings screenshots are `test-artifacts.local/veterinarian-details-*.png`.

Earlier TIN-only rollout (superseded by Veterinarian Details above):
Veterinarian TIN is managed in Settings, never entered on the certificate form.
Owners save their own TIN under Clinic profile > Your professional details and
other active veterinarians' TINs under Staff accounts > Veterinarian TINs.
The issuance form displays the selected issuer's saved TIN alongside PRC/PTR.
The server snapshots `profiles.tin_number` and ignores legacy issuance overrides;
already issued certificates keep their original TIN. Missing TIN stays optional
and prints as "Not recorded". Older settings clients preserve existing TINs.

Migration `20261106165757_veterinarian_tin_settings.sql` is applied to Development
(`yerrtkosxksacqxznrhk`). The existing audited, idempotent mutation interface now
accepts owner-only `set_veterinarian_tin: { id, tinNumber }`; `save_settings` accepts
optional `tinNumber`. Profile updates remain clinic-scoped, direct browser writes
and private helper access remain denied, and existing snapshot fingerprints and
security advisor findings are unchanged. Apply the migration before the frontend
in other environments.

Validation: 232 unit tests, certificate/Settings and clinic-access browser checks,
21 rolled-back SQL suites, four concurrency suites, the real Auth/Edge/browser
database workflow, lint and production build passed. Checks cover profile save
and reload, selected issuer changes, missing/formatted TINs, spoofed certificate
overrides, owner-only/cross-clinic/inactive-account enforcement, audit/retry safety
and snapshot-preserving print/public viewing after profile changes.

The Knowledge workspace menu entry, lazy import and route are commented out for
now. Its implementation and data remain available for later work. Direct
`/knowledge` URLs use the existing dashboard fallback. Connection checks verify
the workspace is hidden for both roles and old links redirect safely.

Travel certificate layout and owner edits: migration
`20261106164152_travel_certificate_owner_details.sql` is applied to Development
(`yerrtkosxksacqxznrhk`). New version-3 snapshots use a formal A4 letterhead,
underlined owner/pet fields, patient photo, Anti-Rabies evidence, validity,
veterinarian credentials/signature line and QR code, followed by vaccination
history on continuation pages with repeating table headers. Version-1/2 snapshots
keep their original renderer. Existing issued snapshot fingerprints were verified
unchanged after migration; permissions remain private and security advisors match
the existing baseline. Apply this migration before the frontend elsewhere.

Owner name, address and contact number are required, prefilled, resettable and
editable for this certificate only. `issue_travel_certificate` accepts optional
`ownerDetails: { name, address, contactNumber }`; older callers use the registered
owner's details. The server validates all three, records them in the immutable
snapshot and owner search/display name, and never updates the clinic owner or pet
ownership. Draft edits survive focus refresh, preview and failed-save retries;
choosing a different pet loads that pet's owner details.

Unit, browser and rolled-back SQL checks cover required fields, Unicode,
formatted contacts, escaping, reset/pet switching/refresh, immutable owner edits,
legacy layouts, saved search, public QR viewing, A4 sizing, long details,
multipage PDFs and retry safety. The real isolated database suite verifies
certificate edits leave the owner row unchanged and persist through source edits
and reloading. Desktop/mobile form and certificate captures, plus standard and
long-details PDFs, are saved under ignored `test-artifacts.local/`.

Appointments now owns the calendar and Follow-ups & tasks view. Reminders is no
longer a workspace menu/dashboard entry or page component. `/reminders` remains a
protected compatibility redirect, retaining status/type filters and record
fragments. Notification, dashboard, patient and assistant links use Appointments.
Calendar entries combine only explicit same-pet, same-date source links; unrelated
tasks and snoozed calls remain separate. Historical clinical sources are excluded
from live scheduling. Task contact history, outcomes, edit/snooze/cancel actions,
and owner-only deletion retain their existing authenticated mutation interfaces.

`test:appointments` covers calendar/task pairing, linked follow-up rescheduling,
contact acknowledgement retries, booking from a task, independent contact/care
completion, custom tasks, snoozing without changing vaccine dates, source links,
legacy redirect/reload/focus, roles and both calendar/task views at 320/375/1440px.
Unit tests cover pairing, explicit source IDs, terminal history and historical
exclusions. Connection checks assert the updated workspace menu. The original
reminder data and APIs are retained; this integration needs no database migration.

Patient history has three tabs: Clinical history, Vaccinations, and Weight & vitals.
Clinical history combines checkups, queued maintenance services and historical
service records, with shared search, record-type/detail filters and calendar
previews. Old services/timeline URLs resolve to Clinical history; equivalent
service filters and source fragments are retained. Checkup colors, clinical
editors, historical service edits and queue actions use their existing interfaces.

`test:clinical-history` covers mixed ordering, colliding source IDs, filters,
legacy links, combined previews and permitted edits. It also checks dated weight
points, partial vitals, BCS scales, baseline-only patients, visit links, keyboard
focus and 320/375/1440px chart/table layouts, producing screenshots under
`test-artifacts.local/`. Weight/vitals unit tests cover missing/single/equal/small
weights and clinic-local year boundaries. The connections, new-visits, queue,
checkup-completion, historical-checkups, theme and isolated database checks cover
the affected navigation and clinical workflows. This UI change needs no migration
or mutation API change.

Travel certificate details: `20261106152738_travel_certificate_details.sql` is applied
to Development. New certificates require a manually entered control number (text,
preserving leading zeroes) and a certificate valid-until date. Control numbers are
unique within the clinic and issuance year, including voided certificates; the
generated system reference remains separate. Validity must cover issuance/travel
and cannot exceed the selected Anti-Rabies record's next-dose date. The server
records actual issuance date/time in the clinic timezone.

Version-2 snapshots include owner address/contact, pet color, sex, birth date,
recorded weight and microchip, plus optional certificate-specific veterinarian TIN
and vaccine product expiration copied from documentary evidence. These optional
fields do not update staff profiles or vaccination records. Product expiration
cannot precede vaccination and is separate from immunity/next-dose validity. Pet
weight uses the latest nonfuture recorded measurement, falling back to baseline
weight. Missing details print as "Not recorded". Existing snapshots are retained.
Search includes the manual control number; preview, print and public QR viewing
use the same saved details. Public-sharing controls explain that owner contact
details and veterinarian credentials are included.

The travel unit/browser/SQL suites cover these fields, escaping, retained inputs,
historical source changes, inclusive date boundaries and server validation.
Concurrency checks verify duplicate manual controls cannot create two documents
or consume a system reference. The full isolated database suite covers real
authenticated issuance, public QR access/revocation, reload and voiding. Migration
permissions and RLS were verified in Development; security advisor findings are
unchanged. Apply this migration before the updated frontend in other environments.

Initial inventory stock: `20261106131107_inventory_initial_stock.sql` is applied to
Development. New items accept whole-unit or fractional opening quantities, up to
two decimal places when fractional quantities are enabled. Zero or omitted stock
creates no movement. The item, initial batch and opening ledger movement save in
one transaction using the existing authenticated mutation and retry receipts.
`test:inventory` covers quantity validation, owner/staff creation, retained inputs,
lost acknowledgements, whole/fractional/zero balances and mobile layouts.
`portal_workflows.sql` checks server validation, rollback after a batch failure,
retry safety and that item edits cannot rewrite stock. `test:database` also verifies
a real fractional opening balance after a lost save acknowledgement and reload.

`npm run test:travel-certificates` covers workspace navigation, pet selection,
vaccination eligibility, preview, lost-save acknowledgement retries, saved history,
immutable reprints, print retry, branding, credentials, owner voiding and mobile
layouts using intercepted APIs. It also produces a multipage A4 PDF under
`test-artifacts.local/`. Unit tests verify date boundaries, missing details,
estimated ages and print escaping. `travel_certificates.sql` tests clinic and
subscription isolation, server eligibility, immutable snapshots, source deletion,
void permissions and idempotency with rolled-back fixtures.
`npm run test:travel-certificate-concurrency` verifies reference allocation and
simultaneous retry safety using independent local Postgres sessions. It refuses
hosted databases and requires the empty synthetic clinic. These checks are included
in `test:all` and `test:database`; the latter also issues, reloads and voids a
certificate through the real browser/Auth/PostgREST workflow.

Travel certificate rollout: `20261106052056_pet_travel_certificates.sql` is applied
to Development. The authenticated dispatcher, clinic RLS and browser write denial
were verified after deployment; security advisor findings are unchanged. Deploy
this migration before the matching frontend in other environments. Certificates
are clinic-issued records; government shipping-permit applications remain separate.

Patient photos: `20261106054843_travel_certificate_patient_photos.sql` and the
matching `pet-photo` Edge Function are deployed to Development. The service reads
the private patient image and prepares bytes for its current revision; issuance
copies those bytes into the certificate snapshot. Reprints retain the original
photo after profile changes or deletion. Existing issued snapshots stay immutable.
Browser checks cover photo loading/retry, preview and print; SQL verifies revision
conflicts, missing prepared images, caller-supplied image rejection and clinic
isolation. Unit tests cover image encoding and rejection of unsafe print sources.

Certificate QR sharing: `20261106060854_travel_certificate_public_sharing.sql` and
the `travel-certificate` Edge Function are deployed to Development. Certificates
default to private. Active clinic staff can publish or revoke public viewing through
the audited mutation interface, during issuance or from the saved document. QR codes
use a random 256-bit token in the URL fragment. Anonymous reads return one explicitly
shared snapshot only, with no-store headers and clinic/subscription checks; private,
unknown and revoked links return the same unavailable response. Direct anonymous
table/RPC access remains denied. Public voided certificates display their status.
Browser tests decode the generated QR, check anonymous viewing/revocation, mobile
layout, visibility retries and printed QR output. The real database acceptance flow
also exercises public/private transitions through Auth, PostgREST and Edge Functions.
SQL tests cover private defaults, public issuance, invalid visibility values, tenant
isolation, immutable tokens, retry receipts and snapshot-preserving public reads.

`npm run test:historical-checkups` covers the purpose chooser, record-only entry,
missing measurements, Unicode clinician names, partial historical prescriptions,
prescription dates, retry/edit/reload, owner/staff defaults, and mobile layouts.
`historical_checkups.sql` verifies atomic saves, queue/reminder/stock isolation,
custom clinicians with separate queue responsibility, tenant isolation, anonymous
denial, and finalized-record guards. Its fixtures roll back. Both checks are
included in the corresponding aggregate suites.

`npm run test:subscriptions` covers admin OAuth return paths, owner/staff denial,
clinic search and filters, history, independent code durations, generation and
revocation, extension retries, expired owner/staff notices, renewal, verified
email-owner activation, automatic workspace unmount at expiry, and mobile
layouts using intercepted APIs. Screenshots are saved under
`test-artifacts.local/subscriptions-admin-*.png`.

The rolled-back `platform_subscriptions.sql` suite covers code timing, different
clinics sharing a code, independent terms, once-per-clinic redemption, role
forgery, private function/table grants, idempotency, extensions, revocation,
expiry boundaries, failed provisioning rollback, clinic/file isolation,
expired records/mutations/Storage denial and renewal without record loss.
`npm run test:subscription-concurrency` uses real concurrent local PostgreSQL
sessions for first-use contention, simultaneous activation retries, extension
retries and expiry while waiting for a code lock. Only its generated fixtures
are removed afterward.

`npm run test:subscription-api` uses real local Auth, PostgREST and Edge Functions
to verify activation and renewal, untrusted actor/clinic/role/duration rejection,
admin/staff separation and expiry enforcement for exports, photos, AI and
mutations. It refuses hosted databases and requires an empty synthetic local
stack. These SQL, concurrency and API checks are included in `test:database`;
the intercepted UI suite is included in `test:all`.

Development rollout: the subscription migration and eight matching Edge
Functions have been deployed through Supabase MCP. The initial administrator
and transition grants were verified. Hosted anonymous endpoint checks pass.
Google is enabled and redirects to Google, but a real login and persistent
callback session remain pending at the user's request. Supabase advisors show
the existing five unrelated public-definer warnings and disabled leaked-password
protection; private subscription tables intentionally deny browser access through
RLS without policies. No new exposed-definer warning was introduced.

`npm run test:owner-onboarding` checks required clinic details, image validation
and preview, color selection, opening hours and timezone, saved progress after
reload, completion retry, personalized workspace branding, settings revisit,
staff exclusion and 320/375/1440px layouts using intercepted APIs. Screenshots
are saved under `test-artifacts.local/owner-onboarding-brand-*.png`. The SQL suite
`owner_clinic_onboarding.sql` tests new-clinic setup state, draft/completion
persistence, validation, atomic image saves, retries, owner-only writes, inactive
owners and clinic isolation. Its synthetic fixtures roll back. Both suites are
included in the corresponding aggregate checks.

`npm run test:google-auth` checks Google buttons on sign-in/signup, OAuth callback
restoration and safe return paths, new owner setup/retry, staff code validation
and pending approval, cancelled OAuth, sign-out and mobile layouts. Google and
Supabase responses are intercepted; this suite does not authenticate a real
Google account. Auth-store unit tests cover status failures and account-switch
races. `google_account_registration.sql` verifies trusted Google identity and
confirmed-email requirements, service-only provisioning, new clinic isolation,
request retries, metadata forgery, pending staff isolation and owner approval.
All SQL fixtures roll back. The Google browser suite is included in `test:all`,
and the SQL suite in `test:database`; deploy the matching migration and Edge
Function before running hosted acceptance with a real Google account.

`npm run test:google-provider` performs read-only hosted checks: Google provider
availability, a redirect to Google's authorization server, and rejection of
unauthenticated registration requests. It sends no email and creates no users.
It reports exit code 2 when the hosted provider is disabled. A complete Google
consent/login still requires interactive acceptance with a real Google account.

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

The clinic-access browser suite also checks Owner/Staff switching, retained form
values, login signup before subscription activation, 320px layout, and sign-in with an existing
verified authenticator factor without showing a challenge. `owner_staff_signup.sql`
checks verified-account activation, clinic isolation, default services/code,
repeat confirmation, frozen signup intent, staff metadata forgery and approval
with an ordinary password session. Fixtures are rolled back.

Checkup browser checks cover the four form sections, dates shown in words,
calendar keyboard dismissal, clinic date/time serialization, drafts and mobile
layout. Dates are stored as clinic dates/timestamps, independently of display.
Once care starts, Visit details and Vitals & condition open locked with separate
Edit/Done buttons. Queue checks cover independent unlocking, keyboard access,
required-field validation, retained locked values in drafts and completion,
relocking on reopen and mobile layout. Calendar edits follow the same controls.

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

The prescription browser suite includes shop-logo format validation, resize and
preview, cancel, save failure/retry, persisted reload/removal, mobile controls,
and owner-only upload controls. It checks the logo in the print/PDF document and
the actual downloaded PNG pixels. `clinic_logo.sql` verifies same-clinic staff
read access, owner-only saves, isolation, invalid/oversized payload rejection,
removal and suspended-owner denial in rolled-back transactions.

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


### Historical vaccinations

`npm run test:historical-vaccinations` checks the shared purpose chooser, keyboard
selection/cancellation, unchanged queue inventory controls, required historical
fields, custom Unicode clinician names, optional details, preserved input after a
failed save, retry keys, editing without another chooser, both roles, and mobile
layouts. These UI checks intercept APIs.

`supabase/tests/historical_vaccinations.sql` verifies real authenticated creation
and editing, retry receipts, recorder attribution, missing clinicians, original
dates, date validation, cross-clinic isolation, inventory/dispensing rejection,
immutable purpose, helper grants, and server rejection of historical queue and
reminder links. It runs with active checkup and vaccination queues and confirms
that historical entry leaves operational records unchanged. Fixtures roll back.
The database suite includes this as its nineteenth SQL suite and separately tests
a real browser save whose acknowledgement is lost after commit: retry must leave
one historical vaccination without changing queue counters, reminders,
appointments, or inventory movements.

Validation on 6 November 2026: 215 unit tests, lint, production build, historical
vaccination/checkup, queue, clinical-history, appointment and travel-certificate
browser checks, nineteen isolated SQL suites, four concurrency suites, and the
real Auth/Edge/browser database suite passed. Synthetic database fixtures were
removed afterward. Migration `20261106133210_historical_vaccinations.sql` was
applied to Development (`yerrtkosxksacqxznrhk`); verified existing vaccinations
remain in queue mode, RLS remains enabled, and historical helpers are private.
Security advisors have no new findings relative to the existing baseline. Apply
this migration before releasing the frontend to any other environment.


### Unified New visit flow

`npm run test:new-visits` checks the patient header's single New visit action,
required service selection, the separate queue/record-only choice, changing a
service, and matching forms for Vaccination, Follow-up, Grooming, Wellness check,
Surgery and Sick visit in both modes. It covers keyboard selection, cancellation,
320/375px layouts, historical service save failures/retries/reloads/edits, custom
staff names and unknown performers. The patient opens the relevant history tab
after saving. Existing queue dialogs and record editors keep their direct entry.

`supabase/tests/unified_patient_visits.sql` verifies historical service writes,
idempotency, dates, clinic isolation, private helpers, rejected dispensing,
unchanged operational records and history exports. It also verifies the selected
clinical service survives independently of the checkup reason, and that grooming
cannot be submitted as a clinical checkup. This is the twentieth SQL suite in
`test:database`. The real database/browser suite now covers New visit -> live
grooming queue -> historical grooming, including lost acknowledgement recovery,
reload, editing and no historical changes to queue counters, appointments,
reminders or stock.

Validation on 6 November 2026: 217 unit tests, app lint, production build, New
visit, checkup completion, historical checkup/vaccination, queue, clinical history
and prescription browser checks passed. All twenty isolated SQL suites, four
concurrency suites and the real Auth/Edge/browser database suite passed; synthetic
fixtures were cleaned. Migration `20261106140152_unified_patient_visits.sql` was
applied to Development (`yerrtkosxksacqxznrhk`). Verified scoped reads, denied
anonymous reads/direct writes, private helpers, queue service retention and
historical services in history exports. Security advisors match the previous
baseline. Apply this migration before releasing the frontend elsewhere.


The New visit service picker uses native radio cards with service icons,
descriptions, a theme-colored selected state, and Continue disabled until selection.
`test:new-visits` covers Space/arrow-key selection, a single selected card,
selection retention when returning from the purpose chooser, and 320/375px
layouts. Desktop/mobile screenshots are saved in `test-artifacts.local` as
`new-visit-picker-desktop.png` and `new-visit-picker-mobile.png`. The reference
layout was reviewed against these captures. UI-only update: no database changes.


### Clinic color consistency

`npm run test:theme` checks every clinic workspace route with Coastal green and
Ocean blue, then checks shared controls under all six supported palettes. It
verifies buttons, icons, selected cards/radios, hover/active/focus/disabled states,
normal text contrast (including pixels sampled from the rendered hero metric
panels), hero gradients, patient chart strokes, and preserved
red/amber semantic colors. The suite also checks global Install controls and
installation dialogs, theme refresh without navigation, local onboarding
previews, sign-out cleanup, account changes, and navigation to public pages
without a document reload. Public/auth/account/subscription/platform pages use
the default primary when no clinic theme is loaded.

Desktop/mobile dashboard and patient screenshots and 320/375px picker captures
are stored as `theme-*.png` under ignored `test-artifacts.local`. APIs are
intercepted; this suite never writes real clinic data. Theme publication uses
the existing allowed palette and cleans document-level overrides when the clinic
provider unmounts. Error/warning/status colors, logos/photos, user-selected record
colors, categorical calendar colors and document snapshots remain separate.

Validation on 6 November 2026: 217 unit tests, lint and production build passed,
along with theme, Add Record, onboarding, clinical-history, checkup-completion,
appointment, inventory, public/auth frontend and production PWA browser checks.
No database migration or API change is required.
