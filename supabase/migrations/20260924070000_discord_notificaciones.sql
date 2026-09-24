-- ============================================================
-- Notificaciones en Discord (webhooks) — SQL puro + pg_net.
--
-- Cómo funciona:
--   1) discord_scan()  mira qué pasó desde que se activaron los avisos
--      y lo mete en una cola (discord_outbox). Cada aviso tiene una
--      clave única, así que nunca se manda dos veces lo mismo.
--   2) discord_send()  junta lo pendiente de cada canal en UN mensaje
--      (hasta 8 tarjetas) y lo manda al webhook con pg_net. En la
--      siguiente vuelta revisa la respuesta de Discord: si falló por
--      límite o caída, reintenta; si el webhook no existe, lo marca.
--   3) El cron 'discord' corre las dos cosas cada minuto.
--
-- Las URLs de los webhooks NO están en el código: se guardan en
-- Vault (Supabase → Project Settings → Vault) con estos nombres:
--   discord_webhook_general   → canal general (liga, pentas, retos,
--                                partida del mes, resumen semanal)
--   discord_webhook_admin     → canal privado de admins (canjes)
--
-- Nace APAGADO: se enciende desde el Admin (sección Discord).
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- ── Ajustes (fila única) ──
create table if not exists discord_settings (
  singleton  boolean primary key default true check (singleton),
  enabled    boolean not null default false,
  enabled_at timestamptz,
  kinds      jsonb not null default '{"liga": true, "penta": true, "reto": true, "partida_mes": true, "semana": true, "canje": true}'::jsonb,
  site_url   text not null default 'https://kyosharkcode.github.io/SharkTracker/'
);
insert into discord_settings (singleton) values (true) on conflict do nothing;

-- ── Cola de mensajes ──
create table if not exists discord_outbox (
  id            bigint generated always as identity primary key,
  channel       text not null check (channel in ('general', 'admin')),
  kind          text not null,
  dedupe_key    text not null unique,
  embed         jsonb not null,
  status        text not null default 'pendiente' check (status in ('pendiente', 'enviando', 'enviado', 'error')),
  attempts      integer not null default 0,
  request_id    bigint,
  next_try      timestamptz not null default now(),
  dispatched_at timestamptz,
  sent_at       timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);
create index if not exists discord_outbox_status_idx on discord_outbox (status, channel, id);

-- ============================================================
-- Ayudantes de formato
-- ============================================================
create or replace function dc_num(n numeric)
returns text language sql immutable as $$
  select replace(to_char(round(coalesce(n, 0)), 'FM999,999,999'), ',', '.')
$$;

create or replace function dc_tier_idx(t text)
returns integer language sql immutable as $$
  select array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], upper(t))
$$;

create or replace function dc_tier_es(t text)
returns text language sql immutable as $$
  select case upper(coalesce(t, ''))
    when 'IRON' then 'Hierro' when 'BRONZE' then 'Bronce' when 'SILVER' then 'Plata' when 'GOLD' then 'Oro'
    when 'PLATINUM' then 'Platino' when 'EMERALD' then 'Esmeralda' when 'DIAMOND' then 'Diamante'
    when 'MASTER' then 'Maestro' when 'GRANDMASTER' then 'Gran Maestro' when 'CHALLENGER' then 'Retador'
    else 'Sin clasificar' end
$$;

create or replace function dc_rank(t text, d text, lp integer)
returns text language sql immutable as $$
  select dc_tier_es(t) || case when upper(coalesce(t, '')) in ('MASTER', 'GRANDMASTER', 'CHALLENGER') or d is null then '' else ' ' || d end
         || case when lp is null then '' else ' · ' || lp || ' LP' end
$$;

create or replace function dc_role_es(r text)
returns text language sql immutable as $$
  select case upper(coalesce(r, ''))
    when 'TOP' then 'Top' when 'JUNGLE' then 'Jungla' when 'MIDDLE' then 'Mid' when 'MID' then 'Mid'
    when 'BOTTOM' then 'ADC' when 'ADC' then 'ADC' when 'UTILITY' then 'Support' when 'SUPPORT' then 'Support' else null end
$$;

create or replace function dc_queue(q integer)
returns text language sql immutable as $$
  select case q when 420 then 'SoloQ' when 440 then 'Flex' when 450 then 'ARAM' when 400 then 'Normal' when 430 then 'Normal'
                when 490 then 'Partida rápida' when 1700 then 'Arena' when 900 then 'URF' when 1900 then 'URF' else 'Partida' end
