# KAN-22 — public admission tracking

## Approved policy

Approved clinical staff and clinic owners may configure sharing, generate or
replace codes, revoke access, and publish/unpublish the latest owner-facing update.
Every action uses the existing authenticated `portal_mutation` authorization,
payload-bound retry receipt and audit trail. Sharing starts disabled. Staff must
save the approved fields and explicitly acknowledge bearer-secret access before
generating a code. Publication has its own explicit approval.

The default public view contains approved clinic name/contact, public pet display
name, admission workflow status, latest published update and timezone-aware update
timestamps. Species and admission reference/date require separate opt-ins. A
public reason must be written explicitly. Clinical details remain private by
default, including for previously issued tracking codes.

Staff may explicitly enable **Live clinical sharing** for an individual admission.
This exposes existing and future Admission activity, Monitoring & notes, and Care
board entries without individual publication. It includes clinical condition,
intake/vital/progress notes as recorded, measurements, staff names, care tasks,
medication instructions/doses/routes/frequency/duration and administration history.
Corrections and superseded entries are labeled; trends include only current loaded
measurements. Admission activity excludes sharing-management events and raw event
payloads. Structured owner contact information, inventory quantities/movements,
internal IDs, accommodation history and discharge-summary documents are excluded.
Clinical free text is shared as written and may itself contain personal information.

The audited approval requires explicit acknowledgment of existing and future
clinical content, doses and staff attribution. It preserves the existing code;
disabling clinical sharing preserves the limited status/update view. This approval
is separate from enabling the tracking code itself. The user confirmed this
expanded policy and per-admission approval requirement on 9 November 2026.

The user approved this policy on 9 November 2026. The implementation additionally
sets a 90-day maximum credential lifetime. Access ends at the earlier of that
deadline or 7 days after discharge. Staff can generate a replacement within the
discharge window. Cancellation and historical stays are unavailable. Inactive
clinics or expired subscriptions make all their public tracking unavailable;
reactivation restores access only to still-enabled, unexpired codes. Status
changes appear when the public page refreshes. It automatically refreshes every
30 seconds while visible, pausing when additional history is loaded. Manual
refresh returns to the latest entries. Failed refreshes or page loads clear all
clinical content; there is no offline record cache or browser persistence.

## Credentials and privacy

The server uses cryptographic bytes and rejection sampling over `A–Z a–z 0–9`.
Codes are exactly 13 case-sensitive characters (approximately 77 bits of entropy).
The SHA-256 verifier is indexed uniquely. A private hash ledger prevents reuse of
all prior codes, including after rotation. A collision retries with a new sample
up to ten times. Admission locks plus sharing versions serialize publication,
rotation and revocation without overwriting concurrent edits. Existing payload-bound
receipts replay a lost generation response instead of creating another code.

The sharing and audit records contain hashes, never plaintext codes. The existing
protected idempotency receipt necessarily retains the original generation response
for safe retries; apply the application's receipt retention policy to it. The UI
holds the returned code only in memory and asks staff to save/print it immediately.
Reopening the controls requires replacing the code. Replaying an older receipt
can return its original code, but cannot reactivate a revoked or rotated credential.

QR images are generated locally using the existing `qrcode` package. URLs use
`/track-admission#CODE`, so the capability is omitted from normal HTTP access logs
and referrers. Manual lookup submits the code in a POST body. The public function
does not log request bodies, credentials or database error detail. Avoid enabling
body capture or URL-fragment analytics on this route. Anybody holding a code can
view its approved record; possession never verifies owner identity.

The public function is the only anonymous read surface. Browser roles have no
anonymous sharing/admission table reads, no direct sharing writes, and no execute
permission on the service-only lookup RPCs. The RPC rechecks clinic, subscription,
admission and credential visibility and constructs a strict allowlisted JSON DTO.
Staff sharing reads remain tenant-scoped by RLS. Publication contents and changes
are retained in the existing protected audit log; admission events record actions
and sharing versions without capabilities.

## Lookup and expiry responses

Missing, unknown, disabled, replaced, expired and otherwise unavailable records all
return the same generic 404. The UI explains that the owner should check the code
or contact the clinic, without confirming record existence. Malformed manual input
gets friendly local validation. Service failures return 503 and a retry action;
throttling returns 429 with `Retry-After: 60`.

Shared database buckets limit all public lookups, successful or failed, to 30 per
caller per minute and 300 per project per minute. Buckets are pruned after two
minutes and contain HMAC address digests, not raw IPs or capabilities. Forwarding
headers are only a rate-limit hint, never an authorization signal: proxy behavior
and caller-spoofed headers can weaken per-caller isolation. The project-wide cap
still applies and bounds requests across Edge workers. Configure trusted ingress
rate controls for stronger source-IP enforcement before high-traffic deployment.
These limits intentionally favor clinic privacy over availability under scraping.

Public responses set `no-store`, `noindex, nofollow, noarchive`, `no-referrer` and
`nosniff`. The page adds corresponding meta tags; Netlify headers cover initial
page loads. The PWA caches public build assets only, never POST lookup results.
The install prompt is hidden on the public tracking page to keep updates readable.

## Deployment and verification

1. Ensure all KAN-19 migrations and current tenant/subscription helpers exist.
2. Apply `supabase/migrations/20261109083959_admission_public_tracking.sql`.
   Then apply `20261109103355_admission_tracking_clinical_sections.sql`.
