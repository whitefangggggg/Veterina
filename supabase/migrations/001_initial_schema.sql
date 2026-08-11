-- Veterina: initial clinic schema
-- Staff-only system for one Philippine veterinary clinic.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.staff_role as enum ('owner', 'clinical_staff');
create type public.appointment_status as enum ('pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show');
create type public.reminder_status as enum ('upcoming', 'due', 'overdue', 'completed', 'snoozed', 'cancelled');
create type public.stock_movement_type as enum ('stock_in', 'stock_out', 'adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.staff_role not null default 'clinical_staff',
  job_title text not null default 'Clinical staff',
  phone text,
  prc_license_number text,
  ptr_number text,
  license_expires_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinic_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_name text not null default 'Veterina Veterinary Clinic',
  phone text,
  email text,
  address text,
  timezone text not null default 'Asia/Manila',
  record_retention_years integer not null default 10 check (record_retention_years between 1 and 50),
  reminder_lead_days integer not null default 3 check (reminder_lead_days between 0 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  address text not null default '',
  emergency_contact text,
  notes text not null default '',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.owner_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  full_name text not null,
  relationship text,
  phone text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create sequence public.pet_record_number_seq start 1;

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete restrict,
  record_number text not null unique default (
    'VET-' || extract(year from current_date)::text || '-' ||
    lpad(nextval('public.pet_record_number_seq')::text, 5, '0')
  ),
  name text not null,
  species text not null,
  breed text not null default '',
  sex text not null check (sex in ('Male', 'Female', 'Unknown')),
  reproductive_status text not null default 'Unknown'
    check (reproductive_status in ('Intact', 'Neutered', 'Spayed', 'Unknown')),
  birth_date date,
  birth_date_estimated boolean not null default false,
  color_markings text,
  microchip_number text unique,
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Deceased')),
  photo_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pet_alerts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  alert_type text not null check (alert_type in ('allergy', 'medical', 'behavior', 'other')),
  description text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete restrict,
  appointment_id uuid,
  visited_at timestamptz not null default now(),
  visit_type text not null,
  chief_complaint text not null,
  subjective text not null default '',
  objective text not null default '',
  assessment text not null default '',
  plan text not null default '',
  diagnosis_summary text not null default '',
  attending_veterinarian_id uuid references public.profiles(id),
  recorded_by uuid not null references public.profiles(id),
  finalized_at timestamptz,
  finalized_by uuid references public.profiles(id),
  follow_up_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.visit_vitals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.visits(id) on delete cascade,
  weight_kg numeric(7,2) check (weight_kg > 0),
  temperature_c numeric(4,1) check (temperature_c between 30 and 45),
  heart_rate_bpm integer check (heart_rate_bpm > 0),
  respiratory_rate_rpm integer check (respiratory_rate_rpm > 0),
  body_condition_score integer check (body_condition_score between 1 and 9),
  hydration text,
  mucous_membranes text,
  capillary_refill_seconds numeric(3,1),
  pain_score integer check (pain_score between 0 and 10),
  notes text not null default '',
  measured_at timestamptz not null default now(),
  measured_by uuid not null references public.profiles(id)
);

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  description text not null,
  code text,
  status text not null default 'active' check (status in ('suspected', 'active', 'resolved')),
  created_at timestamptz not null default now()
);

create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  name text not null,
  details text not null default '',
  performed_at timestamptz not null default now(),
  performed_by uuid references public.profiles(id)
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  medication_name text not null,
  strength text,
  dose text not null,
  route text,
  frequency text not null,
  duration text,
  quantity numeric(10,2),
  instructions text not null default '',
  prescribed_by uuid not null references public.profiles(id),
  prescribed_at timestamptz not null default now()
);

create table public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete set null,
  vaccine_name text not null,
  manufacturer text,
  lot_number text not null,
  dose text,
  route text,
  administered_at date not null,
  next_due_at date,
  administered_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete set null,
  file_name text not null,
  storage_path text not null unique,
  content_type text,
  size_bytes bigint check (size_bytes >= 0),
  category text not null default 'other',
  description text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_duration_minutes integer not null default 30 check (default_duration_minutes between 5 and 720),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete restrict,
  service_type_id uuid references public.service_types(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'confirmed',
  veterinarian_id uuid references public.profiles(id),
  notes text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.appointments
  add constraint appointments_veterinarian_no_overlap
  exclude using gist (
    veterinarian_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'arrived', 'in_progress'));

