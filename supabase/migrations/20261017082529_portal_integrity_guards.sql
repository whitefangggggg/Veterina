-- Parent deletion retains a separate audit event while removing booking events.
alter table public.appointment_events drop constraint appointment_events_appointment_id_fkey;
alter table public.appointment_events add constraint appointment_events_appointment_id_fkey
foreign key (appointment_id) references public.appointments(id) on delete cascade;

create or replace function private.portal_reminder_lifecycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='cancelled' and new.status='completed' then raise exception 'INVALID_TRANSITION: cancelled reminder'; end if;
  if old.status='completed' and new.status<>'completed' then raise exception 'INVALID_TRANSITION: completed reminder'; end if;
  return new;
end $$;
create trigger reminders_terminal_lifecycle before update on public.reminders
for each row execute function private.portal_reminder_lifecycle();
revoke all on function private.portal_reminder_lifecycle() from public,anon,authenticated;

create or replace function public.portal_mutation(p_action text,p_data jsonb,p_key uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if private.staff_role() is null then raise exception 'FORBIDDEN: active staff required'; end if;
  if p_action in ('update_encounter','update_vaccination') and not exists(
    select 1 from public.profiles where id=(p_data->>'veterinarianId')::uuid and is_active
  ) then raise exception 'VALIDATION_FAILED: active veterinarian required'; end if;
  return private.portal_mutation(p_action,p_data,p_key);
end $$;
revoke all on function public.portal_mutation(text,jsonb,uuid) from public,anon;
grant execute on function public.portal_mutation(text,jsonb,uuid) to authenticated;
notify pgrst, 'reload schema';
