# Daily workflow improvements

Implemented as three connected features using existing saved clinic records.

## Patient care timeline

Open a patient and choose **Care timeline**, or follow a patient link from the
daily action board. The shareable `?tab=timeline` URL keeps this view on reload.
Appointments, arrivals, care drafts, queue outcomes, checkups, vaccinations,
prescriptions, corrections, reminders and reminder activity appear by clinic date,
latest first. A filter narrows the activity type. Large histories initially show
25 activities; **Show more activity** adds another 25 without discarding records.
Existing clinical history remains the default patient view.

**View source** opens the original record, its date/status filter, and the correct
patient tab. Terminal and historical records remain available. Date-only vaccine
records retain their recorded clinic date; timestamps use the clinic timezone.
The timeline describes saved activity and does not create or modify clinical rows.

## Daily action board

The dashboard shows four lists, with up to five entries each and links to the
full workspaces. In-progress care appears first, then waiting patients by arrival.
Elapsed arrival time includes overnight arrivals and is not an estimated waiting
time. Eligible check-ins show today's active-patient bookings without an existing
arrival. Calls show overdue/due open reminders in due-date order, with owner phone
links when a number is available. Opening a task navigates to its source screen;
staff use the existing saved forms to perform and complete the work.

The dashboard refreshes saved records every 30 seconds while visible. Counts and
lists also recalculate with the shared provider, refresh controls, and clinic clock.
Queue polling continues in the queue workspace.
An empty list states that no work currently matches.

## Stock watch

The dashboard surfaces active items with expired stocked batches, a balance at or
below the minimum, or stocked batches expiring within 30 calendar days. Every
batch is checked; a depleted lot does not create an alert, and an expired lot
does not hide another lot nearing expiry. Expiry today is included in the
expiring-soon list; dates before today are expired. Expired stock appears first,
then stock at/below minimum, then other upcoming expiries.

**Review item** opens the exact inventory record. **Supplier contact** opens its
supplier card. Inventory adds a shareable `attention` filter: `all`, `low`,
`expired`, or `expiring`, compatible with the existing supplier/category filters.
This is a review list; it does not place orders or move stock automatically.

## Acceptance

Unit tests cover patient isolation, complete event projection, clinic-date and
timestamp ordering, source links, terminal states, overnight work and expiry
boundaries. Browser checks cover the board, historical/source navigation, reload,
pagination, empty states, stock filters, keyboard focus and mobile layouts. The
isolated database browser journey checks the timeline against actually saved care
and confirms completed work and replenished stock leave the dashboard work lists.