3. Deploy `supabase/functions/admission-tracking/index.ts` with shared helpers.
   Its configuration deliberately uses `verify_jwt = false`; owners need no
   account. It uses the provisioned service-role key server-side, never in the
   browser. `APP_ORIGIN` follows existing function CORS configuration.
4. Run the frontend locally, or deploy it with SPA rewrites and privacy/cache
   headers matching `netlify.toml` (also required for future Vercel hosting).
   Verify the final HTTPS origin in a
   newly generated QR card. Existing QR cards continue using their printed origin.
5. Have the clinic approve the display fields and publish intended updates. Enable
   clinical sharing separately only for admissions intended to expose full live care.

Local verification: 289 unit tests, lint and production build; the KAN-22 SQL,
concurrency and real browser/Edge suites, plus KAN-19 SQL and browser regressions.
Local Supabase database advisors report no issues. Browser
screenshots cover public light/dark layouts at four widths and staff mobile
controls. Live browser checks decode the generated QR, verify print contents,
retry a deliberately lost generation response and exercise real lookup throttling.
The collision test injects a zero-row credential reservation to exercise retry
without weakening or replacing production cryptographic functions. It is a
collision-path test, not a statistical proof of randomness.

These local verification results are separate from the hosted backend rollout
below. Physical phone-camera scanning, delivery through clinic
channels, hosted ingress behavior, load testing and clinical content acceptance
remain release checks. Do not run the isolated database suites concurrently: they
own and clean up their exclusively synthetic fixtures.

## Hosted missing-table fix — 9 November 2026

The configured frontend targets `Veterina_Demo` (`xuyvlfsoovptklldqydt`). Its
KAN-22 backend was missing, producing `PGRST205` for
`public.admission_public_sharing`. Applied `admission_public_tracking` as hosted
migration `20261109100736` and deployed `admission-tracking` version 1. The schema
reload is included in the migration. No frontend deployment was needed for this
backend fix.

This restored project retains `postgres` as its private mutation dispatcher owner;
the isolated local stack uses `veterina_rpc`. The migration now resolves that
existing owner for its narrowly scoped grants and policies. Tracking mutations
also explicitly match the admission's clinic to `private.current_clinic_id()`
before locking or writing, including when the dispatcher owner bypasses RLS.
`node scripts/check-admission-tracking-migration.mjs` rehearses the fresh migration
and full SQL suite under both ownership layouts in isolated rollback transactions.
Both passed before the hosted rollout.

Hosted checks confirmed the REST schema resolves the table, anonymous reads are
denied (`42501`), authenticated staff can read under clinic RLS, direct browser
writes and lookup-RPC execution are denied, and service-role lookup is allowed.
An anonymous malformed-code POST to the deployed Edge Function returned the
expected generic 404 with `no-store` and `noindex` headers. Both existing admission
rows retained the same aggregate fingerprint; no sharing rows or public codes
were created. Health advisories remain clear and security warning counts are
unchanged. The private service-only throttle table has the expected informational
RLS-without-policy notice; service-role access uses its existing RLS bypass.

## Live clinical extension — 9 November 2026

Applied hosted migration `20261109104506` (`admission_tracking_clinical_sections`)
and deployed `admission-tracking` version 2 to the same Demo project. The frontend
remains local at the user's request; Vercel deployment is a future step. All
existing admissions and prior sharing fields retained their aggregate fingerprints.
The existing sharing row defaults to clinical sharing off. No real admission was
opted in and no hosted clinical fixtures or tracking codes were generated.

The existing two-argument `lookup_public_admission` RPC remains compatible. The
Edge Function uses the new service-only `lookup_public_admission_content` RPC.
Initial responses add `clinicalEnabled` and, only after approval, `condition` and
six bounded collections: `activity`, `monitoring`, `tasks`, `resolvedTasks`,
`orders`, and `administrations`. Each has `items` and an encrypted continuation
`cursor`. `POST {token, section, cursor?}` returns `{section, page}`. There are
20 entries per collection, sorted by timestamp and UUID with keyset continuation;
open tasks are earliest-due first, other collections newest first. Row keys are
SHA-256 fingerprints instead of raw IDs. The service-only RPC's internal cursor
is never returned directly to a browser.

Continuation points use AES-GCM with random nonces, a domain-separated HKDF key
derived from the provisioned service-role secret, credential/section binding, and
15-minute expiry. Forged, expired or cross-code/section cursors consume the usual
lookup allowance and return the generic 404. Each initial/page request rechecks
credential, clinic, subscription, expiry and clinical approval; successful and
failed pages share existing rate limits. Key rotation invalidates old cursors;
refreshing the page obtains fresh ones. Clinical data is never persisted locally.

Verification: 302 unit tests; both dispatcher-ownership migration rehearsals;
original and clinical SQL suites; concurrency including clinical-setting conflicts
and retry replay; real local Auth/PostgREST/Edge/Chrome checks for opt-in, medication
details, encrypted pagination, automatic refresh/history pause, failed-page clearing,
same-code disable, mobile/desktop light/dark layouts, QR/retry, rotation/revocation,
discharge and throttling; production build. Lint has one pre-existing unused-variable
warning in the infographic script. Hosted malformed/pagination requests return
generic no-store/noindex 404s, browser RPC/direct-write access remains denied,
security-advisor warning counts are unchanged and health advisories remain clear.
