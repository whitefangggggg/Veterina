-- A claimed cleanup permanently retires an unfinished upload ID. Keeping its
-- request tombstone prevents a delayed cleanup worker deleting a retried asset.
do $migration$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('public.pet_photo_admin(uuid,jsonb)'::regprocedure);
  patched:=replace(definition,
    'delete from private.pet_photo_requests where public_id=p_data->>''publicId'' and not completed;',
    '-- Retain incomplete request IDs as tombstones after external deletion.');
  patched:=replace(patched,
    'if exists(select 1 from private.pet_photo_cleanup where public_id=request.public_id and lease_until>now()) then raise exception ''PHOTO_BUSY''; end if;',
    'if not exists(select 1 from private.pet_photo_cleanup where public_id=request.public_id) or exists(select 1 from private.pet_photo_cleanup where public_id=request.public_id and attempts>0) then raise exception ''PHOTO_CONFLICT''; end if;
      if exists(select 1 from private.pet_photo_cleanup where public_id=request.public_id and lease_until>now()) then raise exception ''PHOTO_BUSY''; end if;');
  patched:=replace(patched,'for update skip locked limit 20','for update skip locked limit 5');
  patched:=replace(patched,'set lease_until=now()+interval ''2 minutes'',attempts=attempts+1','set lease_until=now()+interval ''5 minutes'',attempts=attempts+1');
  if patched=definition or strpos(patched,'Retain incomplete request IDs')=0 then raise exception 'Expected photo cleanup branches not found'; end if;
  execute patched;
end $migration$;