alter table public.visits
  add constraint visits_appointment_fk foreign key (appointment_id)
  references public.appointments(id) on delete set null;

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  vaccination_id uuid references public.vaccinations(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('appointment', 'follow_up', 'vaccination', 'medication', 'custom')),
  title text not null,
  notes text not null default '',
  due_at timestamptz not null,
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  status public.reminder_status not null default 'upcoming',
  assigned_to uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reminder_activity (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  action text not null,
  note text,
  performed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text not null,
  email text,
  address text,
  ordering_notes text not null default '',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null,
  unit text not null,
  minimum_stock numeric(12,2) not null default 0 check (minimum_stock >= 0),
  is_controlled boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.item_suppliers (
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_item_code text,
  unit_cost numeric(12,2) check (unit_cost >= 0),
  is_preferred boolean not null default false,
  primary key (item_id, supplier_id)
);

create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  lot_number text,
  expiration_date date,
  received_at date not null default current_date,
  unit_cost numeric(12,2) check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  batch_id uuid references public.inventory_batches(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete set null,
  movement_type public.stock_movement_type not null,
  quantity_delta numeric(12,2) not null check (quantity_delta <> 0),
  reason text not null,
  reference text,
  performed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create view public.inventory_on_hand
with (security_invoker = true)
as
select
  i.id,
  i.sku,
  i.name,
  i.category,
  i.unit,
  i.minimum_stock,
  coalesce(sum(m.quantity_delta), 0) as quantity_on_hand,
  min(b.expiration_date) filter (
    where b.expiration_date >= current_date
  ) as nearest_expiration
from public.inventory_items i
left join public.inventory_movements m on m.item_id = i.id
left join public.inventory_batches b on b.id = m.batch_id
group by i.id;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index owners_name_idx on public.owners using gin (to_tsvector('simple', full_name));
create index owners_phone_idx on public.owners(phone);
create index pets_owner_idx on public.pets(owner_id);
create index pets_name_idx on public.pets using gin (to_tsvector('simple', name));
create index visits_pet_date_idx on public.visits(pet_id, visited_at desc);
create index vaccinations_pet_due_idx on public.vaccinations(pet_id, next_due_at);
create index appointments_start_idx on public.appointments(starts_at, status);
create index reminders_due_idx on public.reminders(status, due_at);
create index inventory_movements_item_idx on public.inventory_movements(item_id, created_at desc);
create index inventory_batches_expiry_idx on public.inventory_batches(expiration_date);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id, created_at desc);

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_clinic_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_active = true);
$$;

create or replace function public.is_clinic_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_staff_role() = 'owner';
$$;

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_clinic_owner() and (
    new.role is distinct from old.role or
    new.is_active is distinct from old.is_active or
    new.prc_license_number is distinct from old.prc_license_number
  ) then
    raise exception 'Only the clinic owner may change staff access or professional credentials';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
before update on public.profiles
for each row execute function public.prevent_role_escalation();

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id::text, old.id::text),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_pets after insert or update or delete on public.pets
for each row execute function public.write_audit_log();
create trigger audit_visits after insert or update or delete on public.visits
for each row execute function public.write_audit_log();
create trigger audit_vaccinations after insert or update or delete on public.vaccinations
for each row execute function public.write_audit_log();
create trigger audit_inventory_movements after insert or update or delete on public.inventory_movements
for each row execute function public.write_audit_log();

