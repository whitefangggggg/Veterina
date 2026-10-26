# Veterina Codes and clinic access

The public registration flow is for staff only. An administrator provisions each
vetshop's first owner. Existing accounts and records stay in the existing shop.
The two application roles remain Owner and Clinical staff.

## Registration and approval

- Each shop has a random, unique Veterina Code. Only its owners see, copy, rotate,
  or share the code and its registration QR in Settings.
- Staff enter a code or scan a QR containing the registration URL and code. The
  code is validated on the server and links a pending request to exactly one shop.
- A registration code never grants a role. Email confirmation and that shop's
  owner approval are required before transactions or patient data are available.
- Owners approve and reject pending Clinical staff registrations without an
  authenticator challenge. Only pending requests from the owner's shop appear.
  Role changes, suspension and rejection remain scoped to the owner's shop.
  Keep at least one active owner.
- Existing public signup cannot create owners. Provisioning another shop is an
  administrator-only operation, not a role supplied in signup metadata.

## Isolation and RBAC

- One account belongs to one shop in this release. Existing owners can remain
  co-owners of the original shop. Patients, owners, clinical records, appointments,
  queue, inventory, knowledge, exports and staff belong to a shop.
- Add clinic identifiers and indexes, scope RLS reads and writes, and reject
  cross-shop references. Changing an ID or calling an RPC directly must not allow
  another shop's data to be read or modified.
- Existing clinic RPCs execute through a restricted database role that obeys
  RLS, rather than bypassing it. Keep privileged onboarding, workers and photo
  administration private and validate their actor/resource shop explicitly.
- Clinical staff retain daily clinical and inventory workflows. Only owners
  manage settings/staff, export reports and permanently delete records.
- Scope service names, microchips, clinic settings and queue numbering per shop.
  Preserve stock, finalized-record, retry and audit protections.

## Checkup form

- Group Visit details, Vitals, SOAP notes, and Diagnosis & follow-up in clear
  sections, with consistent labels, spacing and mobile-friendly inputs.
- Present dates as words, such as May 9, 2026, while saving unambiguous clinic
  dates/times. Keep keyboard controls, draft resume and current validation.

## Validation and rollout

1. Implement and check the form independently of the access migration.
2. Test additive schema and registration/approval with two isolated shops.
3. Attempt cross-shop reads, referenced-ID writes, exports, photo reads, role
   escalation, unapproved/inactive access, and removing the last active owner.
4. Verify code validation/rotation, QR prefill/camera cleanup, email confirmation,
   owner approval without MFA, existing accounts, clinical/dispensing retries and finalization.
5. Run unit, browser, isolated Postgres, concurrency, lint, build and security
   checks. Apply compatible database/Edge changes before enabling the signup UI.

This is a migration of the current single-clinic model, not a frontend-only
permission check. Do not release shared-shop access until isolation tests pass.

## Implementation and validation

Implemented and applied to Development `yerrtkosxksacqxznrhk` on October 25, 2026:
`clinic_tenancy_rbac`, `veterina_staff_onboarding`, and
`clinic_rbac_policy_indexes`, plus `admin-staff` version 9. The frontend changes
are in the workspace and have a successful production build.

The subsequent `pending_staff_approval_without_mfa` migration and `admin-staff`
version 10 remove the approval authenticator step. The Settings list loads only
pending Clinical staff requests for the owner's shop, with approval/rejection and
email-confirmation status. Approved owners and staff are excluded. AAL1 owner
approval and cross-shop denial are covered by the SQL and real Auth/Edge tests.

Validation passed: 176 unit tests, ten isolated SQL suites, prescription stock
and follow-up arrival concurrency, real local Auth/Edge signup/owner approval and
suspension, browser code/QR/camera and checkup checks, lint, build and Edge type
checking. Both the original schema migration and a current schema export/restore
were tested in rolled-back local transactions. The populated migration test
includes a prescription missing historical Route and immutable dispensing/stock
rows; their contents stay unchanged when clinic IDs are added.

Hosted verification confirms the three original owners, four patients and two
prescriptions remain in one shop, with existing missing Routes preserved. All
tenant tables have RLS, the RPC role cannot log in or bypass RLS, and anonymous
clinical/provisioning access is denied. Owner read checks return the expected
clinic settings, code and accounts. Security advisors introduced no new warnings;
the existing project advisories remain for
[unrelated public definer routines](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Email delivery and physical-device camera
acceptance require a real user/device; automated camera tests use a video stream.
