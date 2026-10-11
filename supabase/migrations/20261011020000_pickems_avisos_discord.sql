-- ============================================================
-- Pickems: avisos en Discord (canal general)
--
-- Un solo tipo de aviso, "pickems", que se enciende/apaga en Admin → Discord.
-- Como el resto de avisos, solo cuenta lo que pase desde que Discord se activó
-- y nunca se manda dos veces lo mismo (dedupe_key).
--
--   🔮 Se abren los Pickems de una fase (al llegar su apertura, si ya tiene series).
--   ⏰ Faltan 12 h para el cierre, con quién todavía no completó su bracket.
--   ✅ Resultado de cada serie, con quién acertó y cuántos 🦷 ganó.
--   🎲 Se abre la apuesta de una serie (cuando se conocen los dos equipos).
--   🏆 Fase finalizada, con quién hizo pleno y su premio.
-- ============================================================

-- ── Nuevo tipo de aviso ──
do $$
begin
  if to_regclass('public.discord_settings') is not null then
    execute $q$alter table discord_settings alter column kinds set default
      '{"liga": true, "penta": true, "reto": true, "partida_mes": true, "semana": true, "canje": true, "partida_grupo": true, "partida": false, "rewind": true, "pickems": true}'::jsonb$q$;
    execute $q$update discord_settings set kinds = '{"pickems": true}'::jsonb || kinds where singleton$q$;
  end if;
end $$;

-- Lista de nombres para un aviso: "Ana, Bea y Cris" (o "nadie")
create or replace function dc_names(p_ids uuid[])
returns text language sql stable security definer set search_path = public as $$
  with n as (select riot_game_name nm, row_number() over (order by riot_game_name) i, count(*) over () c
               from players where id = any(p_ids))
  select coalesce(string_agg(case when i = 1 then '' when i = c then ' y ' else ', ' end || '**' || nm || '**', '' order by i), 'nadie')
    from n
$$;

-- Imagen de la fase para la tarjeta de Discord (solo si está en el repo)
create or replace function dc_pickem_image(e pickem_events)
returns text language sql stable security definer set search_path = public as $$
  select case when e.bg_image like 'assets/%' then dc_site() || e.bg_image when e.bg_image like 'https://%' then e.bg_image end
$$;

create or replace function discord_scan_pickems()
returns void language plpgsql security definer set search_path = public as $$
declare
  s discord_settings;
  e pickem_events;
  m pickem_matches;
  r record;
  v_open timestamptz;
  v_total integer;
  v_max integer;
  v_win text;
  v_ids uuid[];
  v_t1 text; v_t2 text;
  v_url text;
  v_stage text;
