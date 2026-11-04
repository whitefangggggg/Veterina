-- Small embedded logos remain within the clinic's existing settings RLS.
-- Re-encoding raster uploads as PNG avoids external URLs and expiring links
-- in private prescription exports.
alter table public.clinic_settings add column logo_data_url text
  check (logo_data_url is null or (length(logo_data_url) <= 400000
    and logo_data_url ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'));

grant create on schema private to veterina_rpc;
create function private.save_clinic_logo(p_logo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare image bytea; settings_id uuid;
begin
  if auth.uid() is null or private.staff_role() is distinct from 'owner' then
    raise exception 'FORBIDDEN: active clinic owner required';
  end if;
  if p_logo is not null then
    if length(p_logo)>400000 or p_logo !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$' then
      raise exception 'VALIDATION_FAILED: use a prepared PNG shop logo';
    end if;
    image := decode(substr(p_logo,23),'base64');
    if octet_length(image)<33 or substring(image from 1 for 8)<>decode('89504e470d0a1a0a','hex')
      or substring(image from 13 for 4)<>decode('49484452','hex')
      or get_byte(image,16)<>0 or get_byte(image,17)<>0 or get_byte(image,18)>1
      or get_byte(image,20)<>0 or get_byte(image,21)<>0 or get_byte(image,22)>1
      or (get_byte(image,18)*256+get_byte(image,19)) not between 1 and 256
      or (get_byte(image,22)*256+get_byte(image,23)) not between 1 and 256 then
      raise exception 'VALIDATION_FAILED: logo dimensions must be 1 to 256 pixels';
    end if;
  end if;
  update public.clinic_settings set logo_data_url=p_logo
    where clinic_id=private.current_clinic_id() returning id into settings_id;
  if not found then raise exception 'NOT_FOUND: clinic settings unavailable'; end if;
  return jsonb_build_object('id',settings_id);
end $$;
alter function private.save_clinic_logo(text) owner to veterina_rpc;
revoke all on function private.save_clinic_logo(text) from public,anon;
grant execute on function private.save_clinic_logo(text) to authenticated;
revoke create on schema private from veterina_rpc;

create function public.save_clinic_logo(p_logo text) returns jsonb
language sql security invoker set search_path='' as $$ select private.save_clinic_logo(p_logo); $$;
revoke all on function public.save_clinic_logo(text) from public,anon;
grant execute on function public.save_clinic_logo(text) to authenticated;
notify pgrst,'reload schema';
