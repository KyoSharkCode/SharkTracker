-- ============================================================
-- FASE 5 — Historial de rangos por split + Mejor partida del mes
--
-- 1) splits: fechas de cada split/temporada de Riot. Vienen cargadas
--    las de 2026 y se pueden cambiar desde el Admin Dashboard.
-- 2) split_ranks: pico y rango final de cada jugador en cada split.
--    Se llena SOLO con cada rango nuevo (trigger en rank_snapshots) y
--    se recalcula entero cuando la admin cambia las fechas de un split
--    (usando rank_peaks, que guarda los picos por mes para siempre).
-- 3) best_matches: la mejor partida de SoloQ de cada jugador en cada mes
--    (hora de Madrid), según una puntuación de rendimiento 0–100 ajustada
--    por rol. Se guarda aparte porque las partidas se borran a los 30 días.
-- ============================================================

-- ── 1) Splits ──
create table if not exists splits (
  id         bigint generated always as identity primary key,
  name       text not null check (length(trim(name)) between 1 and 60),
  starts_at  timestamptz not null,
  ends_at    timestamptz,                         -- null = sin fecha de fin
  check (ends_at is null or ends_at > starts_at)
);
insert into splits (name, starts_at, ends_at)
select * from (values
  ('2026 · Temporada 1', timestamptz '2026-01-08 12:00 Europe/Madrid', timestamptz '2026-04-29 12:00 Europe/Madrid'),
  ('2026 · Temporada 2', timestamptz '2026-04-29 12:00 Europe/Madrid', timestamptz '2026-07-29 12:00 Europe/Madrid'),
  ('2026 · Temporada 3', timestamptz '2026-07-29 12:00 Europe/Madrid', timestamptz '2027-01-07 12:00 Europe/Madrid')
) v(n, s, e)
where not exists (select 1 from splits);

create or replace function split_for(ts timestamptz)
returns bigint language sql stable set search_path = public as $$
  select id from splits
   where starts_at <= ts and (ends_at is null or ts < ends_at)
   order by starts_at desc limit 1
$$;

-- ── 2) Pico y rango final por split ──
create table if not exists split_ranks (
  player_id     uuid not null references players(id) on delete cascade,
  queue_type    text not null,
  split_id      bigint not null references splits(id) on delete cascade,
  peak_tier     text,
  peak_division text,
  peak_lp       integer,
  peak_elo      integer,
  peak_at       timestamptz,
  last_tier     text,
  last_division text,
  last_lp       integer,
  last_elo      integer,
  last_wins     integer,
  last_losses   integer,
  last_at       timestamptz,
  primary key (player_id, queue_type, split_id)
);

