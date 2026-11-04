-- Competing tabs must receive the same complete ticket receipt, including its
-- display number/date, when the source was already checked in successfully.
do $migration$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('private.follow_up_mutation(text,jsonb)'::regprocedure);
  patched:=replace(definition,
    $old$return jsonb_build_object('id',original.follow_up_visit_id,'queueEntryId',original.follow_up_queue_id,'sourceVisitId',original.id);$old$,
    $new$if original.follow_up_visit_id is null or original.follow_up_queue_id is null then
        raise exception 'FOLLOWUP_ALREADY_ARRIVED: this arrival is retained in history';
      end if;
      return jsonb_build_object('id',original.follow_up_visit_id,'queueEntryId',original.follow_up_queue_id,'sourceVisitId',original.id,
        'queueNumber',(select queue_number from public.queue_entries where id=original.follow_up_queue_id),
        'queueDate',(select queue_date from public.queue_entries where id=original.follow_up_queue_id));$new$);
  if patched=definition then raise exception 'Expected follow-up retry receipt was not found'; end if;
  execute patched;
end $migration$;
