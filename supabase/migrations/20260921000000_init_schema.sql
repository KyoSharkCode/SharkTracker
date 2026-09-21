-- ============================================================
-- SharkTracker — esquema inicial de Supabase
-- Reemplaza datos.json / datos_partidas.json / live_data.json
-- del proyecto viejo (ver OLD/) por tablas relacionales.
-- ============================================================

create extension if not exists "pgcrypto";

-- ── ROSTER ────────────────────────────────────────────────────
-- Whitelist de cuentas de LoL seguidas (equivalente a JUGADORES
-- en el script viejo). Se crea a mano; user_id queda NULL hasta
-- que alguien la reclama con login (ver claim_player() al final).
create table players (
  id             uuid primary key default gen_random_uuid(),
  riot_game_name text not null,
  riot_tag_line  text not null,
  puuid          text unique,
  icon_id        integer,
  user_id        uuid unique references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (riot_game_name, riot_tag_line)
);
comment on table players is 'Roster/whitelist de cuentas de LoL. user_id se llena al reclamar el perfil vía login.';

-- ── PERFIL PÚBLICO EDITABLE ──────────────────────────────────
-- Separada de "players" para que el dueño solo pueda tocar ESTA
-- fila (vía RLS) y nunca su Riot ID / vínculo de cuenta.
create table player_profiles (
  player_id        uuid primary key references players(id) on delete cascade,
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  display_name     text,
  bio              text,
  banner_color     text,
  discord_username text,
  updated_at       timestamptz not null default now()
);

-- ── RANGOS por cola, con historial temporal ─────────────────
-- Una fila nueva cada vez que cambia rango/división/LP. queue_type
-- es texto libre ('RANKED_SOLO_5x5', 'RANKED_FLEX_SR', ...) para
-- no tener que migrar el esquema si se agrega una cola nueva.
create table rank_snapshots (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references players(id) on delete cascade,
  queue_type  text not null,
  tier        text,
  division    text,
  lp          integer not null default 0,
  wins        integer not null default 0,
  losses      integer not null default 0,
  elo_score   integer,
  recorded_at timestamptz not null default now()
);
create index rank_snapshots_player_queue_idx on rank_snapshots (player_id, queue_type, recorded_at desc);

-- ── MAESTRÍAS (top 3 por jugador) ────────────────────────────
create table player_masteries (
  player_id  uuid not null references players(id) on delete cascade,
  rank       smallint not null check (rank between 1 and 3),
  champion   text not null,
  level      integer not null,
  points     integer not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, rank)
);

-- ── PARTIDAS ──────────────────────────────────────────────────
create table matches (
  match_id          text primary key,
  queue_id          integer not null,
  queue_type        text,
  game_mode         text,
  patch             text,
  duration_seconds  integer not null,
  ended_at          timestamptz not null,
  teams             jsonb,
  created_at        timestamptz not null default now()
);

create table match_participants (
  id                   bigint generated always as identity primary key,
  match_id             text not null references matches(match_id) on delete cascade,
  player_id            uuid not null references players(id) on delete cascade,
  champion             text not null,
  team                 text not null,
  win                  boolean not null,
  kills                integer,
  deaths               integer,
  assists              integer,
  cs                   integer,
  gold                 integer,
  damage_to_champions  integer,
  damage_taken         integer,
  vision_score         integer,
  role                 text,
  lp_change            integer,
  keystone_perk        integer,
  secondary_style      integer,
  summoner_spells      integer[],
  extra_stats          jsonb,
  ai_advice            text,
  unique (match_id, player_id)
);
create index match_participants_player_idx on match_participants (player_id, match_id);

-- ── EN VIVO ───────────────────────────────────────────────────
create table live_games (
  game_id      bigint primary key,
  queue_type   text,
  started_at   timestamptz,
  bans         jsonb,
  participants jsonb,
  updated_at   timestamptz not null default now()
);

create table live_status (
  player_id       uuid primary key references players(id) on delete cascade,
  in_game         boolean not null default false,
  game_id         bigint references live_games(game_id) on delete set null,
  champion        text,
  team            text,
  runes           jsonb,
  summoner_spells integer[],
  updated_at      timestamptz not null default now()
);

-- ── GAMIFICACIÓN: badges + feed de eventos ─────────────────
create table weekly_badges (
  category   text primary key,
  player_id  uuid references players(id),
  value      numeric,
  detail     text,
  updated_at timestamptz not null default now()
);

