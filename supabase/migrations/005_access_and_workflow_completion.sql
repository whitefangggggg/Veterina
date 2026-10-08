-- Restore the service-only contracts of legacy Linea functions in this shared
-- Development project. Veterina migrations must not widen other apps' grants.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'linea_%' or p.proname in ('expire_linea_history','lock_elder_placement')) loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
alter extension btree_gist set schema extensions;

create function private.create_custom_reminder(p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; entity uuid; saved_hash text; begin
  if private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  if p_key is null then raise exception 'VALIDATION_FAILED'; end if;
  insert into public.idempotency_keys(user_id,endpoint,key,request_hash) values(auth.uid(),'create_custom_reminder',p_key,md5(p_data::text)) on conflict do nothing;
  select response,request_hash into result,saved_hash from public.idempotency_keys where user_id=auth.uid() and endpoint='create_custom_reminder' and key=p_key for update;
  if saved_hash is not null and saved_hash<>md5(p_data::text) then raise exception 'VALIDATION_FAILED: retry payload changed; reload to confirm the original saved record';end if;
  if result is not null then return result; end if;
  insert into public.reminders(pet_id,reminder_type,title,notes,due_at,created_by)
  values((p_data->>'petId')::uuid,'custom',p_data->>'title',coalesce(p_data->>'notes',''),(p_data->>'dueDate')::date::timestamp at time zone 'Asia/Manila',auth.uid()) returning id into entity;
  result := jsonb_build_object('id',entity);
  update public.idempotency_keys set response=result where user_id=auth.uid() and endpoint='create_custom_reminder' and key=p_key;
  return result;
end $$;
create function public.create_custom_reminder(p_data jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.create_custom_reminder(p_data,p_key); $$;
revoke all on function private.create_custom_reminder(jsonb,uuid),public.create_custom_reminder(jsonb,uuid) from public,anon;
grant execute on function private.create_custom_reminder(jsonb,uuid),public.create_custom_reminder(jsonb,uuid) to authenticated;

-- Service-only administration RPC still requires a verified owner actor from
-- the admin Edge Function. The browser has no grants on this function.
create function public.admin_update_staff(p_actor uuid,p_id uuid,p_role public.staff_role,p_active boolean) returns void
language plpgsql security invoker set search_path='' as $$ begin
  if not exists(select 1 from public.profiles where id=p_actor and role='owner' and is_active) then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.profiles where role='owner' and is_active for update;
  if exists(select 1 from public.profiles where id=p_id and role='owner' and is_active)
    and (p_role<>'owner' or not p_active) and (select count(*) from public.profiles where role='owner' and is_active)<2 then raise exception 'Cannot remove the last active owner'; end if;
  update public.profiles set role=p_role,is_active=p_active where id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_logs(actor_id,action,table_name,record_id) values(p_actor,'STAFF_ACCESS_UPDATED','profiles',p_id::text);
end $$;
revoke all on function public.admin_update_staff(uuid,uuid,public.staff_role,boolean) from public,anon,authenticated;
grant execute on function public.admin_update_staff(uuid,uuid,public.staff_role,boolean) to service_role;
