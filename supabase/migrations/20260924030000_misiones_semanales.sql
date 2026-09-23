-- ============================================================
-- MISIONES SEMANALES (pestañita flotante "Misiones semanales")
--
-- · Cada lunes 6:00 (hora de Madrid) cada jugador del roster recibe
--   SUS 3 misiones al azar: fácil (1 pt), media (2 pts), difícil (3 pts),
--   sin repetir las que tuvo la semana anterior. + 1 misión GRUPAL igual
--   para todos (si el grupo la cumple, los que aportaron suman 2 pts).
-- · Cuentan todas las colas (sin remakes). Las misiones de rol/CS/visión/
--   wards solo cuentan en la Grieta del Invocador.
-- · Reroll: cambia una misión NO completada por otra del mismo nivel.
--   Cada lunes todos quedan con 1. Se gana +1 (máximo 2) con pentakill,
--   victoria sin morir o subida de liga (Plata → Oro…).
-- · Nace PAUSADO: no se genera ni se cuenta nada hasta que la admin lo
--   activa desde el Admin Dashboard (lanzamiento oficial).
-- · El progreso lo calcula compute_missions() cada 5 min (pg_cron, SQL puro).
-- ============================================================

-- ── Ajustes (interruptor) ──
create table if not exists mission_settings (
  singleton  boolean primary key default true check (singleton),
  enabled    boolean not null default false,
  enabled_at timestamptz
);
insert into mission_settings (singleton) values (true) on conflict do nothing;

-- ── Catálogo ──
create table if not exists mission_catalog (
  code       text primary key,
  tier       text not null check (tier in ('easy', 'medium', 'hard', 'group')),
  title      text not null,
  target     integer not null check (target > 0),
  points     integer not null,
  rift_only  boolean not null default false,
  weight     integer not null default 10,   -- más alto = sale más seguido
  active     boolean not null default true
);
insert into mission_catalog (code, tier, title, target, points, rift_only, weight) values
  ('win3',       'easy',   'Gana 3 partidas',                                          3, 1, false, 10),
  ('play5',      'easy',   'Juega 5 partidas',                                         5, 1, false, 10),
  ('vision30',   'easy',   'Consigue 30 o más de visión en una partida',               1, 1, true,  10),
  ('control3',   'easy',   'Compra 3 wards de control en una partida',                 1, 1, true,  10),
  ('newchamp',   'medium', 'Gana con un campeón que no jugaste en los últimos 30 días', 1, 2, false, 10),
  ('duowin',     'medium', 'Gana en dúo con alguien del grupo',                        1, 2, false, 10),
  ('kda5',       'medium', 'Consigue KDA de 5 o más en una victoria',                  1, 2, false, 10),
  ('offrole2',   'medium', 'Gana 2 partidas fuera de tu rol principal',                2, 2, true,  10),
  ('firstblood', 'medium', 'Consigue una primera sangre',                              1, 2, false, 10),
  ('streak3',    'hard',   'Gana 3 partidas seguidas',                                 3, 3, false, 10),
  ('deathless',  'hard',   'Gana una partida sin morir',                               1, 3, false, 10),
  ('dmg30k',     'hard',   'Haz más de 30.000 de daño a campeones en una partida',     1, 3, false, 10),
  ('cs8',        'hard',   'Llega a 8 CS por minuto en una victoria',                  1, 3, true,  10),
  ('penta',      'hard',   'Consigue una pentakill',                                   1, 3, false, 2),
  ('g_wins25',   'group',  'Entre todos, ganen 25 partidas',                          25, 2, false, 10),
  ('g_hours20',  'group',  'Entre todos, jueguen 20 horas',                           20, 2, false, 10),
  ('g_fb8',      'group',  'Entre todos, consigan 8 primeras sangres',                 8, 2, false, 10)
on conflict (code) do nothing;

-- ── Semanas ──
create table if not exists mission_weeks (
  week_start         timestamptz primary key,
  group_code         text references mission_catalog(code),
  group_progress     integer not null default 0,
  group_completed_at timestamptz,
  created_at         timestamptz not null default now()
);

