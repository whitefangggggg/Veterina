# KAN-18: clinic workspace UI and UX

## Scope and source of truth

This pass follows `UI_UX_PATCH_SPEC.md` and the KAN-18 acceptance criteria.
Veterina is an existing React/Vite clinic application. Its shared controls,
clinic palette tokens, appearance settings and clinical workflows remain the
foundation for these changes.

The spec's custom selects/checkboxes, appointment task search, mascot error
views, notification agenda, route transitions, dashboard decluttering, report
spacing, patient skim/detail cards, contact actions and supplier cards were
already implemented. The initial unit suite (260 tests) and existing UI
refinement acceptance suite passed before this work.

## Audit findings and changes

| Finding | Evidence | Change |
| --- | --- | --- |
| Global search had no accessible input name, keyboard result selection, focus containment or focus restoration. | `src/components/AppShell.jsx`, `GlobalSearch` | Named combobox, live result feedback, arrow/Enter selection, shared dialog focus management and return to the previously focused control. |
| Modal implementations handled focus and scroll locking independently. Hidden native select elements could enter the manual focus list, and closing nested dialogs could release another dialog's scroll lock. | `src/components/ui.jsx`, `src/components/AppShell.jsx` | Shared `useDialogFocus` stack; ignore hidden, disabled and negative-tabindex controls; preserve scroll locking and parent focus for nested dialogs. |
| The body's modal scroll lock disabled touch gestures for the entire subtree. | `src/index.css`, `body.overlay-open` | Keep background overflow locked while allowing vertical gestures and contained scrolling in dialogs. |
| Repeated header controls had no skip link; the workspace menu did not identify the current destination. | `src/components/AppShell.jsx` | Keyboard-visible skip link and `aria-current` destination state. |
| Reports was listed for staff even though the route explicitly restricts exports to owners. Settings is shared because staff can change their display mode. | `src/components/AppShell.jsx`, `src/pages/Admin.jsx` | Hide owner-only Reports from staff navigation; retain Settings with a role-relevant description. Route/backend restrictions still apply. |
| The dashboard named Veterina instead of the active clinic, its metric tiles were passive and its next-patient area was blank on quiet days. | `src/pages/Dashboard.jsx` | Saved clinic name and role, links from metrics to their existing workspaces, queue shortcut and explicit empty feedback. |
| Patient, queue and inventory filters lacked a combined reset action. Patient species filters exposed selection only through color. | `src/pages/Patients.jsx`, `src/pages/Queue.jsx`, `src/pages/Stock.jsx` | Reset controls, live result counts and pressed state for species filters. Resets preserve unrelated URL parameters. |
| Shared asynchronous forms did not announce saving, and their immediate submission guard depended on a render. MutationForm did not expose busy state to Modal. | `src/components/RecordForm.jsx`, `src/components/MutationForm.jsx` | Synchronous in-flight guard, status announcement and consistent `aria-busy`; busy dialogs retain the existing dismissal protection. |

## Personalization and persistence

- Clinic names and owner-selected palettes come from existing clinic settings.
  All added styling uses the existing theme tokens and inherits light/dark mode.
- Existing Light/Dark/System selection remains browser-local and shared by
  accounts using that browser, as the Appearance settings screen explains.
  This is the current implementation, despite the issue's shorthand reference
  to per-user appearance. No new account preference storage is introduced.
- No new dashboard arrangement, pinned shortcut or other user preference is
  introduced. New navigation defaults are the same for every approved user,
  with the existing owner restriction on Reports.
- Search text and list filters remain transient. Queue and inventory filters
  already represented in URLs continue to use those URLs.
- Form retries continue to use the existing payload-bound mutation keys. A
  successful save followed by a failed refresh uses the existing Retry refresh
  recovery path and does not resubmit the operation.

## Verification

`npm run test:ui-refinements` covers the added search, focus, reset, submission,
input retention and saved-but-refresh-failed recovery scenarios with intercepted
APIs and synthetic records. It also covers all core workspaces at 320px, 375px
and desktop widths in light/dark mode with reduced motion. Search screenshots
are generated as `test-artifacts.local/kan18-search-<mode>-<width>.png`.

The existing registration, Add Record, queue, appointment, inventory, checkup
completion and clinic theme browser suites provide workflow regression coverage.
These browser checks do not validate hosted database permissions or third-party
photo/AI providers. The theme suite also checks contrast using rendered colors.

Verification on 9 November 2026:

| Check | Result |
| --- | --- |
| Unit tests | 260 passed across 33 files |
| Production build | Passed |
| Lint | Passed; existing unused `icons` warning in `scripts/create-clinic-infographic.mjs` remains |
| Expanded UI refinement suite | Passed, including all six width/appearance combinations |
| Theme suite | Passed: all six clinic palettes, contrast, persistence, staff appearance, public/clinic routes, mobile and print |
| Workflow browser suites | Registration, Add Record, queue, appointments, inventory and checkup completion passed |

Representative owner/staff walkthroughs and physical-device screen-reader/touch
checks remain acceptance work. No Jira completion, staff review or hosted
frontend rollout is implied by the automated checks.