create table events (
  id                 bigint generated always as identity primary key,
  type               text not null,
  category           text,
  icon               text,
  player_id          uuid references players(id),
  previous_player_id uuid references players(id),
  detail             text,
  occurred_at        timestamptz not null default now()
);
create index events_occurred_at_idx on events (occurred_at desc);

-- ============================================================
-- RLS — lectura pública (es un tracker para mostrar, sin datos
-- sensibles en estas tablas), escritura solo vía service_role
-- (Edge Functions) salvo el propio perfil editable.
-- ============================================================
alter table players            enable row level security;
alter table player_profiles    enable row level security;
alter table rank_snapshots     enable row level security;
alter table player_masteries   enable row level security;
alter table matches            enable row level security;
alter table match_participants enable row level security;
alter table live_games         enable row level security;
alter table live_status        enable row level security;
alter table weekly_badges      enable row level security;
alter table events             enable row level security;

create policy "lectura publica" on players            for select using (true);
create policy "lectura publica" on player_profiles    for select using (true);
create policy "lectura publica" on rank_snapshots      for select using (true);
create policy "lectura publica" on player_masteries    for select using (true);
create policy "lectura publica" on matches             for select using (true);
create policy "lectura publica" on match_participants  for select using (true);
create policy "lectura publica" on live_games          for select using (true);
create policy "lectura publica" on live_status         for select using (true);
create policy "lectura publica" on weekly_badges       for select using (true);
create policy "lectura publica" on events              for select using (true);

create policy "dueno edita su perfil" on player_profiles
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- GRANTS — activar RLS no basta: cada rol también necesita el
-- permiso base de Postgres sobre la tabla ANTES de que las
-- políticas de arriba entren a filtrar filas. service_role (la
-- que usan las Edge Functions) necesita CRUD completo; anon/
-- authenticated se quedan en SELECT, ya acotado por RLS.
-- ============================================================
grant usage on schema public to service_role, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant select on tables to anon, authenticated;

-- ============================================================
-- REGISTRO — reclamar un perfil del roster tras login con Discord.
-- security definer: corre con permisos elevados PERO solo hace
-- esta operación puntual (no es un atajo para saltarse RLS en
-- general). Rechaza si el Riot ID no matchea con el roster o si
-- esa cuenta ya fue reclamada por otra persona.
-- ============================================================
create or replace function claim_player(p_game_name text, p_tag_line text)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player players;
begin
  select * into v_player
  from players
  where lower(riot_game_name) = lower(p_game_name)
    and lower(riot_tag_line)  = lower(p_tag_line)
    and user_id is null
  for update;

  if not found then
    raise exception 'No se encontró una cuenta esperada con ese Riot ID, o ya fue reclamada.';
  end if;

  update players set user_id = auth.uid() where id = v_player.id;

  insert into player_profiles (player_id, user_id, display_name)
  values (v_player.id, auth.uid(), p_game_name)
  on conflict (player_id) do nothing;

  select * into v_player from players where id = v_player.id;
  return v_player;
end;
$$;

grant execute on function claim_player(text, text) to authenticated;

-- ============================================================
-- RETENCIÓN — 30 días de historial (rango y partidas). Ya no
-- hace falta podar por CANTIDAD de puntos como en el script
-- viejo (MAX_PUNTOS_HISTORIAL = 300 / últimas 10 partidas): con
-- una base de datos real, se poda por TIEMPO. match_participants
-- se borra solo vía "on delete cascade" al borrar la partida.
-- pg_cron corre esta limpieza todos los días a las 5AM UTC.
-- ============================================================
create extension if not exists pg_cron;

create or replace function cleanup_old_history()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rank_snapshots where recorded_at < now() - interval '30 days';
  delete from matches        where ended_at    < now() - interval '30 days';
  delete from events         where occurred_at < now() - interval '30 days';
end;
$$;

select cron.schedule(
  'cleanup-old-history',
  '0 5 * * *',
  $$select cleanup_old_history()$$
);

-- ============================================================
-- ETAPA 3 — Badges (dos ventanas) + Rey de la Temporada.
-- TODO restringido a SoloQ (queue_id = 420) únicamente. 100%
-- calculado desde datos ya en la base — cero llamadas a Riot.
--
-- Pendiente para una etapa futura (no está aquí todavía):
--   - lp_change por partida / posible Égida de Valor
--   - adelantamientos de ranking (evento "X superó a Y")
--   - primera victoria del día
-- ============================================================