begin
  select * into s from discord_settings;
  if not found or not s.enabled or s.enabled_at is null then return; end if;

  for e in select * from pickem_events loop
    v_url := dc_site() || 'pickems.html?id=' || e.id;
    v_stage := e.name;
    select count(*), coalesce(sum(points), 0) into v_total, v_max from pickem_matches where event_id = e.id;

    -- 🔮 Se abren los Pickems (si ya hay series para votar)
    v_open := coalesce(e.opens_at, e.created_at);
    if e.finished_at is null and v_total > 0 and v_open <= now() and now() < e.locks_at and v_open >= s.enabled_at - interval '1 day' then
      perform discord_enqueue('general', 'pickems', 'pickems_abre:' || e.id, jsonb_build_object(
        'title', '🔮 ¡Se abren los Pickems de ' || v_stage || '!',
        'description', 'Arma tu bracket: elige el ganador de cada serie y gana hasta **🦷 ' || v_max || '**. '
                       || 'Si aciertas todo, te llevas **' || e.perfect_prize || '**.' || E'\n'
                       || 'Cierra el **' || dc_day(e.locks_at) || ' a las ' || to_char(e.locks_at at time zone 'Europe/Madrid', 'HH24:MI') || '** (hora de España).'
                       || E'\n' || '[Armar mi bracket](' || v_url || ')',
        'color', 4063186, 'url', v_url,
        'image', jsonb_build_object('url', dc_pickem_image(e)),
        'timestamp', v_open));
    end if;

    -- ⏰ Faltan 12 h para el cierre: quién no completó su bracket (cuentas vinculadas)
    if e.finished_at is null and v_total > 0 and now() >= e.locks_at - interval '12 hours' and now() < e.locks_at
       and e.locks_at - interval '12 hours' >= s.enabled_at - interval '1 hour' then
      select array_agg(p.id) into v_ids
        from players p
       where p.user_id is not null
         and (select count(*) from pickem_picks pk join pickem_matches pm on pm.id = pk.match_id
               where pk.player_id = p.id and pm.event_id = e.id) < v_total;
      perform discord_enqueue('general', 'pickems', 'pickems_cierre:' || e.id, jsonb_build_object(
        'title', '⏰ Últimas 12 horas para los Pickems de ' || v_stage,
        'description', 'Cierra el **' || dc_day(e.locks_at) || ' a las ' || to_char(e.locks_at at time zone 'Europe/Madrid', 'HH24:MI') || '** (hora de España).'
                       || case when v_ids is null then E'\n' || '¡Todo el grupo tiene su bracket completo! 🦈'
                               else E'\n' || 'Todavía les faltan elecciones a ' || dc_names(v_ids) || '.' end
                       || E'\n' || '[Completar mi bracket](' || v_url || ')',
        'color', 16758087, 'url', v_url,
        'timestamp', e.locks_at - interval '12 hours'));
    end if;

    for m in select * from pickem_matches where event_id = e.id order by sort, id loop
      v_t1 := pickem_actual_team(m.id, 1); v_t2 := pickem_actual_team(m.id, 2);

      -- 🎲 Se abre la apuesta (se conocen los dos equipos y aún no se jugó)
      if m.bets_enabled and v_t1 is not null and v_t2 is not null and m.score1 is null and m.bets_closed_at is null
         and (m.starts_at is null or now() < m.starts_at) and now() >= e.locks_at then
        perform discord_enqueue('general', 'pickems', 'pickems_apuesta:' || m.id || ':' || v_t1 || ':' || v_t2, jsonb_build_object(
          'title', '🎲 Apuesta abierta: ' || v_t1 || ' vs ' || v_t2,
          'description', coalesce(m.label, 'Serie') || ' de ' || v_stage || '. Apuesta tus dientes (de ' || pickem_min_bet() || ' a ' || pickem_max_bet()
                         || ' 🦷): los que aciertan se reparten el bote.'
                         || case when m.starts_at is not null then E'\n' || 'Cierra al empezar la serie: **' || dc_day(m.starts_at) || ' a las '
                                 || to_char(m.starts_at at time zone 'Europe/Madrid', 'HH24:MI') || '**.' else '' end
                         || E'\n' || '[Apostar](' || v_url || ')',
          'color', 16758087, 'url', v_url));
      end if;

      -- ✅ Resultado de una serie
      if m.score1 is not null and m.result_at >= s.enabled_at then
        v_win := pickem_winner(m.id);
        select array_agg(player_id) into v_ids from pickem_picks where match_id = m.id and team = v_win;
        perform discord_enqueue('general', 'pickems', 'pickems_res:' || m.id || ':' || m.score1 || '-' || m.score2 || ':' || v_t1 || ':' || v_t2, jsonb_build_object(
          'title', '✅ ' || v_t1 || ' ' || m.score1 || '-' || m.score2 || ' ' || v_t2,
          'description', '**' || v_win || '** gana · ' || coalesce(m.label || ' · ', '') || v_stage || E'\n'
                         || case when v_ids is null then 'Nadie lo vio venir. 👀'
                                 else 'Acertaron ' || dc_names(v_ids) || ' (**+🦷 ' || m.points || '**).' end
                         || E'\n' || '[Ver el bracket](' || v_url || ')',
          'color', 4063186, 'url', v_url,
          'timestamp', m.result_at));
      end if;
    end loop;

    -- 🏆 Fase finalizada: quién hizo pleno
    if e.finished_at is not null and e.finished_at >= s.enabled_at then
      select array_agg(pk.player_id) into v_ids from (
        select pk.player_id from pickem_picks pk join pickem_matches pm on pm.id = pk.match_id
         where pm.event_id = e.id and pk.team = pickem_winner(pm.id)
         group by pk.player_id having count(*) = v_total) pk;
      perform discord_enqueue('general', 'pickems', 'pickems_fin:' || e.id, jsonb_build_object(
        'title', '🏆 Terminaron los Pickems de ' || v_stage,
        'description', case when v_ids is null then 'Nadie acertó todas las series esta vez. ¡A por la siguiente fase!'
                            else dc_names(v_ids) || case when array_length(v_ids, 1) = 1 then ' acertó' else ' acertaron' end
                                 || ' todas las series y se lleva **' || e.perfect_prize || '**. 👑' end
                       || E'\n' || '[Ver la clasificación](' || v_url || ')',
        'color', 11111423, 'url', v_url,
        'image', jsonb_build_object('url', dc_pickem_image(e)),
        'timestamp', e.finished_at));
    end if;
  end loop;
end;
$$;

-- El reloj de Discord (cada minuto) pasa también por los Pickems
create or replace function discord_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform discord_scan();
  if to_regprocedure('public.discord_scan_live()') is not null then perform discord_scan_live(); end if;
  if to_regprocedure('public.discord_scan_rewind()') is not null then perform discord_scan_rewind(); end if;
  perform discord_scan_pickems();
  perform discord_send();
  delete from discord_outbox where created_at < now() - interval '30 days';
end;
$$;

revoke execute on function dc_names(uuid[]), dc_pickem_image(pickem_events), discord_scan_pickems(), discord_tick() from public, anon, authenticated;