-- Suma un "punto" de rango al split que le toca. p_last = false para
-- puntos que solo sirven como pico (el pico mensual de rank_peaks).
create or replace function split_rank_point(
  p_player uuid, p_queue text, p_tier text, p_div text, p_lp integer, p_elo integer,
  p_wins integer, p_losses integer, p_at timestamptz, p_last boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_split bigint := split_for(p_at);
begin
  if v_split is null or p_elo is null or p_at is null then return; end if;
  insert into split_ranks as sr (
    player_id, queue_type, split_id,
    peak_tier, peak_division, peak_lp, peak_elo, peak_at,
    last_tier, last_division, last_lp, last_elo, last_wins, last_losses, last_at)
  values (
    p_player, p_queue, v_split,
    p_tier, p_div, p_lp, p_elo, p_at,
    case when p_last then p_tier end, case when p_last then p_div end, case when p_last then p_lp end,
    case when p_last then p_elo end, case when p_last then p_wins end, case when p_last then p_losses end,
    case when p_last then p_at end)
  on conflict (player_id, queue_type, split_id) do update set
    peak_tier     = case when excluded.peak_elo > sr.peak_elo then excluded.peak_tier     else sr.peak_tier     end,
    peak_division = case when excluded.peak_elo > sr.peak_elo then excluded.peak_division else sr.peak_division end,
    peak_lp       = case when excluded.peak_elo > sr.peak_elo then excluded.peak_lp       else sr.peak_lp       end,
    peak_at       = case when excluded.peak_elo > sr.peak_elo then excluded.peak_at       else sr.peak_at       end,
    peak_elo      = greatest(sr.peak_elo, excluded.peak_elo),
    last_tier     = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then excluded.last_tier     else sr.last_tier     end,
    last_division = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then excluded.last_division else sr.last_division end,
    last_lp       = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then excluded.last_lp       else sr.last_lp       end,
    last_elo      = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then excluded.last_elo      else sr.last_elo      end,
    last_wins     = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then excluded.last_wins     else sr.last_wins     end,
    last_losses   = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then excluded.last_losses   else sr.last_losses   end,
    last_at       = case when p_last and (sr.last_at is null or p_at >= sr.last_at) then p_at                   else sr.last_at       end;
end;
$$;

create or replace function track_split_rank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform split_rank_point(new.player_id, new.queue_type, new.tier, new.division, new.lp, new.elo_score,
                           new.wins, new.losses, new.recorded_at, true);
  return new;
end;
$$;
drop trigger if exists rank_snapshots_track_split on rank_snapshots;
create trigger rank_snapshots_track_split after insert on rank_snapshots
  for each row execute function track_split_rank();

-- Recalcula todo (al crear/editar/borrar un split): picos y cierres de
-- cada mes (rank_peaks, se guardan para siempre) + los rangos de los
-- últimos 30 días (rank_snapshots), en orden cronológico.
create or replace function rebuild_split_ranks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  delete from split_ranks where true;   -- "where true": Supabase bloquea DELETE sin WHERE
  for r in
    select * from (
      select player_id, queue_type, peak_tier t, peak_division d, peak_lp lp, peak_elo e, null::int w, null::int l, peak_at at, false is_last from rank_peaks
      union all
      select player_id, queue_type, last_tier, last_division, last_lp, last_elo, last_wins, last_losses, last_at, true from rank_peaks
      union all
      select player_id, queue_type, tier, division, lp, elo_score, wins, losses, recorded_at, true from rank_snapshots where elo_score is not null
    ) x
    where at is not null
    order by at
  loop
    perform split_rank_point(r.player_id, r.queue_type, r.t, r.d, r.lp, r.e, r.w, r.l, r.at, r.is_last);
  end loop;
end;
$$;

-- Admin: crear / editar / borrar splits (y recalcular).
create or replace function admin_save_split(p_id bigint, p_name text, p_starts_at timestamptz, p_ends_at timestamptz)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede editar los splits.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Ponle un nombre al split.'; end if;
  if p_starts_at is null then raise exception 'Falta la fecha de inicio.'; end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'La fecha de fin tiene que ser después del inicio.'; end if;
  if exists (select 1 from splits s
              where s.id is distinct from p_id
                and tstzrange(s.starts_at, s.ends_at) && tstzrange(p_starts_at, p_ends_at)) then
    raise exception 'Esas fechas se cruzan con otro split.';
  end if;
  if p_id is null then
    insert into splits (name, starts_at, ends_at) values (trim(p_name), p_starts_at, p_ends_at) returning id into v_id;
  else
    update splits set name = trim(p_name), starts_at = p_starts_at, ends_at = p_ends_at where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Ese split no existe.'; end if;
  end if;
  perform rebuild_split_ranks();
  return v_id;
end;
$$;

create or replace function admin_delete_split(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede borrar splits.';
  end if;
  delete from splits where id = p_id;
  perform rebuild_split_ranks();
end;
$$;

-- ── 3) Mejor partida del mes ──
-- Puntuación 0–100 ajustada por rol. Referencias (lo "normal" por minuto;
-- cada apartado llega al máximo con 1,5× lo normal, CS con 1,25×, KDA con 8
-- y participación en kills con 80 %):
--            daño/min  CS/min  visión/min
--   TOP        650      7.0      0.7
--   JUNGLE     500      5.8      1.0
--   MID        700      7.5      0.8
--   ADC        750      8.0      0.7
--   SUPPORT    300      1.2      2.0
-- Pesos: KDA 25 · participación en kills 20 · daño 20 · CS 10 · visión 10 ·
-- victoria 15 (support: CS 5 y visión 15). Si la partida no tiene
-- participación en kills guardada (partidas viejas), se reparte el resto.
-- Extras: +5 por pentakill, +3 por ganar sin morir. Máximo 100.
create or replace function match_score(
  p_role text, p_win boolean, p_k integer, p_d integer, p_a integer, p_cs integer,
  p_dmg integer, p_vision integer, p_dur integer, p_kp numeric, p_pentas integer)
returns numeric
language plpgsql
immutable
as $$
declare
  r text := case upper(coalesce(p_role, ''))
              when 'TOP' then 'TOP' when 'JUNGLE' then 'JUNGLE' when 'MIDDLE' then 'MID' when 'MID' then 'MID'
              when 'BOTTOM' then 'ADC' when 'ADC' then 'ADC' when 'UTILITY' then 'SUPPORT' when 'SUPPORT' then 'SUPPORT'
              else '' end;
  b_dpm numeric := case r when 'TOP' then 650 when 'JUNGLE' then 500 when 'MID' then 700 when 'ADC' then 750 when 'SUPPORT' then 300 else 600 end;
  b_cs  numeric := case r when 'TOP' then 7.0 when 'JUNGLE' then 5.8 when 'MID' then 7.5 when 'ADC' then 8.0 when 'SUPPORT' then 1.2 else 6.5 end;
  b_vis numeric := case r when 'TOP' then 0.7 when 'JUNGLE' then 1.0 when 'MID' then 0.8 when 'ADC' then 0.7 when 'SUPPORT' then 2.0 else 0.9 end;
  w_cs  numeric := case when r = 'SUPPORT' then 5 else 10 end;
  w_vis numeric := case when r = 'SUPPORT' then 15 else 10 end;
  mins  numeric := greatest(coalesce(p_dur, 0), 60) / 60.0;
  kda_n numeric := least((coalesce(p_k, 0) + coalesce(p_a, 0))::numeric / greatest(coalesce(p_d, 0), 1) / 8.0, 1);
  dpm_n numeric := least(coalesce(p_dmg, 0) / mins / (b_dpm * 1.5), 1);
  cs_n  numeric := least(coalesce(p_cs, 0) / mins / (b_cs * 1.25), 1);
  vis_n numeric := least(coalesce(p_vision, 0) / mins / (b_vis * 1.5), 1);
  kp_n  numeric := case when p_kp is null then null else least(p_kp / 0.8, 1) end;
  pts   numeric; tot numeric;
begin
  pts := 25 * kda_n + 20 * dpm_n + w_cs * cs_n + w_vis * vis_n + 15 * (case when p_win then 1 else 0 end);
  tot := 25 + 20 + w_cs + w_vis + 15;
  if kp_n is not null then pts := pts + 20 * kp_n; tot := tot + 20; end if;
  pts := pts * 100 / tot
       + 5 * coalesce(p_pentas, 0)
       + case when p_win and coalesce(p_d, 0) = 0 then 3 else 0 end;
  return round(least(pts, 100), 1);
end;
$$;

create table if not exists best_matches (
  player_id        uuid not null references players(id) on delete cascade,
  period           text not null,                 -- 'YYYY-MM' (hora de Madrid)
  match_id         text not null,
  score            numeric not null,
  champion         text,
  role             text,
  win              boolean,
  kills            integer,
  deaths           integer,
  assists          integer,
  cs               integer,
  damage           integer,
  vision           integer,
  kp               numeric,
  lp_change        integer,
  duration_seconds integer,
  ended_at         timestamptz not null,
  updated_at       timestamptz not null default now(),
  primary key (player_id, period)
);
create index if not exists best_matches_period_idx on best_matches (period, score desc);

create or replace function consider_best_match(p match_participants)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches;
  v_score numeric;
  v_kp numeric;
  v_period text;
begin
  select * into m from matches where match_id = p.match_id;
  if not found or m.queue_id <> 420 or coalesce(m.duration_seconds, 0) < 900 then return; end if;   -- solo SoloQ de 15+ min
  v_kp := nullif(p.extra_stats->>'kp', '')::numeric;
  v_score := match_score(p.role, p.win, p.kills, p.deaths, p.assists, p.cs, p.damage_to_champions,
                         p.vision_score, m.duration_seconds, v_kp, coalesce((p.extra_stats->>'pentakills')::int, 0));
  v_period := to_char(m.ended_at at time zone 'Europe/Madrid', 'YYYY-MM');
  insert into best_matches as b (player_id, period, match_id, score, champion, role, win, kills, deaths, assists,
                                 cs, damage, vision, kp, lp_change, duration_seconds, ended_at, updated_at)
  values (p.player_id, v_period, p.match_id, v_score, p.champion, p.role, p.win, p.kills, p.deaths, p.assists,
          p.cs, p.damage_to_champions, p.vision_score, v_kp, p.lp_change, m.duration_seconds, m.ended_at, now())
  on conflict (player_id, period) do update set
    match_id = excluded.match_id, score = excluded.score, champion = excluded.champion, role = excluded.role,
    win = excluded.win, kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists,
    cs = excluded.cs, damage = excluded.damage, vision = excluded.vision, kp = excluded.kp,
    lp_change = excluded.lp_change, duration_seconds = excluded.duration_seconds, ended_at = excluded.ended_at,
    updated_at = now()
  where excluded.score > b.score or excluded.match_id = b.match_id;
end;
$$;

create or replace function track_best_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform consider_best_match(new);
  return new;
end;
$$;
drop trigger if exists match_participants_best on match_participants;
create trigger match_participants_best after insert or update on match_participants
  for each row execute function track_best_match();

-- ── Seguridad ──
do $$
declare t text;
begin
  foreach t in array array['splits', 'split_ranks', 'best_matches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('create policy "lectura publica" on %I for select using (true)', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;
revoke execute on function split_rank_point(uuid, text, text, text, integer, integer, integer, integer, timestamptz, boolean),
                           track_split_rank(), rebuild_split_ranks(), consider_best_match(match_participants), track_best_match()
  from public, anon, authenticated;
revoke execute on function admin_save_split(bigint, text, timestamptz, timestamptz), admin_delete_split(bigint) from public, anon;
grant execute on function admin_save_split(bigint, text, timestamptz, timestamptz), admin_delete_split(bigint) to authenticated;

-- ── Realtime ──
do $$
declare tbl text;
begin
  for tbl in select unnest(array['splits', 'split_ranks', 'best_matches']) loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;

-- ── Relleno con lo que ya hay ──
select rebuild_split_ranks();
do $$
declare p match_participants;
begin
  for p in select mp.* from match_participants mp join matches m using (match_id)
            where m.queue_id = 420 order by m.ended_at loop
    perform consider_best_match(p);
  end loop;
end $$;
