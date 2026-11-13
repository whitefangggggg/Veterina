# KAN-28 — preventive-care vitals and condition

Vaccination and deworming records now include optional Weight, Temperature,
Heart rate, Respiratory rate, Body condition (1–5), and Hydration fields. The
hydration choices match checkups: Normal, Mild dehydration, Moderate dehydration,
and Severe dehydration. No value is preselected or saved when it was not
recorded.

One set of observations belongs to a vaccination group, regardless of how many
vaccine items it contains. A deworming administration has its own set. Values
are saved with the preventive record in the same authorized mutation as its
existing care workflow. Drafts and historical record-only entries preserve
partial values without creating queue, reminder, or stock effects. Older rows
without vitals remain blank. Record detail and unified patient history show
saved values and units, including the staff member who recorded them.

The new `preventive_record_vitals` table is clinic-scoped, read-only to approved
clinic staff, writable through `portal_mutation`, and audited with before/after
snapshots. Weight and temperature must be positive decimals; heart and
respiratory rates must be positive whole numbers; body condition must be 1–5;
hydration must use the checkup options. Existing vaccination inventory, batch,
dose, due-date, and completion behavior is unchanged.

## Migration and verification

Apply `supabase/migrations/20261113125359_preventive_record_vitals.sql` before
releasing the matching frontend. The migration creates the clinic-scoped table
and adds vitals persistence to the existing atomic preventive-care and draft
paths.

Coverage is in `supabase/tests/preventive_care.sql` and
`src/lib/preventiveCare.test.js`: grouped/partial/blank/historical values,
precision, draft retention, invalid ranges, tenant isolation, history projection,
and audited corrections.
