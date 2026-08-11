-- Veterina: record integrity and lifecycle hardening
-- Clinical staff may operate records but only the owner may permanently delete them.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger clinic_settings_set_updated_at before update on public.clinic_settings
for each row execute function public.set_updated_at();
create trigger owners_set_updated_at before update on public.owners
for each row execute function public.set_updated_at();
create trigger pets_set_updated_at before update on public.pets
for each row execute function public.set_updated_at();
create trigger visits_set_updated_at before update on public.visits
for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
for each row execute function public.set_updated_at();
create trigger reminders_set_updated_at before update on public.reminders
for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger inventory_items_set_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

create or replace function public.owner_only_permanent_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_clinic_owner() then
    raise exception 'Only the clinic owner may permanently delete clinic records';
  end if;
  return old;
end;
$$;

create trigger owners_owner_only_delete before delete on public.owners
for each row execute function public.owner_only_permanent_delete();
create trigger pets_owner_only_delete before delete on public.pets
for each row execute function public.owner_only_permanent_delete();
create trigger visits_owner_only_delete before delete on public.visits
for each row execute function public.owner_only_permanent_delete();
create trigger vaccinations_owner_only_delete before delete on public.vaccinations
for each row execute function public.owner_only_permanent_delete();
create trigger attachments_owner_only_delete before delete on public.attachments
for each row execute function public.owner_only_permanent_delete();
create trigger appointments_owner_only_delete before delete on public.appointments
for each row execute function public.owner_only_permanent_delete();
create trigger reminders_owner_only_delete before delete on public.reminders
for each row execute function public.owner_only_permanent_delete();
create trigger suppliers_owner_only_delete before delete on public.suppliers
for each row execute function public.owner_only_permanent_delete();
create trigger inventory_items_owner_only_delete before delete on public.inventory_items
for each row execute function public.owner_only_permanent_delete();
create trigger inventory_batches_owner_only_delete before delete on public.inventory_batches
for each row execute function public.owner_only_permanent_delete();

create or replace function public.protect_finalized_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.finalized_at is not null and not public.is_clinic_owner() then
    raise exception 'A finalized clinical entry may only be corrected by the clinic owner';
  end if;
  if new.finalized_at is not null and new.finalized_by is null then
    new.finalized_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger visits_protect_finalized
before update on public.visits
for each row execute function public.protect_finalized_visit();

create or replace function public.refresh_reminder_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_clinic_staff() then raise exception 'Not authorized'; end if;

  update public.reminders
  set status = case
    when due_at < date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
      then 'overdue'::public.reminder_status
    when due_at < (date_trunc('day', now() at time zone 'Asia/Manila') + interval '1 day') at time zone 'Asia/Manila'
      then 'due'::public.reminder_status
    else 'upcoming'::public.reminder_status
  end
  where status in ('upcoming', 'due', 'overdue');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.refresh_reminder_statuses() to authenticated;
