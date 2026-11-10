# Veterina UI/UX Modernization & Refinement Specification
> **Target Audience:** AI Coding Assistants & Senior Frontend Engineers (Vibe Coding Ready)  
> **System Stack:** React 19, React Router 7, Vite, Phosphor Icons (`@phosphor-icons/react`), Vanilla CSS with CSS Variables / Design Tokens, Supabase.

---

## Executive Summary & Vision

This specification defines a comprehensive UI/UX overhaul for **Veterina** — a modern, privacy-first veterinary clinical care platform. The goal is to strip away generic "AI template" aesthetics in favor of a bespoke, warm, tactile clinic operating environment tailored to veterinary staff. 

### Key Objectives
1. **Bespoke Selects & Comboboxes:** Replace browser-native dropdowns with accessible, branded floating dropdowns.
2. **Bug Squashing:** Fix the broken search input and misaligned layout on `/appointments` (`ScheduleTasks.jsx`).
3. **Charming Mascot Error Suite:** Replace blank/generic redirects with illustrated 404, 403, and 500 error boundaries featuring Veterina's pixel art mascots (Doctor Dino, Sleeping Cat, Wandering Pup).
4. **Functional Header Notification Hub:** Upgrade the bland bell into a dynamic "Today's Agenda" popover driven by real-time appointment counts and urgent care tasks.
5. **Smooth Page & Workspace Transitions:** Implement subtle, hardware-accelerated transitions that communicate context switching.
6. **Dashboard Decluttering:** Remove the redundant bottom "Choose a workspace" section.
7. **Spacing System Normalization:** Use `/eports` (Clinical History card) as the benchmark to enforce consistent vertical rhythm and gap standards across cards and forms.
8. **Branded Custom Checkboxes:** Replace system checkboxes with animated, brand-tinted controls.
9. **Patient Record Quick Skim View:** Add a folder-style, low-density summary view for clinical history cards with on-demand detailed modals.
10. **Patients & Owners Page Glow-Up:** Integrate clinic branding, enhanced avatar stickers, and rapid contact actions without overwhelming busy staff.
11. **System-wide Card Elevating:** Infuse depth, subtle brand tinting, and tactile hover states into cards.
12. **Supplier Directory Redesign:** Convert flat vendor boxes into executive purchasing cards with live inventory previews and one-click contact actions.

---

