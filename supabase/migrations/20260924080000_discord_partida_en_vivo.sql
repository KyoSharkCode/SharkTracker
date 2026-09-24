-- ============================================================
-- Discord: avisos de partidas EN VIVO (necesita la migración
-- 20260924070000_discord_notificaciones.sql ya ejecutada).
--
--   partida_grupo  → 2 o más del grupo en la MISMA partida
--                    (juntos o enfrentados). Encendido por defecto.
--   partida        → cada vez que alguien del grupo empieza una
--                    partida. Apagado por defecto (puede ser mucho).
--
-- Usa lo que ya guarda sync-live-status (live_status + live_games):
-- no gasta llamadas extra a Riot.
-- ============================================================

alter table discord_settings alter column kinds set default
  '{"liga": true, "penta": true, "reto": true, "partida_mes": true, "semana": true, "canje": true, "partida_grupo": true, "partida": false}'::jsonb;
update discord_settings set kinds = '{"partida_grupo": true, "partida": false}'::jsonb || kinds where singleton;

create or replace function discord_scan_live()
returns void language plpgsql security definer set search_path = public as $$
declare
  s discord_settings;
  g record;
  m record;
  v_blue text; v_red text; v_first_champ text;
  v_lines text;
begin
  select * into s from discord_settings;
  if not found or not s.enabled or s.enabled_at is null then return; end if;

  for g in
    select lg.game_id, lg.queue_type, lg.started_at,
           count(*) as n,
           count(distinct ls.team) as teams
      from live_status ls join live_games lg on lg.game_id = ls.game_id
     where ls.in_game
       and lg.updated_at >= s.enabled_at
       and (lg.started_at is null or lg.started_at > now() - interval '90 minutes')
     group by lg.game_id, lg.queue_type, lg.started_at
  loop
    -- 🎮 / ⚔️ Dos o más del grupo en la misma partida
    if g.n >= 2 then
      select string_agg('**' || p.riot_game_name || '** (' || ls.champion || ')', ' + ' order by p.riot_game_name)
        into v_blue from live_status ls join players p on p.id = ls.player_id
       where ls.in_game and ls.game_id = g.game_id and ls.team = 'blue';
      select string_agg('**' || p.riot_game_name || '** (' || ls.champion || ')', ' + ' order by p.riot_game_name)
        into v_red from live_status ls join players p on p.id = ls.player_id
       where ls.in_game and ls.game_id = g.game_id and ls.team = 'red';
      select ls.champion into v_first_champ from live_status ls
       where ls.in_game and ls.game_id = g.game_id order by ls.team, ls.player_id limit 1;
      v_lines := concat_ws(E'\n', case when v_blue is not null then '🔵 ' || v_blue end, case when v_red is not null then '🔴 ' || v_red end);

      perform discord_enqueue('general', 'partida_grupo', 'vivo:' || g.game_id, jsonb_build_object(
        'title', case when g.teams > 1 then '⚔️ ¡Se enfrentan en vivo!' else '🎮 Partida en grupo' end,
        'description', v_lines || E'\n' || coalesce(g.queue_type, 'Partida') || ' · [ver en vivo](' || dc_site() || 'en-vivo.html?partida=' || g.game_id || ')',
        'color', case when g.teams > 1 then 16436245 else 58823 end,
        'url', dc_site() || 'en-vivo.html?partida=' || g.game_id,
        'image', jsonb_build_object('url', dc_splash(v_first_champ, 0)),
        'timestamp', coalesce(g.started_at, now())));
    end if;

    -- 🕹️ Cada jugador que empieza partida (apagado por defecto)
    for m in select ls.player_id, ls.champion from live_status ls where ls.in_game and ls.game_id = g.game_id
    loop
      perform discord_enqueue('general', 'partida', 'vivo1:' || g.game_id || ':' || m.player_id, jsonb_build_object(
        'title', '🕹️ ' || dc_name(m.player_id) || ' está en partida',
        'description', 'Con **' || m.champion || '** · ' || coalesce(g.queue_type, 'Partida') || ' · [ver en vivo](' || dc_site() || 'en-vivo.html?partida=' || g.game_id || ')',
        'color', 16736061,
        'url', dc_site() || 'en-vivo.html?partida=' || g.game_id,
        'author', dc_author(m.player_id),
        'thumbnail', jsonb_build_object('url', dc_champ_icon(m.champion)),
        'timestamp', coalesce(g.started_at, now())));
    end loop;
  end loop;
end;
$$;

create or replace function discord_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform discord_scan();
  perform discord_scan_live();
  perform discord_send();
  delete from discord_outbox where created_at < now() - interval '30 days';
end;
$$;

revoke execute on function discord_scan_live(), discord_tick() from public, anon, authenticated;
