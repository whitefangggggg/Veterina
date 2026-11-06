alter table public.travel_certificates
  add column public_token text not null default encode(extensions.gen_random_bytes(32),'hex')
    check(public_token ~ '^[a-f0-9]{64}$'),
  add column is_public boolean not null default false;
create unique index travel_certificates_public_token on public.travel_certificates(public_token);
grant select on public.travel_certificates to service_role;

-- Sharing is mutable and audited; issued content and its QR token stay immutable.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('private.guard_travel_certificate()'::regprocedure);
  patched:=replace(definition,$old$array['search_text',$old$,$new$array['is_public','search_text',$new$);
  if patched=definition then raise exception 'Expected certificate immutability comparison not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$  return new;$old$,$new$  if new.is_public is distinct from old.is_public and (auth.uid() is null or private.staff_role() is null) then
    raise exception 'FORBIDDEN: active clinic staff required to change public access';
  end if;
  return new;$new$);
  if patched=definition then raise exception 'Expected certificate guard return not found'; end if;
  execute patched;

  definition:=pg_get_functiondef('private.travel_certificate_mutation(text,jsonb)'::regprocedure);
  patched:=replace(definition,$old$  if p_action='void_travel_certificate' then$old$,$new$  if p_action='set_travel_certificate_visibility' then
    if jsonb_typeof(p_data->'isPublic') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED: choose public or private'; end if;
    select * into certificate from public.travel_certificates where id=nullif(p_data->>'id','')::uuid for update;
    if certificate.id is null then raise exception 'NOT_FOUND: certificate'; end if;
    update public.travel_certificates set is_public=(p_data->>'isPublic')::boolean where id=certificate.id;
    return jsonb_build_object('id',certificate.id,'isPublic',(p_data->>'isPublic')::boolean);
  end if;
  if p_action='void_travel_certificate' then$new$);
  if patched=definition then raise exception 'Expected certificate actions not found'; end if;
  definition:=patched;
  patched:=replace(definition,$old$  select * into clinic from public.clinic_settings$old$,$new$  if p_data ? 'isPublic' and jsonb_typeof(p_data->'isPublic') is distinct from 'boolean' then
    raise exception 'VALIDATION_FAILED: choose public or private';
  end if;
  select * into clinic from public.clinic_settings$new$);
  if patched=definition then raise exception 'Expected certificate clinic lookup not found'; end if;
  definition:=patched;
  patched:=replace(definition,'reference_number,pet_name,owner_name,issuer_name,snapshot)',
    'reference_number,pet_name,owner_name,issuer_name,snapshot,is_public)');
  patched:=replace(patched,'issuer.full_name,document) returning id',
    'issuer.full_name,document,coalesce((p_data->>''isPublic'')::boolean,false)) returning id');
  if patched=definition then raise exception 'Expected certificate insert not found'; end if;
  execute patched;

  definition:=pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure);
  patched:=replace(definition,$old$('issue_travel_certificate','void_travel_certificate')$old$,
    $new$('issue_travel_certificate','void_travel_certificate','set_travel_certificate_visibility')$new$);
  if patched=definition then raise exception 'Expected certificate dispatcher not found'; end if;
  execute patched;
end $$;

-- The public Edge Function can fetch one explicitly shared document. Browser
-- roles cannot invoke this function or read certificate tables anonymously.
create function public.read_public_travel_certificate(p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('reference_number',t.reference_number,'status',t.status,'void_reason',t.void_reason,'snapshot',t.snapshot)
  from public.travel_certificates t join public.clinics c on c.id=t.clinic_id
  where p_token ~ '^[a-f0-9]{64}$' and t.public_token=p_token and t.is_public
    and c.is_active and private.subscription_active(c.id);
$$;
revoke all on function public.read_public_travel_certificate(text) from public,anon,authenticated;
grant execute on function public.read_public_travel_certificate(text) to service_role;
notify pgrst,'reload schema';