-- ── Misiones de cada jugador ──
create table if not exists player_missions (
  id           bigint generated always as identity primary key,
  week_start   timestamptz not null references mission_weeks(week_start) on delete cascade on update cascade,
  player_id    uuid not null references players(id) on delete cascade,
  tier         text not null check (tier in ('easy', 'medium', 'hard')),
  code         text not null references mission_catalog(code),
  progress     integer not null default 0,
  started_at   timestamptz not null,       -- solo cuentan partidas desde acá
  completed_at timestamptz,
  rerolls      integer not null default 0,
  unique (week_start, player_id, tier)
);
create index if not exists player_missions_player_idx on player_missions (player_id, week_start);

-- ── Rerolls disponibles + de dónde salió cada reroll ganado ──
create table if not exists player_rerolls (
  player_id  uuid primary key references players(id) on delete cascade,
  available  integer not null default 1 check (available between 0 and 2),
  updated_at timestamptz not null default now()
);
create table if not exists reroll_grants (
  player_id  uuid not null references players(id) on delete cascade,
  source_key text not null,             -- 'penta:<match>', 'perfect:<match>', 'tier:<snapshot>'
  granted    boolean not null,          -- false = ya tenía el máximo
  created_at timestamptz not null default now(),
  primary key (player_id, source_key)
);

