-- KAN-23. Private, synchronously maintained allowlisted search documents.
create extension if not exists pg_trgm with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='veterina_search') then
    create role veterina_search nologin inherit nobypassrls;
  end if;
end $$;
-- Hosted restores need not contain the mutation-owner role. Search inherits only
-- the normal authenticated RLS persona, never a privileged mutation role.
do $$ declare inherited_role name; begin
  for inherited_role in
    select parent.rolname from pg_auth_members m join pg_roles parent on parent.oid=m.roleid
    where m.member='veterina_search'::regrole and parent.rolname<>'authenticated'
  loop execute format('revoke %I from veterina_search',inherited_role); end loop;
end $$;
grant authenticated to veterina_search;
grant usage on schema public,private,auth,extensions to veterina_search;
grant execute on function auth.uid(),private.current_clinic_id(),private.staff_role() to veterina_search;
-- These are the guarded readers' only direct source-table queries. Their normal
-- authenticated clinic policies apply through role membership.
grant select on public.queue_entries,public.vaccinations,public.deworming_administrations,
  public.inventory_movements to veterina_search;
grant veterina_search to postgres;

create function private.search_normalize(p_text text) returns text
language sql immutable parallel safe set search_path='' as $$
  select lower(btrim(regexp_replace(coalesce(p_text,''),'[[:space:]]+',' ','g')));
$$;
revoke all on function private.search_normalize(text) from public,anon,authenticated;
grant execute on function private.search_normalize(text) to veterina_search;

create table private.clinic_search_documents (
  source_table text not null,
  entity_id uuid not null,
  clinic_id uuid not null references public.clinics(id),
  kind text not null,
  title text not null,
  context text not null default '',
  search_text text not null,
  pet_id uuid,
  owner_id uuid,
  item_id uuid,
  parent_source text,
  parent_id uuid,
  occurred_at timestamptz,
  status text,
  fields jsonb not null check(jsonb_typeof(fields)='object'),
  primary key(source_table,entity_id)
);
create index clinic_search_tenant_kind on private.clinic_search_documents(clinic_id,kind);
create index clinic_search_text on private.clinic_search_documents using gin(search_text extensions.gin_trgm_ops);
create index clinic_search_pet on private.clinic_search_documents(clinic_id,pet_id) where pet_id is not null;
create index clinic_search_owner on private.clinic_search_documents(clinic_id,owner_id) where owner_id is not null;
create index clinic_search_item on private.clinic_search_documents(clinic_id,item_id) where item_id is not null;
create index clinic_search_parent on private.clinic_search_documents(clinic_id,parent_source,parent_id) where parent_id is not null;
alter table private.clinic_search_documents enable row level security;
revoke all on private.clinic_search_documents from public,anon,authenticated,service_role;
grant select on private.clinic_search_documents to veterina_search;
create policy clinic_search_read on private.clinic_search_documents for select to veterina_search
  using(clinic_id=(select private.current_clinic_id()) and (select private.staff_role()) is not null);

