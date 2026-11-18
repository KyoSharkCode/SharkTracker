-- ============================================================
-- Se retira la función de Twitch.
--
-- La web ya no muestra el ícono de Twitch, el cuadro de "en vivo" ni
-- la opción "Mi Twitch". Esta migración quita lo que quedaba en la
-- base de datos:
--   1) la llamada a sync-twitch-status que el cron hacía cada minuto;
--   2) las funciones para conectar, desconectar y corregir el Twitch;
--   3) el Twitch en las funciones del Admin Dashboard;
--   4) las tablas stream_status y twitch_token_cache;
--   5) la columna player_profiles.twitch_username.
--
-- IMPORTANTE — orden:
--   a) Primero se publica la web (unir a main). La versión anterior
--      de la web está suscrita a los cambios de stream_status.
--   b) Después se ejecuta este archivo.
--   c) Al final se borra la Edge Function sync-twitch-status y sus
--      secretos TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET en Supabase.
--
-- Los pasos 4 y 5 borran datos y no se pueden deshacer (los usuarios
-- de Twitch guardados). Se puede ejecutar más de una vez.
-- ============================================================

begin;

-- ── 1) Cron ──────────────────────────────────────────────────
-- Tarea antigua (una por función), por si todavía existe.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-twitch-status-minutely';

-- Tarea actual: tareas_programadas() llama a todo cada minuto. Se
-- vuelve a definir igual, sin la llamada a sync-twitch-status.
do $do$
begin
  if to_regprocedure('public.tareas_programadas()') is null then
    return;
  end if;
  execute $fn$
    create or replace function public.tareas_programadas()
    returns void
    language plpgsql
    as $body$
    declare
      minuto int := extract(minute from now())::int;
      activo boolean := public.hay_partidas_recientes();
    begin
      -- Cada minuto
      begin perform public.llamar_edge_function('sync-live-status');
      exception when others then raise warning 'tareas_programadas: sync-live-status: %', sqlerrm; end;

      begin perform public.discord_tick();
      exception when others then raise warning 'tareas_programadas: discord: %', sqlerrm; end;

      -- Rango y LP: cada minuto si hay actividad; si no, cada 15 min.
      -- (Las maestrías se piden en los minutos 0 y 30, que siempre entran.)
      if activo or minuto % 15 = 0 then
        begin perform public.llamar_edge_function('sync-riot-data');
        exception when others then raise warning 'tareas_programadas: sync-riot-data: %', sqlerrm; end;
      end if;

      -- Cada 3 minutos
      if minuto % 3 = 0 then
        -- Historial de partidas: cada 3 min si hay actividad; si no, cada 15.
        if activo or minuto % 15 = 0 then
          begin perform public.llamar_edge_function('sync-matches');
          exception when others then raise warning 'tareas_programadas: sync-matches: %', sqlerrm; end;
        end if;

        begin
          perform public.compute_recent_badges();
          perform public.compute_weekly_badges();
          perform public.compute_season_king();
        exception when others then raise warning 'tareas_programadas: badges: %', sqlerrm; end;
      end if;

      -- Cada 5 minutos
      if minuto % 5 = 0 then
        begin perform public.close_due_challenges();
        exception when others then raise warning 'tareas_programadas: cerrar-retos: %', sqlerrm; end;

        begin perform public.recalc_missions_rewards();
        exception when others then raise warning 'tareas_programadas: misiones-recompensas: %', sqlerrm; end;
      end if;

      -- Cada 10 minutos
      if minuto % 10 = 0 then
        begin perform public.llamar_edge_function('referencias-elo');
        exception when others then raise warning 'tareas_programadas: referencias-elo: %', sqlerrm; end;
      end if;
    end;
    $body$
  $fn$;
end
$do$;


-- ── 2) Funciones de "Mi Twitch" ──────────────────────────────
drop function if exists link_my_twitch();
drop function if exists unlink_my_twitch();
drop function if exists admin_set_twitch(uuid, text);


-- ── 3) Admin Dashboard sin Twitch ────────────────────────────
-- Cambian las columnas que devuelve: hay que borrarla y crearla de nuevo.
drop function if exists admin_list_players();
create function admin_list_players()
returns table (
  player_id uuid, riot_game_name text, riot_tag_line text, icon_id integer,
  user_id uuid, discord_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede ver esto.';
  end if;
  return query
  select p.id, p.riot_game_name, p.riot_tag_line, p.icon_id, p.user_id,
         coalesce(u.raw_user_meta_data->'custom_claims'->>'global_name',
                  u.raw_user_meta_data->>'full_name',
                  u.raw_user_meta_data->>'name')::text
  from players p
  left join auth.users u on u.id = p.user_id
  order by p.riot_game_name;
end;
$$;

-- Desvincular: se borra lo personal (apodo, bio, campeón elegido).
create or replace function admin_unlink_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede desvincular cuentas.';
  end if;
  update players set user_id = null where id = p_player_id;
  update player_profiles pp
     set user_id = null, display_name = p.riot_game_name, bio = null,
         favorite_champion = null, favorite_skin = null
    from players p
   where pp.player_id = p_player_id and p.id = p_player_id;
end;
$$;

-- Solo usuarios con sesión pueden llamarlas (no anon).
revoke execute on function admin_list_players(), admin_unlink_player(uuid) from public, anon;
grant execute on function admin_list_players(), admin_unlink_player(uuid) to authenticated;


-- ── 4) Tablas ────────────────────────────────────────────────
-- (Al borrar stream_status también sale de la publicación de Realtime.)
drop table if exists stream_status;
drop table if exists twitch_token_cache;


-- ── 5) Columna del perfil ────────────────────────────────────
alter table player_profiles drop column if exists twitch_username;

commit;

-- Comprobación: no debería quedar nada con "twitch" en la base.
select 'funcion' as tipo, p.proname as nombre
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.proname ilike '%twitch%' or p.prosrc ilike '%twitch%' or p.prosrc ilike '%stream_status%')
union all
select 'tabla', c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('stream_status', 'twitch_token_cache')
union all
select 'columna', table_name || '.' || column_name from information_schema.columns
 where table_schema = 'public' and column_name ilike '%twitch%'
union all
select 'cron', jobname from cron.job where command ilike '%twitch%';