do $$
declare t text;
begin
  foreach t in array array['mission_settings','mission_catalog','mission_weeks','player_missions','player_rerolls','reroll_grants'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('create policy "lectura publica" on %I for select using (true)', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;


-- ============================================================
-- Utilidades
-- ============================================================

-- Lunes 6:00 hora de Madrid de la semana en curso.
create or replace function mission_week_start(ts timestamptz default now())
returns timestamptz language sql stable as $$
  select (date_trunc('week', (ts at time zone 'Europe/Madrid') - interval '6 hours') + interval '6 hours') at time zone 'Europe/Madrid'
$$;

create or replace function mission_norm_role(r text)
returns text language sql immutable as $$
  select case upper(coalesce(r, ''))
    when 'TOP' then 'TOP' when 'JUNGLE' then 'JUNGLE' when 'JUNGLA' then 'JUNGLE'
    when 'MIDDLE' then 'MID' when 'MID' then 'MID' when 'BOTTOM' then 'ADC' when 'ADC' then 'ADC'
    when 'UTILITY' then 'SUPPORT' when 'SUPPORT' then 'SUPPORT' else null end
$$;

-- Colas de la Grieta del Invocador (para misiones de rol/CS/visión/wards).
create or replace function mission_is_rift(q integer)
returns boolean language sql immutable as $$ select q in (400, 420, 430, 440, 480, 490, 700) $$;

-- Progreso de UNA misión de un jugador con sus partidas en [p_since, now()).
create or replace function mission_progress(p_code text, p_player uuid, p_since timestamptz)
returns integer
language plpgsql volatile
security definer
set search_path = public
as $$
declare
  v integer := 0;
  v_role text;
begin
  select mission_norm_role(primary_role) into v_role from players where id = p_player;

  create temp table if not exists _g (match_id text, win boolean, kills int, deaths int, assists int, cs int,
    damage int, vision int, role text, team text, champion text, extra jsonb, queue_id int, dur int, ended_at timestamptz) on commit drop;
  truncate _g;
  insert into _g
  select mp.match_id, mp.win, coalesce(mp.kills,0), coalesce(mp.deaths,0), coalesce(mp.assists,0), coalesce(mp.cs,0),
         coalesce(mp.damage_to_champions,0), coalesce(mp.vision_score,0), mp.role, mp.team, mp.champion,
         coalesce(mp.extra_stats, '{}'::jsonb), mt.queue_id, mt.duration_seconds, mt.ended_at
    from match_participants mp join matches mt on mt.match_id = mp.match_id
   where mp.player_id = p_player and mt.ended_at >= p_since
     and not (not mp.win and mt.duration_seconds < 300);   -- sin remakes

  case p_code
    when 'win3'       then select count(*) filter (where win) into v from _g;
    when 'play5'      then select count(*) into v from _g;
    when 'vision30'   then select count(*) into v from _g where mission_is_rift(queue_id) and vision >= 30;
    when 'control3'   then select count(*) into v from _g where mission_is_rift(queue_id) and coalesce((extra->>'wards_control')::int, 0) >= 3;
    when 'newchamp'   then
      select count(*) into v from _g g where g.win and not exists (
        select 1 from match_participants mp2 join matches m2 on m2.match_id = mp2.match_id
         where mp2.player_id = p_player and mp2.champion = g.champion
           and m2.ended_at < g.ended_at and m2.ended_at >= g.ended_at - interval '30 days');
    when 'duowin'     then
      select count(*) into v from _g g where g.win and exists (
        select 1 from match_participants o where o.match_id = g.match_id and o.team = g.team and o.player_id <> p_player);
    when 'kda5'       then select count(*) into v from _g where win and (kills + assists)::numeric / greatest(deaths, 1) >= 5;
    when 'offrole2'   then select count(*) into v from _g where win and mission_is_rift(queue_id)
                             and mission_norm_role(role) is not null and v_role is not null and mission_norm_role(role) <> v_role;
    when 'firstblood' then select count(*) into v from _g where coalesce((extra->>'primera_sangre')::boolean, false);
    when 'streak3'    then
      select coalesce(max(n), 0) into v from (
        select count(*) n from (
          select win, sum(case when win then 0 else 1 end) over (order by ended_at) grp from _g) s
         where win group by grp) t;
    when 'deathless'  then select count(*) into v from _g where win and deaths = 0;
    when 'dmg30k'     then select count(*) into v from _g where damage > 30000;
    when 'cs8'        then select count(*) into v from _g where win and mission_is_rift(queue_id) and dur > 0 and cs / (dur / 60.0) >= 8;
    when 'penta'      then select count(*) into v from _g where coalesce((extra->>'pentakills')::int, 0) > 0;
    else v := 0;
  end case;
  return coalesce(v, 0);
end;
$$;

-- Progreso de la misión grupal (todos los del roster, desde p_since).
create or replace function mission_group_progress(p_code text, p_since timestamptz)
returns integer
language sql stable
security definer
set search_path = public
as $$
  with g as (
    select mp.*, mt.duration_seconds dur from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= p_since and not (not mp.win and mt.duration_seconds < 300))
  select coalesce(case p_code
    when 'g_wins25'  then (select count(*) filter (where win) from g)
    when 'g_hours20' then (select floor(sum(dur) / 3600.0)::int from g)
    when 'g_fb8'     then (select count(*) from g where coalesce((extra_stats->>'primera_sangre')::boolean, false))
    else 0 end, 0)::int
$$;

-- Elige un código al azar (ponderado) de un nivel, evitando los de p_exclude.
create or replace function mission_pick(p_tier text, p_exclude text[])
returns text language sql volatile set search_path = public as $$
  select code from mission_catalog
   where tier = p_tier and active and not (code = any(coalesce(p_exclude, '{}')))
   order by -ln(greatest(random(), 1e-9)) / weight
   limit 1
$$;


-- ============================================================
-- Motor: se corre cada 5 minutos
-- ============================================================
create or replace function compute_missions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s mission_settings;
  v_week timestamptz := mission_week_start(now());
  v_start timestamptz;
  w mission_weeks;
  pm record;
  p record;
  v_prog integer;
  v_cat mission_catalog;
  v_prev text[];
  t text;
  r record;
begin
  select * into s from mission_settings;
  if not s.enabled then return; end if;
  v_start := greatest(v_week, s.enabled_at);

  -- 1) Semana nueva: misión grupal + reset de rerolls (todos quedan en 1).
  select * into w from mission_weeks where week_start = v_week;
  if not found then
    insert into mission_weeks (week_start, group_code)
    values (v_week, mission_pick('group', array(select group_code from mission_weeks where week_start < v_week order by week_start desc limit 1)))
    returning * into w;
    insert into player_rerolls (player_id, available, updated_at)
    select id, 1, now() from players
    on conflict (player_id) do update set available = 1, updated_at = now();
  end if;

  -- 2) Cada jugador del roster con sus 3 misiones (también los que se agregan a mitad de semana).
  for p in select id from players loop
    insert into player_rerolls (player_id) values (p.id) on conflict do nothing;
    foreach t in array array['easy', 'medium', 'hard'] loop
      if not exists (select 1 from player_missions where week_start = v_week and player_id = p.id and tier = t) then
        select array_agg(code) into v_prev from player_missions
         where player_id = p.id and week_start = (select max(week_start) from player_missions where player_id = p.id and week_start < v_week);
        insert into player_missions (week_start, player_id, tier, code, started_at)
        values (v_week, p.id, t, coalesce(mission_pick(t, v_prev), mission_pick(t, null)), v_start);
      end if;
    end loop;
  end loop;

  -- 3) Progreso de las misiones abiertas.
  for pm in select m.*, c.target, c.title from player_missions m join mission_catalog c on c.code = m.code
             where m.week_start = v_week and m.completed_at is null loop
    v_prog := least(mission_progress(pm.code, pm.player_id, pm.started_at), pm.target);
    if v_prog >= pm.target then
      update player_missions set progress = v_prog, completed_at = now() where id = pm.id;
      insert into events (type, icon, category, player_id, detail) values ('mision_completada', '🎯', pm.tier, pm.player_id, pm.title);
    elsif v_prog <> pm.progress then
      update player_missions set progress = v_prog where id = pm.id;
    end if;
  end loop;

  -- 4) Misión grupal.
  if w.group_code is not null and w.group_completed_at is null then
    select * into v_cat from mission_catalog where code = w.group_code;
    v_prog := least(mission_group_progress(w.group_code, v_start), v_cat.target);
    update mission_weeks set group_progress = v_prog,
           group_completed_at = case when v_prog >= v_cat.target then now() else null end
     where week_start = v_week;
    if v_prog >= v_cat.target then
      insert into events (type, icon, category, detail) values ('mision_grupal', '👥', 'group', v_cat.title);
    end if;
  end if;

  -- 5) Rerolls ganados esta semana: pentakill, victoria sin morir, subida de liga.
  for r in
    select mp.player_id, 'penta:' || mp.match_id k, 'Pentakill' why
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= v_start and coalesce((mp.extra_stats->>'pentakills')::int, 0) > 0
    union all
    select mp.player_id, 'perfect:' || mp.match_id, 'Victoria sin morir'
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= v_start and mp.win and coalesce(mp.deaths, 0) = 0 and mt.duration_seconds >= 300
    union all
    select x.player_id, 'tier:' || x.id, 'Subió a ' || case x.tier when 'IRON' then 'Hierro' when 'BRONZE' then 'Bronce' when 'SILVER' then 'Plata'
             when 'GOLD' then 'Oro' when 'PLATINUM' then 'Platino' when 'EMERALD' then 'Esmeralda' when 'DIAMOND' then 'Diamante'
             when 'MASTER' then 'Maestro' when 'GRANDMASTER' then 'Gran Maestro' when 'CHALLENGER' then 'Aspirante' else x.tier end
      from (select rs.*, lag(rs.tier) over (partition by rs.player_id, rs.queue_type order by rs.recorded_at) prev_tier
              from rank_snapshots rs where rs.queue_type = 'RANKED_SOLO_5x5') x
     where x.recorded_at >= v_start and x.prev_tier is not null and x.tier is not null
       and array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], x.tier)
         > array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], x.prev_tier)
  loop
    if exists (select 1 from reroll_grants where player_id = r.player_id and source_key = r.k) then continue; end if;
    if exists (select 1 from player_rerolls where player_id = r.player_id and available < 2) then
      update player_rerolls set available = available + 1, updated_at = now() where player_id = r.player_id;
      insert into reroll_grants (player_id, source_key, granted) values (r.player_id, r.k, true);
      insert into events (type, icon, category, player_id, detail) values ('reroll_ganado', '🎲', 'reroll', r.player_id, r.why);
    else
      insert into reroll_grants (player_id, source_key, granted) values (r.player_id, r.k, false);
    end if;
  end loop;