## Table of Contents
- [1. Design Tokens & Styling Foundations](#1-design-tokens--styling-foundations)
- [2. Dropdowns, Selects & Comboboxes Component Suite](#2-dropdowns-selects--comboboxes-component-suite)
- [3. Bug Fix: /appointments Search Box](#3-bug-fix-appointments-search-box)
- [4. Custom Mascot Error Pages (404, 403, 500)](#4-custom-mascot-error-pages-404-403-500)
- [5. Header Notification Hub Upgrade](#5-header-notification-hub-upgrade)
- [6. Workspace & Page Transition Animations](#6-workspace--page-transition-animations)
- [7. Dashboard Cleanup](#7-dashboard-cleanup)
- [8. Spacing Hierarchy & /reports Alignment Fix](#8-spacing-hierarchy--reports-alignment-fix)
- [9. Custom Accessible Checkboxes](#9-custom-accessible-checkboxes)
- [10. Patient Records: Quick Skim vs Detailed Mode](#10-patient-records-quick-skim-vs-detailed-mode)
- [11. Patients & Owners Layout Polish](#11-patients--owners-layout-polish)
- [12. Elevated System-Wide Card Treatment](#12-elevated-system-wide-card-treatment)
- [13. Suppliers Directory Redesign](#13-suppliers-directory-redesign)
- [14. Implementation & Verification Checklist](#14-implementation--verification-checklist)

---

## 1. Design Tokens & Styling Foundations

Veterina uses CSS custom properties defined in `src/index.css` and `src/appearance.css`. All new components **must** tap into these variables rather than hardcoding hex values.

```css
:root {
  /* Clinic Brand Palette (Personalized by Clinic Owner) */
  --brand-ink: #2a6f62;         /* Primary clinic deep green/teal */
  --brand-soft: #e8f3ef;        /* Soft tinted background */
  --brand-strong-ink: #1a4a41;  /* High-contrast brand text */
  --brand-border: color-mix(in srgb, var(--brand-ink) 22%, #d5ded9);

  /* Neutrals & Surfaces */
  --ink: #1c2b26;               /* Main text */
  --muted: #5f6d67;             /* Subdued labels & hints */
  --surface: #ffffff;           /* Card & modal backgrounds */
  --surface-soft: #f6f8f6;      /* Table heads, secondary wells */
  --line: #e3e8e5;              /* Default border line */
  
  /* Status Semantics */
  --sage: #507c6c;
  --amber: #b26c1e;
  --amber-soft: #fdf5ea;
  --rose: #b53838;
  --rose-soft: #fdf0f0;
  --blue: #2c6382;
  --blue-soft: #edf5fa;

  /* Elevation & Motion */
  --shadow-subtle: 0 1px 3px rgba(28, 43, 38, 0.04), 0 4px 12px -2px rgba(28, 43, 38, 0.03);
  --shadow-card: 0 2px 6px rgba(28, 43, 38, 0.04), 0 8px 24px -4px rgba(28, 43, 38, 0.06);
  --shadow-popover: 0 4px 16px rgba(28, 43, 38, 0.08), 0 16px 36px -6px rgba(28, 43, 38, 0.12);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --transition-snappy: 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 2. Dropdowns, Selects & Comboboxes Component Suite

### Problem Statement
Native HTML `<select>` elements look completely generic, render system-native OS chrome (gray squares on Windows), lack search filtering, and break visual immersion.

### Recommended Library
Install `@floating-ui/react` (lightweight, zero bundle bloat, works smoothly in React 19):
```bash
npm install @floating-ui/react
```

### Component Architecture: `src/components/VeterinaSelect.jsx`

Create a reusable, fully accessible dropdown supporting both simple selection and searchable combobox modes.

```jsx
import { useState, useRef, useEffect, useId } from 'react'
import { useFloating, offset, flip, shift, size, autoUpdate } from '@floating-ui/react'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import './VeterinaSelect.css'

export default function VeterinaSelect({
  value,
  onChange,
  options = [], // [{ value: '...', label: '...', icon?: Icon, tone?: 'sage' }] or string[]
  placeholder = 'Select an option',
  searchable = false,
  searchPlaceholder = 'Search...',
  ariaLabel,
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const id = useId()
  const searchInputRef = useRef(null)

  const normalizedOptions = options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  )

  const selectedOption = normalizedOptions.find((opt) => opt.value === value)

  const filtered = normalizedOptions.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  )

  const { refs, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxWidth: '360px',
          })
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      setSearch('')
    }
  }, [open, searchable])

  // Handle outside click & escape key
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div className={`vt-select-root ${className}`}>
      <button
        ref={refs.setReference}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
        className={`vt-select-trigger ${open ? 'is-open' : ''} ${selectedOption ? 'has-value' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className="vt-select-label">
          {selectedOption ? selectedOption.label : <span className="vt-placeholder">{placeholder}</span>}
        </span>
        <CaretDown size={14} weight="bold" className="vt-select-caret" />
      </button>

      {open && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="vt-select-popover"
          role="listbox"
        >
          {searchable && (
            <div className="vt-select-search">
              <MagnifyingGlass size={15} />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="vt-select-options">
            {filtered.length === 0 ? (
              <div className="vt-select-empty">No options found</div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    className={`vt-select-option ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                    }}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check size={14} weight="bold" className="vt-option-check" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

### Accompanying Styling: `src/components/VeterinaSelect.css`
```css
.vt-select-root { position: relative; display: inline-block; width: 100%; }
.vt-select-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 42px; padding: 8px 14px;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--ink);
  font: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: border-color var(--transition-snappy), box-shadow var(--transition-snappy);
}
.vt-select-trigger:hover:not(:disabled) {
  border-color: var(--brand-border);
  background: var(--surface-soft);
}
.vt-select-trigger:focus-visible, .vt-select-trigger.is-open {
  outline: none;
  border-color: var(--brand-ink);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.vt-select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-placeholder { color: var(--muted); font-weight: normal; }
.vt-select-caret { color: var(--muted); transition: transform var(--transition-snappy); }
.vt-select-trigger.is-open .vt-select-caret { transform: rotate(180deg); color: var(--brand-ink); }

.vt-select-popover {
  z-index: 1000; background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--radius-md);
  box-shadow: var(--shadow-popover); overflow: hidden;
  animation: vtSelectEntrance 140ms ease-out;
}
@keyframes vtSelectEntrance {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.vt-select-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--line); background: var(--surface-soft);
}
.vt-select-search input {
  width: 100%; border: none; background: transparent; color: var(--ink);
  font: inherit; font-size: 13px; outline: none;
}
.vt-select-options { max-height: 220px; overflow-y: auto; padding: 4px; }
.vt-select-option {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 6px; font-size: 13px; color: var(--ink);
  cursor: pointer; transition: background 100ms;
}
.vt-select-option:hover { background: var(--brand-soft); color: var(--brand-strong-ink); }
.vt-select-option.is-selected { font-weight: 600; color: var(--brand-ink); background: var(--brand-soft); }
.vt-option-check { color: var(--brand-ink); }
.vt-select-empty { padding: 12px; text-align: center; color: var(--muted); font-size: 12px; }
```

---

## 3. Bug Fix: /appointments Search Box

### Issue Breakdown (From User's Attached Screenshot)
In `src/components/ScheduleTasks.jsx` (line 67):
```jsx
/* CURRENT BUGGY IMPLEMENTATION */
<div className="list-toolbar compact">
  <label>Search<input type="search" aria-label="Search follow-up tasks" placeholder="Patient, owner or task" value={query} onChange={(event) => change('taskSearch', event.target.value)} /></label>
  <label>Status<select ...>...</select></label>
  <label>Type<select ...>...</select></label>
</div>
```
Combined with `ScheduleTasks.css`:
```css
.schedule-tasks .list-toolbar label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
.schedule-tasks .list-toolbar input { min-height: 42px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); }
```
**Why it fails:**
- The word "Search" is rendered as raw text inside a grid `<label>`, causing the label text to stack vertically right above the input box.
- Inside `.list-toolbar.compact` (which is a single horizontal flex strip), this causes a hideous height mismatch, cut-off border edges, and overlapping placeholder text ("Patient, owner or tasl").

### Corrected Implementation in `src/components/ScheduleTasks.jsx`
Replace the search block with the standard `.table-search` container with a Phosphor icon:

```jsx
<div className="list-toolbar compact">
  <div className="table-search">
    <MagnifyingGlass size={18} weight="bold" />
    <input
      type="search"
      aria-label="Search follow-up tasks"
      placeholder="Search patient, owner, or task..."
      value={query}
      onChange={(event) => change('taskSearch', event.target.value)}
    />
  </div>
  
  <div className="toolbar-filter-group">
    <span className="filter-label">Status</span>
    <VeterinaSelect
      value={status}
      onChange={(val) => change('status', val)}
      options={statuses}
      className="toolbar-select"
    />
  </div>

  <div className="toolbar-filter-group">
    <span className="filter-label">Type</span>
    <VeterinaSelect
      value={type}
      onChange={(val) => change('type', val)}
      options={['All', 'Follow-up', 'Vaccination', 'Deworming', 'Checkup', 'Custom', 'Medication']}
      className="toolbar-select"
    />
  </div>

  {patientId && <button className="text-link" onClick={() => change('taskPet', '')}>Show all patients</button>}
</div>
```

### CSS Patch in `src/components/ScheduleTasks.css`
```css
/* Remove the conflicting nested grid label rule */
.schedule-tasks .list-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.schedule-tasks .table-search {
  flex: 1 1 260px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-height: 42px;
}
.schedule-tasks .table-search input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--ink);
  outline: none;
  font-size: 13px;
}
.toolbar-filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-filter-group .filter-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.toolbar-select { width: 140px; }
```

---

## 4. Custom Mascot Error Pages (404, 403, 500)

Veterina uses crisp, nostalgic pixel mascots (`shapeRendering="crispEdges"`) to give the clinical software warmth without sacrificing medical rigor.

### The Mascot Cast for Error States
1. **404 Not Found:** **Wandering Pixel Pup**  
   - *Expression/Pose:* Cute floppy-eared brown dog with a tiny clinic neck bandana, sitting bewildered, sniffing a cold trail of pawprints.  
   - *Placement:* Centered 96x96 SVG illustration on an elevated card, resting on a soft grass-tinted oval shadow.  
   - *Headline:* "Trail Went Cold (404)"  
   - *Description:* "The patient record, file, or room you're looking for scampered away or was moved."  
   - *Actions:* Primary button `[ Return to Dashboard ]`, Secondary `[ Search Clinic Records ]`.

2. **403 Forbidden / Access Denied:** **Doctor Dino Guard**  
   - *Expression/Pose:* Upright Pixel T-Rex (`DoctorDino.jsx`) wearing a white lab coat, stethoscope, and holding a small clipboard with a red seal.  
   - *Placement:* Top-centered, with a subtle alert-tinted halo (`var(--amber-soft)`).  
   - *Headline:* "Authorized Paws Only (403)"  
   - *Description:* "This clinic zone is restricted to clinic owners or higher-tier credentials. Ask your clinic administrator for access."  
   - *Actions:* Primary button `[ Go to My Workspace ]`, Secondary `[ Sign Out / Switch ]`.

3. **500 / Crash Boundary:** **Catnap Patient**  
   - *Expression/Pose:* The beloved `SleepingPatientCat` from `src/components/PixelPatients.jsx` curled up on its teal orthopedic cat bed, gently breathing with floating `Zzz` particles.  
   - *Placement:* Center-stage inside a reassuring card with a calm sage-green medical cross badge.  
   - *Headline:* "Taking a Quick Catnap (500)"  
   - *Description:* "The clinic engine ran into an unexpected hiccup. Your records remain safe in the database."  
   - *Actions:* Primary button `[ Recheck Vitals (Reload) ]`, Secondary button `[ Copy Diagnostic Code ]`.

### Implementation: `src/components/ErrorViews.jsx`
```jsx
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, House, MagnifyingGlass, ShieldWarning, ArrowClockwise } from '@phosphor-icons/react'
import { SleepingPatientCat } from './PixelPatients'
import DoctorDino from './DoctorDino'
import './ErrorViews.css'

export function NotFoundView() {
  const navigate = useNavigate()
  return (
    <div className="vt-error-page">
      <div className="vt-error-card">
        <div className="vt-mascot-frame">
          <svg className="vt-lost-pup" viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true">
            {/* Soft ground shadow */}
            <ellipse cx="32" cy="56" rx="22" ry="4" fill="#dce6e1" />
            {/* Dog body */}
            <path d="M22 36h20v14H22Z" fill="#9b6039" />
            <path d="M24 38h16v10H24Z" fill="#f1f3e6" />
            {/* Head & drooping curious ears */}
            <path d="M24 18h16v16H24Z" fill="#a66b39" />
            <path d="M18 20h6v12h-6Z" fill="#65412c" />
            <path d="M40 20h6v12h-6Z" fill="#65412c" />
            {/* Inquisitive eyes with tiny white highlights */}
            <path d="M28 24h3v3h-3ZM35 24h3v3h-3Z" fill="#202c29" />
            <path d="M29 24h1v1h-1ZM36 24h1v1h-1Z" fill="#ffffff" />
            {/* Little snout & nose */}
            <path d="M30 28h6v4h-6Z" fill="#e0cbb2" />
            <path d="M32 28h2v2h-2Z" fill="#30241e" />
            {/* Teal bandana */}
            <path d="M24 34l8 6 8-6v3l-8 5-8-5Z" fill="#2a6f62" />
          </svg>
        </div>
        <span className="vt-error-code">404 — PAGE NOT FOUND</span>
        <h1>This trail went cold</h1>
        <p>The patient record, clinic document, or page you were headed to couldn't be found. It may have been relocated or archived.</p>
        <div className="vt-error-actions">
          <button className="button button-secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Go back
          </button>
          <Link className="button button-primary" to="/dashboard">
            <House size={16} /> Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}

export function ForbiddenView({ message }) {
  return (
    <div className="vt-error-page">
      <div className="vt-error-card">
        <div className="vt-mascot-frame vt-dino-wrap">
          <DoctorDino />
        </div>
        <span className="vt-error-code vt-code-amber">403 — RESTRICTED AREA</span>
        <h1>Authorized paws only</h1>
        <p>{message || "You don't have active permissions to enter this clinic workspace. Access is restricted to clinic owners or elevated clinical accounts."}</p>
        <div className="vt-error-actions">
          <Link className="button button-primary" to="/dashboard">
            <House size={16} /> Return to safe workspace
          </Link>
        </div>
      </div>
    </div>
  )
}

export function CrashFallback({ error, resetErrorBoundary }) {
  return (
    <div className="vt-error-page">
      <div className="vt-error-card vt-crash-card">
        <div className="vt-mascot-frame">
          <SleepingPatientCat />
        </div>
        <span className="vt-error-code vt-code-rose">SYSTEM INTERRUPT</span>
        <h1>Taking a quick catnap</h1>
        <p>An unexpected error occurred during this clinic operation. Your patient records in Supabase remain safely persisted.</p>
        {error?.message && (
          <pre className="vt-error-log">
            <code>{error.message}</code>
          </pre>
        )}
        <div className="vt-error-actions">
          <button className="button button-primary" onClick={resetErrorBoundary || (() => window.location.reload())}>
            <ArrowClockwise size={16} /> Recheck vitals (Reload)
          </button>
          <Link className="button button-secondary" to="/dashboard">
            <House size={16} /> Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
```

### Routing Wiring in `src/App.jsx`
Replace the wildcard navigate (`{ path: '*', element: <Navigate to="/dashboard" replace /> }`) with the proper 404 page, and add the root `errorElement`:

```jsx
import { NotFoundView, CrashFallback } from './components/ErrorViews'

const router = createBrowserRouter([
  {
    element: <RecoveryRedirect />,
    errorElement: <CrashFallback />,
    children: [
      /* All standard routes... */
      {
        element: <ProtectedWorkspace />,
        children: [
          /* Workspace paths... */
          { path: '*', element: <NotFoundView /> },
        ],
      },
      { path: '*', element: <NotFoundView /> },
    ],
  },
])
```

---

## 5. Header Notification Hub Upgrade

### Problem Statement
In `src/components/AppShell.jsx`, the notification bell is a static link to `/appointments?view=tasks` with a number showing only overdue/due reminders. It ignores today's upcoming appointments schedule and offers no preview.

### The Refinement
1. **Dynamic Schedule Badge:** Count all pending appointments scheduled for today (`appointments.filter(a => a.date === today && !['Cancelled', 'No Show', 'Completed'].includes(a.status))`) alongside urgent follow-up calls.
2. **Interactive Dropdown Popover:** Clicking the bell opens a sleek "Today's Clinic Glance" popover displaying:
   - Next 3 upcoming patients today with appointment time, pet sticker, owner name, and care category.
   - Urgent pending reminders / follow-up calls.
   - One-click shortcuts to `[ Open Calendar ]` and `[ Follow-up Tasks ]`.

### Code Implementation in `src/components/AppShell.jsx`

```jsx
// Inside AppShell component:
const { appointments, reminders, getPet, getOwner, today } = useClinicData()
const [notifOpen, setNotifOpen] = useState(false)
const notifRef = useRef(null)

const todayAppointments = useMemo(() => {
  return appointments
    .filter((a) => a.date === today && !['Cancelled', 'No Show'].includes(a.status))
    .sort((a, b) => a.time.localeCompare(b.time))
}, [appointments, today])

const pendingToday = todayAppointments.filter((a) => a.status !== 'Completed')
const dueReminders = reminders.filter((r) => r.status === 'Due' || r.status === 'Overdue')
const totalBadgeCount = pendingToday.length + dueReminders.length

// Outside-click handler
useEffect(() => {
  if (!notifOpen) return
  const close = (e) => {
    if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
  }
  window.addEventListener('mousedown', close)
  return () => window.removeEventListener('mousedown', close)
}, [notifOpen])
```

Render block inside header actions:
```jsx
<div className="notification-wrapper" ref={notifRef}>
  <button
    type="button"
    className={`notification-button icon-button ${notifOpen ? 'is-active' : ''} ${totalBadgeCount > 0 ? 'has-badge' : ''}`}
    aria-label={`${totalBadgeCount} appointments and tasks for today`}
    onClick={() => setNotifOpen(!notifOpen)}
  >
    <BellRinging size={21} weight="duotone" />
    {totalBadgeCount > 0 && <span className="notification-badge">{totalBadgeCount}</span>}
  </button>

  {notifOpen && (
    <div className="notification-popover" role="dialog" aria-label="Today's schedule and reminders">
      <div className="notif-header">
        <div>
          <strong>Today's Schedule</strong>
          <small>{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(`${today}T00:00:00Z`))}</small>
        </div>
        <Link to="/appointments" onClick={() => setNotifOpen(false)} className="text-link">Calendar →</Link>
      </div>

      <div className="notif-section">
        <span className="notif-eyebrow">Upcoming appointments ({pendingToday.length})</span>
        {pendingToday.length === 0 ? (
          <p className="notif-empty">No remaining appointments today.</p>
        ) : (
          <div className="notif-list">
            {pendingToday.slice(0, 3).map((apt) => {
              const pet = getPet(apt.petId)
              const owner = getOwner(pet?.ownerId)
              return (
                <Link to={`/patients/${pet?.id}`} key={apt.id} className="notif-item" onClick={() => setNotifOpen(false)}>
                  <time>{apt.time}</time>
                  <PetSticker pet={pet} size="small" />
                  <div className="notif-info">
                    <strong>{pet?.name}</strong>
                    <small>{apt.service} · {owner?.fullName}</small>
                  </div>
                  <Badge tone={apt.status === 'Confirmed' ? 'success' : 'warning'}>{apt.status}</Badge>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      <div className="notif-section">
        <span className="notif-eyebrow">Tasks & follow-ups ({dueReminders.length})</span>
        {dueReminders.length === 0 ? (
          <p className="notif-empty">All follow-ups up to date!</p>
        ) : (
          <div className="notif-list">
            {dueReminders.slice(0, 2).map((task) => (
              <Link to="/appointments?view=tasks" key={task.id} className="notif-task-item" onClick={() => setNotifOpen(false)}>
                <span className={`task-dot ${task.status.toLowerCase()}`} />
                <span>{task.title}</span>
                <small>{task.status}</small>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="notif-footer">
        <Link to="/appointments?view=tasks" onClick={() => setNotifOpen(false)} className="button button-secondary small-button">
          Open all tasks ({dueReminders.length})
        </Link>
      </div>
    </div>
  )}
</div>
```

---

## 6. Workspace & Page Transition Animations

When clinicians switch workspaces (e.g. from `/queue` to `/patients` or `/inventory`), the screen should seamlessly crossfade without jarring layout flash.

### Implementation in `src/components/AppShell.jsx`
Pass the router `useLocation()` key to the main content container:
```jsx
const location = useLocation()
// Get the top-level workspace key (e.g., 'patients', 'queue', 'inventory')
const workspaceKey = location.pathname.split('/')[1] || 'dashboard'

return (
  <div className="app-shell spacious-shell">
    {/* Header & overlays... */}
    <main className="main-content spacious-content">
      <div key={workspaceKey} className="workspace-page-transition">
        <Outlet />
      </div>
    </main>
  </div>
)
```

### CSS Animation in `src/index.css`
```css
/* Smooth, GPU-accelerated workspace transition */
.workspace-page-transition {
  animation: workspaceFadeIn 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  will-change: opacity, transform;
}

@keyframes workspaceFadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Accessibility: respect motion preferences */
@media (prefers-reduced-motion: reduce) {
  .workspace-page-transition {
    animation: none !important;
  }
}
```

---

## 7. Dashboard Cleanup

### Action Required in `src/pages/Dashboard.jsx`
1. Delete the `spaces` array constant at the top of the file (lines 21–29):
   ```javascript
   /* DELETE THIS UNUSED BLOCK */
   const spaces = [
     { to: '/queue', title: 'In-site queue', ... },
     ...
   ]
   ```
2. Remove the entire `<section className="spaces-section">` at the bottom of the JSX (lines 77–90):
   ```jsx
   /* REMOVE THIS ENTIRE SECTION */
   <section className="spaces-section">
     <div className="spaces-heading">
       <div><span className="eyebrow">Your clinic</span><h2>Choose a workspace</h2>...</div>
     </div>
     <div className="space-card-grid">...</div>
   </section>
   ```
3. Keep the hero, `today-glance`, and `<DailyWorklist />` intact. This elevates `DailyWorklist` to the bottom anchor of the screen, creating a clean operational cockpit.

---

## 8. Spacing Hierarchy & /reports Alignment Fix

### The Benchmark Bug: `/reports` Complete Clinical History Card
In `src/pages/Admin.jsx` (lines 66–70):
```jsx
<SectionCard key={id} className="report-card">
  <div className="report-icon"><Icon size={23} /></div>
  <h2>{title}</h2>
  <p>{description}</p>
  <span>{format}</span>
  {id === 'history' && (
    <label className="field">
      <span>Patient</span>
      <select ...>...</select>
    </label>
  )}
  <button className="button button-secondary" ...>Prepare report</button>
</SectionCard>
```

**What's broken:**
- Inside `.report-card`, there is no layout wrapper around the input and button.
- The label "Patient", the select box, and the "Prepare report" button sit directly on top of each other with 0px margin, creating a cramped, broken appearance.

### Fixed Structure in `src/pages/Admin.jsx`
```jsx
<SectionCard key={id} className="report-card">
  <div className="report-icon"><Icon size={23} /></div>
  <h2>{title}</h2>
  <p className="report-desc">{description}</p>
  <span className="report-format-pill">{format}</span>
  
  <div className="report-card-footer">
    {id === 'history' && (
      <div className="report-patient-picker">
        <label className="field-label" htmlFor="report-patient-select">Patient</label>
        <VeterinaSelect
          id="report-patient-select"
          value={patientId}
          onChange={setPatientId}
          searchable
          searchPlaceholder="Search pet or record #..."
          placeholder="Select patient..."
          options={pets.map((p) => ({ value: p.id, label: `${p.name} · ${p.recordNumber}` }))}
        />
      </div>
    )}
    <button
      className="button button-secondary report-action-btn"
      disabled={Boolean(busy) || (id === 'history' && !patientId) || (['vaccinations','reminders'].includes(id) && Boolean(invalidDates))}
      onClick={() => prepare(id)}
    >
      {busy === id ? 'Preparing...' : 'Prepare report'}
    </button>
  </div>
</SectionCard>
```

### Accompanying CSS in `src/index.css`
```css
.report-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-subtle);
}
.report-desc {
  flex-grow: 1; /* Pushes the controls and button to the bottom */
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}
.report-format-pill {
  display: inline-block;
  margin-bottom: 18px;
  color: var(--brand-ink);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.report-card-footer {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: auto; /* Snaps cleanly to the bottom of the card */
  padding-top: 14px;
  border-top: 1px solid light-dark(#f0f3f1, var(--line));
}
.report-patient-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.report-patient-picker .field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.report-action-btn {
  width: 100%;
  justify-content: center;
}
```

---

## 9. Custom Accessible Checkboxes

### Component: `src/components/VeterinaCheckbox.jsx`
```jsx
import { Check } from '@phosphor-icons/react'
import './VeterinaCheckbox.css'

export default function VeterinaCheckbox({
  checked,
  onChange,
  label,
  name,
  disabled = false,
  className = '',
}) {
  return (
    <label className={`vt-checkbox-label ${disabled ? 'is-disabled' : ''} ${className}`}>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked, e)}
        className="vt-checkbox-native sr-only"
      />
      <span className={`vt-checkbox-box ${checked ? 'is-checked' : ''}`} aria-hidden="true">
        {checked && <Check size={13} weight="bold" className="vt-check-icon" />}
      </span>
      {label && <span className="vt-checkbox-text">{label}</span>}
    </label>
  )
}
```

### Styling: `src/components/VeterinaCheckbox.css`
```css
.vt-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
  user-select: none;
}
.vt-checkbox-label.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.vt-checkbox-native.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.vt-checkbox-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border: 1.5px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  transition: all var(--transition-snappy);
}
.vt-checkbox-label:hover .vt-checkbox-box {
  border-color: var(--brand-ink);
}
.vt-checkbox-native:focus-visible + .vt-checkbox-box {
  outline: 2px solid var(--brand-ink);
  outline-offset: 2px;
}
.vt-checkbox-box.is-checked {
  background: var(--brand-ink);
  border-color: var(--brand-ink);
}
.vt-check-icon {
  color: #ffffff;
  animation: vtCheckPop 140ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes vtCheckPop {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
```

---

## 10. Patient Records: Quick Skim vs Detailed Mode

### Motivation & Requirement
When looking through a patient's historical records on `/patients/:petId`, staff frequently only need to skim dates and key diagnoses (like checking an index card folder) rather than reading full paragraphs of SOAP notes and prescription tables.

### Solution Design
1. Provide a view toggle in the history header: **`[ Detailed View ]`** vs **`[ Quick Skim ]`**.
2. In **Quick Skim Mode**:
   - Renders low-density, tactile folder cards (`.skim-folder-card`).
   - Displays Date, Diagnosis/Chief Complaint, Attending Vet, and subtle badges.
   - Clicking a card opens a modal (`<VisitDetailModal />`) with the full SOAP observations, vitals, prescriptions, and correction notes.
3. In **Detailed Mode**:
   - Retains the full inline `VisitCard` expansion.

### Implementation in `src/pages/PetDetail.jsx`
```jsx
// Add view mode state
const [skimMode, setSkimMode] = useState(false)
const [skimActiveVisit, setSkimActiveVisit] = useState(null)

// In the Clinical History tab header:
<div className="history-view-controls">
  <ClinicalHistoryFilters ... />
  <div className="skim-toggle-group">
    <button
      type="button"
      className={`view-toggle-btn ${!skimMode ? 'active' : ''}`}
      onClick={() => setSkimMode(false)}
      title="Detailed clinical records"
    >
      <Rows size={16} /> Detailed
    </button>
    <button
      type="button"
      className={`view-toggle-btn ${skimMode ? 'active' : ''}`}
      onClick={() => setSkimMode(true)}
      title="Quick skim folder cards"
    >
      <FolderSimple size={16} /> Quick Skim
    </button>
  </div>
</div>

// Inside the clinical-timeline container:
{skimMode ? (
  <div className="skim-card-list">
    {visibleVisits.map((visit) => (
      <div
        key={visit.historyKey}
        className="skim-folder-card"
        onClick={() => setSkimActiveVisit(visit)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setSkimActiveVisit(visit)}
      >
        <div className="skim-folder-tab">
          <CalendarBlank size={15} />
          <span>{format(parseISO(visit.visitedAt), 'd MMM yyyy')}</span>
        </div>
        <div className="skim-main">
          <div className="skim-headline">
            <Badge tone="blue">{visit.type}</Badge>
            <strong>{visit.diagnosis || visit.complaint || 'General Checkup'}</strong>
            {visit.weightKg && <span className="skim-vital-chip">{visit.weightKg} kg</span>}
          </div>
          <span className="skim-vet">{visit.veterinarian}</span>
        </div>
        <CaretRight size={16} className="skim-chevron" />
      </div>
    ))}
  </div>
) : (
  /* Existing full-detail VisitCard layout */
  visibleVisits.map((visit) => <VisitCard ... />)
)}

{/* Modal for Quick Skim inspection */}
{skimActiveVisit && (
  <Modal
    title={`Clinical Record · ${format(parseISO(skimActiveVisit.visitedAt), 'd MMMM yyyy')}`}
    description={`${skimActiveVisit.type} by ${skimActiveVisit.veterinarian}`}
    onClose={() => setSkimActiveVisit(null)}
    wide
  >
    <div className="skim-modal-content">
      {/* Renders full vitals, SOAP observations, and prescriptions inside modal */}
    </div>
  </Modal>
)}
```

### Accompanying Styling in `src/pages/PetDetail.css`
```css
.skim-toggle-group {
  display: inline-flex;
  padding: 3px;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.view-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all var(--transition-snappy);
}
.view-toggle-btn.active {
  background: var(--surface);
  color: var(--brand-ink);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.skim-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.skim-folder-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-left: 4px solid var(--brand-ink);
  border-radius: var(--radius-sm);
  cursor: pointer;
  box-shadow: var(--shadow-subtle);
  transition: transform var(--transition-snappy), box-shadow var(--transition-snappy), border-color var(--transition-snappy);
}
.skim-folder-card:hover {
  transform: translateY(-1px);
  border-color: var(--brand-border);
  box-shadow: var(--shadow-card);
}
.skim-folder-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.skim-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.skim-headline {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.skim-vital-chip {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--muted);
  font-size: 12px;
}
.skim-vet {
  font-size: 13px;
  color: var(--muted);
}
.skim-chevron {
  color: var(--muted);
}
```

---

## 11. Patients & Owners Layout Polish

### Objectives
- Upgrade `/patients` to feel personalized to the clinic (using `settings.brand_color` or custom accents).
- Provide quick contact triggers for staff without navigating away.
- Modernize the table row with clean metadata badge groups.

### Key Refinements in `src/pages/Patients.jsx`
1. **Quick Call & SMS Pills:** Next to the owner's phone number, display micro action buttons (`tel:` link with phone icon).
2. **Species-specific Sticker Frame:** Enhance `PetSticker` with a subtle species badge overlay.
3. **Multi-tag Alert Pills:** Clean up allergy and behavioral alert badges so they don't wrap awkwardly.
4. **Header Accent Bar:** Render a fine clinic-brand color bar across the top of `.patient-table` for personalized identity.

---

## 12. Elevated System-Wide Card Treatment

To eliminate the "AI generic" feel across all cards in the system:

```css
/* System-wide card elevation */
.section-card {
  border: 1px solid color-mix(in srgb, var(--brand-ink, #2a6f62) 10%, var(--line));
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-subtle);
  transition: box-shadow 200ms ease, border-color 200ms ease;
}

.section-card:hover {
  box-shadow: var(--shadow-card);
}

.section-header {
  padding-bottom: 14px;
  border-bottom: 1px solid light-dark(#f1f4f2, var(--line));
  margin-bottom: 18px;
}
.section-header h2 {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: var(--ink);
}
```

---

## 13. Suppliers Directory Redesign

### Requirements
The suppliers list on `/suppliers` (`export function Suppliers` in `src/pages/Stock.jsx`) should look like an executive purchasing portal — informative, crisp, and high-utility without visual clutter.

### Redesigned Layout (`src/pages/Stock.jsx`)
```jsx
<div className="supplier-grid">
  {filtered.map((supplier) => {
    const linkedItems = inventory.filter((item) => item.supplierIds.includes(supplier.id))
    return (
      <div key={supplier.id} className="supplier-executive-card">
        <div className="supplier-top">
          <div className="supplier-avatar">
            <Truck size={22} weight="duotone" />
          </div>
          <div className="supplier-identity">
            <h3>{supplier.name}</h3>
            <span className="contact-person">{supplier.contactPerson || 'General Contact'}</span>
          </div>
          <Badge tone={supplier.isActive ? 'success' : 'neutral'}>
            {supplier.isActive ? 'Active' : 'Archived'}
          </Badge>
        </div>

        <div className="supplier-quick-actions">
          <a href={`tel:${supplier.phone.replace(/\s/g, '')}`} className="action-pill">
            <Phone size={14} weight="bold" /> {supplier.phone}
          </a>
          {supplier.email && (
            <a href={`mailto:${supplier.email}`} className="action-pill">
              <EnvelopeSimple size={14} weight="bold" /> Email
            </a>
          )}
          {supplier.address && (
            <span className="action-pill text-muted" title={supplier.address}>
              <MapPin size={14} /> {supplier.address}
            </span>
          )}
        </div>

        {supplier.notes && (
          <div className="supplier-notes-box">
            <Notepad size={14} />
            <p>{supplier.notes}</p>
          </div>
        )}

        <div className="supplier-inventory-preview">
          <div className="preview-label">
            <span>Linked supplies</span>
            <strong>{linkedItems.length} items</strong>
          </div>
          <div className="preview-chips">
            {linkedItems.slice(0, 3).map((item) => (
              <span key={item.id} className="item-chip">
                {item.name}
              </span>
            ))}
            {linkedItems.length > 3 && (
              <span className="item-chip more-chip">+{linkedItems.length - 3} more</span>
            )}
            {linkedItems.length === 0 && <span className="no-items">No items linked yet</span>}
          </div>
        </div>

        <div className="supplier-card-footer">
          <Link className="button button-secondary small-button" to={`/inventory?supplierId=${encodeURIComponent(supplier.id)}`}>
            Manage inventory
          </Link>
          <button className="button button-secondary small-button" onClick={() => setModal({ type: 'edit', record: supplier })}>
            Edit details
          </button>
        </div>
      </div>
    )
  })}
</div>
```

---

## 14. Implementation & Verification Checklist

Follow this checklist during your coding session:

- [ ] **Step 1: Install & Set Up Floating UI**
  - Run `npm install @floating-ui/react`
  - Build `VeterinaSelect.jsx` and `VeterinaSelect.css`
  - Replace `<select>` elements in `ScheduleTasks.jsx`, `Admin.jsx`, and `Patients.jsx`

- [ ] **Step 2: Squashed Bug on /appointments**
  - Verify `.table-search` container in `ScheduleTasks.jsx`
  - Ensure search placeholder text is no longer truncated or overlapping labels

- [ ] **Step 3: Implement Custom Mascot Error Suite**
  - Add `ErrorViews.jsx` and `ErrorViews.css`
  - Update `src/App.jsx` router with root `errorElement` and 404 wildcard route

- [ ] **Step 4: Functional Header Notification Bell**
  - Wire today's appointment schedule count in `AppShell.jsx`
  - Build dropdown popover with today's appointments and task actions

- [ ] **Step 5: Add Page & Workspace Transitions**
  - Wrap `<Outlet />` with keyed `.workspace-page-transition`
  - Add `@keyframes workspaceFadeIn` with `prefers-reduced-motion` override

- [ ] **Step 6: Dashboard Cleanup**
  - Delete `spaces` array and `<section className="spaces-section">` in `Dashboard.jsx`

- [ ] **Step 7: Normalise Spacing & Fix /reports History Card**
  - Wrap controls in `.report-card-footer` inside `Admin.jsx`
  - Verify consistent margins between label, select, and button

- [ ] **Step 8: Custom Branded Checkboxes**
  - Create `VeterinaCheckbox.jsx` and style with SVG checkpop animation
  - Replace generic checkboxes in `Admin.jsx` and `Stock.jsx`

- [ ] **Step 9: Patient History Quick Skim Mode**
  - Add folder-style skim card layout in `PetDetail.jsx`
  - Wire detailed inspection modal on card click

- [ ] **Step 10: Revamp Suppliers Page**
  - Rebuild supplier cards in `Stock.jsx` with quick action pills and linked item chips

- [ ] **Step 11: Final Regression Testing**
  - Run `npm run test` or `npm run dev`
  - Verify that mobile viewports remain responsive and keyboard navigation operates cleanly.

