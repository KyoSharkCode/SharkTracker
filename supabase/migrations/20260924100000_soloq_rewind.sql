-- ============================================================
-- SoloQ Rewind — datos que NO se borran a los 30 días.
--
-- El historial normal (matches / match_participants / rank_snapshots)
-- se limpia cada 30 días, así que para poder armar el resumen de un
-- split entero guardamos aparte, para siempre:
--
--   rewind_games  una fila compacta por jugador y partida de SoloQ
--                 (sin remakes): campeón, rol, equipo, KDA, LP, puntuación…
--   rank_daily    primer y último rango de SoloQ de cada día por jugador
--                 (para "empezaste en … y terminaste en …").
--
-- No se guardan con el split pegado: el split se calcula por fechas al
-- ver el Rewind, así que si se editan las fechas en el Admin sigue bien.
-- Todo se llena solo (triggers) y se rellena ahora con lo que ya hay.
-- ============================================================

create table if not exists rewind_games (
  match_id         text not null,
  player_id        uuid not null references players(id) on delete cascade,
  ended_at         timestamptz not null,
  duration_seconds integer not null,
  champion         text,
  role             text,
  team             text,
  win              boolean not null,
  kills            integer,
  deaths           integer,
  assists          integer,
  cs               integer,
  damage           integer,
  vision           integer,
  lp_change        integer,
  pentakills       integer not null default 0,
  score            numeric,
  primary key (match_id, player_id)
);
create index if not exists rewind_games_player_idx on rewind_games (player_id, ended_at);
create index if not exists rewind_games_ended_idx on rewind_games (ended_at);

create table if not exists rank_daily (
  player_id      uuid not null references players(id) on delete cascade,
  day            date not null,                    -- día en hora de Madrid
  first_tier     text, first_division text, first_lp integer, first_elo integer,
  last_tier      text, last_division  text, last_lp  integer, last_elo  integer,
  peak_tier      text, peak_division  text, peak_lp  integer, peak_elo  integer,
  updated_at     timestamptz not null default now(),
  primary key (player_id, day)
);

-- ── Copiar cada partida de SoloQ a rewind_games ──
create or replace function rewind_track_game()
returns trigger language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where match_id = new.match_id;
  if not found or m.queue_id <> 420 or coalesce(m.duration_seconds, 0) < 300 then return new; end if;   -- solo SoloQ, sin remakes
  insert into rewind_games as g (match_id, player_id, ended_at, duration_seconds, champion, role, team, win,
                                 kills, deaths, assists, cs, damage, vision, lp_change, pentakills, score)
  values (new.match_id, new.player_id, m.ended_at, m.duration_seconds, new.champion, new.role, new.team, new.win,
          new.kills, new.deaths, new.assists, new.cs, new.damage_to_champions, new.vision_score, new.lp_change,
          coalesce((new.extra_stats->>'pentakills')::int, 0),
          case when m.duration_seconds >= 900 then
            match_score(new.role, new.win, new.kills, new.deaths, new.assists, new.cs, new.damage_to_champions, new.vision_score,
                        m.duration_seconds, nullif(new.extra_stats->>'kp', '')::numeric, coalesce((new.extra_stats->>'pentakills')::int, 0)) end)
  on conflict (match_id, player_id) do update set
    lp_change = excluded.lp_change, role = excluded.role, pentakills = excluded.pentakills, score = excluded.score,
    kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists;
  return new;
end;
$$;
drop trigger if exists match_participants_rewind on match_participants;
create trigger match_participants_rewind after insert or update on match_participants
  for each row execute function rewind_track_game();

