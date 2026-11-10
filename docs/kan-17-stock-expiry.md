# KAN-17: stock expiry warnings

KAN-17 requests dashboard warnings when stocks approach their expiration dates.
The existing stock watch already detected expiry within 30 days, but its two-item
priority list could conceal those warnings behind shortages. Inventory also used
a conflicting 90-day summary based only on each item's earliest batch.

## Behavior

- Use one shared **30 calendar-day** window, inclusive of today and day 30, based
  on the configured clinic date. Today's expiry is upcoming, not already expired.
- Warn per stocked batch. Skip empty/depleted lots, absent/invalid expiry dates
  and archived items. An archived batch with a positive balance still represents
  held stock and remains visible until its stock is disposed of or depleted.
- Keep expired and upcoming batch counts visible at the top of dashboard stock
  watch, independently of its two prioritized item rows. Each count links to the
  corresponding Inventory attention filter.
- Add expiry warnings to the notification bell and its count. List the three
  earliest affected lots first, including product, lot, remaining quantity, expiry
  date and relative timing. A link opens all expiry warnings without shortages.
- Batch links select the relevant Inventory attention filter, reset conflicting
  local search/category filters, expand the batch ledger, and focus the exact lot.
  Reloading the link preserves that destination. Other Inventory filters retain
  their existing behavior.
- Inventory uses the same 30-day classification for its item count, attention
  filters, item badges and batch badges. An item with both expired and upcoming
  batches displays both conditions and counts in both appropriate categories.

The bell counts batches; Inventory statistics count affected items. Date arithmetic
uses date-only UTC boundaries to avoid browser-timezone and daylight-saving shifts.
Existing provider clock ticks update classifications at clinic midnight; dashboard
polling, ordinary refresh and successful stock mutations refresh ledger quantities.
There is no notification dismissal state: warnings disappear when their stock or
expiry no longer meets the criteria.

## Access and delivery

These are in-app warnings for clinic owners and approved clinical staff, using the
same authorized Inventory dataset. No extra access, database migration, Edge
Function, scheduled job, email or push-notification delivery is added. KAN-17 is
implemented in the local frontend source; it does not require a Demo database
deployment or imply a hosted frontend rollout.

## Verification

- `npm test`: 281 tests passed, including day 0/day 1/day 30/day 31 boundaries,
  archived/depleted/invalid lots, fractional quantities and midnight/DST behavior.
- `npm run test:stock-expiry`: intercepted browser acceptance for warnings beyond
  two stockouts, notification counts/order, exact-lot links/reload/filter recovery,
  mixed expired/upcoming lots, depleted-warning removal, owner/staff visibility
  and clinic-local midnight. Includes 320/375/768/1440px in light/dark mode.
- Existing dashboard, Inventory and UI refinement browser suites passed. The aggregate runner
  includes the new expiry suite.
- Production build and lint passed, with the existing unused `icons` lint warning
  in `scripts/create-clinic-infographic.mjs`.

Screenshots: `test-artifacts.local/stock-expiry-*.png`. Browser checks use synthetic
fixtures and intercept all API calls; they do not create hosted clinical records.