create or replace function public.create_vaccine_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.next_due_at is not null then
    insert into public.reminders (
      pet_id, vaccination_id, reminder_type, title, due_at, created_by
    ) values (
      new.pet_id,
      new.id,
      'vaccination',
      new.vaccine_name || ' due',
      (new.next_due_at::timestamp at time zone 'Asia/Manila'),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger vaccinations_create_reminder
after insert on public.vaccinations
for each row execute function public.create_vaccine_reminder();

create or replace function public.record_inventory_movement(
  p_item_id uuid,
  p_batch_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_reference text default null,
  p_visit_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
  v_id uuid;
begin
  if not public.is_clinic_staff() then raise exception 'Not authorized'; end if;
  if p_quantity_delta = 0 then raise exception 'Quantity cannot be zero'; end if;

  perform 1 from public.inventory_items where id = p_item_id for update;
  select coalesce(sum(quantity_delta), 0) into v_current
  from public.inventory_movements where item_id = p_item_id;

  if v_current + p_quantity_delta < 0 then
    raise exception 'Insufficient stock';
  end if;

  insert into public.inventory_movements (
    item_id, batch_id, visit_id, movement_type, quantity_delta, reason, reference, performed_by
  ) values (
    p_item_id,
    p_batch_id,
    p_visit_id,
    case when p_quantity_delta > 0 then 'stock_in' else 'stock_out' end,
    p_quantity_delta,
    p_reason,
    p_reference,
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_inventory_movement(uuid, uuid, numeric, text, text, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.clinic_settings enable row level security;
alter table public.owners enable row level security;
alter table public.owner_contacts enable row level security;
alter table public.pets enable row level security;
alter table public.pet_alerts enable row level security;
alter table public.visits enable row level security;
alter table public.visit_vitals enable row level security;
alter table public.diagnoses enable row level security;
alter table public.treatments enable row level security;
alter table public.prescriptions enable row level security;
alter table public.vaccinations enable row level security;
alter table public.attachments enable row level security;
alter table public.service_types enable row level security;
alter table public.appointments enable row level security;
alter table public.reminders enable row level security;
alter table public.reminder_activity enable row level security;
alter table public.suppliers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.item_suppliers enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.audit_logs enable row level security;

create policy "staff read profiles" on public.profiles for select using (public.is_clinic_staff());
create policy "self update profile" on public.profiles for update using (id = auth.uid() or public.is_clinic_owner()) with check (id = auth.uid() or public.is_clinic_owner());
create policy "owner manages profiles" on public.profiles for all using (public.is_clinic_owner()) with check (public.is_clinic_owner());
create policy "staff read settings" on public.clinic_settings for select using (public.is_clinic_staff());
create policy "owner manages settings" on public.clinic_settings for all using (public.is_clinic_owner()) with check (public.is_clinic_owner());
create policy "owner reads audit" on public.audit_logs for select using (public.is_clinic_owner());

-- Operational tables are available to authenticated active clinic staff.
create policy "staff manage owners" on public.owners for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage owner contacts" on public.owner_contacts for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage pets" on public.pets for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage pet alerts" on public.pet_alerts for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage visits" on public.visits for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage vitals" on public.visit_vitals for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage diagnoses" on public.diagnoses for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage treatments" on public.treatments for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage prescriptions" on public.prescriptions for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage vaccinations" on public.vaccinations for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage attachments" on public.attachments for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff read services" on public.service_types for select using (public.is_clinic_staff());
create policy "owner manages services" on public.service_types for all using (public.is_clinic_owner()) with check (public.is_clinic_owner());
create policy "staff manage appointments" on public.appointments for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage reminders" on public.reminders for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage reminder activity" on public.reminder_activity for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage suppliers" on public.suppliers for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage inventory items" on public.inventory_items for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage item suppliers" on public.item_suppliers for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff manage batches" on public.inventory_batches for all using (public.is_clinic_staff()) with check (public.is_clinic_staff());
create policy "staff read movements" on public.inventory_movements for select using (public.is_clinic_staff());
create policy "staff insert movements" on public.inventory_movements for insert with check (public.is_clinic_staff() and performed_by = auth.uid());

insert into public.clinic_settings (clinic_name, timezone)
values ('Veterina Veterinary Clinic', 'Asia/Manila');

insert into public.service_types (name, default_duration_minutes) values
  ('Wellness check', 30),
  ('Vaccination', 20),
  ('Follow-up', 20),
  ('Dental consultation', 30),
  ('Procedure', 60),
  ('Emergency', 30);

insert into storage.buckets (id, name, public)
values ('pet-photos', 'pet-photos', false), ('medical-attachments', 'medical-attachments', false)
on conflict (id) do nothing;

create policy "staff read clinic files" on storage.objects for select
using (bucket_id in ('pet-photos', 'medical-attachments') and public.is_clinic_staff());
create policy "staff upload clinic files" on storage.objects for insert
with check (bucket_id in ('pet-photos', 'medical-attachments') and public.is_clinic_staff());
create policy "owner deletes clinic files" on storage.objects for delete
using (bucket_id in ('pet-photos', 'medical-attachments') and public.is_clinic_owner());
