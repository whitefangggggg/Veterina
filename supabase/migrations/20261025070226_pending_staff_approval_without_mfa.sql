-- Owners approve pending, code-linked staff without an authenticator challenge.
-- Registration's validated clinic assignment remains the authority; editable
-- Auth metadata and the current (possibly rotated) code are never reinterpreted.
create or replace function private.staff_administration(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=nullif(p_data->>'id','')::uuid; application private.staff_join_requests; member public.profiles;
  desired_role public.staff_role:=coalesce(nullif(p_data->>'role',''),'clinical_staff')::public.staff_role;
  enabled boolean:=coalesce((p_data->>'is_active')::boolean,true); result jsonb;
begin
  if private.staff_role() is distinct from 'owner' then raise exception 'FORBIDDEN: shop owner required'; end if;
  if p_action='list' then
    select jsonb_build_object('accounts',coalesce(jsonb_agg(row),'[]')) into result from (
      select r.id,r.email,r.full_name,'clinical_staff'::text role,false is_active,r.email_confirmed,r.status
      from private.staff_join_requests r
      where r.clinic_id=private.current_clinic_id() and r.status='pending'
        and not exists(select 1 from public.profiles p where p.id=r.id)
      order by r.requested_at,r.id
    ) row;
    return result;
  end if;
  if p_action in ('approve','reject') then
    select * into application from private.staff_join_requests where id=target and clinic_id=private.current_clinic_id() for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if application.status<>'pending' then raise exception 'VALIDATION_FAILED: this registration has already been reviewed'; end if;
    if p_action='reject' then
      update private.staff_join_requests set status='rejected',decided_at=now(),decided_by=auth.uid() where id=target;
    else
      if not application.email_confirmed then raise exception 'VALIDATION_FAILED: verified email required'; end if;
      if desired_role<>'clinical_staff' or length(btrim(coalesce(p_data->>'full_name',''))) not between 1 and 120 then raise exception 'VALIDATION_FAILED: approve a staff name and role'; end if;
      insert into public.profiles(id,clinic_id,full_name,role,is_active) values(target,application.clinic_id,btrim(p_data->>'full_name'),'clinical_staff',true);
      update private.staff_join_requests set status='approved',decided_at=now(),decided_by=auth.uid() where id=target;
    end if;
  elsif p_action='update' then
    perform 1 from public.profiles where clinic_id=private.current_clinic_id() and role='owner' and is_active order by id for update;
    select * into member from public.profiles where id=target and clinic_id=private.current_clinic_id() for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if member.role='owner' and member.is_active and (desired_role<>'owner' or not enabled)
      and (select count(*) from public.profiles where clinic_id=member.clinic_id and role='owner' and is_active)<2 then raise exception 'VALIDATION_FAILED: keep at least one active shop owner'; end if;
    update public.profiles set role=desired_role,is_active=enabled where id=target;
  else raise exception 'VALIDATION_FAILED: unknown staff action'; end if;
  insert into public.audit_logs(actor_id,action,table_name,record_id) values(auth.uid(),'STAFF_'||upper(p_action),'profiles',target::text);
  return jsonb_build_object('success',true);
end $$;
notify pgrst,'reload schema';