end;
$$;
revoke execute on function compute_missions() from public, anon, authenticated;
revoke execute on function mission_progress(text, uuid, timestamptz), mission_group_progress(text, timestamptz), mission_pick(text, text[]) from public, anon, authenticated;


-- ============================================================
-- Acciones desde la web
-- ============================================================

-- Reroll del propio jugador (o de cualquiera si es admin; la admin no gasta rerolls).
create or replace function reroll_mission(p_mission_id bigint)
returns player_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  m player_missions;
  v_admin boolean := exists (select 1 from admins where user_id = auth.uid());
  v_owner uuid;
  v_new text;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión.'; end if;
  if not (select enabled from mission_settings) then raise exception 'Las misiones están pausadas.'; end if;
  select * into m from player_missions where id = p_mission_id for update;
  if not found then raise exception 'Esa misión no existe.'; end if;
  select user_id into v_owner from players where id = m.player_id;
  if v_owner is distinct from auth.uid() and not v_admin then raise exception 'Solo puedes cambiar tus propias misiones.'; end if;
  if m.week_start <> mission_week_start(now()) then raise exception 'Esa misión es de otra semana.'; end if;
  if m.completed_at is not null then raise exception 'Esa misión ya está completada.'; end if;

  if v_owner is not distinct from auth.uid() or not v_admin then
    update player_rerolls set available = available - 1, updated_at = now()
     where player_id = m.player_id and available > 0;
    if not found then raise exception 'No te quedan rerolls esta semana.'; end if;
  end if;

  v_new := mission_pick(m.tier, array(select code from player_missions where player_id = m.player_id and week_start = m.week_start));
  if v_new is null then raise exception 'No hay otra misión disponible de ese nivel.'; end if;
  update player_missions set code = v_new, progress = 0, started_at = now(), rerolls = rerolls + 1
   where id = m.id returning * into m;
  return m;