-- ── Rango de SoloQ por día ──
create or replace function rewind_rank_point(p_player uuid, p_tier text, p_div text, p_lp integer, p_elo integer, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tier is null or p_elo is null then return; end if;
  insert into rank_daily as r (player_id, day, first_tier, first_division, first_lp, first_elo,
                               last_tier, last_division, last_lp, last_elo, peak_tier, peak_division, peak_lp, peak_elo, updated_at)
  values (p_player, (p_at at time zone 'Europe/Madrid')::date, p_tier, p_div, p_lp, p_elo,
          p_tier, p_div, p_lp, p_elo, p_tier, p_div, p_lp, p_elo, p_at)
  on conflict (player_id, day) do update set
    last_tier = excluded.last_tier, last_division = excluded.last_division, last_lp = excluded.last_lp, last_elo = excluded.last_elo,
    peak_tier = case when excluded.peak_elo > coalesce(r.peak_elo, -1) then excluded.peak_tier else r.peak_tier end,
    peak_division = case when excluded.peak_elo > coalesce(r.peak_elo, -1) then excluded.peak_division else r.peak_division end,
    peak_lp = case when excluded.peak_elo > coalesce(r.peak_elo, -1) then excluded.peak_lp else r.peak_lp end,
    peak_elo = greatest(excluded.peak_elo, r.peak_elo),
    updated_at = excluded.updated_at
  where r.updated_at <= excluded.updated_at;
end;
$$;

create or replace function rewind_track_rank()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.queue_type = 'RANKED_SOLO_5x5' then
    perform rewind_rank_point(new.player_id, new.tier, new.division, new.lp, new.elo_score, new.recorded_at);
  end if;
  return new;
end;
$$;
drop trigger if exists rank_snapshots_rewind on rank_snapshots;
create trigger rank_snapshots_rewind after insert on rank_snapshots
  for each row execute function rewind_track_rank();

-- ── Rellenar con lo que ya hay (últimos 30 días) ──
insert into rewind_games (match_id, player_id, ended_at, duration_seconds, champion, role, team, win,
                          kills, deaths, assists, cs, damage, vision, lp_change, pentakills, score)
select mp.match_id, mp.player_id, m.ended_at, m.duration_seconds, mp.champion, mp.role, mp.team, mp.win,
       mp.kills, mp.deaths, mp.assists, mp.cs, mp.damage_to_champions, mp.vision_score, mp.lp_change,
       coalesce((mp.extra_stats->>'pentakills')::int, 0),
       case when m.duration_seconds >= 900 then
         match_score(mp.role, mp.win, mp.kills, mp.deaths, mp.assists, mp.cs, mp.damage_to_champions, mp.vision_score,
                     m.duration_seconds, nullif(mp.extra_stats->>'kp', '')::numeric, coalesce((mp.extra_stats->>'pentakills')::int, 0)) end
  from match_participants mp join matches m on m.match_id = mp.match_id
 where m.queue_id = 420 and m.duration_seconds >= 300
on conflict (match_id, player_id) do nothing;

do $$
declare r record;
begin
  for r in select player_id, tier, division, lp, elo_score, recorded_at from rank_snapshots
            where queue_type = 'RANKED_SOLO_5x5' and elo_score is not null order by recorded_at
  loop
    perform rewind_rank_point(r.player_id, r.tier, r.division, r.lp, r.elo_score, r.recorded_at);
  end loop;
end $$;

-- ── Permisos: lectura pública (mismos datos que ya se ven en la web) ──
alter table rewind_games enable row level security;
alter table rank_daily   enable row level security;
revoke all on rewind_games, rank_daily from anon, authenticated;
grant select on rewind_games, rank_daily to anon, authenticated;
grant select, insert, update, delete on rewind_games, rank_daily to service_role;
drop policy if exists "lectura publica" on rewind_games;
drop policy if exists "lectura publica" on rank_daily;
create policy "lectura publica" on rewind_games for select using (true);
create policy "lectura publica" on rank_daily   for select using (true);
revoke execute on function rewind_track_game(), rewind_track_rank(), rewind_rank_point(uuid, text, text, integer, integer, timestamptz)
  from public, anon, authenticated;

-- ============================================================
-- Discord: aviso cuando termina un split → "¡Ya está el SoloQ Rewind!"
-- (usa la cola de avisos; se enciende/apaga en Admin → Discord)
-- ============================================================
do $$
begin
  if to_regclass('public.discord_settings') is not null then
    execute $q$alter table discord_settings alter column kinds set default
      '{"liga": true, "penta": true, "reto": true, "partida_mes": true, "semana": true, "canje": true, "partida_grupo": true, "partida": false, "rewind": true}'::jsonb$q$;
    execute $q$update discord_settings set kinds = '{"rewind": true}'::jsonb || kinds where singleton$q$;
  end if;
end $$;

create or replace function discord_scan_rewind()
returns void language plpgsql security definer set search_path = public as $$
declare s discord_settings; sp record;
begin
  select * into s from discord_settings;
  if not found or not s.enabled or s.enabled_at is null then return; end if;
  for sp in select id, name, ends_at from splits
             where ends_at is not null and ends_at <= now() and ends_at >= s.enabled_at and ends_at > now() - interval '7 days'
  loop
    perform discord_enqueue('general', 'rewind', 'rewind:' || sp.id, jsonb_build_object(
      'title', '🎞️ ¡Ya está el SoloQ Rewind!',
      'description', 'Terminó **' || sp.name || '**. Mira tu resumen del split: partidas, campeón estrella, rachas, tu dúo, tu némesis y de dónde a dónde llegaste.'
                     || E'\n' || '[Ver mi Rewind](' || dc_site() || 'rewind.html?split=' || sp.id || ')',
      'color', 58823,
      'url', dc_site() || 'rewind.html?split=' || sp.id,
      'thumbnail', jsonb_build_object('url', dc_site() || 'logo/FlaviIconLogo.png'),
      'timestamp', sp.ends_at));
  end loop;
end;
$$;

create or replace function discord_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform discord_scan();
  if to_regprocedure('public.discord_scan_live()') is not null then perform discord_scan_live(); end if;
  perform discord_scan_rewind();
  perform discord_send();
  delete from discord_outbox where created_at < now() - interval '30 days';
end;
$$;
revoke execute on function discord_scan_rewind(), discord_tick() from public, anon, authenticated;
