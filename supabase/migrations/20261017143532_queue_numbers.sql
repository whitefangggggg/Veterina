-- One clinic-wide ticket sequence per arrival date. The counter row is updated
-- atomically so simultaneous arrivals cannot receive the same number.
alter table public.queue_entries add column queue_date date;
alter table public.queue_entries add column queue_number integer;

with numbered as (
  select id,
    (arrived_at at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date as arrival_date,
    row_number() over (
      partition by (arrived_at at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date
      order by arrived_at,id
    )::integer as ticket
  from public.queue_entries
)
update public.queue_entries q set queue_date=n.arrival_date,queue_number=n.ticket
from numbered n where n.id=q.id;

alter table public.queue_entries alter column queue_date set not null;
alter table public.queue_entries alter column queue_number set not null;
alter table public.queue_entries add constraint queue_number_positive check (queue_number>0);
alter table public.queue_entries add constraint queue_date_number_unique unique(queue_date,queue_number);

create table private.queue_number_counters (
  queue_date date primary key,
  last_number integer not null check (last_number>0)
);
alter table private.queue_number_counters enable row level security;
revoke all on private.queue_number_counters from public,anon,authenticated;
insert into private.queue_number_counters(queue_date,last_number)
  select queue_date,max(queue_number) from public.queue_entries group by queue_date;

create function private.assign_queue_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.queue_date:=(new.arrived_at at time zone coalesce((select timezone from public.clinic_settings limit 1),'Asia/Manila'))::date;
  insert into private.queue_number_counters(queue_date,last_number) values(new.queue_date,1)
  on conflict(queue_date) do update set last_number=private.queue_number_counters.last_number+1
  returning last_number into new.queue_number;
  return new;
end $$;
revoke all on function private.assign_queue_number() from public,anon,authenticated;
create trigger queue_assign_number before insert on public.queue_entries
  for each row execute function private.assign_queue_number();

create function private.protect_queue_number() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.queue_date is distinct from old.queue_date or new.queue_number is distinct from old.queue_number or new.arrived_at is distinct from old.arrived_at then
    raise exception 'VALIDATION_FAILED: arrival date and queue number cannot be changed';
  end if;
  return new;
end $$;
revoke all on function private.protect_queue_number() from public,anon,authenticated;
create trigger queue_protect_number before update of queue_date,queue_number,arrived_at on public.queue_entries
  for each row execute function private.protect_queue_number();
notify pgrst, 'reload schema';