-- Projection values are explicit; no full source row or credential is indexed.
-- Helpers are not browser APIs. The trigger uses its own row's clinic and all
-- relationship lookups check that same clinic, including service-role maintenance.
create function private.search_project(p_source text,r jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare kind text; title text; context text:=''; body text:=''; fields jsonb:='{}';
  pet uuid:=nullif(r->>'pet_id','')::uuid; owner uuid; item uuid;
  parent_source text; parent_id uuid; occurred text; status text:=r->>'status';
  v public.visits; a public.admissions; pr public.preventive_care_records;
  clinic uuid:=(r->>'clinic_id')::uuid; names text; medications text;
begin
  if p_source in ('diagnoses','treatments','prescriptions','visit_corrections') then
    select * into v from public.visits where id=(r->>'visit_id')::uuid and clinic_id=clinic;
    if not found then return null; end if;
    pet:=v.pet_id; parent_source:='visits'; parent_id:=v.id; occurred:=v.visited_at::text;
  end if;
  case p_source
  when 'pets' then
    kind:='patients'; title:=r->>'name'; owner:=(r->>'owner_id')::uuid;
    context:=concat_ws(' · ',r->>'record_number',r->>'species',r->>'breed');
    body:=concat_ws(' ',title,r->>'record_number',r->>'species',r->>'breed',r->>'microchip_number');
    fields:=jsonb_build_object('Record number',r->>'record_number','Species',r->>'species','Breed',r->>'breed','Sex',r->>'sex','Microchip',r->>'microchip_number','Patient status',status);
  when 'owners' then
    kind:='owners'; title:=r->>'full_name'; context:=concat_ws(' · ',r->>'phone',r->>'email');
    body:=concat_ws(' ',title,r->>'phone',r->>'normalized_phone',replace(r->>'normalized_phone','+63','0'),regexp_replace(coalesce(r->>'phone',''),'[^0-9]','','g'),r->>'email');
    status:=case when (r->>'is_active')::boolean then 'Active' else 'Inactive' end;
    fields:=jsonb_build_object('Phone',r->>'phone','Email',r->>'email','Address',r->>'address','Owner status',status);
  when 'visits' then
    kind:='visits'; title:=coalesce(nullif(r->>'service_name',''),r->>'visit_type','Visit');
    context:=left(coalesce(r->>'chief_complaint',''),140); occurred:=r->>'visited_at';
    body:=concat_ws(' ',title,r->>'chief_complaint',r->>'diagnosis_summary',r->>'attending_veterinarian_name',occurred);
    status:=case when r->>'recording_purpose'='record_only' then 'Record only' when r->>'recording_purpose'='admission' then 'Inpatient encounter' when r->>'finalized_at' is not null then 'Finalized' else 'Open chart' end;
    fields:=jsonb_build_object('Visit type',title,'Complaint',r->>'chief_complaint','Diagnosis summary',r->>'diagnosis_summary','Recording purpose',r->>'recording_purpose','Veterinarian',r->>'attending_veterinarian_name','Finalized at',r->>'finalized_at');
  when 'diagnoses' then
    kind:='diagnoses'; title:=left(r->>'description',160); context:=r->>'code';
    body:=concat_ws(' ',r->>'description',r->>'code');
    fields:=jsonb_build_object('Diagnosis',r->>'description','Code',r->>'code','Status',status);
  when 'treatments' then
    kind:='services'; title:=r->>'name'; occurred:=coalesce(r->>'performed_at',occurred);
    fields:=jsonb_build_object('Treatment',title); body:=title;
  when 'patient_service_records' then
    kind:='services'; title:=r->>'service_name'; occurred:=r->>'performed_at'; status:='Record only';
    body:=concat_ws(' ',title,r->>'performed_by_name');
    fields:=jsonb_build_object('Service',title,'Performed by',r->>'performed_by_name','Recording purpose','record_only');
  when 'vaccinations' then
    kind:='vaccinations'; title:=r->>'vaccine_name'; context:=concat_ws(' · ',r->>'brand',r->>'lot_number'); occurred:=r->>'administered_at';
    body:=concat_ws(' ',title,r->>'brand',r->>'manufacturer',r->>'lot_number',r->>'administered_by_name',occurred,r->>'next_due_at');
    status:=case when r->>'recording_purpose'='record_only' then 'Record only' else 'Care record' end;
    fields:=jsonb_build_object('Vaccine',title,'Brand',r->>'brand','Lot number',r->>'lot_number','Dose',r->>'dose','Next dose',r->>'next_due_at','Recording purpose',r->>'recording_purpose');
  when 'deworming_administrations' then
    select * into pr from public.preventive_care_records where id=(r->>'preventive_record_id')::uuid and clinic_id=clinic;
    if not found then return null; end if;
    kind:='deworming'; pet:=pr.pet_id; title:=r->>'product_name'; context:=concat_ws(' · ',r->>'brand',r->>'lot_number'); occurred:=pr.administered_at::text;
    body:=concat_ws(' ',title,r->>'brand',r->>'lot_number',occurred,r->>'next_due_at');
    status:=case when pr.recording_purpose='record_only' then 'Record only' else 'Care record' end;
    fields:=jsonb_build_object('Product',title,'Brand',r->>'brand','Lot number',r->>'lot_number','Dose',r->>'dose','Next dose',r->>'next_due_at','Recording purpose',pr.recording_purpose);
  when 'prescriptions' then
    select string_agg(coalesce(m->>'medicationName',m->>'name'),' · '),
      string_agg(concat_ws(' — ',coalesce(m->>'medicationName',m->>'name'),nullif(concat_ws(' ',m->>'dose',m->>'route',m->>'frequency',m->>'duration'),'')),E'\n')
      into names,medications from jsonb_array_elements(case when jsonb_typeof(r->'medications')='array' then r->'medications' else '[]'::jsonb end) m;
    kind:='prescriptions'; title:=coalesce(nullif(names,''),r->>'medication_name','Prescription');
    occurred:=r->>'prescribed_at'; body:=concat_ws(' ',names,r->>'medication_name',r->>'prescribed_by_name',occurred);
    status:=case when (r->>'is_historical')::boolean then 'Record only' when r->>'dispensing_mode'='on_administration' then 'Inpatient order' else 'Prescription' end;
    fields:=jsonb_build_object('Medications',coalesce(medications,r->>'medication_name'),'Prescribed by',r->>'prescribed_by_name','Dispensing mode',r->>'dispensing_mode');
  when 'appointments' then
    kind:='appointments'; select name into title from public.service_types where id=(r->>'service_type_id')::uuid and clinic_id=clinic;
    title:=coalesce(title,'Appointment'); occurred:=r->>'starts_at'; body:=concat_ws(' ',title,occurred);
    fields:=jsonb_build_object('Service',title,'Starts at',r->>'starts_at','Ends at',r->>'ends_at','Booking status',status);
  when 'queue_entries' then
    kind:='queue'; title:=coalesce(r->>'service_name','Arrival'); context:=case when r->>'queue_number' is not null then 'Q-'||lpad(r->>'queue_number',3,'0') else 'Arrival' end;
    occurred:=r->>'arrived_at'; body:=concat_ws(' ',title,context,r->>'queue_date',r->>'category');
    fields:=jsonb_build_object('Queue number',context,'Queue date',r->>'queue_date','Service',title,'Care status',status,'Source',r->>'source');
  when 'reminders' then
    kind:='reminders'; title:=r->>'title'; context:=r->>'reminder_type'; occurred:=r->>'due_at';
    body:=concat_ws(' ',title,context,occurred);
    fields:=jsonb_build_object('Reminder',title,'Type',context,'Priority',r->>'priority','Status',status);
  when 'inventory_items' then
    kind:='inventory'; title:=r->>'name'; context:=concat_ws(' · ',r->>'sku',r->>'category',r->>'brand');
    body:=concat_ws(' ',title,context); status:=case when (r->>'is_active')::boolean then 'Active' else 'Archived' end;
    fields:=jsonb_build_object('SKU',r->>'sku','Category',r->>'category','Brand',r->>'brand','Unit',r->>'unit','Item status',status);
  when 'inventory_batches' then
    kind:='batches'; title:=coalesce(nullif(r->>'lot_number',''),'Unnumbered batch'); item:=(r->>'item_id')::uuid; occurred:=r->>'expiration_date';
    context:=case when occurred is not null then 'Expires '||occurred else 'No expiry recorded' end;
    body:=concat_ws(' ',title,r->>'expiration_date',r->>'received_at'); status:=case when (r->>'is_active')::boolean then 'Active' else 'Archived' end;
    fields:=jsonb_build_object('Lot number',r->>'lot_number','Expiration date',r->>'expiration_date','Received date',r->>'received_at','Batch status',status);
  when 'suppliers' then
    kind:='suppliers'; title:=r->>'name'; context:=concat_ws(' · ',r->>'contact_person',r->>'phone');
    body:=concat_ws(' ',title,context,r->>'email',regexp_replace(coalesce(r->>'phone',''),'[^0-9]','','g'));
    status:=case when (r->>'is_active')::boolean then 'Active' else 'Archived' end;
    fields:=jsonb_build_object('Contact person',r->>'contact_person','Phone',r->>'phone','Email',r->>'email','Address',r->>'address','Supplier status',status);
  when 'travel_certificates' then
    kind:='certificates'; title:=coalesce(nullif(r->>'control_number',''),r->>'reference_number'); context:=concat_ws(' · ',r->>'pet_name',r->>'destination'); occurred:=r->>'issued_at';
    body:=concat_ws(' ',title,r->>'reference_number',r->>'pet_name',r->>'owner_name',r->>'destination',r->>'issued_on',r->>'travel_date');
    fields:=jsonb_build_object('Control number',r->>'control_number','Reference',r->>'reference_number','Patient on document',r->>'pet_name','Owner on document',r->>'owner_name','Destination',r->>'destination','Travel date',r->>'travel_date','Valid until',r->>'valid_until','Certificate status',status,'Visibility',case when (r->>'is_public')::boolean then 'Public' else 'Private' end);
  when 'admissions' then
    kind:='admissions'; title:=r->>'reference'; occurred:=r->>'admitted_at'; body:=concat_ws(' ',title,occurred);
    fields:=jsonb_build_object('Reference',title,'Workflow status',status,'Clinical condition',r->>'condition','Historical',case when (r->>'is_historical')::boolean then 'Yes' else 'No' end,'Closed at',r->>'closed_at');
  when 'admission_tasks' then
    select * into a from public.admissions where id=(r->>'admission_id')::uuid and clinic_id=clinic;
    if not found then return null; end if;
    kind:='tasks'; pet:=a.pet_id; parent_source:='admissions'; parent_id:=a.id;
    select o.title into title from public.admission_orders o where o.id=(r->>'order_id')::uuid and o.clinic_id=clinic;
    title:=coalesce(title,'Inpatient care task'); occurred:=r->>'due_at'; body:=concat_ws(' ',title,occurred);
    fields:=jsonb_build_object('Care task',title,'Task status',status,'Due at',occurred);
  when 'visit_corrections' then
    kind:='corrections'; title:='Visit correction'; context:=left(coalesce(r->>'reason',''),140); occurred:=r->>'created_at';
    body:=concat_ws(' ',r->>'reason',r->>'correction'); status:='Retained correction';
    fields:=jsonb_build_object('Correction reason',r->>'reason','Correction',r->>'correction');
  else return null;
  end case;
  return jsonb_build_object('kind',kind,'title',left(coalesce(nullif(title,''),'Saved record'),160),'context',coalesce(context,''),
    'search_text',private.search_normalize(concat_ws(' ',r->>'id',body,status,occurred)),
    'pet_id',pet,'owner_id',owner,'item_id',item,'parent_source',parent_source,'parent_id',parent_id,
    'occurred_at',occurred,'status',status,'fields',jsonb_strip_nulls(fields));
end $$;
revoke all on function private.search_project(text,jsonb) from public,anon,authenticated,service_role,veterina_search;

create function private.search_refresh(p_source text,p_id uuid) returns void
language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare r jsonb; d jsonb; begin
  if not p_source=any(array['pets','owners','visits','diagnoses','treatments','patient_service_records','vaccinations','deworming_administrations','prescriptions','appointments','queue_entries','reminders','inventory_items','inventory_batches','suppliers','travel_certificates','admissions','admission_tasks','visit_corrections']) then raise exception 'Unsupported search source'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1',p_source) into r using p_id;
  if r is null then delete from private.clinic_search_documents where source_table=p_source and entity_id=p_id; return; end if;
  d:=private.search_project(p_source,r);
  if d is null then return; end if;
  insert into private.clinic_search_documents(source_table,entity_id,clinic_id,kind,title,context,search_text,pet_id,owner_id,item_id,parent_source,parent_id,occurred_at,status,fields)
    values(p_source,p_id,(r->>'clinic_id')::uuid,d->>'kind',d->>'title',d->>'context',d->>'search_text',(d->>'pet_id')::uuid,(d->>'owner_id')::uuid,(d->>'item_id')::uuid,d->>'parent_source',(d->>'parent_id')::uuid,(d->>'occurred_at')::timestamptz,d->>'status',d->'fields')
    on conflict(source_table,entity_id) do update set clinic_id=excluded.clinic_id,kind=excluded.kind,title=excluded.title,context=excluded.context,search_text=excluded.search_text,pet_id=excluded.pet_id,owner_id=excluded.owner_id,item_id=excluded.item_id,parent_source=excluded.parent_source,parent_id=excluded.parent_id,occurred_at=excluded.occurred_at,status=excluded.status,fields=excluded.fields;
end $$;
revoke all on function private.search_refresh(text,uuid) from public,anon,authenticated,service_role,veterina_search;

-- Trigger-only definer: must also maintain trusted service/migration writes with
-- no auth.uid(). It accepts no caller-supplied SQL or API arguments; all source
-- identifiers come from this fixed set of attached triggers.
create function private.search_sync() returns trigger
language plpgsql security definer set search_path='' as $$
declare child record; begin
  if tg_op='DELETE' then
    delete from private.clinic_search_documents where source_table=tg_table_name and entity_id=old.id;
    return old;
  end if;
  if tg_table_name not in ('preventive_care_records','service_types','admission_orders') then perform private.search_refresh(tg_table_name,new.id); end if;
  if tg_op='UPDATE' and tg_table_name='visits' then
    if (new.pet_id,new.visited_at,new.recording_purpose) is distinct from (old.pet_id,old.visited_at,old.recording_purpose) then
      for child in select source_table,entity_id from private.clinic_search_documents where clinic_id=new.clinic_id and parent_source='visits' and parent_id=new.id order by source_table,entity_id loop
        perform private.search_refresh(child.source_table,child.entity_id);
      end loop;
    end if;
  elsif tg_table_name='preventive_care_records' then
    for child in select id from public.deworming_administrations where preventive_record_id=new.id and clinic_id=new.clinic_id order by id loop perform private.search_refresh('deworming_administrations',child.id); end loop;
  elsif tg_op='UPDATE' and tg_table_name='service_types' then
    if new.name is distinct from old.name then
      for child in select id from public.appointments where service_type_id=new.id and clinic_id=new.clinic_id order by id loop perform private.search_refresh('appointments',child.id); end loop;
    end if;
  elsif tg_op='UPDATE' and tg_table_name='admission_orders' then
    if new.title is distinct from old.title then
      for child in select id from public.admission_tasks where order_id=new.id and clinic_id=new.clinic_id order by id loop perform private.search_refresh('admission_tasks',child.id); end loop;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.search_sync() from public,anon,authenticated,service_role,veterina_search;

create function private.search_truncate() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  delete from private.clinic_search_documents where source_table=tg_table_name;
  return null;
end $$;
revoke all on function private.search_truncate() from public,anon,authenticated,service_role,veterina_search;

do $$ declare t text; r record; begin
  foreach t in array array['pets','owners','visits','diagnoses','treatments','patient_service_records','vaccinations','deworming_administrations','prescriptions','appointments','queue_entries','reminders','inventory_items','inventory_batches','suppliers','travel_certificates','admissions','admission_tasks','visit_corrections'] loop
    execute format('create trigger z_clinic_search after insert or update or delete on public.%I for each row execute function private.search_sync()',t);
    execute format('create trigger z_clinic_search_truncate after truncate on public.%I for each statement execute function private.search_truncate()',t);
    for r in execute format('select id from public.%I order by id',t) loop perform private.search_refresh(t,r.id); end loop;
  end loop;
  foreach t in array array['preventive_care_records','service_types','admission_orders'] loop
    execute format('create trigger z_clinic_search after insert or update on public.%I for each row execute function private.search_sync()',t);
  end loop;
end $$;

-- A result points at a persisted, bounded read-only record view. Existing direct
-- admission and certificate readers already load records independently.
create function private.search_href(p_source text,p_id uuid) returns text
language sql immutable parallel safe set search_path='' as $$
  select case p_source when 'admissions' then '/admissions/'||p_id
    when 'travel_certificates' then '/travel-certificates?certificateId='||p_id
    else '/records/'||p_source||'/'||p_id end;
$$;
revoke all on function private.search_href(text,uuid) from public,anon,authenticated;
grant execute on function private.search_href(text,uuid) to veterina_search;

-- Resolve care state for the bounded returned page, rather than rewriting other
-- records' index rows while holding queue locks. Source RLS still applies here.
create function private.search_care_status(p_source text,p_id uuid,p_fallback text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare care text; tenant uuid:=private.current_clinic_id(); begin
  if p_fallback in ('Record only','Inpatient encounter') then return p_fallback; end if;
  if p_source='visits' then
    select q.status into care from public.queue_entries q where q.clinic_id=tenant and q.visit_id=p_id order by q.arrived_at desc,q.id desc limit 1;
  elsif p_source='vaccinations' then
    select q.status into care from public.vaccinations v join public.queue_entries q on q.clinic_id=tenant
      and (q.preventive_record_id=v.preventive_record_id or q.vaccination_id=v.id)
      where v.id=p_id and v.clinic_id=tenant order by q.arrived_at desc,q.id desc limit 1;
  elsif p_source='deworming_administrations' then
    select q.status into care from public.deworming_administrations d join public.queue_entries q on q.clinic_id=tenant and q.preventive_record_id=d.preventive_record_id
      where d.id=p_id and d.clinic_id=tenant order by q.arrived_at desc,q.id desc limit 1;
  end if;
  return coalesce(care,p_fallback);
end $$;
revoke all on function private.search_care_status(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.search_care_status(text,uuid,text) to veterina_search;

create function private.search_clinic_records(p_query text,p_kind text default null,p_limit integer default 25,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare q text:=private.search_normalize(p_query); terms text[]; patterns text[]; anchor text; pattern text;
  tenant uuid:=private.current_clinic_id(); role public.staff_role:=private.staff_role(); result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if tenant is null or role is null then raise exception 'FORBIDDEN'; end if;
  if length(q)<2 or length(q)>120 or p_limit is null or p_limit not between 1 and 50
    or (p_kind is not null and p_kind<>all(array['patients','owners','visits','diagnoses','services','vaccinations','deworming','prescriptions','appointments','queue','reminders','inventory','batches','suppliers','certificates','admissions','tasks','corrections','navigation'])) then raise exception 'VALIDATION_FAILED: search requires 2–120 characters and a supported record type'; end if;
  terms:=string_to_array(q,' ');
  if cardinality(terms)>8 then raise exception 'VALIDATION_FAILED: use at most eight search terms'; end if;
  select t into anchor from unnest(terms) t order by length(t) desc,t limit 1;
  pattern:='%'||replace(replace(replace(anchor,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  select array_agg('%'||replace(replace(replace(t,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%') into patterns from unnest(terms) t;
  if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or not(p_cursor ?& array['rank','title','source','id'])
    or jsonb_typeof(p_cursor->'rank') is distinct from 'number' or jsonb_typeof(p_cursor->'title') is distinct from 'string'
    or jsonb_typeof(p_cursor->'source') is distinct from 'string' or jsonb_typeof(p_cursor->'id') is distinct from 'string'
    or length(p_cursor->>'title')>1000 or length(p_cursor->>'source')>80 or (p_cursor->>'rank')::integer not between 0 and 100
    or (p_cursor->>'id') !~ '^[a-f0-9-]{36}$') then raise exception 'VALIDATION_FAILED: invalid search cursor'; end if;
  with anchors as materialized (
    select source_table,entity_id from private.clinic_search_documents where clinic_id=tenant and search_text like pattern
  ), candidates as (
    select source_table,entity_id from anchors
    union select d.source_table,d.entity_id from private.clinic_search_documents d join anchors a on a.source_table='pets' and d.pet_id=a.entity_id where d.clinic_id=tenant
    union select d.source_table,d.entity_id from private.clinic_search_documents d join anchors a on a.source_table='owners' and d.owner_id=a.entity_id where d.clinic_id=tenant
    union select d.source_table,d.entity_id from private.clinic_search_documents d join private.clinic_search_documents p on p.source_table='pets' and p.entity_id=d.pet_id and p.clinic_id=tenant join anchors a on a.source_table='owners' and p.owner_id=a.entity_id where d.clinic_id=tenant
    union select d.source_table,d.entity_id from private.clinic_search_documents d join anchors a on a.source_table='inventory_items' and d.item_id=a.entity_id where d.clinic_id=tenant
  ), enriched as (
    select d.*,private.search_normalize(d.title) as title_key,
      concat_ws(' ',p.title,o.title,i.title,nullif(d.context,'')) as display_context,
      concat_ws(' ',d.search_text,p.search_text,o.search_text,i.search_text) as haystack
    from candidates c join private.clinic_search_documents d using(source_table,entity_id)
      left join private.clinic_search_documents p on p.source_table='pets' and p.entity_id=d.pet_id and p.clinic_id=tenant
      left join private.clinic_search_documents o on o.source_table='owners' and o.entity_id=coalesce(d.owner_id,p.owner_id) and o.clinic_id=tenant
      left join private.clinic_search_documents i on i.source_table='inventory_items' and i.entity_id=d.item_id and i.clinic_id=tenant
    where d.clinic_id=tenant
  ), nav as (
    select '_navigation'::text as source_table,md5(n.path)::uuid as entity_id,'navigation'::text as kind,n.title,
      private.search_normalize(n.title) as title_key,n.context as display_context,null::timestamptz as occurred_at,
      'Workspace'::text as status,n.path as href,private.search_normalize(n.title||' '||n.context||' '||n.keywords) as haystack
    from (values
      ('Patients','Patient registry and owner directory','pet owner records','/patients',false),
      ('Admissions','Hospitalization and inpatient care','hospital wards care tasks','/admissions',false),
      ('Appointments','Calendar and bookings','schedule','/appointments',false),
      ('Follow-up tasks','Owner follow-ups and reminders','due care reminders','/appointments?view=tasks',false),
      ('Inventory','Products, stock and batches','sku lots expiry','/inventory',false),
      ('Suppliers','Ordering contacts','supplies','/suppliers',false),
      ('Travel certificates','Clinic-issued travel documents','documents','/travel-certificates',false),
      ('Clinic settings','Clinic profile and appearance','display theme dark light system','/settings',false),
      ('Staff accounts','Approve and manage clinic staff','administration access','/settings?tab=staff',true),
      ('Services settings','Manage clinic service catalog','administration','/settings?tab=services',true),
      ('Reports','Export clinic reports','history csv exports','/reports',true)
    ) n(title,context,keywords,path,owner_only) where not n.owner_only or role='owner'
  ), matches as materialized (
    select source_table,entity_id,kind,left(title,160) as title,title_key,left(display_context,200) as context,occurred_at,status,
      private.search_href(source_table,entity_id) as href,
      (case when q=entity_id::text or q=title_key then 0 when starts_with(title_key,q) then 10 when position(q in title_key)>0 then 20 else 40 end
        + case kind when 'patients' then 0 when 'owners' then 1 else 2 end)::integer as rank
    from enriched where haystack like all(patterns) and (p_kind is null or kind=p_kind)
    union all
    select source_table,entity_id,kind,title,title_key,display_context,occurred_at,status,href,
      case when q=title_key then 0 when starts_with(title_key,q) then 15 else 45 end as rank
    from nav where haystack like all(patterns) and (p_kind is null or p_kind='navigation')
  ), page as materialized (
    select * from matches where p_cursor is null or
      (rank,title_key collate "C",source_table,entity_id)>((p_cursor->>'rank')::integer,(p_cursor->>'title') collate "C",p_cursor->>'source',(p_cursor->>'id')::uuid)
    order by rank,title_key collate "C",source_table,entity_id limit p_limit+1
  ), shown as materialized (select * from page order by rank,title_key collate "C",source_table,entity_id limit p_limit)
  select jsonb_build_object('total',(select count(*) from matches),
    'groups',coalesce((select jsonb_object_agg(kind,n) from (select kind,count(*) n from matches group by kind) counts),'{}'),
    'records',coalesce((select jsonb_agg(jsonb_build_object('source',source_table,'id',entity_id,'kind',kind,'title',title,'context',context,'date',occurred_at,'status',private.search_care_status(source_table,entity_id,status),'href',href) order by rank,title_key collate "C",source_table,entity_id) from shown),'[]'),
    'nextCursor',case when (select count(*) from page)>p_limit then (select jsonb_build_object('rank',rank,'title',title_key,'source',source_table,'id',entity_id) from shown order by rank desc,title_key collate "C" desc,source_table desc,entity_id desc limit 1) else null end) into result;
  return result;
end $$;
revoke all on function private.search_clinic_records(text,text,integer,jsonb) from public,anon;
grant execute on function private.search_clinic_records(text,text,integer,jsonb) to authenticated;
create function public.search_clinic_records(p_query text,p_kind text default null,p_limit integer default 25,p_cursor jsonb default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.search_clinic_records(p_query,p_kind,p_limit,p_cursor); $$;
revoke all on function public.search_clinic_records(text,text,integer,jsonb) from public,anon;
grant execute on function public.search_clinic_records(text,text,integer,jsonb) to authenticated;

create function private.clinic_search_record(p_source text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=private.current_clinic_id(); d private.clinic_search_documents; p private.clinic_search_documents;
  related jsonb; fields jsonb; quantity numeric;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if tenant is null or private.staff_role() is null then raise exception 'FORBIDDEN'; end if;
  select * into d from private.clinic_search_documents where clinic_id=tenant and source_table=p_source and entity_id=p_id;
  if not found then return null; end if;
  fields:=d.fields;
  if d.pet_id is not null then
    select * into p from private.clinic_search_documents where clinic_id=tenant and source_table='pets' and entity_id=d.pet_id;
    fields:=fields||jsonb_strip_nulls(jsonb_build_object('Patient',p.title,'Patient record number',p.fields->>'Record number'));
  end if;
  if d.source_table='inventory_items' then
    select coalesce(sum(quantity_delta),0) into quantity from public.inventory_movements where item_id=d.entity_id and clinic_id=tenant;
    fields:=fields||jsonb_build_object('Stock quantity',quantity::text);
  elsif d.source_table='inventory_batches' then
    select coalesce(sum(quantity_delta),0) into quantity from public.inventory_movements where batch_id=d.entity_id and clinic_id=tenant;
    fields:=fields||jsonb_build_object('Batch quantity',quantity::text);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('source',r.source_table,'id',r.entity_id,'kind',r.kind,'title',left(r.title,160),'context',left(r.context,200),'href',private.search_href(r.source_table,r.entity_id)) order by r.source_table,r.entity_id),'[]') into related
    from private.clinic_search_documents r where r.clinic_id=tenant and (
      (r.source_table='pets' and r.entity_id=d.pet_id)
      or (r.source_table='owners' and r.entity_id=coalesce(d.owner_id,p.owner_id))
      or (r.source_table='inventory_items' and r.entity_id=d.item_id)
      or (r.source_table=d.parent_source and r.entity_id=d.parent_id));
  if d.source_table='visits' then
    related:=related||coalesce((select jsonb_agg(jsonb_build_object('source',r.source_table,'id',r.entity_id,'kind',r.kind,'title',r.title,'context',r.context,'href',private.search_href(r.source_table,r.entity_id)))
      from (select * from private.clinic_search_documents where clinic_id=tenant and source_table='visit_corrections' and parent_source='visits' and parent_id=d.entity_id order by occurred_at desc,entity_id desc limit 10) r),'[]');
  end if;
  return jsonb_build_object('source',d.source_table,'id',d.entity_id,'kind',d.kind,'title',left(d.title,160),'context',left(d.context,200),'status',private.search_care_status(d.source_table,d.entity_id,d.status),'date',d.occurred_at,
    'fields',fields,'related',related,'href',private.search_href(d.source_table,d.entity_id));
end $$;
revoke all on function private.clinic_search_record(text,uuid) from public,anon;
grant execute on function private.clinic_search_record(text,uuid) to authenticated;
create function public.clinic_search_record(p_source text,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.clinic_search_record(p_source,p_id); $$;
revoke all on function public.clinic_search_record(text,uuid) from public,anon;
grant execute on function public.clinic_search_record(text,uuid) to authenticated;
-- LIKE cannot use the trigram index across an RLS security barrier. A non-login,
-- non-BYPASSRLS role owns only this private index and the two guarded readers.
-- Those readers enforce the authenticated tenant on every branch/join. They
-- still inherit ordinary tenant RLS when reading real clinical/source tables.
-- No browser/service role can assume this role or query the private index.
do $$ declare had_create boolean:=has_schema_privilege('veterina_search','private','CREATE'); begin
  if not had_create then grant create on schema private to veterina_search; end if;
  alter table private.clinic_search_documents owner to veterina_search;
  alter function private.search_clinic_records(text,text,integer,jsonb) owner to veterina_search;
  alter function private.clinic_search_record(text,uuid) owner to veterina_search;
  if not had_create then revoke create on schema private from veterina_search; end if;
end $$;
notify pgrst,'reload schema';