-- Rey de la Temporada es distinto a los demás badges: en vez de
-- recalcularse desde cero cada corrida, ACUMULA tiempo real entre
-- corridas — necesita su propio estado persistente.
create table season_king_progress (
  player_id    uuid primary key references players(id) on delete cascade,
  dias_en_top1 numeric not null default 0
);

create table season_king_state (
  singleton       boolean primary key default true,
  current_top1    uuid references players(id),
  last_checked_at timestamptz not null default now(),
  constraint season_king_state_es_singleton check (singleton)
);
insert into season_king_state (singleton, current_top1, last_checked_at)
values (true, null, now());

alter table season_king_progress enable row level security;
alter table season_king_state    enable row level security;
create policy "lectura publica" on season_king_progress for select using (true);
create policy "lectura publica" on season_king_state    for select using (true);
grant select, insert, update, delete on season_king_progress, season_king_state to service_role;
grant select on season_king_progress, season_king_state to anon, authenticated;

-- ── Badges SUPERIORES — últimas 10 partidas de SoloQ por jugador ──
create or replace function compute_recent_badges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_prev_player uuid;
  v_madrid_now timestamp;
  v_day_start timestamptz;
begin
  drop table if exists _recent_stats;
  create temporary table _recent_stats as
  select player_id, kills, vision_score
  from (
    select mp.player_id, mp.kills, mp.vision_score,
      row_number() over (partition by mp.player_id order by m.ended_at desc) as rn
    from match_participants mp
    join matches m on m.match_id = mp.match_id
    where m.queue_id = 420
  ) ranked
  where rn <= 10;

  drop table if exists _recent_badge_results;
  create temporary table _recent_badge_results (
    category text primary key, player_id uuid, valor numeric, detail text
  );

  -- Top Asesino — total de kills en sus últimas 10
  insert into _recent_badge_results
  select 'top_asesino', player_id, valor, valor || ' kills en sus últimas 10 partidas'
  from (select player_id, sum(kills) as valor from _recent_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- Top Observador — mejor promedio de visión en sus últimas 10
  insert into _recent_badge_results
  select 'top_observador', player_id, round(valor, 1), round(valor, 1) || ' de visión en promedio'
  from (select player_id, avg(vision_score) as valor from _recent_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- Sin Rendirse — partidas de SoloQ jugadas HOY (día = 6AM España)
  v_madrid_now := now() at time zone 'Europe/Madrid';
  if extract(hour from v_madrid_now) >= 6 then
    v_day_start := (date_trunc('day', v_madrid_now) + interval '6 hours') at time zone 'Europe/Madrid';
  else
    v_day_start := (date_trunc('day', v_madrid_now) - interval '1 day' + interval '6 hours') at time zone 'Europe/Madrid';
  end if;

  insert into _recent_badge_results
  select 'sin_rendirse', player_id, valor,
    valor || ' partida' || (case when valor <> 1 then 's' else '' end) || ' hoy'
  from (
    select mp.player_id, count(*) as valor
    from match_participants mp
    join matches m on m.match_id = mp.match_id
    where m.queue_id = 420 and m.ended_at >= v_day_start
    group by mp.player_id
  ) x
  where valor > 0 order by valor desc limit 1;

  for r in select * from _recent_badge_results loop
    select player_id into v_prev_player from weekly_badges where category = r.category;
    if v_prev_player is distinct from r.player_id then
      insert into events (type, category, player_id, previous_player_id, detail)
      values ('badge_reciente', r.category, r.player_id, v_prev_player, r.detail);
    end if;
    insert into weekly_badges (category, player_id, value, detail, updated_at)
    values (r.category, r.player_id, r.valor, r.detail, now())
    on conflict (category) do update
      set player_id = excluded.player_id, value = excluded.value,
          detail = excluded.detail, updated_at = now();
  end loop;
end;
$$;

grant execute on function compute_recent_badges() to service_role;

-- ── Destacados DE LA SEMANA — últimos 7 días de SoloQ ──────────
create or replace function compute_weekly_badges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_prev_player uuid;
begin
  drop table if exists _weekly_stats;
  create temporary table _weekly_stats as
  select
    mp.player_id, mp.champion, mp.win, mp.kills, mp.deaths, mp.assists, mp.cs,
    m.duration_seconds,
    coalesce((mp.extra_stats->>'primera_sangre')::boolean, false) as primera_sangre,
    coalesce((mp.extra_stats->>'pentakills')::int, 0) as pentakills,
    coalesce((mp.extra_stats->>'objetivos_robados')::int, 0) as objetivos_robados,
    coalesce((mp.extra_stats->>'estructuras_destruidas')::int, 0) as estructuras_destruidas,
    coalesce((mp.extra_stats->>'tiempo_cc')::numeric, 0) as tiempo_cc,
    coalesce((mp.extra_stats->>'damage_taken_pct')::numeric, 0) as damage_taken_pct,
    coalesce(mp.extra_stats->'duo_con', '[]'::jsonb) as duo_con
  from match_participants mp
  join matches m on m.match_id = mp.match_id
  where m.queue_id = 420 and m.ended_at >= now() - interval '7 days';

  drop table if exists _badge_results;
  create temporary table _badge_results (
    category text primary key, player_id uuid, valor numeric, detail text
  );

  -- OTP del Torneo — mismo campeón más veces repetido esta semana
  insert into _badge_results
  select 'otp_del_torneo', player_id, veces, veces || ' partidas con ' || champion
  from (
    select distinct on (player_id) player_id, champion, count(*) as veces
    from _weekly_stats group by player_id, champion
    order by player_id, count(*) desc
  ) x
  where veces > 0 order by veces desc limit 1;

  -- Maestro del Champion Pool — más campeones DISTINTOS ganados esta semana
  insert into _badge_results
  select 'champion_pool', player_id, valor, valor || ' campeones distintos ganados'
  from (select player_id, count(distinct champion) filter (where win) as valor
        from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- El Escalador — subida de elo_score en SoloQ en 7 días
  insert into _badge_results
  select 'escalador', l.player_id, (l.elo_now - b.elo_before), 'Mejor jugador de la semana'
  from (
    select distinct on (player_id) player_id, elo_score as elo_now
    from rank_snapshots where queue_type = 'RANKED_SOLO_5x5'
    order by player_id, recorded_at desc
  ) l
  join (
    select distinct on (player_id) player_id, elo_score as elo_before
    from rank_snapshots
    where queue_type = 'RANKED_SOLO_5x5' and recorded_at <= now() - interval '7 days'
    order by player_id, recorded_at desc
  ) b on b.player_id = l.player_id
  where (l.elo_now - b.elo_before) > 0
  order by (l.elo_now - b.elo_before) desc limit 1;

  -- Horas en la Grieta — minutos totales jugados esta semana
  insert into _badge_results
  select 'horas_en_la_grieta', player_id, round(valor / 60.0, 1),
    round(valor / 60.0, 1) || ' minutos jugados esta semana'
  from (select player_id, sum(duration_seconds) as valor from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- Agresivo
  insert into _badge_results
  select 'agresivo', player_id, valor,
    valor || ' primera' || (case when valor <> 1 then 's' else '' end) || ' sangre'
  from (select player_id, count(*) filter (where primera_sangre) as valor
        from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- KDA Player
  insert into _badge_results
  select 'kda_player', player_id, score,
    case when perfecto then 'KDA Perfecto' else score || ' KDA' end
  from (
    select player_id, (sum(deaths) = 0) as perfecto,
      case when sum(deaths) = 0 then 999
           else round((sum(kills) + sum(assists))::numeric / sum(deaths), 2) end as score
    from _weekly_stats group by player_id
  ) x order by score desc limit 1;

  -- Pentakills
  insert into _badge_results
  select 'pentakills', player_id, valor,
    valor || ' pentakill' || (case when valor <> 1 then 's' else '' end)
  from (select player_id, sum(pentakills) as valor from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- Dúo Dinámico
  insert into _badge_results
  select 'duo_dinamico', player_id, veces,
    'con ' || partner || ' (' || veces || ' partida' || (case when veces <> 1 then 's' else '' end) || ' juntos)'
  from (
    select distinct on (player_id) player_id, partner, veces
    from (
      select player_id, partner, count(*) as veces
      from (select player_id, jsonb_array_elements_text(duo_con) as partner from _weekly_stats) p
      group by player_id, partner
    ) c order by player_id, veces desc
  ) best
  order by veces desc limit 1;

  -- El Farmeador — mejor CS/min de UNA partida en los últimos 7 días
  insert into _badge_results
  select 'farmeador', player_id, cs_min, cs_min || ' CS/min con ' || champion
  from (
    select player_id, champion, round(cs / greatest(duration_seconds / 60.0, 1), 1) as cs_min
    from _weekly_stats
  ) x where cs_min > 0 order by cs_min desc limit 1;

  -- El Defensor — promedio del % de daño de su equipo absorbido
  insert into _badge_results
  select 'defensor', player_id, pct, pct || '% del daño de su equipo, en promedio esta semana'
  from (
    select player_id, round(avg(damage_taken_pct), 1) as pct
    from _weekly_stats where damage_taken_pct > 0 group by player_id
  ) x where pct > 0 order by pct desc limit 1;

  -- El Ladrón
  insert into _badge_results
  select 'ladron', player_id, valor,
    valor || ' objetivo' || (case when valor <> 1 then 's' else '' end) || ' robado' || (case when valor <> 1 then 's' else '' end)
  from (select player_id, sum(objetivos_robados) as valor from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- El Destructor
  insert into _badge_results
  select 'destructor', player_id, valor,
    valor || ' estructura' || (case when valor <> 1 then 's' else '' end) || ' destruida' || (case when valor <> 1 then 's' else '' end)
  from (select player_id, sum(estructuras_destruidas) as valor from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- Stop
  insert into _badge_results
  select 'stop', player_id, valor, round(valor) || 's de CC aplicado'
  from (select player_id, sum(tiempo_cc) as valor from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  for r in select * from _badge_results loop
    select player_id into v_prev_player from weekly_badges where category = r.category;
    if v_prev_player is distinct from r.player_id then
      insert into events (type, category, player_id, previous_player_id, detail)
      values ('badge_semanal', r.category, r.player_id, v_prev_player, r.detail);
    end if;
    insert into weekly_badges (category, player_id, value, detail, updated_at)
    values (r.category, r.player_id, r.valor, r.detail, now())
    on conflict (category) do update
      set player_id = excluded.player_id, value = excluded.value,
          detail = excluded.detail, updated_at = now();
  end loop;
end;
$$;

grant execute on function compute_weekly_badges() to service_role;

-- ── Rey de la Temporada — tiempo acumulado en el #1 de SoloQ ──
create or replace function compute_season_king()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_top1 uuid;
  v_prev_top1 uuid;
  v_last_checked timestamptz;
  v_elapsed_days numeric;
  v_king_player uuid;
  v_king_days numeric;
  v_prev_king uuid;
begin
  select player_id into v_current_top1
  from (
    select distinct on (player_id) player_id, elo_score
    from rank_snapshots where queue_type = 'RANKED_SOLO_5x5'
    order by player_id, recorded_at desc
  ) latest
  order by elo_score desc limit 1;

  select current_top1, last_checked_at into v_prev_top1, v_last_checked
  from season_king_state limit 1;

  -- El tiempo transcurrido desde la última corrida se le atribuye a
  -- quien tenía el #1 ANTES de este chequeo, no al nuevo.
  if v_prev_top1 is not null then
    v_elapsed_days := greatest(extract(epoch from (now() - v_last_checked)) / 86400.0, 0);
    insert into season_king_progress (player_id, dias_en_top1)
    values (v_prev_top1, v_elapsed_days)
    on conflict (player_id) do update
      set dias_en_top1 = season_king_progress.dias_en_top1 + v_elapsed_days;
  end if;

  update season_king_state set current_top1 = v_current_top1, last_checked_at = now();

  select player_id, dias_en_top1 into v_king_player, v_king_days
  from season_king_progress order by dias_en_top1 desc limit 1;

  if v_king_player is not null then
    select player_id into v_prev_king from weekly_badges where category = 'rey_temporada';
    if v_prev_king is distinct from v_king_player then
      insert into events (type, category, player_id, previous_player_id, detail)
      values ('rey_temporada', 'rey_temporada', v_king_player, v_prev_king,
              round(v_king_days, 1) || ' días acumulados en el Top 1');
    end if;
    insert into weekly_badges (category, player_id, value, detail, updated_at)
    values ('rey_temporada', v_king_player, v_king_days,
            round(v_king_days, 1) || ' días acumulados en el Top 1', now())
    on conflict (category) do update
      set player_id = excluded.player_id, value = excluded.value,
          detail = excluded.detail, updated_at = now();
  end if;
end;
$$;

grant execute on function compute_season_king() to service_role;

-- ============================================================
-- ETAPA 4 — En vivo (Spectator v5) + caché de Data Dragon.
-- ============================================================

-- Caché del diccionario de campeones de Data Dragon — se refresca
-- solo cuando Riot saca una versión nueva (se chequea con una
-- petición chica a versions.json en cada corrida; el JSON completo
-- de campeones solo se vuelve a pedir si la versión cambió).
create table ddragon_cache (
  id         boolean primary key default true,
  version    text not null,
  champions  jsonb not null,
  updated_at timestamptz not null default now(),
  constraint ddragon_cache_es_singleton check (id)
);
alter table ddragon_cache enable row level security;
grant select, insert, update on ddragon_cache to service_role;

-- ============================================================
-- ETAPA 6 — Piezas que faltaban, confirmadas contra el JSON real
-- del tracker viejo (OLD/datos.json, OLD/live_data.json):
-- récord de LP, adelantamientos de ranking, rol/campeones
-- recientes, LP por partida, posible Égida, logros de una sola
-- partida, primera victoria del día.
-- ============================================================
alter table players add column record_lp_score integer;
alter table players add column record_lp_label text;
alter table players add column primary_role text;
alter table players add column top_roles jsonb;
alter table players add column top_recent_champions jsonb;

-- "Representación" de campeón elegida por cada jugador — se muestra de
-- fondo en su fila/tarjeta cuando NO está en partida (cuando SÍ está en
-- partida, se usa el campeón real que está jugando ahora mismo). Por
-- ahora se llena a mano (admin), hasta que exista el perfil editable.
alter table players add column favorite_champion text;
alter table players add column favorite_skin integer default 0;

update players set favorite_champion = 'Aurora', favorite_skin = 1 where riot_game_name = 'Galactic Shark';
update players set favorite_champion = 'Ahri',   favorite_skin = 85 where riot_game_name = 'El Buñuelito';
update players set favorite_champion = 'Fiora',  favorite_skin = 50 where riot_game_name = 'Pinea';
update players set favorite_champion = 'Lux',    favorite_skin = 3 where riot_game_name = 'Ostia';
update players set favorite_champion = 'Poppy',  favorite_skin = 1 where riot_game_name = 'ゆうき まこと';
update players set favorite_champion = 'Vayne',  favorite_skin = 11 where riot_game_name = 'adrianNOOBYT';

-- Posición de cada jugador en el ranking SoloQ de la corrida anterior
-- — se compara contra la actual para detectar adelantamientos.
create table ranking_positions (
  player_id  uuid primary key references players(id) on delete cascade,
  position   integer not null,
  updated_at timestamptz not null default now()
);
alter table ranking_positions enable row level security;
grant select, insert, update, delete on ranking_positions to service_role;
grant select on ranking_positions to anon, authenticated;

-- Quién tiene la primera victoria SoloQ del día (día = 6AM España,
-- mismo criterio que "Sin Rendirse"). Se resetea solo al cambiar de día.
create table daily_first_win_state (
  singleton  boolean primary key default true,
  day_start  timestamptz,
  player_id  uuid references players(id),
  won_at     timestamptz,
  constraint daily_first_win_singleton check (singleton)
);
insert into daily_first_win_state (singleton, day_start, player_id, won_at) values (true, null, null, null);
alter table daily_first_win_state enable row level security;
create policy "lectura publica" on daily_first_win_state for select using (true);
grant select, insert, update on daily_first_win_state to service_role;
grant select on daily_first_win_state to anon, authenticated;

-- ============================================================
-- ETAPA 5 — Twitch: ¿estás en vivo ahora mismo?
-- ============================================================
alter table player_profiles add column twitch_username text;

create table stream_status (
  player_id     uuid primary key references players(id) on delete cascade,
  is_live       boolean not null default false,
  title         text,
  game_name     text,
  viewer_count  integer,
  started_at    timestamptz,
  thumbnail_url text,
  updated_at    timestamptz not null default now()
);
alter table stream_status enable row level security;
create policy "lectura publica" on stream_status for select using (true);
grant select, insert, update, delete on stream_status to service_role;
grant select on stream_status to anon, authenticated;

-- Twitch da un token de acceso de app que dura ~60 días — se guarda
-- y se reutiliza en vez de pedir uno nuevo en cada corrida.
create table twitch_token_cache (
  id           boolean primary key default true,
  access_token text not null,
  expires_at   timestamptz not null,
  constraint twitch_token_cache_es_singleton check (id)
);
alter table twitch_token_cache enable row level security;
grant select, insert, update on twitch_token_cache to service_role;

update player_profiles
set twitch_username = 'kyosumivt'
where player_id = (
  select id from players where riot_game_name = 'Galactic Shark' and riot_tag_line = 'AYK'
);

-- ── Cron: las tres corren juntas cada 3 minutos (igual que sync-matches) ──
select cron.schedule(
  'compute-all-badges',
  '*/3 * * * *',
  $$
  select compute_recent_badges();
  select compute_weekly_badges();
  select compute_season_king();
  $$
);
