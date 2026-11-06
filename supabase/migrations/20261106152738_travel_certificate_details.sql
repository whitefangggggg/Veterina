-- Existing issued documents are retained verbatim; new details live in version-2 snapshots.
alter table public.travel_certificates
  add column control_number text check(control_number is null or (length(btrim(control_number)) between 1 and 64 and control_number !~ '[[:cntrl:]]')),
  add column valid_until date check(valid_until is null or (isfinite(valid_until) and valid_until>=travel_date));
-- Control numbers may restart in a new issuance year. Leading zeroes remain text.
create unique index travel_certificates_control_year
  on public.travel_certificates(clinic_id,extract(year from issued_on),lower(control_number)) where control_number is not null;
alter table public.travel_certificates drop column search_text;
alter table public.travel_certificates add column search_text text generated always as
  (coalesce(control_number||' ','')||reference_number||' '||pet_name||' '||owner_name) stored;

CREATE OR REPLACE FUNCTION private.travel_certificate_mutation(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare patient public.pets; household public.owners; issuer public.profiles; clinic public.clinic_settings;
  vaccination public.vaccinations; certificate public.travel_certificates; owner_uuid uuid;
  clinic_uuid uuid:=private.current_clinic_id(); issue_day date; journey_day date; destination_name text;
  sequence_number bigint; reference text; history jsonb; document jsonb; patient_photo text;
  control text; certificate_until date; product_expiry date; issuer_tin text; weight numeric; violated_constraint text;
begin
  if auth.uid() is null or private.staff_role() is null or clinic_uuid is null then raise exception 'FORBIDDEN: active clinic access required'; end if;
  if p_action='set_travel_certificate_visibility' then
    if jsonb_typeof(p_data->'isPublic') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED: choose public or private'; end if;
    select * into certificate from public.travel_certificates where id=nullif(p_data->>'id','')::uuid for update;
    if certificate.id is null then raise exception 'NOT_FOUND: certificate'; end if;
    update public.travel_certificates set is_public=(p_data->>'isPublic')::boolean where id=certificate.id;
    return jsonb_build_object('id',certificate.id,'isPublic',(p_data->>'isPublic')::boolean);
  end if;
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
  if p_data ? 'isPublic' and jsonb_typeof(p_data->'isPublic') is distinct from 'boolean' then
    raise exception 'VALIDATION_FAILED: choose public or private';
  end if;
  select * into clinic from public.clinic_settings where clinic_id=clinic_uuid for share;
  if clinic.id is null then raise exception 'VALIDATION_FAILED: clinic details required'; end if;
  issue_day:=(now() at time zone coalesce(clinic.timezone,'Asia/Manila'))::date;
  if coalesce(p_data->>'travelDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(p_data->'destination') is distinct from 'string' then raise exception 'VALIDATION_FAILED: travel date and destination required'; end if;
  journey_day:=nullif(p_data->>'travelDate','')::date; destination_name:=btrim(coalesce(p_data->>'destination',''));
  if journey_day is null or journey_day<issue_day or length(destination_name) not between 1 and 300 then raise exception 'VALIDATION_FAILED: choose a current or future travel date and enter the destination'; end if;
  if jsonb_typeof(p_data->'controlNumber') is distinct from 'string'
    or length(btrim(p_data->>'controlNumber')) not between 1 and 64
    or (p_data->>'controlNumber') ~ '[[:cntrl:]]' then
    raise exception 'VALIDATION_FAILED: enter a control number of up to 64 characters';
  end if;
  control:=btrim(p_data->>'controlNumber');
  if coalesce(p_data->>'validUntil','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'VALIDATION_FAILED: certificate valid-until date required';
  end if;
  begin
    certificate_until:=(p_data->>'validUntil')::date;
    if nullif(p_data->>'vaccineExpirationDate','') is not null then
      if (p_data->>'vaccineExpirationDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'VALIDATION_FAILED: enter a valid vaccine product expiration date';
      end if;
      product_expiry:=(p_data->>'vaccineExpirationDate')::date;
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'VALIDATION_FAILED: enter valid certificate and vaccine expiration dates';
  end;
  if certificate_until<journey_day or certificate_until<issue_day then
    raise exception 'VALIDATION_FAILED: certificate validity must cover issuance and travel';
  end if;
  if p_data->'veterinarianTin' is not null and p_data->'veterinarianTin'<>'null'::jsonb
    and (jsonb_typeof(p_data->'veterinarianTin') is distinct from 'string'
      or length(btrim(p_data->>'veterinarianTin'))>64 or (p_data->>'veterinarianTin') ~ '[[:cntrl:]]') then
    raise exception 'VALIDATION_FAILED: enter a TIN of up to 64 characters';
  end if;
  issuer_tin:=nullif(btrim(p_data->>'veterinarianTin'),'');
  select owner_id into owner_uuid from public.pets where id=nullif(p_data->>'petId','')::uuid;
  select * into household from public.owners where id=owner_uuid for share;
  select * into patient from public.pets where id=nullif(p_data->>'petId','')::uuid for share;
  if patient.id is null or household.id is null then raise exception 'NOT_FOUND: patient or owner'; end if;
  if patient.owner_id<>household.id then raise exception 'RECORD_CHANGED: patient owner changed; refresh the records'; end if;
  if patient.status<>'Active' or not household.is_active then raise exception 'VALIDATION_FAILED: select an active patient with an active owner'; end if;
  if p_data ? 'patientPhotoRevision' and patient.photo_revision is distinct from (p_data->>'patientPhotoRevision')::bigint then
    raise exception 'PHOTO_CONFLICT: patient photo changed; refresh the patient and preview again';
  end if;
  if patient.has_photo then
    select photo_data_url into patient_photo from private.travel_certificate_photos
      where pet_id=patient.id and photo_revision=patient.photo_revision;
    if p_data ? 'patientPhotoRevision' and patient_photo is null then
      raise exception 'VALIDATION_FAILED: load the patient photo before issuing the certificate';
    end if;
  end if;
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
  if certificate_until>vaccination.next_due_at then
    raise exception 'VALIDATION_FAILED: certificate validity cannot exceed the recorded Anti-Rabies next-dose date';
  end if;
  if product_expiry<vaccination.administered_at then
    raise exception 'VALIDATION_FAILED: vaccine product expiration cannot precede administration';
  end if;
  select vv.weight_kg into weight from public.visit_vitals vv join public.visits v on v.id=vv.visit_id
    where v.pet_id=patient.id and vv.weight_kg is not null and v.visited_at<=now() and vv.measured_at<=now()
    order by v.visited_at desc,vv.measured_at desc,vv.id desc limit 1;
  weight:=coalesce(weight,patient.baseline_weight);
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.vaccine_name,'brand',v.brand,'lotNumber',v.lot_number,'dose',v.dose,
      'administeredOn',v.administered_at,'validThrough',v.next_due_at,'administeredBy',v.administered_by_name) || case when v.id=vaccination.id then jsonb_build_object('type','Anti-Rabies','vaccinated',true,'expirationDate',product_expiry) else '{}'::jsonb end order by v.administered_at desc,v.id),'[]')
    into history from public.vaccinations v where v.pet_id=patient.id and isfinite(v.administered_at) and v.administered_at<=issue_day
      and not exists(select 1 from public.queue_entries q where q.vaccination_id=v.id and q.status<>'completed');
  document:=jsonb_build_object('version',2,'issuedOn',issue_day,'issuedTime',to_char(now() at time zone coalesce(clinic.timezone,'Asia/Manila'),'HH24:MI'),
    'timezone',coalesce(clinic.timezone,'Asia/Manila'),'controlNumber',control,'validUntil',certificate_until,
    'pet',jsonb_build_object('name',patient.name,'species',patient.species,'breed',patient.breed,'recordNumber',patient.record_number,'birthDate',patient.birth_date,'birthDateEstimated',patient.birth_date_estimated,'photoDataUrl',patient_photo,'color',patient.color_markings,'sex',patient.sex,'weightKg',weight,'microchipNumber',patient.microchip_number),
    'owner',jsonb_build_object('name',household.full_name,'address',household.address,'contactNumber',household.phone),
    'clinic',jsonb_build_object('name',clinic.clinic_name,'address',clinic.address,'phone',clinic.phone,'email',clinic.email,'logoDataUrl',clinic.logo_data_url),
    'issuer',jsonb_build_object('name',issuer.full_name,'title',issuer.job_title,'prcLicenseNumber',issuer.prc_license_number,'ptrNumber',issuer.ptr_number,'tinNumber',issuer_tin),
    'journey',jsonb_build_object('date',journey_day,'destination',destination_name),
    'rabiesVaccinationId',vaccination.id,'vaccinations',history,
    'review',jsonb_build_object('rabiesConfirmed',true,'eligibilityConfirmed',true));
  insert into private.travel_certificate_counters(clinic_id,issue_year,last_number) values(clinic_uuid,extract(year from issue_day)::integer,1)
    on conflict(clinic_id,issue_year) do update set last_number=private.travel_certificate_counters.last_number+1 returning last_number into sequence_number;
  reference:=format('TC-%s-%s',extract(year from issue_day)::integer,lpad(sequence_number::text,greatest(6,length(sequence_number::text)),'0'));
  begin
  insert into public.travel_certificates(clinic_id,pet_id,rabies_vaccination_id,issued_by,recorded_by,issued_on,travel_date,destination,reference_number,pet_name,owner_name,issuer_name,snapshot,is_public,control_number,valid_until)
    values(clinic_uuid,patient.id,vaccination.id,issuer.id,auth.uid(),issue_day,journey_day,destination_name,reference,patient.name,household.full_name,issuer.full_name,document,coalesce((p_data->>'isPublic')::boolean,false),control,certificate_until) returning id into certificate.id;
  exception when unique_violation then
    get stacked diagnostics violated_constraint=constraint_name;
    if violated_constraint='travel_certificates_control_year' then
      raise exception 'VALIDATION_FAILED: control number already exists for this clinic and issuance year; enter another control number';
    end if;
    raise;
  end;
  return jsonb_build_object('id',certificate.id,'referenceNumber',reference);
end $function$;


notify pgrst,'reload schema';
