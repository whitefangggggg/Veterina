-- Service-prepared image bytes, keyed to the current patient photo revision.
-- Certificates copy these bytes into their immutable document snapshot.
create table private.travel_certificate_photos (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  photo_revision bigint not null check(photo_revision>=0),
  photo_data_url text not null check(length(photo_data_url)<=6666720 and photo_data_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$')
);
create index travel_certificate_photos_clinic on private.travel_certificate_photos(clinic_id);
alter table private.travel_certificate_photos enable row level security;
revoke all on private.travel_certificate_photos from public,anon,authenticated;
grant select,insert,update,delete on private.travel_certificate_photos to service_role;
grant select on private.travel_certificate_photos to veterina_rpc;
create policy travel_certificate_photos_rpc on private.travel_certificate_photos for select to veterina_rpc
  using(clinic_id=(select private.current_clinic_id()));
create trigger a_clinic_scope before insert or update on private.travel_certificate_photos
  for each row execute function private.enforce_clinic_scope();

do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.pet_photo_admin(uuid,jsonb)'::regprocedure);
  patched:=replace(definition,$old$  if action='read' then return to_jsonb(photo); end if;$old$,$new$  if action='read' then return to_jsonb(photo); end if;
  if action='certificate' then
    if photo.public_id is null or not patient.has_photo then raise exception 'NOT_FOUND'; end if;
    if patient.photo_revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'PHOTO_CONFLICT'; end if;
    insert into private.travel_certificate_photos(pet_id,clinic_id,photo_revision,photo_data_url)
      values(patient.id,patient.clinic_id,patient.photo_revision,p_data->>'photoDataUrl')
      on conflict(pet_id) do update set photo_revision=excluded.photo_revision,photo_data_url=excluded.photo_data_url;
    return jsonb_build_object('revision',patient.photo_revision,'photoDataUrl',p_data->>'photoDataUrl');
  end if;$new$);
  if patched=definition then raise exception 'Expected private photo read branch not found'; end if;
  execute patched;

  definition:=pg_get_functiondef('private.travel_certificate_mutation(text,jsonb)'::regprocedure);
  patched:=replace(definition,$old$  sequence_number bigint; reference text; history jsonb; document jsonb;$old$,
    $new$  sequence_number bigint; reference text; history jsonb; document jsonb; patient_photo text;$new$);
  if patched=definition then raise exception 'Expected certificate declarations not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$  select * into issuer from public.profiles$old$,$new$  if p_data ? 'patientPhotoRevision' and patient.photo_revision is distinct from (p_data->>'patientPhotoRevision')::bigint then
    raise exception 'PHOTO_CONFLICT: patient photo changed; refresh the patient and preview again';
  end if;
  if patient.has_photo then
    select photo_data_url into patient_photo from private.travel_certificate_photos
      where pet_id=patient.id and photo_revision=patient.photo_revision;
    if p_data ? 'patientPhotoRevision' and patient_photo is null then
      raise exception 'VALIDATION_FAILED: load the patient photo before issuing the certificate';
    end if;
  end if;
  select * into issuer from public.profiles$new$);
  if patched=definition then raise exception 'Expected certificate issuer lookup not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$'birthDateEstimated',patient.birth_date_estimated)$old$,
    $new$'birthDateEstimated',patient.birth_date_estimated,'photoDataUrl',patient_photo)$new$);
  if patched=definition then raise exception 'Expected patient snapshot not found'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