end;
$$;

-- Activar / pausar (admin). Al activar se crea la semana al instante.
create or replace function admin_set_missions_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede cambiar esto.';
  end if;
  update mission_settings set enabled = p_enabled,
         enabled_at = case when p_enabled and not enabled then now() else enabled_at end
   where singleton;
  if p_enabled then perform compute_missions(); end if;
end;
$$;

-- Reiniciar TODO lo de misiones (para empezar de cero en el lanzamiento).
create or replace function admin_reset_missions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede reiniciar las misiones.';
  end if;
  -- "where true": Supabase bloquea UPDATE/DELETE sin WHERE (pg_safeupdate).
  delete from mission_weeks where true;          -- borra también player_missions (cascade)
  delete from reroll_grants where true;
  delete from player_rerolls where true;
  delete from events where type in ('mision_completada', 'mision_grupal', 'reroll_ganado');
  update mission_settings set enabled = false, enabled_at = null where singleton;
end;
$$;

revoke execute on function reroll_mission(bigint), admin_set_missions_enabled(boolean), admin_reset_missions() from public, anon;
grant execute on function reroll_mission(bigint), admin_set_missions_enabled(boolean), admin_reset_missions() to authenticated;


-- ============================================================
-- Realtime + cron
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['mission_settings', 'mission_weeks', 'player_missions', 'player_rerolls'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'misiones-semanales';
    perform cron.schedule('misiones-semanales', '*/5 * * * *', 'select public.compute_missions()');
  end if;
end $$;
