-- Only new bookings or writes to their scheduled start must be in the future.
-- Status changes and other updates to historical appointments still work.
create function private.require_future_appointment_start()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.starts_at is null or not isfinite(new.starts_at) or new.starts_at <= clock_timestamp() then
    raise exception 'APPOINTMENT_IN_PAST: choose a future appointment date and time';
  end if;
  return new;
end;
$$;

revoke all on function private.require_future_appointment_start() from public, anon, authenticated;

create trigger appointments_require_future_start
before insert or update of starts_at on public.appointments
for each row execute function private.require_future_appointment_start();

notify pgrst, 'reload schema';
