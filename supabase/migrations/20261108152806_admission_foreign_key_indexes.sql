-- Cover admission foreign-key lookups without changing existing clinical data.
-- These indexes address the new module's hosted performance-advisor findings.
create index admission_administrations_batch on public.admission_administrations(batch_id);
create index admission_administrations_clinic on public.admission_administrations(clinic_id);
create index admission_administrations_item on public.admission_administrations(inventory_item_id);
create index admission_administrations_order on public.admission_administrations(order_id);
create index admission_administrations_author on public.admission_administrations(recorded_by);
create index admission_discharge_clinic on public.admission_discharge_summaries(clinic_id);
create index admission_discharge_author on public.admission_discharge_summaries(created_by);
create index admission_events_clinic on public.admission_events(clinic_id);
create index admission_events_author on public.admission_events(recorded_by);
create index admission_observations_clinic on public.admission_observations(clinic_id);
create index admission_observations_author on public.admission_observations(recorded_by);
create index admission_occupancy_assigner on public.admission_occupancy(assigned_by);
create index admission_occupancy_releaser on public.admission_occupancy(released_by);
create index admission_orders_clinic on public.admission_orders(clinic_id);
create index admission_orders_item on public.admission_orders(inventory_item_id);
create index admission_orders_author on public.admission_orders(ordered_by);
create index admission_tasks_clinic on public.admission_tasks(clinic_id);
create index admissions_author on public.admissions(created_by);
create index admissions_pet on public.admissions(pet_id);