$$;

create or replace function dc_month_es(m integer)
returns text language sql immutable as $$
  select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[m]
$$;

-- "21 de septiembre" (hora de Madrid)
create or replace function dc_day(ts timestamptz)
returns text language sql stable as $$
  select extract(day from ts at time zone 'Europe/Madrid')::int || ' de ' || dc_month_es(extract(month from ts at time zone 'Europe/Madrid')::int)
$$;

create or replace function dc_name(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select riot_game_name from players where id = p), 'Alguien')
$$;

create or replace function dc_site()
returns text language sql stable security definer set search_path = public as $$
  select site_url from discord_settings
$$;

create or replace function dc_champ_icon(c text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if c is null or c = '' then return null; end if;
  -- La versión de Data Dragon se toma de ddragon_cache si esa tabla existe;
  -- si no, una fija (si el icono no existe, Discord simplemente no lo muestra).
  if to_regclass('public.ddragon_cache') is not null then
    execute 'select version from public.ddragon_cache limit 1' into v;
  end if;
  return 'https://ddragon.leagueoflegends.com/cdn/' || coalesce(v, '15.18.1') || '/img/champion/' || c || '.png';
end;
$$;

create or replace function dc_emblem(t text)
returns text language sql immutable as $$
  select 'https://raw.communitydragon.org/14.10/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/' || lower(coalesce(t, 'unranked')) || '.png'
$$;

-- Splash grande (no depende de la versión) — "FiddleSticks" en Riot = "Fiddlesticks" en Data Dragon
create or replace function dc_splash(c text, skin integer default 0)
returns text language sql immutable as $$
  select case when c is null or c = '' then null else
    'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/' || case when c = 'FiddleSticks' then 'Fiddlesticks' else c end
    || '_' || coalesce(skin, 0) || '.jpg' end
$$;

-- Icono de invocador (CommunityDragon "latest": no hace falta versión)
create or replace function dc_profile_icon(id integer)
returns text language sql immutable as $$
  select 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/' || coalesce(id, 29) || '.jpg'
$$;

-- Cabecera de la tarjeta: foto de perfil + nombre, con link al perfil
create or replace function dc_author(p uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_name text; v_icon integer;
begin
  select riot_game_name, icon_id into v_name, v_icon from players where id = p;
  if not found then return null; end if;
  return jsonb_build_object('name', v_name, 'icon_url', dc_profile_icon(v_icon),
                            'url', (select site_url from discord_settings) || 'perfil.html?jugador=' || p);
end;
$$;

-- Splash del campeón/skin favoritos del jugador (el mismo del banner del perfil)
create or replace function dc_fav_splash(p uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare c text; k integer;
begin
  begin
    execute 'select favorite_champion, favorite_skin from player_profiles where player_id = $1' into c, k using p;
  exception when others then c := null; end;
  if c is null then
    begin
      execute 'select favorite_champion, favorite_skin from players where id = $1' into c, k using p;
    exception when others then c := null; end;
  end if;
  return dc_splash(c, k);
end;
$$;

-- ── Meter un aviso en la cola (si ese tipo está activado) ──
create or replace function discord_enqueue(p_channel text, p_kind text, p_key text, p_embed jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb := jsonb_strip_nulls(p_embed);
begin
  if p_kind <> 'prueba' and not coalesce((select (kinds->>p_kind)::boolean from discord_settings), false) then return; end if;
  -- Discord rechaza imágenes/cabeceras vacías: fuera las que quedaron sin URL
  if not (e->'image' ? 'url') then e := e - 'image'; end if;
  if not (e->'thumbnail' ? 'url') then e := e - 'thumbnail'; end if;
  if not (e->'author' ? 'name') then e := e - 'author'; end if;
  insert into discord_outbox (channel, kind, dedupe_key, embed)
  values (p_channel, p_kind, p_key, e)
  on conflict (dedupe_key) do nothing;
end;
$$;

-- ============================================================
-- Resumen semanal (tarjeta). p_from/p_to = lunes 6:00 → lunes 6:00.
-- ============================================================
create or replace function discord_weekly_embed(p_from timestamptz, p_to timestamptz, p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_games int; v_wins int;
  v_fields jsonb := '[]'::jsonb;
  r record;
  v_desc text;
  v_img text;
begin
  -- SoloQ de la semana (sin remakes)
  create temp table if not exists _dc_week (player_id uuid, match_id text, champion text, role text, win boolean,
    kills int, deaths int, assists int, lp int, score numeric) on commit drop;
  delete from _dc_week where true;
  insert into _dc_week
  select mp.player_id, mp.match_id, mp.champion, mp.role, mp.win, mp.kills, mp.deaths, mp.assists, coalesce(mp.lp_change, 0),
         case when mt.duration_seconds >= 900 then
           match_score(mp.role, mp.win, mp.kills, mp.deaths, mp.assists, mp.cs, mp.damage_to_champions, mp.vision_score,
                       mt.duration_seconds, nullif(mp.extra_stats->>'kp', '')::numeric, coalesce((mp.extra_stats->>'pentakills')::int, 0))
         end
    from match_participants mp join matches mt on mt.match_id = mp.match_id
   where mt.queue_id = 420 and mt.ended_at >= p_from and mt.ended_at < p_to and mt.duration_seconds >= 300;

  select count(*), count(*) filter (where win) into v_games, v_wins from _dc_week;

  -- 📈 Más LP ganado
  select player_id, sum(lp) as lp into r from _dc_week group by player_id having sum(lp) > 0 order by sum(lp) desc limit 1;
  if found then v_fields := v_fields || jsonb_build_object('name', '📈 Más LP ganado', 'value', '**' || dc_name(r.player_id) || '** · +' || r.lp || ' LP', 'inline', true); end if;

  -- 🎮 Más partidas
  select player_id, count(*) as g, count(*) filter (where win) as w into r from _dc_week group by player_id order by count(*) desc, count(*) filter (where win) desc limit 1;
  if found then v_fields := v_fields || jsonb_build_object('name', '🎮 Más partidas', 'value', '**' || dc_name(r.player_id) || '** · ' || r.g || ' (' || r.w || 'V)', 'inline', true); end if;

  -- 🔥 Mejor winrate (mín. 5)
  select player_id, count(*) as g, round(100.0 * count(*) filter (where win) / count(*)) as wr into r
    from _dc_week group by player_id having count(*) >= 5 order by 3 desc, 2 desc limit 1;
  if found then v_fields := v_fields || jsonb_build_object('name', '🔥 Mejor winrate', 'value', '**' || dc_name(r.player_id) || '** · ' || r.wr || '% en ' || r.g, 'inline', true); end if;

  -- 🎯 Misiones completadas
  select player_id, count(*) as n into r from player_missions
   where week_start = p_from and completed_at is not null group by player_id order by count(*) desc, max(completed_at) asc limit 1;
  if found then v_fields := v_fields || jsonb_build_object('name', '🎯 Más misiones', 'value', '**' || dc_name(r.player_id) || '** · ' || r.n || '/3', 'inline', true); end if;
  select mw.group_completed_at, mc.title into r from mission_weeks mw left join mission_catalog mc on mc.code = mw.group_code where mw.week_start = p_from;
  if found and r.title is not null then
    v_fields := v_fields || jsonb_build_object('name', '👥 Misión grupal', 'value', case when r.group_completed_at is not null then '✅ ' else '❌ ' end || r.title, 'inline', true);
  end if;

  -- 🦷 Dientes ganados
  select player_id, sum(amount) as n into r from wallet_tx
   where amount > 0 and reason not in ('reembolso', 'admin') and created_at >= p_from and created_at < p_to
   group by player_id order by sum(amount) desc limit 1;
  if found then v_fields := v_fields || jsonb_build_object('name', '🦷 Más dientes', 'value', '**' || dc_name(r.player_id) || '** · ' || dc_num(r.n), 'inline', true); end if;

  -- 🌟 Partida de la semana
  select * into r from _dc_week where score is not null order by score desc limit 1;
  if found then
    v_fields := v_fields || jsonb_build_object('name', '🌟 Partida de la semana',
      'value', '**' || dc_name(r.player_id) || '** con ' || r.champion || coalesce(' (' || dc_role_es(r.role) || ')', '') || ' · '
               || r.kills || '/' || r.deaths || '/' || r.assists || ' · ' || round(r.score) || ' pts · [ver](' || dc_site() || 'partidas.html?id=' || r.match_id || '&jugador=' || r.player_id || ')',
      'inline', false);
  end if;

  select champion into v_img from _dc_week where score is not null order by score desc limit 1;
  v_desc := case when p_preview then 'Del ' || dc_day(p_from) || ' hasta hoy.'
                 when extract(month from p_from at time zone 'Europe/Madrid') = extract(month from (p_to - interval '1 day') at time zone 'Europe/Madrid')
                   then 'Del ' || extract(day from p_from at time zone 'Europe/Madrid')::int || ' al ' || dc_day(p_to - interval '1 day') || '.'
                 else 'Del ' || dc_day(p_from) || ' al ' || dc_day(p_to - interval '1 day') || '.' end || E'\n'
            || case when v_games = 0 then 'Semana tranquila: nadie jugó SoloQ 😴'
                    else 'Entre todos: **' || v_games || ' partidas** de SoloQ · ' || v_wins || ' victorias.' end;

  return jsonb_build_object(
    'title', case when p_preview then '📅 Resumen semanal (vista previa)' else '📅 Resumen semanal' end,
    'description', v_desc, 'url', dc_site(), 'color', 58823,
    'thumbnail', jsonb_build_object('url', dc_site() || 'logo/FlaviIconLogo.png'),
    'image', case when v_img is not null then jsonb_build_object('url', dc_splash(v_img, 0)) end,
    'fields', v_fields,
    'footer', jsonb_build_object('text', case when p_preview then 'SharkTracker · la semana sigue en curso' else 'SharkTracker · ¡ya hay misiones nuevas!' end));
end;
$$;

-- ============================================================
-- Buscar novedades y encolarlas
-- ============================================================
create or replace function discord_scan()
returns void language plpgsql security definer set search_path = public as $$
declare
  s discord_settings;
  v_since timestamptz;
  r record;
  v_ws timestamptz; v_ms timestamptz; v_period text;
  v_lines text;
begin
  select * into s from discord_settings;
  if not found or not s.enabled or s.enabled_at is null then return; end if;
  v_since := s.enabled_at;

  -- 📈 Cambio de liga (SoloQ). Solo cambia la LIGA, no la división.
  for r in
    select sn.id, sn.player_id, sn.tier, sn.division, sn.lp, sn.recorded_at, pv.tier as ptier, pv.division as pdiv
      from rank_snapshots sn
      join lateral (select p.tier, p.division from rank_snapshots p
                     where p.player_id = sn.player_id and p.queue_type = sn.queue_type and p.id < sn.id
                     order by p.id desc limit 1) pv on true
     where sn.queue_type = 'RANKED_SOLO_5x5' and sn.recorded_at >= v_since
       and sn.tier is not null and pv.tier is not null and upper(sn.tier) <> upper(pv.tier)
  loop
    perform discord_enqueue('general', 'liga', 'liga:' || r.id, jsonb_build_object(
      'title', case when dc_tier_idx(r.tier) > dc_tier_idx(r.ptier) then '⬆️ ¡Subida de liga!' else '⬇️ Bajada de liga' end,
      'description', '**' || dc_name(r.player_id) || '** ' || case when dc_tier_idx(r.tier) > dc_tier_idx(r.ptier) then 'sube a' else 'baja a' end
                     || ' **' || dc_rank(r.tier, r.division, r.lp) || '**' || E'\n' || '_Venía de ' || dc_rank(r.ptier, r.pdiv, null) || '_',
      'color', case when dc_tier_idx(r.tier) > dc_tier_idx(r.ptier) then 16436245 else 8246268 end,
      'url', dc_site() || 'perfil.html?jugador=' || r.player_id,
      'author', dc_author(r.player_id),
      'thumbnail', jsonb_build_object('url', dc_emblem(r.tier)),
      'image', jsonb_build_object('url', dc_fav_splash(r.player_id)),
      'timestamp', r.recorded_at));
  end loop;

  -- 🖐️ Pentakills (cualquier cola)
  for r in
    select mp.player_id, mp.match_id, mp.champion, mp.kills, mp.deaths, mp.assists, mp.win, mt.queue_id, mt.ended_at,
           (mp.extra_stats->>'pentakills')::int as n
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= v_since and coalesce((mp.extra_stats->>'pentakills')::int, 0) > 0
  loop
    perform discord_enqueue('general', 'penta', 'penta:' || r.match_id || ':' || r.player_id, jsonb_build_object(
      'title', case when r.n > 1 then '🖐️ ¡' || r.n || ' PENTAKILLS!' else '🖐️ ¡PENTAKILL!' end,
      'description', '**' || dc_name(r.player_id) || '** con **' || r.champion || '** · ' || r.kills || '/' || r.deaths || '/' || r.assists
                     || ' · ' || case when r.win then 'Victoria' else 'Derrota' end || ' · ' || dc_queue(r.queue_id),
      'color', 16736168,
      'url', dc_site() || 'partidas.html?id=' || r.match_id || '&jugador=' || r.player_id,
      'author', dc_author(r.player_id),
      'thumbnail', jsonb_build_object('url', dc_champ_icon(r.champion)),
      'image', jsonb_build_object('url', dc_splash(r.champion, 0)),
      'timestamp', r.ended_at));
  end loop;

  -- 🏆 Retos finalizados (podio)
  for r in select c.id, c.name, c.finished_at, c.winner_player_id from challenges c where c.finished_at >= v_since
  loop
    select string_agg(case cr.position when 1 then '🥇' when 2 then '🥈' when 3 then '🥉' end || ' **' || cr.riot_game_name || '** — '
                      || dc_rank(cr.tier, cr.division, cr.lp) || ' · ' || cr.reto_games || ' partidas (' || cr.reto_wins || 'V)', E'\n' order by cr.position)
      into v_lines from challenge_results cr where cr.challenge_id = r.id and cr.position <= 3;
    perform discord_enqueue('general', 'reto', 'reto:' || r.id, jsonb_build_object(
      'title', '🏆 Reto finalizado: ' || r.name,
      'description', coalesce(v_lines, 'El reto terminó sin resultados.'),
      'color', 16436245,
      'url', dc_site() || 'reto.html?id=' || r.id,
      'thumbnail', jsonb_build_object('url', dc_champ_icon((select favorite_champion from challenge_results where challenge_id = r.id and position = 1))),
      'image', jsonb_build_object('url', (select dc_splash(favorite_champion, favorite_skin) from challenge_results where challenge_id = r.id and position = 1)),
      'timestamp', r.finished_at));
  end loop;

  -- 🌟 Partida del mes (día 1, desde las 6:00 de Madrid, del mes anterior)
  v_ms := date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  if now() >= v_ms + interval '6 hours' and now() < v_ms + interval '2 days' and v_since < v_ms then
    v_period := to_char((v_ms at time zone 'Europe/Madrid') - interval '1 day', 'YYYY-MM');
    select * into r from best_matches where period = v_period order by score desc, ended_at asc limit 1;
    if found then
      perform discord_enqueue('general', 'partida_mes', 'partida_mes:' || v_period, jsonb_build_object(
        'title', '🌟 Partida del mes · ' || initcap(dc_month_es(split_part(v_period, '-', 2)::int)),
        'description', '**' || dc_name(r.player_id) || '** con **' || r.champion || '**' || coalesce(' (' || dc_role_es(r.role) || ')', '')
                       || E'\n' || r.kills || '/' || r.deaths || '/' || r.assists || ' · ' || case when r.win then 'Victoria' else 'Derrota' end
                       || ' · **' || round(r.score) || ' pts**',
        'color', 16436245,
        'url', dc_site() || 'partidas.html?id=' || r.match_id || '&jugador=' || r.player_id,
        'author', dc_author(r.player_id),
        'thumbnail', jsonb_build_object('url', dc_champ_icon(r.champion)),
        'image', jsonb_build_object('url', dc_splash(r.champion, 0)),
        'fields', jsonb_build_array(
          jsonb_build_object('name', 'Daño', 'value', dc_num(r.damage), 'inline', true),
          jsonb_build_object('name', 'Part. en kills', 'value', coalesce(round(r.kp * 100) || '%', '—'), 'inline', true),
          jsonb_build_object('name', 'Visión', 'value', coalesce(r.vision::text, '—'), 'inline', true))));
    end if;
  end if;

  -- 📅 Resumen semanal (lunes 6:00, semana anterior)
  v_ws := mission_week_start(now());
  if now() < v_ws + interval '1 day' and v_since < v_ws then
    perform discord_enqueue('general', 'semana', 'semana:' || to_char((v_ws - interval '7 days') at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
                            discord_weekly_embed(v_ws - interval '7 days', v_ws));
  end if;

  -- 🎁 Canjes de premios → canal de admins
  for r in select * from prize_claims where created_at >= v_since
  loop
    perform discord_enqueue('admin', 'canje', 'canje:' || r.id, jsonb_build_object(
      'title', '🎁 Premio canjeado',
      'description', '**' || dc_name(r.player_id) || '** canjeó **' || r.item_name || '** por 🦷 ' || dc_num(r.price) || E'\n' || 'Márcalo como entregado en el Admin.',
      'color', 16436245,
      'url', dc_site() || 'admin.html',
      'author', dc_author(r.player_id),
      'timestamp', r.created_at));
  end loop;
end;
$$;

-- ============================================================
-- Enviar la cola (agrupa hasta 8 tarjetas por mensaje y canal)
-- ============================================================
create or replace function discord_send()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  o record;
  ch text;
  v_url text;
  v_ids bigint[];
  v_embeds jsonb;
  v_len int;
  v_req bigint;
  e record;
begin
  -- 1) Revisar respuestas de lo que ya se mandó
  for o in
    select q.id, q.attempts, q.dispatched_at, h.status_code, h.timed_out, h.error_msg, left(h.content, 300) as content, (h.id is not null) as has_resp
      from discord_outbox q left join net._http_response h on h.id = q.request_id
     where q.status = 'enviando'
  loop
    if o.has_resp and o.status_code between 200 and 299 then
      update discord_outbox set status = 'enviado', sent_at = now(), last_error = null where id = o.id;
    elsif o.has_resp and o.status_code is not null and o.status_code between 400 and 499 and o.status_code <> 429 then
      update discord_outbox set status = 'error',
             last_error = case when o.status_code in (401, 403, 404) then 'Discord no reconoce el webhook (' || o.status_code || '): revisa la URL guardada en Vault.'
                               else 'Discord rechazó el mensaje (' || o.status_code || '): ' || coalesce(o.content, '') end
       where id = o.id;
    elsif o.has_resp then
      -- 429 (límite), 5xx o timeout → reintentar con espera creciente
      update discord_outbox set status = case when o.attempts >= 5 then 'error' else 'pendiente' end,
             next_try = now() + (o.attempts * interval '1 minute'),
             last_error = coalesce('HTTP ' || o.status_code, o.error_msg, 'sin respuesta') || case when o.timed_out then ' (timeout)' else '' end
       where id = o.id;
    elsif o.dispatched_at < now() - interval '15 minutes' then
      -- La respuesta ya no está (pg_net la borra a las horas): lo damos por enviado.
      update discord_outbox set status = 'enviado', sent_at = now(), last_error = 'sin confirmación de Discord' where id = o.id;
    end if;
  end loop;

  -- 2) Mandar lo pendiente, un mensaje por canal
  foreach ch in array array['general', 'admin'] loop
    if exists (select 1 from discord_outbox where channel = ch and status = 'enviando') then continue; end if;  -- uno a la vez
    v_url := null;
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'discord_webhook_' || ch limit 1;

    v_ids := '{}'; v_embeds := '[]'::jsonb; v_len := 0;
    for e in select id, embed from discord_outbox where channel = ch and status = 'pendiente' and next_try <= now() order by id limit 8
    loop
      exit when v_len + length(e.embed::text) > 5000 and array_length(v_ids, 1) > 0;
      v_ids := v_ids || e.id; v_embeds := v_embeds || jsonb_build_array(e.embed); v_len := v_len + length(e.embed::text);
    end loop;
    continue when coalesce(array_length(v_ids, 1), 0) = 0;

    if v_url is null or v_url !~ '^https://(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)/api/webhooks/' then
      update discord_outbox set last_error = 'Falta el secreto discord_webhook_' || ch || ' en Vault (o no es una URL de webhook de Discord).'
       where id = any(v_ids);
      continue;
    end if;

    v_req := net.http_post(
      url := v_url,
      body := jsonb_build_object('username', 'SharkTracker',
                                 'avatar_url', dc_site() || 'logo/FlaviIconLogo.png',
                                 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb),
                                 'embeds', v_embeds),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 8000);
    update discord_outbox set status = 'enviando', request_id = v_req, dispatched_at = now(), attempts = attempts + 1
     where id = any(v_ids);
  end loop;
end;
$$;

create or replace function discord_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform discord_scan();
  perform discord_send();
  delete from discord_outbox where created_at < now() - interval '30 days';
end;
$$;

-- ============================================================
-- Admin
-- ============================================================
create or replace function admin_set_discord(p_enabled boolean, p_kinds jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not is_admin() then raise exception 'Solo una administradora puede cambiar esto.'; end if;
  if p_kinds is not null then
    for k in select jsonb_object_keys(p_kinds) loop
      if not (select kinds ? k from discord_settings) then raise exception 'Aviso desconocido: %', k; end if;
      if jsonb_typeof(p_kinds->k) <> 'boolean' then raise exception 'Valor inválido para %', k; end if;
    end loop;
    update discord_settings set kinds = kinds || p_kinds where singleton;
  end if;
  update discord_settings set enabled = p_enabled,
         enabled_at = case when p_enabled and not enabled then now() else enabled_at end
   where singleton;
end;
$$;

-- p_what: 'general' | 'admin' | 'semana' (vista previa del resumen de esta semana)
create or replace function admin_discord_test(p_what text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws timestamptz := mission_week_start(now());
begin
  if not is_admin() then raise exception 'Solo una administradora puede hacer esto.'; end if;
  if p_what = 'semana' then
    perform discord_enqueue('general', 'prueba', 'prueba:semana:' || extract(epoch from clock_timestamp()),
                            discord_weekly_embed(v_ws, now(), true));
  elsif p_what in ('general', 'admin') then
    perform discord_enqueue(p_what, 'prueba', 'prueba:' || p_what || ':' || extract(epoch from clock_timestamp()), jsonb_build_object(
      'title', '🦈 Prueba de SharkTracker',
      'description', case when p_what = 'general' then 'Si ves esto, los avisos del canal **general** funcionan: subidas de liga, pentas, retos, partida del mes y resumen semanal.'
                          else 'Si ves esto, los avisos del canal de **admins** funcionan: aquí llegarán los canjes de premios.' end,
      'color', 58823, 'url', dc_site(),
      'author', dc_author((select id from players where user_id = auth.uid() limit 1)),
      'thumbnail', jsonb_build_object('url', dc_site() || 'logo/FlaviIconLogo.png'),
      'image', jsonb_build_object('url', coalesce(dc_fav_splash((select id from players where user_id = auth.uid() limit 1)), dc_splash('Nami', 0)))));
  else
    raise exception 'Prueba desconocida: %', p_what;
  end if;
  perform discord_send();
end;
$$;

create or replace function admin_discord_retry()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede hacer esto.'; end if;
  update discord_outbox set status = 'pendiente', attempts = 0, next_try = now(), last_error = null where status = 'error';
  perform discord_send();
end;
$$;

-- ¿Están guardados los secretos? (solo dice sí/no, nunca la URL)
create or replace function admin_discord_secrets()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede ver esto.'; end if;
  return jsonb_build_object(
    'general', exists (select 1 from vault.decrypted_secrets where name = 'discord_webhook_general'),
    'admin',   exists (select 1 from vault.decrypted_secrets where name = 'discord_webhook_admin'));
end;
$$;

-- ============================================================
-- Permisos
-- ============================================================
alter table discord_settings enable row level security;
alter table discord_outbox   enable row level security;
revoke all on discord_settings, discord_outbox from anon, authenticated;
grant select on discord_settings, discord_outbox to authenticated;
grant select, insert, update, delete on discord_settings, discord_outbox to service_role;
drop policy if exists "solo admins" on discord_settings;
create policy "solo admins" on discord_settings for select using (is_admin());
drop policy if exists "solo admins" on discord_outbox;
create policy "solo admins" on discord_outbox for select using (is_admin());

revoke execute on function discord_enqueue(text, text, text, jsonb), discord_weekly_embed(timestamptz, timestamptz, boolean),
                           discord_scan(), discord_send(), discord_tick(), dc_name(uuid), dc_site(), dc_champ_icon(text), dc_author(uuid), dc_fav_splash(uuid)
  from public, anon, authenticated;
revoke execute on function admin_set_discord(boolean, jsonb), admin_discord_test(text), admin_discord_retry(), admin_discord_secrets() from public, anon;
grant execute on function admin_set_discord(boolean, jsonb), admin_discord_test(text), admin_discord_retry(), admin_discord_secrets() to authenticated;

-- ── Cron (SQL puro, cada minuto) ──
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'discord';
    perform cron.schedule('discord', '* * * * *', 'select public.discord_tick()');
  end if;
end $$;
