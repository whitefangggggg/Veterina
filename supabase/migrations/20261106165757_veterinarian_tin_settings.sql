-- Professional TIN belongs to the selected issuer, not to an issuance-form override.
alter table public.profiles add column tin_number text
  check(tin_number is null or (length(btrim(tin_number)) between 1 and 64 and tin_number !~ '[[:cntrl:]]'));

create function private.validated_veterinarian_tin(value jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
  if value is null or value='null'::jsonb then return null; end if;
  if jsonb_typeof(value) is distinct from 'string' or length(btrim(value#>>'{}'))>64 or (value#>>'{}') ~ '[[:cntrl:]]' then
    raise exception 'VALIDATION_FAILED: enter a TIN of up to 64 characters';
  end if;
  return nullif(btrim(value#>>'{}'),'');
end $$;
revoke all on function private.validated_veterinarian_tin(jsonb) from public,anon,authenticated;
grant execute on function private.validated_veterinarian_tin(jsonb) to veterina_rpc;

do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,
    $old$  if p_action in ('issue_travel_certificate','void_travel_certificate','set_travel_certificate_visibility') then$old$,
    $new$  if p_action='set_veterinarian_tin' then
    if staff_role<>'owner' then raise exception 'FORBIDDEN: veterinarian TINs are owner-managed'; end if;
    if not (p_data ? 'tinNumber') then raise exception 'VALIDATION_FAILED: TIN field required'; end if;
    update public.profiles set tin_number=private.validated_veterinarian_tin(p_data->'tinNumber')
      where id=entity and clinic_id=private.current_clinic_id() and is_active;
    if not found then raise exception 'NOT_FOUND: active veterinarian'; end if;
  elsif p_action in ('issue_travel_certificate','void_travel_certificate','set_travel_certificate_visibility') then$new$);
  if patched=definition then raise exception 'Expected certificate mutation dispatcher not found'; end if;
  definition:=patched;
  patched:=replace(definition,
    $old$set full_name=p_data->>'fullName',prc_license_number=p_data->>'prcLicenseNumber',ptr_number=p_data->>'ptrNumber',license_expires_on=nullif(p_data->>'licenseExpiresOn','')::date where id=actor;$old$,
    $new$set full_name=p_data->>'fullName',prc_license_number=p_data->>'prcLicenseNumber',ptr_number=p_data->>'ptrNumber',license_expires_on=nullif(p_data->>'licenseExpiresOn','')::date,
      tin_number=case when p_data ? 'tinNumber' then private.validated_veterinarian_tin(p_data->'tinNumber') else tin_number end where id=actor;$new$);
  if patched=definition then raise exception 'Expected professional settings update not found'; end if;
  execute patched;

  definition:=pg_get_functiondef('private.travel_certificate_mutation(text,jsonb)'::regprocedure);
  patched:=replace(definition,
    $old$  if p_data->'veterinarianTin' is not null and p_data->'veterinarianTin'<>'null'::jsonb
    and (jsonb_typeof(p_data->'veterinarianTin') is distinct from 'string'
      or length(btrim(p_data->>'veterinarianTin'))>64 or (p_data->>'veterinarianTin') ~ '[[:cntrl:]]') then
    raise exception 'VALIDATION_FAILED: enter a TIN of up to 64 characters';
  end if;
  issuer_tin:=nullif(btrim(p_data->>'veterinarianTin'),'');
$old$,
    $new$  -- Legacy issuance payload TINs are ignored; the locked issuer profile is authoritative.
$new$);
  if patched=definition then raise exception 'Expected certificate TIN override not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$'tinNumber',issuer_tin$old$,$new$'tinNumber',issuer.tin_number$new$);
  if patched=definition then raise exception 'Expected certificate issuer snapshot not found'; end if;
  execute replace(patched,'product_expiry date; issuer_tin text;','product_expiry date;');
end $$;

notify pgrst,'reload schema';
