create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table private.rag_schedule_config(id boolean primary key default true check(id), project_url text not null, publishable_key text not null);
alter table private.rag_schedule_config enable row level security;
revoke all on private.rag_schedule_config from public,anon,authenticated;
grant all on private.rag_schedule_config to service_role;
do $$ begin
  if not exists(select 1 from vault.secrets where name='veterina_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'veterina_worker_secret','Internal Veterina indexing scheduler credential');
  end if;
end $$;
create function private.verify_worker_secret(p_secret text) returns boolean language sql stable security definer set search_path='' as $$
  select length(p_secret)=64 and exists(select 1 from vault.decrypted_secrets where name='veterina_worker_secret' and decrypted_secret=p_secret);
$$;
create function public.verify_worker_secret(p_secret text) returns boolean language sql security invoker set search_path='' as $$ select private.verify_worker_secret(p_secret); $$;
revoke all on function private.verify_worker_secret(text),public.verify_worker_secret(text) from public,anon,authenticated;
grant execute on function private.verify_worker_secret(text),public.verify_worker_secret(text) to service_role;

create function private.dispatch_rag() returns bigint language plpgsql security definer set search_path='' as $$ declare request_id bigint; begin
  if exists(select 1 from public.rag_jobs where status in ('queued','failed') and run_after<=now() or status='running' and locked_at<now()-interval '5 minutes') then
    select net.http_post(url:=c.project_url || '/functions/v1/embed-worker',
      headers:=jsonb_build_object('Content-Type','application/json','apikey',c.publishable_key,'x-worker-secret',s.decrypted_secret),
      body:='{}'::jsonb,timeout_milliseconds:=10000) into request_id
    from private.rag_schedule_config c cross join vault.decrypted_secrets s where s.name='veterina_worker_secret';
  end if;
  return request_id;
end $$;
revoke all on function private.dispatch_rag() from public,anon,authenticated;
create function public.configure_rag_schedule(p_url text,p_key text) returns void language plpgsql security invoker set search_path='' as $$ begin
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co$' or p_key not like 'sb_publishable_%' then raise exception 'Invalid project URL or publishable key';end if;
  insert into private.rag_schedule_config(id,project_url,publishable_key) values(true,p_url,p_key) on conflict(id) do update set project_url=excluded.project_url,publishable_key=excluded.publishable_key;
  perform cron.schedule('veterina-indexing','* * * * *','select private.dispatch_rag()');
end $$;
revoke all on function public.configure_rag_schedule(text,text) from public,anon,authenticated;
grant execute on function public.configure_rag_schedule(text,text) to service_role;
create or replace function public.claim_rag_jobs(p_limit integer default 10) returns setof public.rag_jobs
language plpgsql security invoker set search_path='' as $$ begin
  update public.rag_jobs set status='dead',last_error='Worker lease expired after maximum attempts' where status='running' and locked_at<now()-interval '5 minutes' and attempts>=5;
  return query update public.rag_jobs j set status='running',attempts=attempts+1,locked_at=now(),lease_token=gen_random_uuid()
    where id in (select id from public.rag_jobs where
      ((status in ('queued','failed') and run_after<=now()) or (status='running' and locked_at<now()-interval '5 minutes'))
      and attempts<5 order by id for update skip locked limit least(greatest(p_limit,1),20)) returning j.*;
end $$;
