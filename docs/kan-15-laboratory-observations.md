# KAN-15: laboratory observations

Laboratory Requests records requested tests; Laboratory Results records available
findings. Both are optional plain-text notes, without past/future labels, statuses,
attachments or a separate lab-order workflow.

## Entry and display

Both fields follow Treatment Plan and precede Clinical notes in the shared checkup
form. They use full-width multiline inputs with a 10,000-character limit each.
They follow existing Clinical Observations visibility: historical checkups expose
observations during entry; live care exposes them after care starts. No intake or
queue transition rules change.

Wizard navigation/review and errors preserve entered values. Saved drafts restore
both notes. Patient history, Quick Skim details, calendar records and saved-draft
previews show populated notes. History search includes both. Printed history reads
raw database fields, escapes HTML and preserves newlines. Empty laboratory fields
are omitted from read-only views, leaving old records uncluttered.

## Persistence and compatibility

Migration `20261109051710_laboratory_observations.sql` adds `laboratory_requests`
and `laboratory_results` to visits as non-null text, defaulting to empty strings.
Application records and mutation payloads use `laboratoryRequests` and
`laboratoryResults`. Supplied values must be strings of at most 10,000 characters;
JSON null, numbers, objects and arrays are rejected on clinical saves and drafts.

The existing encounter insert/update and checkup draft allowlist are extended.
Queued completion, direct historical creation and prescription-assisted completion
retain the same shared persistence paths. Omitted laboratory fields preserve saved
values when an old client updates a visit or replaces a draft. Omitted fields also
carry from a draft into completion or prescription progress; explicit empty strings
clear the corresponding notes. All other draft fields retain their existing
replacement behavior.

Writes still pass the existing authenticated, clinic-scoped RPC. No public API,
privilege or policy is added. Draft conflict checks and payload-bound retry receipts
remain intact. Finalized visit fields remain immutable; owners can append the
existing free-text correction with a reason. Audit and correction snapshots include
the original laboratory fields. This does not add a post-finalization lab-result
editing workflow.

## Verification and rollout

- Unit tests cover normalized/raw field mapping, empty legacy records, history
  search and escaped multiline exports.
- `test:new-visits`, `test:historical-checkups` and `test:checkup-completion` cover
  wizard review/navigation, input limits, save errors/retry keys, draft reload,
  editing, completion, history and Quick Skim display.
- `supabase/tests/laboratory_observations.sql` runs in the isolated database runner
  and rolls back all fixtures. It covers persistence, validation, compatibility,
  clearing, stale drafts, retries, prescription completion, approved staff access,
  cross-clinic/inactive-staff denial, finalization, corrections and audit evidence.
- Apply the additive database migration before releasing the frontend. Older
  frontends can continue omitting laboratory fields without erasing them.

The migration was validated on the isolated local database and applied to
Veterina_Demo (`xuyvlfsoovptklldqydt`) on November 9, 2026. Its filename matches
the hosted migration receipt. Both columns, updated save functions and retained
function privileges were inspected after deployment. Hosted security advisor
finding counts were unchanged; existing unrelated warnings remain outside KAN-15.

Hosted clinical test data is not created during deployment verification. Local SQL
and browser tests use synthetic fixtures; staff acceptance remains a clinic walkthrough.

Local verification on November 9, 2026:

- All 278 unit tests across 35 files passed.
- Add Record, historical checkup, checkup completion and clinical history browser
  suites passed. Laboratory inputs were checked at 320/375/1440px; screenshots
  use `test-artifacts.local/laboratory-observations-*.png`.
- Production build and lint passed; lint retains the pre-existing unused `icons`
  warning in `scripts/create-clinic-infographic.mjs`.
- The isolated SQL suites, including laboratory observations, passed. Local
  security advisors reported no warning/error findings.
- The complete isolated database acceptance suite passed, including 27 SQL
  suites, concurrency checks, real Auth/Edge/browser workflows and fixture cleanup.
  The real browser check saved/reloaded laboratory drafts, edited results and
  verified persisted visit text after a lost completion response and retry.
