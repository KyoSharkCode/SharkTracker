-- ============================================================
-- Rendimiento + limpieza de 30 días completa.
--
-- IMPORTANTE: correr este SQL ANTES de desplegar la nueva versión de
-- sync-riot-data (usa la vista rank_latest que se crea acá).
-- ============================================================

-- ── 1) Último rango de cada jugador y cola ──────────────────────
-- En vez de descargar todos los snapshots de 30 días para quedarse con
-- el más nuevo de cada uno, la base devuelve directamente ese último.
-- (Usa el índice rank_snapshots_player_queue_idx que ya existe.)
create or replace view rank_latest with (security_invoker = true) as
  select distinct on (player_id, queue_type)
         id, player_id, queue_type, tier, division, lp, wins, losses, elo_score, recorded_at
    from rank_snapshots
   order by player_id, queue_type, recorded_at desc;

grant select on rank_latest to anon, authenticated, service_role;

-- ── 2) Índice para "partidas de una cola ordenadas por fecha" ────
-- Lo usan la portada, el consejo de IA, sync-matches y las misiones.
create index if not exists matches_queue_ended_idx on matches (queue_id, ended_at desc);

-- ── 3) Limpieza diaria: también el detalle y el análisis de IA ───
-- match_details (detalle completo de partidas.html) y match_ai (análisis
-- de IA) nunca se borraban. Ahora se borran junto con su partida, salvo
-- las que están guardadas como "mejor partida" (esas se siguen pudiendo
-- abrir desde el perfil). match_ai se borra solo al borrar su detalle.
create or replace function cleanup_old_history()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rank_snapshots rs
   where rs.recorded_at < now() - interval '30 days'
     and exists (select 1 from rank_snapshots newer
                  where newer.player_id = rs.player_id and newer.queue_type = rs.queue_type
                    and newer.recorded_at > rs.recorded_at);
  delete from matches where ended_at    < now() - interval '30 days';
  delete from events  where occurred_at < now() - interval '30 days';
  delete from match_details md
   where md.fetched_at < now() - interval '1 day'   -- margen: por si se abrió justo antes de guardarse
     and not exists (select 1 from matches m      where m.match_id = md.match_id)
     and not exists (select 1 from best_matches b where b.match_id = md.match_id);
end;
$$;

-- Sigue siendo solo para el cron (igual que en 20260925000000_seguridad_revoke.sql).
revoke execute on function cleanup_old_history() from public, anon, authenticated;
grant execute on function cleanup_old_history() to service_role;
