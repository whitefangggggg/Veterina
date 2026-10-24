-- Optional presentation metadata; existing checkups retain their default color.
alter table public.visits add column card_color text
  constraint visits_card_color_check check (card_color ~ '^#[0-9a-fA-F]{6}$');

-- Color changes may be made after finalization, while every clinical field stays locked.
create or replace function private.protect_finalized_visit()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.finalized_at is not null and
    (to_jsonb(new) - 'card_color' - 'updated_at') is distinct from
    (to_jsonb(old) - 'card_color' - 'updated_at') then
    raise exception 'RECORD_FINALIZED: append a correction instead';
  end if;
  if new.finalized_at is not null and old.finalized_at is null then
    new.finalized_by := auth.uid();
  end if;
  return new;
end $function$;

-- Extend the existing authenticated, audited, idempotent mutation path.
do $migration$
declare definition text; patched text;
begin
  select pg_get_functiondef('private.portal_mutation(text,jsonb,uuid)'::regprocedure) into definition;
  patched := replace(definition,
    $old$elsif p_action='update_encounter' then$old$,
    $new$elsif p_action='set_visit_card_color' then
    if not (p_data ? 'cardColor') or
      (p_data->'cardColor' <> 'null'::jsonb and
        (jsonb_typeof(p_data->'cardColor') <> 'string' or p_data->>'cardColor' !~ '^#[0-9a-fA-F]{6}$')) then
      raise exception 'VALIDATION_FAILED: select a valid card color';
    end if;
    update public.visits set card_color=lower(p_data->>'cardColor') where id=entity;
    if not found then raise exception 'NOT_FOUND'; end if;
  elsif p_action='update_encounter' then$new$);
  if patched=definition then raise exception 'Expected checkup mutation handler not found'; end if;
  execute patched;
end $migration$;
