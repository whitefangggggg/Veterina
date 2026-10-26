-- Synthetic fixtures and all writes roll back, including audit/RAG/idempotency rows.
begin;
select set_config('color_test.actor',gen_random_uuid()::text,true);
select set_config('color_test.pending',gen_random_uuid()::text,true);
select set_config('color_test.inactive',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
select current_setting('color_test.actor')::uuid,'color-staff-'||gen_random_uuid()||'@veterina-test.invalid',now()
union all select current_setting('color_test.pending')::uuid,'color-pending-'||gen_random_uuid()||'@veterina-test.invalid',now()
union all select current_setting('color_test.inactive')::uuid,'color-inactive-'||gen_random_uuid()||'@veterina-test.invalid',now();
insert into public.profiles(id,full_name,role,is_active) values
 (current_setting('color_test.actor')::uuid,'Color test clinician','clinical_staff',true),
 (current_setting('color_test.inactive')::uuid,'Color test inactive clinician','clinical_staff',false);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('color_test.actor'),'role','authenticated')::text,true);

create function pg_temp.reject_color(data jsonb,pattern text) returns void language plpgsql as $$
begin
  begin
    perform public.portal_mutation('set_visit_card_color',data,gen_random_uuid());
  exception when others then
    if sqlerrm like pattern then return; end if;
    raise;
  end;
  raise exception 'TEST: color action unexpectedly accepted';
end $$;
grant execute on function pg_temp.reject_color(jsonb,text) to authenticated, anon;
set local role authenticated;
do $$
declare
  actor uuid:=current_setting('color_test.actor')::uuid;
  owner_id uuid; pet uuid; visit_id uuid; key uuid:=gen_random_uuid();
  payload jsonb; clinical jsonb; original jsonb; response jsonb;
begin
  owner_id:=(public.portal_mutation('create_owner',jsonb_build_object('fullName','Color fixture owner','phone','09171234567','address','Test'),gen_random_uuid())->>'id')::uuid;
  pet:=(public.portal_mutation('create_pet',jsonb_build_object('ownerId',owner_id,'name','Color fixture patient','species','Dog','breed','Mixed','sex','Male','reproductiveStatus','Intact'),gen_random_uuid())->>'id')::uuid;
  clinical:=jsonb_build_object('petId',pet,'veterinarianId',actor,'type','Wellness','complaint','Color fixture','weightKg','5');
  visit_id:=(public.portal_mutation('create_encounter',clinical,gen_random_uuid())->>'id')::uuid;
  perform set_config('color_test.visit',visit_id::text,true);
  if (select card_color from public.visits where id=visit_id) is not null then raise exception 'TEST: default color must be null'; end if;
  select to_jsonb(v)-'card_color'-'updated_at' into original from public.visits v where id=visit_id;
  payload:=jsonb_build_object('id',visit_id,'cardColor','#CC5599');
  response:=public.portal_mutation('set_visit_card_color',payload,key);
  if (select card_color from public.visits where id=visit_id) is distinct from '#cc5599' then raise exception 'TEST: color save'; end if;
  if public.portal_mutation('set_visit_card_color',payload,key)<>response then raise exception 'TEST: color replay'; end if;
  if (select to_jsonb(v)-'card_color'-'updated_at' from public.visits v where id=visit_id) is distinct from original then raise exception 'TEST: color altered clinical data'; end if;
  perform pg_temp.reject_color(jsonb_build_object('id',visit_id),'VALIDATION_FAILED%');
  perform pg_temp.reject_color(jsonb_build_object('id',visit_id,'cardColor','red'),'VALIDATION_FAILED%');
  perform pg_temp.reject_color(jsonb_build_object('id',visit_id,'cardColor','#fff'),'VALIDATION_FAILED%');
  perform pg_temp.reject_color(jsonb_build_object('id',visit_id,'cardColor','#12345678'),'VALIDATION_FAILED%');
  perform pg_temp.reject_color(jsonb_build_object('id',visit_id,'cardColor',123456),'VALIDATION_FAILED%');
  perform pg_temp.reject_color(jsonb_build_object('id',visit_id,'cardColor',jsonb_build_object('hex','#123456')),'VALIDATION_FAILED%');
  perform pg_temp.reject_color(jsonb_build_object('id',gen_random_uuid(),'cardColor','#123456'),'NOT_FOUND%');
  perform public.portal_mutation('set_visit_card_color',jsonb_build_object('id',visit_id,'cardColor',null),gen_random_uuid());
  if (select card_color from public.visits where id=visit_id) is not null then raise exception 'TEST: color reset'; end if;
  perform public.portal_mutation('finalize_encounter',jsonb_build_object('id',visit_id),gen_random_uuid());
  select to_jsonb(v)-'card_color'-'updated_at' into original from public.visits v where id=visit_id;
  perform public.portal_mutation('set_visit_card_color',jsonb_build_object('id',visit_id,'cardColor','#2288cc'),gen_random_uuid());
  if (select card_color from public.visits where id=visit_id) is distinct from '#2288cc' then raise exception 'TEST: finalized card color'; end if;
  if (select to_jsonb(v)-'card_color'-'updated_at' from public.visits v where id=visit_id) is distinct from original then raise exception 'TEST: finalized record changed'; end if;
  begin
    perform public.portal_mutation('update_encounter',clinical||jsonb_build_object('id',visit_id,'complaint','Forbidden edit'),gen_random_uuid());
    raise exception 'TEST: finalized clinical edit accepted';
  exception when others then if sqlerrm not like 'RECORD_FINALIZED%' then raise; end if; end;
  perform public.portal_mutation('set_visit_card_color',jsonb_build_object('id',visit_id,'cardColor',null),gen_random_uuid());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('color_test.pending'),'role','authenticated')::text,true);
  perform pg_temp.reject_color(payload,'FORBIDDEN%');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('color_test.inactive'),'role','authenticated')::text,true);
  perform pg_temp.reject_color(payload,'FORBIDDEN%');
end $$;

-- Even an update that combines a valid color with a clinical edit stays blocked.
reset role;
do $$
begin
  -- Clinical staff cannot read audit logs; check these as the fixture administrator.
  if (select count(*) from public.audit_logs where table_name='visits' and record_id=current_setting('color_test.visit') and action='UPDATE')<>5 then
    raise exception 'TEST: color audit/replay';
  end if;
  begin
    update public.visits set card_color='#123456',chief_complaint='Forbidden clinical edit'
      where id=current_setting('color_test.visit')::uuid;
    raise exception 'TEST: combined finalized update accepted';
  exception when others then if sqlerrm not like 'RECORD_FINALIZED%' then raise; end if; end;
  begin
    update public.visits set finalized_at=null,card_color='#123456'
      where id=current_setting('color_test.visit')::uuid;
    raise exception 'TEST: finalized record unlocked';
  exception when others then if sqlerrm not like 'RECORD_FINALIZED%' then raise; end if; end;
  begin
    update public.visits set card_color='invalid' where id=current_setting('color_test.visit')::uuid;
    raise exception 'TEST: color constraint bypassed';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.reject_color(jsonb_build_object('id',current_setting('color_test.visit'),'cardColor','#123456'),'permission denied%');
reset role;
rollback;
select 'PASS: card colors, reset, validation, audit/idempotency, active staff permissions and finalized clinical guards (fixtures rolled back)' as result;
