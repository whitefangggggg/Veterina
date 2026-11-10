-- Expanded disclosure is opt-in for every admission, including existing codes.
alter table public.admission_public_sharing
  add column share_clinical_details boolean not null default false;

do $$ declare definition text; marker text:=$marker$if p_action='tracking_configure' then$marker$; begin
  definition:=pg_get_functiondef('private.tracking_mutation(text,jsonb)'::regprocedure);
  if strpos(definition,marker)=0 then raise exception 'Expected tracking configuration branch'; end if;
  execute replace(definition,marker,$new$if p_action='tracking_clinical_sharing' then
    if jsonb_typeof(p_data->'enabled') is distinct from 'boolean'
      or ((p_data->>'enabled')::boolean and (p_data->>'acknowledgePublic')::boolean is distinct from true) then
      raise exception 'VALIDATION_FAILED: explicitly approve existing and future clinical details, doses and staff names';
    end if;
    update public.admission_public_sharing set share_clinical_details=(p_data->>'enabled')::boolean where id=a.id;
  elsif p_action='tracking_configure' then$new$);
end $$;

-- Internal cursors leave the database only for encryption by the Edge Function.
create function private.public_admission_clinical_page(a public.admissions,p_section text,p_cursor jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source text; direction text:='desc'; comparator text:='<'; entries jsonb; result jsonb;
begin
  case p_section
  when 'activity' then source:=$query$
    select e.id,e.occurred_at as k,jsonb_build_object(
      'key',encode(extensions.digest(e.id::text,'sha256'),'hex'),'type',e.event_type,
      'occurredAt',e.occurred_at,'author',e.author_name,'reason',e.details->>'reason',
      'fromStatus',case when e.event_type='status' then e.details->>'from' end,
      'toStatus',case when e.event_type='status' then e.details->>'to' end,
      'condition',case when e.event_type='discharged' then e.details->>'condition' end) as item
    from public.admission_events e where e.admission_id=$1 and e.clinic_id=$2
      and e.event_type in ('admitted','status','discharged','transfer','care_order','order_stopped')
  $query$;
  when 'monitoring' then source:=$query$
    select o.id,o.recorded_at as k,jsonb_build_object(
      'key',encode(extensions.digest(o.id::text,'sha256'),'hex'),'kind',o.kind,
      'occurredAt',o.occurred_at,'recordedAt',o.recorded_at,'author',o.author_name,
      'note',o.note,'values',jsonb_strip_nulls(jsonb_build_object(
        'weightKg',o.values->'weightKg','temperatureC',o.values->'temperatureC',
        'heartRate',o.values->'heartRate','respiratoryRate',o.values->'respiratoryRate',
        'bodyConditionScore',o.values->'bodyConditionScore','hydration',o.values->'hydration','condition',o.values->'condition')),
      'correction',o.corrects_id is not null,'correctionReason',o.correction_reason,
      'isCurrent',not exists(select 1 from public.admission_observations c
        where c.corrects_id=o.id and c.admission_id=$1 and c.clinic_id=$2)) as item
    from public.admission_observations o where o.admission_id=$1 and o.clinic_id=$2
  $query$;
  when 'tasks','resolvedTasks' then
    if p_section='tasks' then direction:='asc'; comparator:='>'; end if;
    source:=$query$
    select t.id,t.due_at as k,jsonb_build_object(
      'key',encode(extensions.digest(t.id::text,'sha256'),'hex'),'title',o.title,
      'status',t.status,'dueAt',t.due_at,'originalDueAt',t.original_due_at) as item
    from public.admission_tasks t join public.admission_orders o
      on o.id=t.order_id and o.admission_id=$1 and o.clinic_id=$2
    where t.admission_id=$1 and t.clinic_id=$2
    $query$||case when p_section='tasks' then ' and t.status in (''pending'',''delayed'')' else ' and t.status not in (''pending'',''delayed'')' end;
  when 'orders' then source:=$query$
    select o.id,o.created_at as k,jsonb_build_object(
      'key',encode(extensions.digest(o.id::text,'sha256'),'hex'),'kind',o.kind,'title',o.title,
      'instructions',o.instructions,'status',o.status,'author',o.author_name,'createdAt',o.created_at,
      'startsAt',o.starts_at,'endsAt',o.ends_at,'intervalHours',o.interval_hours,
      'revised',o.replaces_id is not null,
      'medication',(select jsonb_build_object('name',m->>'medicationName','dose',m->>'dose',
        'route',m->>'route','frequency',m->>'frequency','duration',m->>'duration','instructions',m->>'instructions')
        from public.prescriptions rx cross join lateral jsonb_array_elements(rx.medications) m
        where rx.id=o.prescription_id and rx.visit_id=$5 and rx.clinic_id=$2
          and m->>'medicationId'=o.medication_id::text limit 1)) as item
    from public.admission_orders o where o.admission_id=$1 and o.clinic_id=$2
  $query$;
  when 'administrations' then source:=$query$
    select h.id,h.recorded_at as k,jsonb_build_object(
      'key',encode(extensions.digest(h.id::text,'sha256'),'hex'),'title',h.title,
      'outcome',h.outcome,'reason',h.reason,'occurredAt',h.occurred_at,'recordedAt',h.recorded_at,
      'author',h.author_name,'deferredUntil',h.deferred_until,'correction',h.corrects_id is not null,
      'isCurrent',not exists(select 1 from public.admission_administrations c
        where c.corrects_id=h.id and c.admission_id=$1 and c.clinic_id=$2)) as item
    from public.admission_administrations h where h.admission_id=$1 and h.clinic_id=$2
  $query$;
  else return null;
  end case;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''at'',k,''id'',id,''item'',item) order by k %1$s,id %1$s),''[]'') from
    (select * from (%2$s) source where ($3::timestamptz is null or (k,id) %3$s ($3::timestamptz,$4::uuid))
      order by k %1$s,id %1$s limit 21) page',direction,source,comparator)
    into entries using a.id,a.clinic_id,p_cursor->>'at',p_cursor->>'id',a.visit_id;
  select jsonb_build_object('items',coalesce(jsonb_agg(x->'item' order by ord) filter(where ord<=20),'[]'),
    'next',case when jsonb_array_length(entries)>20 then (entries->19)-'item' else null end)
    into result from jsonb_array_elements(entries) with ordinality as rows(x,ord);
  return result;
