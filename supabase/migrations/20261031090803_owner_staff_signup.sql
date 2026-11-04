-- Capture owner signup intent once, before user-editable metadata can change.
-- This table is private and has no browser grants or RLS policies.
create table private.owner_registrations (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check(length(btrim(full_name)) between 1 and 120),
  clinic_name text not null check(length(btrim(clinic_name)) between 1 and 160),
  clinic_id uuid references public.clinics(id),
  requested_at timestamptz not null default now()
);
create index owner_registrations_clinic on private.owner_registrations(clinic_id);
alter table private.owner_registrations enable row level security;
revoke all on private.owner_registrations from public, anon, authenticated;

-- Existing Auth triggers call this private, non-callable trigger function.
-- Owner selection creates only a NEW clinic, never ownership in a chosen clinic.
-- Provisioning waits for trusted Auth email confirmation, including signup when
-- confirmations are disabled. Later metadata edits cannot change signup intent.
create or replace function private.register_veterina_staff() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  clinic uuid;
  full_name text;
  account_type text;
  registration private.owner_registrations;
begin
  if tg_op='INSERT' then
    if new.raw_user_meta_data->>'application' is distinct from 'veterina' then return new; end if;
    full_name := btrim(coalesce(new.raw_user_meta_data->>'full_name',''));
    if length(full_name) not between 1 and 120 then raise exception 'VALIDATION_FAILED: full name required'; end if;
    account_type := coalesce(new.raw_user_meta_data->>'account_type','staff');
    if account_type='owner' then
      if length(btrim(coalesce(new.raw_user_meta_data->>'clinic_name',''))) not between 1 and 160 then
        raise exception 'VALIDATION_FAILED: clinic name required';
      end if;
      insert into private.owner_registrations(id,full_name,clinic_name)
        values(new.id,full_name,btrim(new.raw_user_meta_data->>'clinic_name'));
    elsif account_type='staff' then
      select k.clinic_id into clinic from private.clinic_codes k join public.clinics c on c.id=k.clinic_id
        where k.code=private.normalized_veterina_code(new.raw_user_meta_data->>'veterina_code') and c.is_active;
      if clinic is null then raise exception 'INVALID_VETERINA_CODE: use a current code from your shop owner'; end if;
      insert into private.staff_join_requests(id,clinic_id,full_name,email,email_confirmed)
        values(new.id,clinic,full_name,coalesce(new.email,''),new.email_confirmed_at is not null);
    else
      raise exception 'VALIDATION_FAILED: choose owner or staff';
    end if;
  else
    update private.staff_join_requests set email=coalesce(new.email,''),email_confirmed=new.email_confirmed_at is not null where id=new.id;
  end if;

  if new.email_confirmed_at is not null then
    select * into registration from private.owner_registrations where id=new.id for update;
    if found and registration.clinic_id is null and not exists(select 1 from public.profiles where id=new.id) then
      clinic := public.provision_vetshop(new.id,registration.clinic_name,registration.full_name,'Asia/Manila');
      update private.owner_registrations set clinic_id=clinic where id=new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.register_veterina_staff() from public,anon,authenticated;
