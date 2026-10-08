create policy internal_schedule_only on private.rag_schedule_config for all to service_role using(true) with check(true);
create function public.bootstrap_clinic_owner(p_email text,p_name text) returns uuid
language plpgsql security invoker set search_path='' as $$ declare result uuid; begin
  -- Bootstrap must be performed by database administration, never a browser.
  perform pg_advisory_xact_lock(hashtextextended('veterina-initial-owner',0));
  if exists(select 1 from public.profiles) then raise exception 'Bootstrap already completed';end if;
  select id into result from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if result is null then raise exception 'Create and verify this Auth account before bootstrapping';end if;
  if length(trim(p_name))=0 then raise exception 'Owner name required';end if;
  insert into public.profiles(id,full_name,role,is_active) values(result,trim(p_name),'owner',true);
  return result;
end $$;
revoke all on function public.bootstrap_clinic_owner(text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_clinic_owner(text,text) to service_role;
