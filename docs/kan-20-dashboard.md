# KAN-20: operational clinic dashboard

The dashboard now starts with clinic work rather than a large greeting banner.
It uses existing clinic records, role restrictions, editors and mutation methods.
There are no database migrations or new RPCs for this feature.

## The five zones

1. **Shift command bar:** saved clinic identity, a greeting and date in the
   clinic timezone, business-hours status, Quick Walk-In and appointment booking.
   Global search remains in the workspace header. The duplicate dashboard search
   and refresh controls were removed by request; automatic refresh remains.
   The desktop bar is 84px high.
2. **Live clinic floor:** overnight waiting arrivals, consultations with direct
   resume/start actions, and admissions explicitly ready for discharge. Each lane
   scrolls when busy. A quiet floor shows the existing pixel cat and a walk-in
   action instead of empty numeric counters.
3. **Action radar:** unfinished charts and active drafts, up to three due calls,
   and the two highest-priority stock alerts. Assigned care appears first, and a
   visit linked to a draft appears once. Inpatient charts remain in Admissions;
   finalized and cancelled charts are excluded. Expired products remain urgent;
   clinical stockouts and vaccines/medicines precede general supplies. Supplier
   links fall back to the item's inventory record when no active supplier exists.
4. **Appointment stream:** today's non-cancelled appointments, ordered by clinic
   time, with owner/service details and status derived from the linked arrival.
   Bookings open their existing calendar source. The stream scrolls horizontally.
5. **Recent patients:** the five most recently viewed patients, including charts
   opened from the dashboard, with direct links and a clear action.

The dashboard refreshes visible data every 30 seconds and on return to the tab.
It also retains the provider's existing window-focus refresh. This is polling,
not a new realtime subscription. Layouts below 1024px stack the zones vertically.

## Clinical and persistence boundaries

- There is no outpatient collection/pickup flag in the current data model. The
  third floor lane uses the actual admission `ready_for_discharge` state and is
  labelled **Ready for discharge**. A finalized outpatient chart is not evidence
  that its owner is awaiting collection.
- Quick Walk-In opens `QueueDialog` / `WalkInRegistration`. `NewVisitDialog`
  requires a selected patient, so it is not the intake entrypoint.
- The opening badge uses `business_hours` and the saved clinic timezone. Unset
  or invalid hours display **Hours not set**. The clock alone never declares a
  clinic open. This badge does not control authorization or booking permissions.
- Inline Done calls the existing `completeReminder(id, 'Completed')`. The check
  appears immediately and locks while pending. Failure unchecks it and exposes
  retry feedback; retries preserve the existing payload-bound mutation key.
  Acknowledged completion stays hidden if its follow-up refresh fails. The
  provider's Retry refresh recovers records without another completion request.
- Recent context is browser-local, scoped by both clinic and authenticated user:
  `vt_recent_patients:<clinicId>:<userId>`. Only IDs are stored; names, contacts,
  notes and clinical records are resolved from the currently authorized dataset.
  Unknown/deleted IDs are omitted. The default is empty, with five unique IDs in
  last-opened order. It persists across reloads until cleared or browser storage
  is removed. Older unscoped storage is not imported. Blocked storage falls back
  to memory for the current session; storage events synchronize other tabs.

## Verification

Run `npm run test:dashboard` for intercepted browser acceptance and `npm test`
for domain/storage tests. The browser suite covers 1440x900 and 1920x1080 viewport
fit; hour/status and arrival display; direct chart/draft/walk-in/search actions;
optimistic completion, error rollback, request-key retry and failed-refresh
recovery; appointment ordering; stock/supplier links; five-patient persistence,
scope changes and clearing; visible polling; and populated/quiet layouts at
320/375/768/1440px in light/dark mode. Screenshots are written to
`test-artifacts.local/dashboard-*.png`.

Existing UI refinement, theme, connected-workflow and Add Record suites cover
shared navigation, appearance and clinical regressions. The aggregate runner
includes the dashboard suite. Intercepted checks use synthetic fixtures and do
not prove hosted database permissions, provider availability or staff acceptance.
The isolated database runner's dashboard assertions now target the new zones.

Local verification on November 9, 2026:

- 274 unit tests across 35 files passed.
- Dashboard, theme, UI refinement, connected-workflow and Add Record browser
  suites passed, including read-failure recovery and sign-out isolation.
- Production build and lint passed; lint retains the existing unused `icons`
  warning in `scripts/create-clinic-infographic.mjs`.
- The isolated database suite was not run for this frontend change.

Manual acceptance remains an owner/staff walkthrough using representative clinic
workloads and real-device touch/screen-reader checks. No Jira completion or
hosted frontend rollout is implied by these local changes.
