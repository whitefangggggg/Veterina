-- Designation is independent of account permissions; credentials remain per person.
alter table public.profiles add column is_veterinarian boolean not null default false;
update public.profiles set is_veterinarian=true where nullif(btrim(prc_license_number),'') is not null;

create function private.save_veterinarian_details(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target uuid:=nullif(p_data->>'id','')::uuid; field text; value text; details jsonb:='{}'; expiry date;
begin
  if private.staff_role() is distinct from 'owner' then raise exception 'FORBIDDEN: veterinarian details are owner-managed'; end if;
  if jsonb_typeof(p_data->'fullName') is distinct from 'string' or length(btrim(p_data->>'fullName')) not between 1 and 120
    or (p_data->>'fullName') ~ '[[:cntrl:]]' or (p_data->>'fullName') !~ '[^[:space:]]' then
    raise exception 'VALIDATION_FAILED: enter a full name of up to 120 characters';
  end if;
  if jsonb_typeof(p_data->'isVeterinarian') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED: choose the veterinarian designation'; end if;
  foreach field in array array['tinNumber','prcLicenseNumber','ptrNumber'] loop
    if p_data->field is not null and p_data->field<>'null'::jsonb and
      (jsonb_typeof(p_data->field) is distinct from 'string' or length(btrim(p_data->>field))>64 or (p_data->>field) ~ '[[:cntrl:]]') then
      raise exception 'VALIDATION_FAILED: enter % of up to 64 characters',field;
    end if;
    value:=nullif(btrim(p_data->>field),'');
    details:=details||jsonb_build_object(field,value);
  end loop;
  if p_data->'licenseExpiresOn' is not null and p_data->'licenseExpiresOn'<>'null'::jsonb and nullif(p_data->>'licenseExpiresOn','') is not null then
    if jsonb_typeof(p_data->'licenseExpiresOn') is distinct from 'string' or (p_data->>'licenseExpiresOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'VALIDATION_FAILED: enter a valid license expiry date';
    end if;
    begin expiry:=(p_data->>'licenseExpiresOn')::date;
    exception when datetime_field_overflow or invalid_datetime_format then raise exception 'VALIDATION_FAILED: enter a valid license expiry date'; end;
  end if;
  update public.profiles set full_name=btrim(p_data->>'fullName'),is_veterinarian=(p_data->>'isVeterinarian')::boolean,
    tin_number=details->>'tinNumber',prc_license_number=details->>'prcLicenseNumber',ptr_number=details->>'ptrNumber',license_expires_on=expiry
    where id=target and clinic_id=private.current_clinic_id();
  if not found then raise exception 'NOT_FOUND: clinic staff profile'; end if;
  return jsonb_build_object('id',target);
end $$;
revoke all on function private.save_veterinarian_details(jsonb) from public,anon,authenticated;
grant execute on function private.save_veterinarian_details(jsonb) to veterina_rpc;

do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$  if p_action='set_veterinarian_tin' then$old$,
    $new$  if p_action='save_veterinarian_details' then
    result:=private.save_veterinarian_details(p_data); entity:=(result->>'id')::uuid;
  elsif p_action='set_veterinarian_tin' then$new$);
  if patched=definition then raise exception 'Expected veterinarian dispatcher not found'; end if;
  definition:=patched;
  patched:=replace(definition,
    $old$    update public.profiles set full_name=p_data->>'fullName',prc_license_number=p_data->>'prcLicenseNumber',ptr_number=p_data->>'ptrNumber',license_expires_on=nullif(p_data->>'licenseExpiresOn','')::date,
      tin_number=case when p_data ? 'tinNumber' then private.validated_veterinarian_tin(p_data->'tinNumber') else tin_number end where id=actor;$old$,
    $new$    -- Legacy identity/credential fields in clinic-settings payloads are intentionally ignored.$new$);
  if patched=definition then raise exception 'Expected combined clinic/profile settings update not found'; end if;
  execute patched;

  definition:=pg_get_functiondef('private.travel_certificate_mutation(text,jsonb)'::regprocedure);
  patched:=replace(definition,
    $old$select * into issuer from public.profiles where id=nullif(p_data->>'issuerId','')::uuid and is_active for share;
  if issuer.id is null then raise exception 'VALIDATION_FAILED: select active issuing personnel'; end if;$old$,
    $new$select * into issuer from public.profiles where id=nullif(p_data->>'issuerId','')::uuid and clinic_id=clinic_uuid and is_active and is_veterinarian for share;
  if issuer.id is null then raise exception 'VALIDATION_FAILED: select an active, designated veterinarian'; end if;$new$);
  if patched=definition then raise exception 'Expected certificate issuer check not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$document:=jsonb_build_object('version',3$old$,$new$document:=jsonb_build_object('version',4$new$);
  if patched=definition then raise exception 'Expected certificate snapshot version not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$'tinNumber',issuer.tin_number)$old$,$new$'tinNumber',issuer.tin_number,'licenseExpiresOn',issuer.license_expires_on)$new$);
  if patched=definition then raise exception 'Expected certificate credentials snapshot not found'; end if;
  execute patched;
end $$;

notify pgrst,'reload schema';
