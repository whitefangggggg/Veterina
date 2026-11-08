create table public.travel_certificates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default private.current_clinic_id() references public.clinics(id),
  pet_id uuid references public.pets(id) on delete set null,
  rabies_vaccination_id uuid references public.vaccinations(id) on delete set null,
  issued_by uuid references public.profiles(id) on delete set null,
  recorded_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  issued_on date not null,
  travel_date date not null check(travel_date>=issued_on),
  destination text not null check(length(btrim(destination)) between 1 and 300),
  reference_number text not null,
  pet_name text not null,
  owner_name text not null,
  issuer_name text not null,
  search_text text generated always as (reference_number||' '||pet_name||' '||owner_name) stored,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  status text not null default 'issued' check(status in ('issued','void')),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  unique(clinic_id,reference_number),
  check((status='issued' and voided_at is null and voided_by is null and void_reason is null)
    or (status='void' and voided_at is not null and length(btrim(void_reason)) between 1 and 1000))
);
create index travel_certificates_clinic_issued on public.travel_certificates(clinic_id,issued_at desc,id desc);
create index travel_certificates_pet on public.travel_certificates(pet_id) where pet_id is not null;
create index travel_certificates_vaccination on public.travel_certificates(rabies_vaccination_id) where rabies_vaccination_id is not null;
create index travel_certificates_issuer on public.travel_certificates(issued_by) where issued_by is not null;
create index travel_certificates_recorder on public.travel_certificates(recorded_by) where recorded_by is not null;
create index travel_certificates_voider on public.travel_certificates(voided_by) where voided_by is not null;
alter table public.travel_certificates enable row level security;
revoke all on public.travel_certificates from public,anon,authenticated;
grant select on public.travel_certificates to authenticated;
grant select,insert,update on public.travel_certificates to veterina_rpc;
create policy travel_certificates_read on public.travel_certificates for select to authenticated
  using(clinic_id=(select private.current_clinic_id()));
create policy travel_certificates_rpc on public.travel_certificates for all to veterina_rpc
  using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()));
create trigger a_clinic_scope before insert or update on public.travel_certificates
  for each row execute function private.enforce_clinic_scope();
create trigger travel_certificates_audit after insert or update on public.travel_certificates
  for each row execute function private.write_audit_log();

create table private.travel_certificate_counters (
  clinic_id uuid not null references public.clinics(id),
  issue_year integer not null,
  last_number bigint not null check(last_number>0),
  primary key(clinic_id,issue_year)
);
alter table private.travel_certificate_counters enable row level security;
revoke all on private.travel_certificate_counters from public,anon,authenticated;
grant select,insert,update on private.travel_certificate_counters to veterina_rpc;
create policy travel_certificate_counter_rpc on private.travel_certificate_counters for all to veterina_rpc
  using(clinic_id=(select private.current_clinic_id())) with check(clinic_id=(select private.current_clinic_id()));

create function private.guard_travel_certificate() returns trigger
language plpgsql security invoker set search_path='' as $$
declare field text; parent regclass; old_id uuid; new_id uuid; present boolean;
begin
  if tg_op='DELETE' then raise exception 'IMMUTABLE_CERTIFICATE: void the certificate instead'; end if;
  if (to_jsonb(new)-array['search_text','pet_id','rabies_vaccination_id','issued_by','recorded_by','voided_by','status','voided_at','void_reason'])
    is distinct from (to_jsonb(old)-array['search_text','pet_id','rabies_vaccination_id','issued_by','recorded_by','voided_by','status','voided_at','void_reason']) then
    raise exception 'IMMUTABLE_CERTIFICATE: issue a replacement instead';
  end if;
  -- FK deletion may clear source links, while the issued document remains intact.
  foreach field in array array['pet_id','rabies_vaccination_id','issued_by','recorded_by','voided_by'] loop
    if field='voided_by' and old.status='issued' and new.status='void' then continue; end if;
    old_id:=nullif(to_jsonb(old)->>field,'')::uuid; new_id:=nullif(to_jsonb(new)->>field,'')::uuid;
    if old_id is not distinct from new_id then continue; end if;
    parent:=case field when 'pet_id' then 'public.pets'::regclass when 'rabies_vaccination_id' then 'public.vaccinations'::regclass else 'public.profiles'::regclass end;
    execute format('select exists(select 1 from %s where id=$1)',parent) into present using old_id;
    if new_id is not null or present then raise exception 'IMMUTABLE_CERTIFICATE: source links cannot be changed'; end if;
  end loop;
  if (new.status,new.voided_at,new.voided_by,new.void_reason) is distinct from (old.status,old.voided_at,old.voided_by,old.void_reason)
    and not (new.status=old.status and new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason and new.voided_by is null and old.voided_by is not null) then
    if private.staff_role() is distinct from 'owner'::public.staff_role then raise exception 'FORBIDDEN: owner required to void certificates'; end if;
    if old.status<>'issued' or new.status<>'void' or length(btrim(coalesce(new.void_reason,''))) not between 1 and 1000 then raise exception 'INVALID_TRANSITION: certificate cannot be changed'; end if;
    new.voided_at:=now(); new.voided_by:=auth.uid(); new.void_reason:=btrim(new.void_reason);
  end if;
  return new;
