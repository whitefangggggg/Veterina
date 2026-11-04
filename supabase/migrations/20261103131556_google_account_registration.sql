-- Google supplies identity, while clinic membership is chosen only after sign-in.
-- The helper must see private registration rows and provision a new workspace;
-- its public wrapper is an invoker and no table grants are added.
create function private.google_account_registration(p_actor uuid, p_registration jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := p_actor;
  account auth.users;
  request_status text;
  clinic uuid;
  full_name text;
  account_type text;
  clinic_name text;
begin
  if actor is null then raise exception 'UNAUTHORIZED: sign in with Google first'; end if;
  if current_setting('role', true) is distinct from 'service_role'
    and (actor is distinct from auth.uid() or p_registration is not null) then
    raise exception 'FORBIDDEN: complete registration through the verified Google registration endpoint';
  end if;
  -- Serialize setup and retries for this account, including owner provisioning.
  select * into account from auth.users where id = actor for update;
  if not found or account.email_confirmed_at is null or not exists (
    select 1 from auth.identities where user_id = actor and provider = 'google'
  ) then raise exception 'FORBIDDEN: a verified Google account is required'; end if;

  if exists (select 1 from public.profiles where id = actor) then
    return jsonb_build_object('status', 'registered');
  end if;
  select status into request_status from private.staff_join_requests where id = actor;
  if found then return jsonb_build_object('status', request_status); end if;
  if exists (select 1 from private.owner_registrations where id = actor) then
    return jsonb_build_object('status', 'pending');
  end if;
  if p_registration is null then return jsonb_build_object('status', 'unregistered'); end if;
  if jsonb_typeof(p_registration) is distinct from 'object' then
    raise exception 'VALIDATION_FAILED: account details required';
  end if;

  full_name := btrim(coalesce(p_registration->>'fullName', ''));
  account_type := p_registration->>'accountType';
  if length(full_name) not between 1 and 120 then
    raise exception 'VALIDATION_FAILED: enter your full name (up to 120 characters)';
  end if;

  if account_type = 'owner' then
    clinic_name := btrim(coalesce(p_registration->>'clinicName', ''));
    if length(clinic_name) not between 1 and 160 then
      raise exception 'VALIDATION_FAILED: enter your clinic name (up to 160 characters)';
    end if;
    -- This creates a new clinic; supplied IDs, roles and metadata are ignored.
    clinic := public.provision_vetshop(actor, clinic_name, full_name, 'Asia/Manila');
    insert into private.owner_registrations(id, full_name, clinic_name, clinic_id)
      values(actor, full_name, clinic_name, clinic);
    return jsonb_build_object('status', 'registered');
  elsif account_type = 'staff' then
    select k.clinic_id into clinic from private.clinic_codes k
      join public.clinics c on c.id = k.clinic_id
      where length(p_registration->>'veterinaCode') <= 60
        and k.code = private.normalized_veterina_code(p_registration->>'veterinaCode') and c.is_active;
    if clinic is null then
      raise exception 'INVALID_VETERINA_CODE: ask your shop owner for the current Veterina Code';
    end if;
    -- A join request grants no profile or clinic access until owner approval.
    insert into private.staff_join_requests(id, clinic_id, full_name, email, email_confirmed)
      values(actor, clinic, full_name, coalesce(account.email, ''), true);
    return jsonb_build_object('status', 'pending');
  else
    raise exception 'VALIDATION_FAILED: choose Owner or Staff';
  end if;
end $$;
revoke all on function private.google_account_registration(uuid,jsonb) from public, anon, authenticated;
grant execute on function private.google_account_registration(uuid,jsonb) to authenticated, service_role;

create function public.google_account_registration()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.google_account_registration(auth.uid(), null);
$$;
revoke all on function public.google_account_registration() from public, anon, authenticated;
grant execute on function public.google_account_registration() to authenticated;

-- Only the Edge Function's service client can submit a verified account's setup.
-- Browser calls never supply an actor ID or receive provisioning privileges.
create function public.complete_google_registration(p_actor uuid, p_registration jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.google_account_registration(p_actor, p_registration);
$$;
revoke all on function public.complete_google_registration(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.complete_google_registration(uuid,jsonb) to service_role;
