-- ============================================================
-- Insignias: no reescribir si nada visible cambió.
--
-- compute_recent_badges / compute_weekly_badges / compute_season_king
-- corren cada 3 minutos y hacían UPDATE de todas las filas de
-- weekly_badges aunque fueran idénticas. Cada UPDATE dispara un aviso de
-- Realtime y hacía recargar las páginas abiertas cada 3 minutos.
--
-- Este trigger descarta el UPDATE cuando no cambia nada de lo que se
-- muestra (quién la tiene, el detalle o el campeón). "value" y
-- "updated_at" no se usan en la web: el Rey de la Temporada suma días en
-- "value" cada corrida, pero su texto visible ("x días") solo cambia
-- cada ~2 horas, y ahí sí se guarda.
-- ============================================================
create or replace function weekly_badges_skip_noop()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.category, new.player_id, new.player_ids, new.detail, new.champion)
     is not distinct from
     (old.category, old.player_id, old.player_ids, old.detail, old.champion) then
    return null;  -- nada visible cambió: no se escribe
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_badges_skip_noop on weekly_badges;
create trigger weekly_badges_skip_noop
  before update on weekly_badges
  for each row execute function weekly_badges_skip_noop();

revoke execute on function weekly_badges_skip_noop() from public, anon, authenticated;