end $$;
revoke all on function private.public_admission_clinical_page(public.admissions,text,jsonb) from public,anon,authenticated;
grant execute on function private.public_admission_clinical_page(public.admissions,text,jsonb) to service_role;

create function public.lookup_public_admission_content(p_token text,p_client_hash text,p_section text default null,p_cursor jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; sharing public.admission_public_sharing; a public.admissions; pages jsonb:='{}'; section text;
begin
  -- Reuse the original capability, expiry, subscription and shared throttle gate.
  result:=public.lookup_public_admission(p_token,p_client_hash);
  if result is null or result ? 'limited' then return result; end if;
  select * into sharing from public.admission_public_sharing
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and enabled and expires_at>now();
  if not found then return null; end if;
  select * into a from public.admissions where id=sharing.id and clinic_id=sharing.clinic_id;
  if not found then return null; end if;
  if p_section is not null then
    if not sharing.share_clinical_details then return null; end if;
    if p_cursor is not null and (jsonb_typeof(p_cursor) is distinct from 'object'
      or p_cursor->>'at' is null or p_cursor->>'id' is null) then return null; end if;
    return jsonb_build_object('section',p_section,'page',private.public_admission_clinical_page(a,p_section,p_cursor));
  end if;
  if not sharing.share_clinical_details then return result||jsonb_build_object('clinicalEnabled',false); end if;
  foreach section in array array['activity','monitoring','tasks','resolvedTasks','orders','administrations'] loop
    pages:=pages||jsonb_build_object(section,private.public_admission_clinical_page(a,section));
  end loop;
  return result||jsonb_build_object('clinicalEnabled',true,'condition',a.condition,'clinical',pages,
    'updatedAt',greatest((result->>'updatedAt')::timestamptz,
      (select max(recorded_at) from public.admission_observations where admission_id=a.id and clinic_id=a.clinic_id),
      (select max(occurred_at) from public.admission_events where admission_id=a.id and clinic_id=a.clinic_id),
      (select max(created_at) from public.admission_orders where admission_id=a.id and clinic_id=a.clinic_id),
      (select max(recorded_at) from public.admission_administrations where admission_id=a.id and clinic_id=a.clinic_id)));
end $$;
revoke all on function public.lookup_public_admission_content(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.lookup_public_admission_content(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