end $$;
create trigger travel_certificates_immutable before update or delete on public.travel_certificates
  for each row execute function private.guard_travel_certificate();
revoke all on function private.guard_travel_certificate() from public,anon,authenticated;
grant execute on function private.guard_travel_certificate() to veterina_rpc;

create function private.travel_certificate_mutation(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare patient public.pets; household public.owners; issuer public.profiles; clinic public.clinic_settings;
  vaccination public.vaccinations; certificate public.travel_certificates; owner_uuid uuid;
  clinic_uuid uuid:=private.current_clinic_id(); issue_day date; journey_day date; destination_name text;
  sequence_number bigint; reference text; history jsonb; document jsonb;
begin
  if auth.uid() is null or private.staff_role() is null or clinic_uuid is null then raise exception 'FORBIDDEN: active clinic access required'; end if;
  if p_action='void_travel_certificate' then
    if private.staff_role()<>'owner' then raise exception 'FORBIDDEN: owner required to void certificates'; end if;
    if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(coalesce(p_data->>'reason',''))) not between 1 and 1000 then raise exception 'VALIDATION_FAILED: a void reason is required'; end if;
    select * into certificate from public.travel_certificates where id=nullif(p_data->>'id','')::uuid for update;
    if certificate.id is null then raise exception 'NOT_FOUND: certificate'; end if;
    if certificate.status<>'issued' then raise exception 'INVALID_TRANSITION: certificate is already void'; end if;
    update public.travel_certificates set status='void',voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_data->>'reason') where id=certificate.id;
    return jsonb_build_object('id',certificate.id,'referenceNumber',certificate.reference_number);
  end if;
  if p_action<>'issue_travel_certificate' then raise exception 'VALIDATION_FAILED: unknown certificate action'; end if;
  if p_data->'rabiesConfirmed' is distinct from 'true'::jsonb or p_data->'eligibilityConfirmed' is distinct from 'true'::jsonb then
    raise exception 'VALIDATION_FAILED: confirm the Anti-Rabies record and review of travel eligibility';
  end if;
  select * into clinic from public.clinic_settings where clinic_id=clinic_uuid for share;
  if clinic.id is null then raise exception 'VALIDATION_FAILED: clinic details required'; end if;
  issue_day:=(now() at time zone coalesce(clinic.timezone,'Asia/Manila'))::date;
  if coalesce(p_data->>'travelDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(p_data->'destination') is distinct from 'string' then raise exception 'VALIDATION_FAILED: travel date and destination required'; end if;
  journey_day:=nullif(p_data->>'travelDate','')::date; destination_name:=btrim(coalesce(p_data->>'destination',''));
  if journey_day is null or journey_day<issue_day or length(destination_name) not between 1 and 300 then raise exception 'VALIDATION_FAILED: choose a current or future travel date and enter the destination'; end if;
  select owner_id into owner_uuid from public.pets where id=nullif(p_data->>'petId','')::uuid;
  select * into household from public.owners where id=owner_uuid for share;
  select * into patient from public.pets where id=nullif(p_data->>'petId','')::uuid for share;
  if patient.id is null or household.id is null then raise exception 'NOT_FOUND: patient or owner'; end if;
  if patient.owner_id<>household.id then raise exception 'RECORD_CHANGED: patient owner changed; refresh the records'; end if;
  if patient.status<>'Active' or not household.is_active then raise exception 'VALIDATION_FAILED: select an active patient with an active owner'; end if;
  select * into issuer from public.profiles where id=nullif(p_data->>'issuerId','')::uuid and is_active for share;
  if issuer.id is null then raise exception 'VALIDATION_FAILED: select active issuing personnel'; end if;
  -- Queue rows precede clinical records in the existing clinical lock order.
  perform 1 from public.queue_entries where pet_id=patient.id and category='vaccination' order by id for share;
  perform 1 from public.vaccinations where pet_id=patient.id order by id for share;
  select * into vaccination from public.vaccinations where id=nullif(p_data->>'rabiesVaccinationId','')::uuid and pet_id=patient.id;
  if vaccination.id is null then raise exception 'VALIDATION_FAILED: select this pet''s Anti-Rabies vaccination'; end if;
  if exists(select 1 from public.queue_entries where vaccination_id=vaccination.id and status<>'completed') then raise exception 'VALIDATION_FAILED: the selected vaccination must be completed'; end if;
  if vaccination.administered_at is null or not isfinite(vaccination.administered_at) or vaccination.administered_at>issue_day then raise exception 'VALIDATION_FAILED: vaccination date must be on or before issuance'; end if;
  if vaccination.next_due_at is null or not isfinite(vaccination.next_due_at) or vaccination.next_due_at<issue_day or vaccination.next_due_at<journey_day then
    raise exception 'VALIDATION_FAILED: Anti-Rabies validity must be recorded and cover issuance and travel; update the vaccination record';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.vaccine_name,'brand',v.brand,'lotNumber',v.lot_number,'dose',v.dose,
      'administeredOn',v.administered_at,'validThrough',v.next_due_at,'administeredBy',v.administered_by_name) order by v.administered_at desc,v.id),'[]')
    into history from public.vaccinations v where v.pet_id=patient.id and isfinite(v.administered_at) and v.administered_at<=issue_day
      and not exists(select 1 from public.queue_entries q where q.vaccination_id=v.id and q.status<>'completed');
  document:=jsonb_build_object('version',1,'issuedOn',issue_day,
    'pet',jsonb_build_object('name',patient.name,'species',patient.species,'breed',patient.breed,'recordNumber',patient.record_number,'birthDate',patient.birth_date,'birthDateEstimated',patient.birth_date_estimated),
    'owner',jsonb_build_object('name',household.full_name),
    'clinic',jsonb_build_object('name',clinic.clinic_name,'address',clinic.address,'phone',clinic.phone,'email',clinic.email,'logoDataUrl',clinic.logo_data_url),
    'issuer',jsonb_build_object('name',issuer.full_name,'title',issuer.job_title,'prcLicenseNumber',issuer.prc_license_number,'ptrNumber',issuer.ptr_number),
    'journey',jsonb_build_object('date',journey_day,'destination',destination_name),
    'rabiesVaccinationId',vaccination.id,'vaccinations',history,
    'review',jsonb_build_object('rabiesConfirmed',true,'eligibilityConfirmed',true));
  insert into private.travel_certificate_counters(clinic_id,issue_year,last_number) values(clinic_uuid,extract(year from issue_day)::integer,1)
    on conflict(clinic_id,issue_year) do update set last_number=private.travel_certificate_counters.last_number+1 returning last_number into sequence_number;
  reference:=format('TC-%s-%s',extract(year from issue_day)::integer,lpad(sequence_number::text,greatest(6,length(sequence_number::text)),'0'));
  insert into public.travel_certificates(clinic_id,pet_id,rabies_vaccination_id,issued_by,recorded_by,issued_on,travel_date,destination,reference_number,pet_name,owner_name,issuer_name,snapshot)
    values(clinic_uuid,patient.id,vaccination.id,issuer.id,auth.uid(),issue_day,journey_day,destination_name,reference,patient.name,household.full_name,issuer.full_name,document) returning id into certificate.id;
  return jsonb_build_object('id',certificate.id,'referenceNumber',reference);
end $$;
revoke all on function private.travel_certificate_mutation(text,jsonb) from public,anon,authenticated;
grant execute on function private.travel_certificate_mutation(text,jsonb) to veterina_rpc;

do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  if p_action='create_record_only_checkup' then$old$,$new$  if p_action in ('issue_travel_certificate','void_travel_certificate') then
    result:=private.travel_certificate_mutation(p_action,p_data); entity:=(result->>'id')::uuid;
  elsif p_action='create_record_only_checkup' then$new$);
  if patched=definition then raise exception 'Expected portal dispatcher branch not found'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
