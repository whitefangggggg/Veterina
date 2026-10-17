# Veterina — Product Requirements Document

| Document field | Value |
| --- | --- |
| Version | 1.0 |
| Prepared | 8 October 2026 |
| Product | Veterina clinic care system |
| Status | Source-derived draft for stakeholder review |
| Primary evidence | React application in `src/` |
| Supporting evidence | `README.md`, `package.json`, and existing Supabase migration files |
| Initial market | Small veterinary clinic in the Philippines |
| Initial deployment scope | One clinic with internal staff users |

## Contents

1. [Purpose and product summary](#1-purpose-and-product-summary)
2. [Evidence and implementation status](#2-evidence-and-implementation-status)
3. [Problem, goals, and success measures](#3-problem-goals-and-success-measures)
4. [Users and access model](#4-users-and-access-model)
5. [Scope and priorities](#5-scope-and-priorities)
6. [Information architecture](#6-information-architecture)
7. [Core user journeys](#7-core-user-journeys)
8. [Functional requirements](#8-functional-requirements)
9. [Data dictionary and relationships](#9-data-dictionary-and-relationships)
10. [Business rules and state transitions](#10-business-rules-and-state-transitions)
11. [Experience and accessibility requirements](#11-experience-and-accessibility-requirements)
12. [Nonfunctional requirements](#12-nonfunctional-requirements)
13. [Integration and architecture requirements](#13-integration-and-architecture-requirements)
14. [Implementation gaps and risks](#14-implementation-gaps-and-risks)
15. [Acceptance and validation plan](#15-acceptance-and-validation-plan)
16. [Delivery phases and release gates](#16-delivery-phases-and-release-gates)
17. [Assumptions and open decisions](#17-assumptions-and-open-decisions)
18. [Source traceability](#18-source-traceability)

## 1. Purpose and product summary

Veterina is a browser-based clinic management system that keeps pet owners, patients, clinical encounters, vaccinations, appointments, reminders, inventory, and supplier contacts in a connected workspace. Its interface emphasizes fast record retrieval and clear daily worklists on desktops, tablets, and phones.

The product serves clinic staff. Pet owners are contact records and recipients of staff outreach; the source does not provide an owner portal or self-service booking. A public landing page introduces the product and links to a fictional demo.

The current application is an interactive frontend prototype. It uses React context and in-memory demonstration data. It includes a Supabase client factory and separate database migrations, but the displayed clinic workflows do not read or write through that client. Adding environment variables alone does not make the application persistent or authenticated.

This PRD documents the visible product, defines requirements for an initial production release, and identifies work that remains. It is intended for product planning, design, engineering, and clinic acceptance review.

### 1.1 Interpretation rules

- **Observed:** Behavior established by reading the source. This does not imply deployed or runtime-verified behavior.
- **UI placeholder:** A visible control or screen without the corresponding workflow or persistence.
- **Backend scaffold:** A schema, function, or policy exists in the migration files; deployment and correctness have not been verified.
- **Required:** Proposed behavior for the release scope described here, including production hardening of existing demo workflows.
- **Proposed / decision needed:** A recommendation or unresolved product choice, not an approved commitment.

All performance targets, delivery priorities, and new workflows below are proposed unless explicitly described as observed. No stakeholder interviews, production usage measurements, or database execution were available for this document.

## 2. Evidence and implementation status

| Area | Observed implementation | Remaining production work |
| --- | --- | --- |
| Landing page | Feature overview, benefits, mock previews, demo links, contact links | Confirm marketing copy, contact ownership, and separation from real clinic data |
| Navigation | Workspace chooser, dashboard links, global search, reminder badge | Authenticated identity, authorization, complete keyboard behavior |
| Dashboard | Appointment, reminder, and low-stock summaries | Live clinic date, live data, meaningful next-patient selection |
| Owners and pets | Search, species filters, add-owner and register-pet forms | Persistence, duplicate handling, edit/archive workflows, consistent identifiers |
| Clinical records | Checkup form, SOAP timeline, vitals, latest weight, weight chart | Atomic persistence, finalization and correction flow, staff identity linkage |
| Vaccinations | Entry form, history, automatic demo reminder creation | Persistent linkage, retry protection, date rules, backend integration |
| Appointments | Monthly calendar, daily agenda, creation | Duration, conflict enforcement, editing, lifecycle status changes |
| Reminders | Open/type/completed filters, call links, completion outcomes | Live classification, assignment, custom reminders, contact activity history |
| Inventory | Search, category filters, low-stock flags, stock-in/out form | Immutable ledger, batch stock, transactional validation, item creation |
| Suppliers | Search, contacts, linked-item count | Add/edit/archive supplier workflows |
| Reports | Five report cards | Report preparation, filters, exports, permission checks, export audit |
| Settings | Clinic and veterinarian fields; temporary “Saved” indicator | Saved configuration, staff administration, role management, retention controls |
| Security | Privacy messaging and backend policy scaffolding | Login/logout, route protection, runtime authorization tests, audit coverage |

The application seeds three owners, four pets, three visits, two vaccinations, four appointments, four reminders, five inventory items, and three suppliers. These are demonstration fixtures, not real clinic volume estimates.

## 3. Problem, goals, and success measures

### 3.1 Problem statement

The product addresses an inferred workflow problem: small veterinary teams need to retrieve patient information quickly, preserve clinical continuity, coordinate visits and follow-up calls, and know when supplies require replenishment. Separate paper records or disconnected lists make these activities harder to coordinate. This problem framing follows the source and README; it still requires clinic validation.

### 3.2 Product goals

| ID | Goal | Intended outcome |
| --- | --- | --- |
| G-01 | Make patient and owner records easy to find | Staff locate the correct pet using a name, phone, microchip, or record number |
| G-02 | Preserve longitudinal clinical records | Each encounter retains its notes, measurements, author, and date |
| G-03 | Connect care with follow-up work | Vaccination and encounter dates produce traceable reminders |
| G-04 | Coordinate the clinic schedule | Staff see the month and daily agenda and avoid conflicting reservations |
| G-05 | Make stock changes explainable | Quantities derive from recorded movements with reasons and responsible staff |
| G-06 | Protect access and accountability | Clinic records require authenticated staff access; administrative actions are restricted |
| G-07 | Support operational oversight | The owner/head doctor can review settings and prepare accurate exports |

### 3.3 Proposed success measures

These targets require stakeholder approval and a baseline pilot. They are not results demonstrated by the code.

| Measure | Proposed target | Measurement approach |
| --- | --- | --- |
| Patient retrieval | At least 90% of staff find the correct seeded patient within 30 seconds | Timed clinic acceptance tasks across supported devices |
| Registration | At least 90% complete owner plus pet registration within 3 minutes | Pilot task observation; exclude interruptions and clinical discussion |
| Record durability | Every successful save survives reload and a new authenticated session | Persistence acceptance scenarios |
| Reminder reliability | Each qualifying saved vaccination or encounter creates exactly one linked reminder | Compare source records with linked reminders, including retry cases |
| Stock integrity | Zero accepted movements that produce negative stock; all changes have ledger entries | Concurrent adjustment tests and reconciliation |
| Permission correctness | All defined prohibited actions fail at the backend | Role-based integration tests |
| Staff adoption | At least 80% of pilot clinical encounters recorded by the end of the clinic day | Reconcile a clinic-approved pilot encounter count |
| Reminder follow-through | Track same-day outcome rate for due reminders | Completed due reminders divided by reminders due at the start of the clinic day; set target after baseline |

## 4. Users and access model

### 4.1 Personas

| Persona | Main tasks | Needs |
| --- | --- | --- |
| Owner / head doctor | Review operations, manage staff/configuration, correct finalized records, authorize exports | Reliable oversight, professional document details, restricted administrative tools |
| Veterinarian | Review alerts and history, document examinations, record vaccines and care plans | Complete patient context, clear encounter forms, preserved measurements |
| Clinical / front-desk staff | Register owners and pets, arrange appointments, conduct reminder calls, record stock movements | Fast search, clear worklists, simple forms, visible save outcomes |
| Public visitor | Learn about the product and explore fictional demo records | Clear product information and an explicitly labeled demo |
| Pet owner | Supply contact and patient details; receive clinic calls | Accurate contact records; no application account in the initial scope |

The database scaffold defines only `owner` and `clinical_staff`. Veterinarian and front-desk responsibilities are workflow personas, not additional implemented permission roles. Whether these responsibilities need separate roles is an open decision.

### 4.2 Proposed permission matrix

This matrix expresses release requirements; the current frontend does not enforce them.

| Capability | Public visitor | Clinical staff | Owner / head doctor |
| --- | --- | --- | --- |
| View landing page / fictional demo | Yes | Yes | Yes |
| Read real patient and owner records | No | Yes | Yes |
| Register or update owners and pets | No | Yes | Yes |
| Record encounters and vaccinations | No | Yes, within approved clinical responsibility | Yes |
| Manage appointments and reminder outcomes | No | Yes | Yes |
| Record inventory movements and maintain supplier contacts | No | Yes | Yes |
| Finalize clinical entries | No | Decision needed for staff job responsibilities | Yes |
| Correct finalized entries | No | No | Yes, with correction reason and retained history |
| Produce complete data exports | No | No | Yes |
| Print an individual clinical history | No | Decision needed; current demo exposes this to everyone | Yes |
| Manage clinic settings, staff, and access | No | No | Yes |
| Read administrative audit history | No | No | Yes |
| Permanently delete records | No | No | Controlled exception subject to approved retention policy |

“Owner” in access rules means the clinic account role. “Pet owner” means the customer contact entity. These must remain distinct in naming and help text.

## 5. Scope and priorities

### 5.1 Priority definitions

- **P0:** Required before entering real clinic data or beginning the production pilot.
- **P1:** Required for the complete initial operational release; may follow a limited pilot if the clinic approves temporary procedures.
- **P2:** Follow-on capability requiring separate planning.

### 5.2 Included scope

**P0:** Authentication and access enforcement; persistent owner/pet registration and search; clinical encounter/vitals capture; vaccination records; linked reminders and outcomes; appointment creation and conflict prevention; durable stock movements; live date handling; validation, errors, audit foundations, and recoverability.

**P1:** Owner/pet editing and archive states; custom reminders and activity history; full appointment lifecycle; inventory item and supplier maintenance; batch and expiry workflows; functional reports and complete patient printing; persisted settings and staff administration UI; clinical finalization and correction UX.

**P2:** Structured prescriptions, clinical attachments, pet photo uploads, expanded vitals visualizations, and any approved communication automation. Prescriptions and attachments have schema support, but their frontend workflows are absent.

Where a P1 administration screen is not yet available during a pilot, account provisioning and clinic setup must have a documented restricted operator procedure. P0 audit and clinical integrity controls remain required even if their advanced management UI follows later.

### 5.3 Outside the initial scope

- Billing, point of sale, invoicing, payment collection, accounting, and revenue reports.
- Pet-owner accounts, public appointment booking, and owner-facing medical record access.
- Multi-clinic tenancy, branch transfers, subscription management, and SaaS billing.
- Automated SMS/email/WhatsApp campaigns or delivery tracking.
- Laboratory integrations, insurance claims, and external electronic prescribing.
- Automated clinical recommendations or vaccine schedules determined by the application.
- Offline record editing and background synchronization.
- Purchase orders, supplier invoice reconciliation, and full purchasing automation.

Future clinic-slug routes appear in comments only. The current schema has no clinic tenancy key, so multi-clinic capability must not be inferred from those comments.

## 6. Information architecture

| Route | Screen | Primary purpose |
| --- | --- | --- |
| `/` | Public landing page | Features, benefits, product previews, demo entry, contact links |
| `/dashboard` | Clinic home | Daily summary and workspace entry points |
| `/patients` | Patients & owners | Search and registration |
| `/patients/:petId` | Patient detail | Identity, alerts, owner contact, history, vaccines, weight trend |
| `/appointments` | Appointments | Monthly calendar and selected-day agenda |
| `/reminders` | Reminder center | Calls, due tasks, contact outcomes |
| `/inventory` | Stock control | Item availability, minimum stock, expiry, movements |
| `/suppliers` | Purchasing contacts | Supplier details and linked items |
| `/reports` | Clinic exports | Operational reports and complete histories |
| `/settings` | Clinic settings | Clinic identity, professional details, staff and access administration |

The shell provides a brand link to the dashboard, a seven-workspace chooser, global search, a due-reminder badge, and a profile chip. Global search opens with Ctrl+K or Command+K. The current catch-all route redirects to `/dashboard`; production redirects must also respect authentication.

## 7. Core user journeys

### 7.1 Register an owner and pet

1. Staff search for an existing owner or pet to reduce duplicate entry.
2. If necessary, staff save an owner with name, mobile number, and address.
3. Staff register a pet against the saved owner and enter identity, reproductive status, identifiers, and baseline health information.
4. The system assigns a unique permanent record number and confirms the save.
5. The pet appears in search and can be opened for subsequent care.

**Exceptions:** No owners available, suspected duplicate contact/patient, invalid email, invalid measurement, failed write, or conflicting microchip. Preserve the form and explain the corrective action.

### 7.2 Document a clinical encounter

1. Staff retrieve the correct patient and review allergy and care alerts.
2. The veterinarian opens Record checkup and enters encounter details, vitals, and SOAP notes.
3. The system saves the encounter and measurements together, with the responsible user and encounter timestamp.
4. The encounter appears in the descending clinical timeline and its weight appears in the chronological chart.
5. If a follow-up date exists, the system creates a linked reminder exactly once.

**Exceptions:** Unknown patient, missing required fields, invalid vitals, expired session, partial-write failure, or repeat submission. Finalization/correction rules must preserve clinical history.

### 7.3 Record a vaccination and follow up

1. Staff open the patient's vaccination tab or quick action.
2. Staff enter vaccine name, administration date, lot, dose, veterinarian, and next due date.
3. The system saves the administered dose and creates its linked next-due reminder.
4. The reminder appears in the appropriate worklist for the clinic date.
5. Staff call the owner and record the outcome to complete the reminder.

The application records clinician-entered dates. It does not independently determine vaccine eligibility or the appropriate interval.

### 7.4 Schedule a clinic visit

1. Staff choose a date in the monthly calendar.
2. The agenda displays that day's appointments in time order.
3. Staff select a patient, service, veterinarian, start time, duration, and optional notes.
4. The system checks availability and saves a nonconflicting reservation.
5. The calendar indicators and daily/monthly counts update.

The current form has no duration and does not check conflicts. Booking from a patient detail page currently opens the general calendar without preselecting the patient.

### 7.5 Reconcile or replenish stock

1. Staff locate an item by name/SKU or category and review quantity, minimum level, expiry, and supplier.
2. Staff choose stock in or stock out and enter quantity, reason, and relevant batch/reference.
3. The system validates available stock and records a durable movement transaction.
4. On-hand stock and low-stock indicators update from the ledger.
5. Staff use the linked supplier contact when replenishment is needed.

**Exceptions:** Insufficient stock, wrong batch, invalid quantity, concurrent movement, expired batch, or failed save. No silent quantity correction is allowed.

### 7.6 Produce an operational report

1. The owner/head doctor opens Reports and chooses a report.
2. They select applicable date range, patient, status, or category filters.
3. The system shows the scope before generating an export or printable view.
4. The generated output matches saved records and includes clinic identity and generation time.
5. The system records who generated it and what scope was exported.

## 8. Functional requirements

### 8.1 Access, demo boundaries, and navigation

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-01 | P0 | Authenticate active clinic users and provide logout | Anonymous users cannot retrieve real clinic data through direct URLs or backend requests; logout ends access |
| FR-02 | P0 | Enforce owner and staff permissions at the backend | Hidden UI controls are supplemented by denied unauthorized requests; inactive accounts lose access |
| FR-03 | P0 | Keep public demo records isolated from production | Demo entry uses fictional data; public visitors cannot reach real records through demo navigation |
| FR-04 | P0 | Provide workspace navigation and protected deep links | Authorized users can open each permitted route directly; unknown or unauthorized routes resolve predictably |
| FR-05 | P0 | Provide global patient search | Case-insensitive search covers pet name, record number, microchip, owner name, and phone; selecting a result opens the correct record |
| FR-06 | P0 | Display actual staff identity and reminder count | Profile reflects the authenticated account; badge equals due plus overdue open reminders for the clinic date |

**Observed detail:** Global demo search returns at most six results. Preserve a useful compact result list, but provide a route to the full result set when matches exceed that limit.

### 8.2 Dashboard

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-07 | P0 | Calculate the dashboard using the live clinic date | Appointment count uses the configured local date; reminder and low-stock totals match their workspaces |
| FR-08 | P0 | Show a useful daily appointment preview | Preview is in time order and clearly distinguishes upcoming visits from earlier or completed visits |
| FR-09 | P1 | Make shortcuts lead into the intended action | New appointment opens booking; patient search opens search/list; all workspace cards use valid routes |

**Observed detail:** The current preview shows the first three appointments of a fixed day, not necessarily the next three relative to the current time. The New appointment dashboard link navigates to the calendar without opening the creation modal.

### 8.3 Owners, pets, and patient search

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-10 | P0 | Register owners with required contact information | Name, mobile, and address are validated; optional email is validated when supplied; save persists |
| FR-11 | P0 | Register a pet against an existing owner | Required pet name, owner, species, and breed are saved; invalid or missing owner references are rejected |
| FR-12 | P0 | Assign permanent unique patient identifiers | Record numbers remain unchanged and collision-free under concurrent creation; supplied microchips are checked for uniqueness |
| FR-13 | P0 | Search and filter patient records | Search also supports breed on the patient list; filters work with search; result count and empty state are accurate |
| FR-14 | P0 | Display identity, owner contact, alerts, and clinical summary | Correct owner is linked; allergies/care alerts are conspicuous; unrecorded weight or visit dates have clear fallback text |
| FR-15 | P1 | Edit and archive owner/patient records safely | Authorized edits persist and are audited; inactive/deceased state preserves historical encounters and does not orphan records |
| FR-16 | P1 | Manage structured allergies and care alerts | Staff can add and resolve alerts; category, severity, actor, and dates are preserved |

Species registration currently offers Dog, Cat, Bird, Rabbit, and Other. Patient filter pills offer All, Dog, Cat, and Other; the implementation matches `Other` literally, so it does not include Bird or Rabbit. Required behavior is to offer all supported species filters or explicitly label an “Other species” group that includes them.

### 8.4 Clinical encounters and vitals

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-17 | P0 | Save an encounter with type, complaint, veterinarian, and weight | Required values are validated and the encounter is linked to the correct patient and recording account |
| FR-18 | P0 | Capture SOAP notes and optional diagnosis | Subjective, objective, assessment, and plan remain separate; saved text appears accurately in the timeline |
| FR-19 | P0 | Save encounter measurements atomically | Encounter and vitals are committed together or fail together; historical measurements retain their encounter link |
| FR-20 | P0 | Show history newest first and weight oldest first | Sorting uses full timestamps; chart points do not lose their original visit identity; latest recorded weight is consistent |
| FR-21 | P0 | Create a follow-up reminder when a date is supplied | One linked reminder exists after a successful save, including retries; no reminder is created without a date |
| FR-22 | P1 | Support finalization and controlled corrections | Finalized entries cannot be silently overwritten; corrections retain actor, reason, timestamp, and prior content |
| FR-23 | P1 | Produce a complete printable patient history | Output includes patient/owner identity, alerts, all encounters, vitals, vaccinations, and clinic details regardless of active screen tab |
| FR-24 | P2 | Add structured prescriptions and clinical attachments | Once scoped, prescriptions link to visits and authorized files link to patients/visits without becoming public |

Encounter types currently offered: Wellness check, Sick visit, Follow-up, Emergency, and Procedure. Hydration choices: Normal, Mild dehydration, Moderate dehydration, and Severe dehydration.

**Observed limitation:** The Weight & vitals tab charts weight only. Other recorded vitals appear on encounter cards. Hydration is saved in the demo record but is not displayed on those cards. Separate temperature, heart-rate, respiratory-rate, or BCS charts are additional scope.

### 8.5 Vaccinations

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-25 | P0 | Record vaccine administration | Vaccine name, administration date, lot, and veterinarian are required; dose is retained when supplied |
| FR-26 | P0 | Record next-due information and create a linked reminder | A supplied due date generates exactly one reminder linked to the vaccination; partial failures cannot lose the reminder |
| FR-27 | P0 | Validate dates and show accurate history | Invalid dates are rejected; administration and due dates display consistently in clinic context; history is ordered explicitly |
| FR-28 | P1 | Handle corrected due dates without duplicate active tasks | Changing a due date updates or supersedes the corresponding reminder with an activity record |

The current form requires a next-due date while the backend permits it to be absent. Initial recommendation: require it when a subsequent dose is planned and allow “No next dose scheduled” only after clinic approval. Date defaults must not silently impose a clinical interval.

### 8.6 Appointments

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-29 | P0 | Provide a month calendar and selected-day agenda | Month navigation, outside-month day selection, and today navigation select the correct date; agenda sorts by time |
| FR-30 | P0 | Create an appointment for a valid patient and veterinarian | Date/time, service, veterinarian, and duration produce valid start/end timestamps; successful save updates views |
| FR-31 | P0 | Prevent overlapping reservations for the same veterinarian | An overlapping active reservation is rejected even under concurrent submissions; adjacent slots are allowed |
| FR-32 | P1 | Edit, reschedule, and change appointment status | Staff can progress or cancel an appointment; changes update agenda/counts and preserve actor/history |
| FR-33 | P1 | Carry patient context into booking | Booking from patient detail preselects that patient without preventing staff from changing it |
| FR-34 | P1 | Calculate indicators from meaningful schedule states | Busy/booked indicators exclude cancelled/no-show visits where appropriate; summary definitions are explicit |

Observed calendar behavior marks any appointment date and labels a day “busy” at two or more appointments. That threshold is a visual demo rule, not a confirmed clinic-capacity policy.

Current booking services: Wellness check, Vaccination, Follow-up, Dental consultation, Procedure, and Emergency. Existing fixtures also use free-text service names; production needs an agreed service catalog and mapping.

### 8.7 Reminders and contact outcomes

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-35 | P0 | Classify open reminders from due date and clinic date | Past dates are Overdue, the current date is Due, later dates are Upcoming; Completed remains terminal unless explicitly reopened |
| FR-36 | P0 | Provide worklist filters and owner call links | Open excludes terminal reminders; type and completed filters are clearly defined; phone links reference the correct owner |
| FR-37 | P0 | Complete a reminder with a required outcome | Outcome, completion time, and completing user persist; reminder leaves the open list and remains accessible in history |
| FR-38 | P1 | Create and assign custom reminders | Staff choose patient, title/type, due date, priority, assignee, and notes; newly saved task is searchable/filterable |
| FR-39 | P1 | Preserve contact attempts and support snooze/cancel | Multiple attempts remain in activity history; snoozing changes the future due date; cancelled reminders do not count as open |

Current source filters are Open, Follow-up, Vaccination, Checkup, and Completed. Type filters currently include completed reminders of that type. The release should expose status and type as independent filters or label this behavior explicitly.

Calling opens a device `tel:` link. It does not establish that a call connected, send a message, or automatically capture a call outcome.

### 8.8 Inventory and suppliers

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-40 | P0 | Search inventory and flag reorder levels | Name/SKU search and category filters combine; quantity less than or equal to minimum triggers the reorder flag |
| FR-41 | P0 | Record every quantity change in an immutable ledger | Movement has item, signed quantity, reason, actor, and timestamp; balances equal the ledger sum |
| FR-42 | P0 | Reject insufficient-stock and concurrent invalid movements | A rejected request leaves stock unchanged; simultaneous withdrawals cannot overdraw available stock |
| FR-43 | P0 | Use live expiry dates and distinguish expired stock | Alerts depend on the clinic date; expired and expiring stock are separate; items without expiry render safely |
| FR-44 | P1 | Maintain items, batches, and supplier associations | Unique SKU, units, minimum level, batch/lot, expiration, and supplier links persist; inactive records retain history |
| FR-45 | P1 | Record physical-count corrections as adjustments | Staff enter observed quantity and reason; the delta is auditable and is classified as an adjustment |
| FR-46 | P0 | Provide supplier search and usable contact details | Search matches supplier or contact name; phone/email links and linked-item totals reference saved data |
| FR-47 | P1 | Add, edit, and archive suppliers | Details persist and validation handles optional email/contact fields; archiving does not erase prior movements |

Observed categories: Vaccines, Medicine, and Consumables. Observed movement reasons: Supplier delivery, Dispensed to patient, Clinic use, Expired / damaged, and Physical count correction.

The displayed “Expiring in 90 days” metric currently uses the fixed cutoff `2026-10-29`. Required behavior is a rolling 90-day window with a separate expired indicator. Batch-level remaining stock must determine which expiries are operationally relevant. Whether expired-stock dispensing is always blocked or subject to a documented exception requires clinic review.

### 8.9 Reports and administration

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FR-48 | P1 | Generate the five advertised reports | Each Prepare report action produces usable output with accurate filters, empty states, and saved-data totals |
| FR-49 | P0 | Restrict complete exports and record export events | Owner permission is checked server-side; generated scope, actor, time, and result are logged |
| FR-50 | P1 | Persist clinic and professional details | Saved clinic identity and veterinarian details survive reload and appear on applicable documents |
| FR-51 | P1 | Provide staff/account administration | Owner can provision/deactivate accounts and assign supported roles; staff cannot elevate themselves |
| FR-52 | P1 | Expose approved privacy and retention settings | Configuration reflects a clinic-approved policy; changes are restricted and audited; no silent automatic purge |

FR-49 is a P0 constraint whenever exports are enabled; FR-48 is the P1 implementation of the report surfaces.

| Report | Required content | Proposed filters | Advertised format |
| --- | --- | --- | --- |
| Patient register | Active pets, record identifiers, linked owner details | Patient state, species | CSV |
| Vaccinations due | Pet, owner contact, vaccine, due date, reminder state | Due-date range, vaccine, status | CSV / Print |
| Complete clinical history | Identity, owner, alerts, encounters, vitals, vaccines | One patient; complete history by default | PDF / Print |
| Inventory status | SKU, item, available stock, minimum level, batches/expiry | Category, low stock, expiry window | CSV |
| Reminder outcomes | Due/completion dates, patient, type, assignee, outcomes | Date range, status, type, assignee | CSV |

Vaccination certificates are mentioned in settings copy, but no certificate-generation workflow exists. Treat certificate design and signing requirements as separate unapproved scope.

## 9. Data dictionary and relationships

The following dictionaries describe the current form fields and the required logical records. Frontend camelCase fields must be mapped explicitly to normalized backend fields rather than sent unchanged.

### 9.1 Owner and pet fields

| Entity / field | Current form requirement | Required handling |
| --- | --- | --- |
| Owner: full name | Required | Trim surrounding whitespace; preserve full display name |
| Owner: mobile number | Required | Preserve display value and support normalized search/call value; agree accepted formats |
| Owner: email | Optional | Validate when present; no invented value when absent |
| Owner: home address | Required | Support multiline location text |
| Owner: emergency contact | Optional | Currently free text; structured additional contacts exist in schema |
| Pet: name / owner / species / breed | Required | Owner is a valid foreign reference; species is from supported choices |
| Pet: sex | Male default | Male, Female, Unknown |
| Pet: reproductive status | Intact default | Intact, Neutered, Spayed, Unknown; reconsider defaults with clinic |
| Pet: birth date | Optional | Unknown is allowed; future dates rejected; estimated dates need explicit labeling if supported |
| Pet: current weight | Optional | Positive kg when supplied; define whether baseline weight becomes an initial measurement |
| Pet: color / markings | Optional | Free text |
| Pet: microchip | Optional | Unique when present; empty text maps to null rather than a shared empty identifier |
| Pet: known allergies | Optional | Current form accepts one free-text entry; production stores structured alert records |
| Pet: record number | Generated | Permanent unique identifier with server-controlled sequence |
| Pet: status | Active default | Active, Inactive, Deceased; history remains accessible |

### 9.2 Encounter and vaccination fields

| Entity / field | Current form requirement | Validation / meaning |
| --- | --- | --- |
| Visit: type | Required / default selection | Supported encounter type |
| Visit: attending veterinarian | Required free text | Production links to a staff profile and retains display attribution |
| Visit: chief complaint | Required | Encounter reason |
| Visit: follow-up date | Optional | Creates linked follow-up task when present |
| Visit: weight | Required | Positive kg; current form allows zero but backend constraint requires greater than zero |
| Visit: temperature | Optional | Source numeric range 30–45 °C, step 0.1; data-entry constraint, not diagnostic guidance |
| Visit: heart rate / respiratory rate | Optional | Positive whole numbers when supplied; units bpm / breaths per minute |
| Visit: BCS | Optional | Integer 1–9 |
| Visit: hydration | Normal default | Supported hydration value; should be visible in saved record |
| Visit: SOAP / diagnosis | Optional | Preserve each field independently and retain line breaks |
| Visit: encounter date/time | Generated at save | Production must distinguish actual encounter time from record creation time |
| Vaccination: vaccine | Required | Clinician-entered name or approved catalog selection |
| Vaccination: administration date | Required | Actual date of administration |
| Vaccination: next due date | Required in demo | Product decision on optional next dose; never silently infer schedule |
| Vaccination: lot / veterinarian | Required | Lot traceability and staff attribution |
| Vaccination: dose | Optional, default `1 mL` | Preserve entered text; default requires clinic review |

### 9.3 Operational records

| Entity | Core fields | Relationships / integrity |
| --- | --- | --- |
| Staff profile | Auth ID, name, role, job title, active flag, professional credentials | Account identity for authorship, assignments, and permissions |
| Appointment | Patient, service, veterinarian, start/end, status, notes, creator | One patient; optional linked encounter; no overlap for active slots of same veterinarian |
| Reminder | Patient, source link, type, title, due date/time, priority, status, assignee, notes, outcome | Source may be vaccination, encounter, appointment, or manual task; preserve completion attribution |
| Reminder activity | Reminder, action, note, actor, timestamp | Multiple events per task; retain contact attempts |
| Supplier | Name, contact, phone, email, address, ordering notes, active flag | Linked to items/batches; demo uses a single supplier per item |
| Inventory item | SKU, name, category, unit, minimum, controlled flag, active flag | Multiple batches and suppliers supported by backend scaffold |
| Inventory batch | Item, supplier, lot, expiration, received date | Must belong to the item on its movements |
| Stock movement | Item, batch, optional visit, type, signed quantity, reason, reference, actor, time | Append-only; reversal/correction uses a new movement |
| Clinic settings | Clinic contact/identity, timezone, retention, reminder lead time | Administrative configuration; clinic-approved values |
| Audit event | Actor, action, entity, record ID, changes/scope, timestamp | Restricted read access; sensitive payload policy must be decided |

### 9.4 Relationship summary

- One pet owner may have many pets; each pet has one primary owner in initial scope.
- A pet has many encounters, vaccinations, alerts, appointments, and reminders.
- Each encounter has its own vitals record; structured diagnoses, treatments, prescriptions, and attachments are backend-supported extensions.
- A vaccination may link to an encounter and produces a next-due reminder when applicable.
- An appointment may link to the encounter it becomes.
- An inventory item has many batches and movements and may have many supplier associations.
- Staff profiles identify record authors, attending veterinarians, assigned staff, and actors.

The present backend reminder table has vaccination and appointment references but no encounter reference. FR-21 therefore needs an explicit encounter-to-reminder linkage mechanism. Clinical prescriptions/attachments have no functioning frontend entry workflow.

## 10. Business rules and state transitions

### 10.1 Dates and timezone

- Use the configured clinic timezone, initially `Asia/Manila`, for clinic-day boundaries, today navigation, dashboard counts, and reminder classification.
- Store event timestamps consistently and distinguish calendar dates from instants.
- Recalculate date-dependent state on initial load, resume, and crossing a clinic-day boundary.
- Remove fixed fixture dates from production defaults. The current dashboard/calendar use `2026-07-29`; the vaccine form uses fixed administration and next-due dates.
- Do not confuse the document preparation date with the demo's simulated clinic date.

### 10.2 Patient identifiers

The demo uses four-digit padding and a collection-length offset. The utility and schema use five-digit padding. The proposed production convention is `VET-YYYY-NNNNN`, generated server-side and never recycled. Existing imported identifiers must be preserved or mapped through a reviewed migration strategy. Whether sequence numbering resets annually is an open decision; the existing schema sequence is continuous.

### 10.3 Reminder status

For nonterminal reminders:

| Condition | Display state |
| --- | --- |
| Due local date before today | Overdue |
| Due local date equals today | Due |
| Due local date after today | Upcoming |
| Explicit successful completion | Completed |

Snoozed and Cancelled are backend-supported extensions. Proposed behavior: snooze updates due information and preserves the event; cancellation removes the task from open counts. Reopening must be an explicit audited operation.

The demo hardcodes new automatic reminders as Upcoming and does not use `classifyReminder` in the active provider. A past-date reminder can therefore be mislabeled until this is connected.

### 10.4 Appointment lifecycle

The schema supports Pending, Confirmed, Arrived, In progress, Completed, Cancelled, and No show. The UI currently displays Pending/Confirmed fixtures and creates only Confirmed appointments.

Proposed normal progression: Pending → Confirmed → Arrived → In progress → Completed. Pending/Confirmed may transition to Cancelled; a scheduled visit may be marked No show. Corrections to terminal states require an explicit action. Overlap prevention applies to Pending, Confirmed, Arrived, and In progress; adjacent bookings can share an end/start boundary.

### 10.5 Stock integrity

- On-hand quantity equals the sum of accepted signed movements.
- Stock in uses a positive delta; stock out uses a negative delta; physical corrections remain identifiable as adjustments.
- Reject a movement that would make available stock negative. Do not clamp the balance to zero.
- Every movement requires an actor, reason, and timestamp; corrections use additional entries.
- Validate item/batch matching and remaining batch stock where batches apply.
- Reorder condition is `quantity <= minimumStock`, despite the current UI label “Below minimum.”
- Expiry calculations must exclude depleted batches and distinguish already expired stock from upcoming expiries.
- Vaccine or prescription entry does not currently deduct stock. Automatic dispensing linkage is a separate decision and must avoid double deductions.

### 10.6 Clinical integrity

- Saved records retain original encounter attribution and measurements.
- Finalization establishes a protected record state; corrections retain previous content and reason.
- Ordinary archiving preserves history; permanent deletion follows an approved policy and restricted workflow.
- Server-generated record creation time must not replace the actual date of a retrospectively recorded encounter.
- Related encounter/vitals/reminder writes must be atomic or use a durable mechanism that makes failures visible and repairable.

## 11. Experience and accessibility requirements

### 11.1 Visual direction

Preserve the implemented calm clinic interface: light neutral surfaces, green/teal primary actions, soft blue/amber/rose status colors, rounded cards, readable typography, clear spacing, and species icons. Status must also be conveyed through words or symbols. Pet stickers are species illustrations, not uploaded patient photos.

### 11.2 Responsive behavior

- Support the existing minimum layout width of 320 px, with practical acceptance coverage on phone, tablet, and desktop.
- On narrow screens, keep patient identification, contact details, status, and actions readable without losing their relationship.
- Calendar selection and agenda must remain usable with touch; forms may scroll without hiding their save/cancel actions.
- Target at least 44 × 44 px for primary touch controls; this is a proposed usability target.
- Preserve safe-area handling and reduced-motion behavior already represented in CSS.

### 11.3 Interaction and accessibility

- Keep Ctrl/Command+K search and visible search entry points.
- Dialogs require programmatic labels, initial focus, focus containment, Escape dismissal, and focus restoration.
- Warn about discarding unsaved form data when closing a populated dialog.
- Implement full tab semantics and keyboard navigation for patient detail tabs.
- Keep visible focus states and readable text contrast; verify with keyboard and screen-reader acceptance tasks.
- Associate validation errors with fields and provide a clear save-level error summary where appropriate.
- Display missing owner, missing expiry, empty lists, and unknown patient IDs safely.
- Printing must use a dedicated complete record representation; the current active tab must not determine history completeness.

The current shared modal has dialog attributes and backdrop dismissal, but no focus trap, focus restoration, or Escape handler. The shell's Escape handling applies to search/workspace overlays. Existing print CSS does not explicitly hide the newer workspace header and hides clinical alerts; print output needs dedicated verification.

## 12. Nonfunctional requirements

| ID | Priority | Requirement | Proposed acceptance target |
| --- | --- | --- | --- |
| NFR-01 | P0 | Persistence and write integrity | No acknowledged write is lost on reload; failed writes preserve user input and create no misleading success message |
| NFR-02 | P0 | Authorization and confidentiality | Real records require active staff credentials; privilege checks apply to API/database operations and private files |
| NFR-03 | P0 | Auditability | Required write/admin/export actions retain actor and timestamp; historical stock and correction records cannot be silently rewritten |
| NFR-04 | P0 | Concurrent correctness | Duplicate submissions do not duplicate records/reminders; concurrent booking/stock requests maintain constraints |
| NFR-05 | P0 | Failure handling | Loading, empty, failed, and session-expired states are clear; retries are safe; save controls prevent accidental repeat submission |
| NFR-06 | P0 | Performance | Proposed p95 search response under 1 second and main workspace usable within 3 seconds on agreed clinic devices/network; validate using 10,000 pets and 100,000 encounters |
| NFR-07 | P0 | Recoverability | Automated backup process and successful restore rehearsal before pilot; proposed RPO 24 hours / RTO 8 hours subject to clinic approval |
| NFR-08 | P1 | Accessibility and responsive usability | Core journeys complete with keyboard and touch at 320 px phone width, tablet, and desktop; no critical accessibility blockers |
| NFR-09 | P0 | Secret management | Frontend uses publishable/anon credentials only; privileged credentials never appear in browser bundles or logs |
| NFR-10 | P1 | Operational visibility | Error and save-failure monitoring identifies affected workflow without unnecessarily exposing clinical/contact content |
| NFR-11 | P1 | Export fidelity | CSV handles Unicode, delimiters, line breaks, and spreadsheet formula injection safely; print/PDF includes all required sections |
| NFR-12 | P0 | Maintainability and verification | Relevant build/lint checks and meaningful rule/integration tests pass before release; no demo data dependencies in real clinic repositories |

No uptime commitment is established by the source. Set a service target and support expectations before general release. Retention values in migrations are configuration defaults, not a verified legal or clinic policy.

## 13. Integration and architecture requirements

### 13.1 Observed architecture

- React 19 application built with Vite; React Router defines lazily loaded pages and a Suspense loader.
- `ClinicDataProvider` wraps the application and exposes collections and synchronous demo mutations.
- DayPicker provides the calendar; date-fns supplies date operations; Recharts provides the weight visualization.
- Phosphor icons and `src/index.css` provide the active presentation system; Tailwind is imported by that stylesheet.
- `src/lib/supabaseClient.js` conditionally initializes Supabase from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and enables persisted/refreshing auth sessions.
- That client is not wired into the page/provider flows. No login, logout, auth guard, persistent repository, or request error state is implemented there.
- Utility tests cover reminder classification, stock summation/negative-stock prevention, and five-digit record-number formatting. The active provider does not call these utilities.

### 13.2 Required production integration

1. Introduce authenticated session/profile loading and active-account checks.
2. Replace demo collections and mutation methods with persistent repositories while retaining an explicit fictional demo mode.
3. Map flat frontend records to backend joins: owners/pets, visits/vitals, structured alerts, staff attribution, item/batch/movement balances, and supplier associations.
4. Normalize UI labels and backend enums. In particular, resolve UI `Checkup` against backend reminder types and map display-case statuses to backend values.
5. Use one authoritative mechanism for vaccination reminder creation. The migration already creates reminders after vaccine insertion; adding another client-created reminder would duplicate work.
6. Define a durable follow-up reminder mechanism and encounter linkage, which the current schema does not fully express.
7. Carry appointment duration and actual veterinarian IDs so backend overlap enforcement applies.
8. Route stock changes through controlled transactions and verify all permitted write paths preserve invariants.
9. Generate privileged exports through a permission-enforcing path and record export events.
10. Add pagination/server-side search suitable for expected clinic volume, plus loading/error/retry states.

### 13.3 Backend scaffold limits

The migrations include two roles, RLS policies, private file buckets, selected audit triggers, an appointment overlap constraint, a vaccine-reminder trigger, a transactional stock function, updated-at triggers, owner-only deletion triggers on selected tables, finalized-visit protection, and a reminder-status refresh function.

These are starting points, not proof of deployed controls. Before production:

- Verify policy behavior with separate active owner, active staff, inactive staff, and anonymous accounts.
- Extend audit coverage beyond pets, visits, vaccinations, and inventory movements to required owner/contact, scheduling, reminder, settings, permissions, and export events.
- Verify finalized-record protections also cover related vitals and other encounter data, not only updates to the visit row.
- Review permanent-deletion behavior across child tables and files against the approved lifecycle policy.
- Ensure direct inventory inserts cannot bypass the negative-stock checks in the transactional function; review batch validation and adjustment typing.
- Reconcile expired/depleted batches with the stock view; its nearest-expiration expression excludes already expired dates and does not determine per-batch remaining stock.
- Schedule or reliably invoke reminder reclassification; having a refresh function does not make it run automatically.

## 14. Implementation gaps and risks

| Gap / risk | Evidence | Product consequence | Required response |
| --- | --- | --- | --- |
| In-memory records | Provider initializes and mutates React state | Refresh discards newly entered records | Persistent repositories and explicit demo label |
| Unprotected staff routes | Router has no auth/role guard; profile is fixed | Privacy text exceeds active protection | Implement session gates and backend authorization |
| Fixed dates and staff details | Dashboard, calendar, vaccine defaults, header | Misleading daily counts and wrong attribution | Live clinic date/profile and clinician-reviewed defaults |
| Identifier mismatch | Four-digit demo vs five-digit utility/schema | Inconsistent records; demo algorithm unsuitable for concurrency | Server-controlled convention and import policy |
| Reminder drift | Stored fixture states; new tasks always Upcoming | Overdue work may appear upcoming | Live classification and durable source linkage |
| Stock clamp and overwritten history | `Math.max(0, ...)`; only `lastMovement` retained | Oversized withdrawal silently loses reconciliation detail | Reject invalid withdrawal and append ledger entries |
| No booking duration or conflict check | Appointment form/provider | Reservations can overlap | Start/end mapping and server conflict enforcement |
| Placeholder actions | Custom reminder, New item, Add supplier, Add prescription, Prepare report | Clicks cannot complete advertised tasks | Implement in priority order or visibly mark unavailable |
| Settings gives cosmetic success | Submit toggles local Saved state | Staff may believe configuration was stored | Persist validated configuration before showing success |
| Partial patient-print output | Browser print uses currently mounted tab | “Complete history” can omit sections/alerts | Dedicated print/report representation and visual QA |
| Incomplete lifecycle UI | No edit/archive/finalize/reschedule workflows | Staff need manual workarounds | Implement reviewed P1 lifecycle flows |
| Flat frontend vs normalized schema | Free-text veterinarians and combined records | Data integration can lose attribution or relationships | Explicit adapters and mapping acceptance tests |
| Backend scaffolding unverified | Migrations read but not executed | Security/integrity assumptions may be wrong | Database integration and authorization tests |
| Clinical default ambiguity | Fixed vaccine dates, dose and reproductive defaults | Staff could save unintended values | Review defaults and require meaningful confirmation |
| Single-clinic assumptions | No tenancy key in schema | Unsafe to treat deployment as multi-tenant | Keep initial scope single clinic; design tenancy separately |

## 15. Acceptance and validation plan

This document is based on static source inspection. The checks below are release requirements, not claims that they have already passed.

| Scenario | Requirements | Required result |
| --- | --- | --- |
| Anonymous deep link and backend read | FR-01–04, NFR-02 | No real record content is returned; user receives an appropriate sign-in path |
| Staff tries owner-only action | FR-02, FR-49–52 | Settings/role/export operation is denied by backend even with a crafted request |
| Register owner and two pets | FR-10–14, NFR-01 | Correct household linkage; unique records; all survive reload/session change |
| Search every identifier and species | FR-05, FR-13 | Correct pet found by name, record, microchip, breed/list, owner, and phone; Bird/Rabbit remain discoverable |
| Save encounter and follow-up | FR-17–21 | Notes and vitals persist together; correct latest weight; one linked reminder |
| Invalid or blank optional vitals | FR-17–19 | Zero/invalid values rejected where required; blank optional values remain absent rather than becoming zero |
| Finalized encounter correction | FR-22, NFR-03 | Staff cannot alter finalized content through visit or child-record paths; owner correction retains history |
| Save vaccine, then retry | FR-25–28, NFR-04 | One saved dose and one reminder; no double client/trigger creation |
| Clinic midnight and date defaults | FR-07, FR-27, FR-35 | Correct today/overdue/upcoming states across day boundary; no production fixture dates |
| Concurrent overlapping bookings | FR-29–32 | One conflicting reservation is rejected; adjacent slots succeed; no partial agenda state |
| Complete/cancel/snooze reminder | FR-35–39 | Correct open counts; outcomes and activity attribution persist; terminal tasks remain in history |
| Stock receipt, use, and excessive withdrawal | FR-40–45 | Ledger reconciles; excessive withdrawal rejected; no zero clamp or overwritten movement history |
| Concurrent batch withdrawals | FR-41–44, NFR-04 | Item and batch balances remain valid; wrong item/batch combination rejected |
| Expired, depleted, and no-expiry stock | FR-43–44 | Distinct accurate indicators; no invalid-date rendering; depleted lots excluded from usable expiry view |
| Supplier and settings maintenance | FR-47, FR-50–52 | Saved edits survive reload; credentials/settings remain owner-controlled |
| Generate all five reports | FR-23, FR-48–49, NFR-11 | Saved-data accuracy, correct filters/Unicode, complete history, export audit, permission enforcement |
| Network failure or expired session during save | NFR-01, NFR-05 | Form input retained, clear failure, safe retry, no false success |
| Keyboard, touch, and print review | Section 11, NFR-08 | Complete core journeys, correct focus behavior, readable narrow-screen layout, complete printed content |
| Backup restoration | NFR-07 | Restore to an isolated environment and reconcile representative records and stock balances |

Existing `clinicRules.test.js` tests helper behavior only. They do not prove frontend integration, persistent save behavior, UI interactions, RLS, or transactional concurrency. Production verification should target those boundaries, including error and retry paths.

## 16. Delivery phases and release gates

No delivery dates or effort estimates are committed by this document. Sequence is dependency-based.

| Phase | Deliverables | Exit gate |
| --- | --- | --- |
| 0. Product decisions | Confirm clinic workflows, required fields/defaults, permission matrix, identifier policy, privacy/retention, and pilot scope | Clinic lead approves scope and unresolved decisions affecting implementation |
| 1. Secure persistence foundation | Auth/profile flow, protected routes, repositories/adapters, live date, validation/error handling, audit foundations, backup setup | P0 access, persistence, identity, and failure-path scenarios pass |
| 2. Connected care | Patient records, atomic encounters/vitals, vaccines, follow-up tasks, reminder completion | Correct relationships and exactly-once task creation; clinical integrity verified |
| 3. Reliable operations | Booking duration/conflicts, transactional stock, supplier lookup, expiry calculations | Concurrent appointment and stock scenarios pass; balances reconcile |
| 4. Complete operational release | P1 editing/lifecycle flows, supplier/item maintenance, reports/printing, saved settings and staff UI | P1 acceptance, export audit, print/accessibility review pass |
| 5. Controlled clinic rollout | Staff training, approved privacy/retention materials, restore rehearsal, dual-entry pilot, signed acceptance | Clinic accepts pilot evidence and authorizes transition from existing records |
| 6. Follow-on capabilities | Approved prescriptions, attachments/photos, expanded charts, future integrations | Separate scope and acceptance criteria approved |

### 16.1 Production-pilot gate

- All P0 requirements applicable to enabled features are satisfied.
- Real records are isolated from public demo access.
- Active owner/staff, inactive-account, and anonymous access checks pass.
- Required data persists; stock and appointment concurrency checks pass.
- Encounter, vaccination, and reminder relationships reconcile without duplicates.
- Critical errors have understandable recovery paths; restore rehearsal succeeds.
- Clinic approves professional defaults, access responsibilities, privacy wording, retention, and training.
- Temporary procedures for deferred P1 features are documented and accepted for the pilot.

### 16.2 Complete initial-release gate

- All P1 workflows in this PRD are implemented or explicitly removed through a documented scope revision.
- Report/print output is complete and audited where required.
- Staff administration and lifecycle workflows are usable without undocumented workarounds.
- Clinic completes representative end-to-end acceptance using fictional or anonymized records.
- Pilot reconciliation shows acceptable completeness and no unresolved record-loss, authorization, or stock-integrity issue.

## 17. Assumptions and open decisions

### 17.1 Working assumptions

- Initial production deployment serves one Philippine clinic, as described by the README and schema comments.
- The public root remains a marketing/demo surface; real records require authentication.
- Two permission roles are sufficient for the first version unless clinic workflow review establishes otherwise.
- Internet connectivity is required for production writes; offline editing is outside initial scope.
- The clinic supplies and approves clinical defaults and scheduling rules.
- The existing Supabase scaffold is the intended backend direction, but is not a production acceptance baseline.

### 17.2 Decisions requiring stakeholder input

| ID | Decision | Suggested decision owner | Needed before |
| --- | --- | --- | --- |
| OD-01 | Can all clinical staff enter/finalize notes, or must veterinarian permissions differ? | Clinic owner / head doctor | Auth and clinical lifecycle design |
| OD-02 | Which individual histories may staff print, and who may export operational lists? | Clinic owner | Print/export release |
| OD-03 | Which SOAP fields are mandatory, and may an encounter be saved as a draft? | Head doctor | Encounter implementation |
| OD-04 | How are historical paper encounters dated, imported, and attributed? | Head doctor / operations lead | Migration and pilot |
| OD-05 | Is a next vaccine dose optional, and which defaults are acceptable? | Head doctor | Vaccination release |
| OD-06 | What are service durations, working hours, veterinarian availability, and emergency overrides? | Clinic operations lead | Conflict-safe scheduling |
| OD-07 | Should Other mean a literal species value or include Bird/Rabbit; how should unknown breed be entered? | Clinic staff lead | Registration/filter refinement |
| OD-08 | What duplicate-owner rules, contact formats, and owner-transfer process apply? | Front-desk lead | Persistent registration/editing |
| OD-09 | Should numbering reset each year, and how are existing four-digit IDs preserved? | Clinic owner / engineering | Identifier integration |
| OD-10 | How should custom, checkup, appointment, and follow-up reminder types map? | Clinic operations lead | Reminder integration |
| OD-11 | Are reminders assigned to individuals or a staff queue, and what contact outcomes/retry rules are needed? | Clinic operations lead | Reminder activity workflow |
| OD-12 | Is fractional stock allowed for each unit; which items require lots and expiry? | Inventory lead / head doctor | Inventory validation |
| OD-13 | How are expired/controlled items handled, and should dispensing link to encounters or vaccines? | Head doctor / inventory lead | Batch workflow and dispensing scope |
| OD-14 | What are the approved privacy notice, retention period, deletion process, and audit payload limits? | Clinic owner and designated privacy reviewer | Real data pilot |
| OD-15 | Which backups, support coverage, recovery targets, and clinic devices are required? | Clinic owner / engineering | Pilot readiness |
| OD-16 | Are certificates, digital signatures, attachments, prescriptions, or communications required earlier? | Clinic owner | Scope approval |
| OD-17 | What contact information should appear on the public landing page? | Product owner | Public publication |

The schema defaults to ten years of retention and three reminder lead days. These values are unapproved configuration starting points; this PRD does not establish a legal retention obligation or automatic outreach policy.

## 18. Source traceability

| Source | Evidence used | Related requirements / sections |
| --- | --- | --- |
| [src/App.jsx](src/App.jsx) | Routes, lazy loading, catch-all navigation | FR-04; information architecture |
| [src/main.jsx](src/main.jsx) | Provider wiring, active stylesheet, application startup | Implementation status; architecture |
| [src/components/AppShell.jsx](src/components/AppShell.jsx) | Workspace chooser, global search, shortcut, badge, fixed profile | FR-04–06; accessibility |
| [src/pages/Landing.jsx](src/pages/Landing.jsx) | Public marketing content, demo entry, contact links | FR-03; scope; OD-17 |
| [src/pages/Dashboard.jsx](src/pages/Dashboard.jsx) | Summary counts, first-three preview, fixed date, shortcuts | FR-07–09; date rules |
| [src/pages/Patients.jsx](src/pages/Patients.jsx) | Owner/pet fields, required inputs, search, species filters, flags | FR-10–16; owner/pet dictionary |
| [src/pages/PetDetail.jsx](src/pages/PetDetail.jsx) | Visit/vaccine forms, timeline, weight chart, alerts, print, placeholder prescription | FR-17–28; clinical dictionary and print gaps |
| [src/pages/Operations.jsx](src/pages/Operations.jsx) | Month/day calendar, appointment form, reminder worklist and outcomes | FR-29–39; scheduling/reminder rules |
| [src/pages/Stock.jsx](src/pages/Stock.jsx) | Inventory filters, fixed expiry cutoff, movement form, supplier cards | FR-40–47; stock rules |
| [src/pages/Admin.jsx](src/pages/Admin.jsx) | Report catalog, export-access copy, settings fields and cosmetic save | FR-48–52; report formats |
| [src/context/ClinicDataContext.jsx](src/context/ClinicDataContext.jsx) | In-memory collections, mutations, reminder creation, stock clamp, record-number generation | FR-12, FR-19, FR-21, FR-26, FR-41–42; persistence gaps |
| [src/data/demoData.js](src/data/demoData.js) | Fixture shapes, states, specimen identifiers, data relationships | Data dictionary; implementation status |
| [src/utils/clinicRules.js](src/utils/clinicRules.js) | Reminder classification, stock helpers, five-digit numbering | Business rules |
| [src/utils/clinicRules.test.js](src/utils/clinicRules.test.js) | Existing helper test coverage | Validation limits |
| [src/lib/supabaseClient.js](src/lib/supabaseClient.js) | Conditional client initialization and auth options | Integration requirements |
| [src/components/ui.jsx](src/components/ui.jsx) | Shared forms, modal behavior, badges, empty states | Experience/accessibility |
| [src/components/PetSticker.jsx](src/components/PetSticker.jsx) | Species illustration and fallback icon | Experience; photo-scope distinction |
| [src/index.css](src/index.css) | Active palette, responsive styles, focus/reduced motion/print rules | Experience/accessibility; print risk |
| [README.md](README.md) | Single-clinic positioning, demo status, setup and pilot guidance | Product scope; release gates |
| [package.json](package.json) | Framework/library dependencies and validation scripts | Architecture; NFR-12 |
| [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql) | Normalized records, roles, policies, selected audits, private storage, overlap/stock functions | Backend alignment; data relationships; security/integrity caveats |
| [supabase/migrations/002_record_integrity.sql](supabase/migrations/002_record_integrity.sql) | Selected deletion protections, finalized-visit update protection, status-refresh function | Lifecycle and reminder integration |

### 18.1 Glossary

| Term | Meaning |
| --- | --- |
| Patient | A pet receiving clinic care |
| Pet owner | Customer/household contact linked to one or more pets |
| Clinic owner | Administrative application role; not the pet-owner entity |
| SOAP | Subjective, Objective, Assessment, Plan clinical note sections |
| BCS | Body condition score, represented on a 1–9 scale in this application |
| SKU | Stock keeping unit; unique inventory item code |
| Lot / batch | Traceable group of inventory or administered vaccine supply |
| RLS | Row-level security policies enforced in the database |
| RPO / RTO | Recovery point objective / recovery time objective |
