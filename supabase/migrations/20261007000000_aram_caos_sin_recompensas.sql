-- ============================================================
-- ARAM Caos (cola 2400) no da recompensas.
-- Sus partidas no cuentan para los dientes (victorias, primera victoria
-- del día, pentakill, misión grupal), ni para el progreso de las misiones
-- semanales. Siguen apareciendo en el historial y en las estadísticas.
-- Las funciones son las mismas de antes con un filtro de cola más.
-- Lo ya entregado no se quita.
-- ============================================================

create or replace function reward_queue_ok(q integer)
returns boolean language sql immutable as $$
  select q is distinct from 2400   -- 2400 = ARAM: Caos
$$;

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
   where mp.player_id = p_player and mt.ended_at >= p_since and reward_queue_ok(mt.queue_id)
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

create or replace function mission_group_progress(p_code text, p_since timestamptz)
returns integer
language sql stable
security definer
set search_path = public
as $$
  with g as (
    select mp.*, mt.duration_seconds dur from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= p_since and reward_queue_ok(mt.queue_id) and not (not mp.win and mt.duration_seconds < 300))
  select coalesce(case p_code
    when 'g_wins25'  then (select count(*) filter (where win) from g)
    when 'g_hours20' then (select floor(sum(dur) / 3600.0)::int from g)
    when 'g_fb8'     then (select count(*) from g where coalesce((extra_stats->>'primera_sangre')::boolean, false))
    else 0 end, 0)::int
$$;

create or replace function reward_group_contrib(p_code text, p_since timestamptz, p_until timestamptz)
returns table (player_id uuid, contrib numeric)
language sql stable
security definer
set search_path = public
as $$
  with g as (
    select mp.player_id, mp.win, mt.duration_seconds dur, mp.extra_stats
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= p_since and mt.ended_at < p_until and reward_queue_ok(mt.queue_id)
       and not (not mp.win and mt.duration_seconds < 300))
  select player_id,
         case p_code
           when 'g_wins25'  then count(*) filter (where win)::numeric
           when 'g_hours20' then sum(dur) / 3600.0
           when 'g_fb8'     then count(*) filter (where coalesce((extra_stats->>'primera_sangre')::boolean, false))::numeric
           else 0 end
    from g group by player_id
$$;

create or replace function compute_rewards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s reward_settings;
  v_since timestamptz;
  v_mis_since timestamptz;
  r record;
  w record;
  v_top numeric;
  v_rest numeric;
  v_amt integer;
  v_end timestamptz;
begin
  select * into s from reward_settings;
  if not s.enabled or s.enabled_at is null then return; end if;
  v_since := s.enabled_at;
  select coalesce(enabled_at, v_since) into v_mis_since from mission_settings;

  -- 1) Misiones completadas
  for r in
    select pm.id, pm.player_id, pm.tier, c.title from player_missions pm join mission_catalog c on c.code = pm.code
     where pm.completed_at >= v_since
  loop
    perform reward_give(r.player_id,
      reward_amount(case r.tier when 'easy' then 'mision_facil' when 'medium' then 'mision_media' else 'mision_dificil' end),
      'mision', r.title, 'mision:' || r.id);
  end loop;

  -- 2) Misión grupal completada: el que más aportó se lleva el premio entero;
  --    otro premio se reparte entre el resto según lo que aportó cada uno.
  for w in
    select mw.week_start, mw.group_code, c.title from mission_weeks mw join mission_catalog c on c.code = mw.group_code
     where mw.group_completed_at >= v_since
  loop
    create temp table if not exists _gc (player_id uuid, contrib numeric) on commit drop;
    truncate _gc;
    insert into _gc select * from reward_group_contrib(w.group_code, greatest(w.week_start, v_mis_since), w.week_start + interval '7 days') x where x.contrib > 0;
    select max(contrib) into v_top from _gc;
    select coalesce(sum(contrib), 0) into v_rest from _gc where contrib < v_top;
    for r in select * from _gc loop
      if r.contrib = v_top then
        v_amt := reward_amount('grupal_top');
      else
        v_amt := greatest(1, round(reward_amount('grupal_resto') * r.contrib / nullif(v_rest, 0)))::int;
      end if;
      perform reward_give(r.player_id, v_amt, 'grupal', w.title, 'grupal:' || to_char(w.week_start, 'YYYY-MM-DD'));
    end loop;
  end loop;

  -- 3) Top 3 de la tabla semanal (cuando la semana ya terminó)
  for w in
    select mw.week_start, mw.group_completed_at is not null as gdone, coalesce(c.points, 2) gpts
      from mission_weeks mw left join mission_catalog c on c.code = mw.group_code
     where mw.week_start + interval '7 days' <= now() and mw.week_start + interval '7 days' >= v_since
  loop
    for r in
      with pts as (
        select pm.player_id,
               sum(case when pm.completed_at is not null then c.points else 0 end)
               + case when w.gdone and exists (
                   select 1 from match_participants mp join matches mt on mt.match_id = mp.match_id
                    where mp.player_id = pm.player_id and mt.ended_at >= greatest(w.week_start, v_mis_since)
                      and mt.ended_at < w.week_start + interval '7 days' and reward_queue_ok(mt.queue_id)
                      and not (not mp.win and mt.duration_seconds < 300)) then w.gpts else 0 end as p
          from player_missions pm join mission_catalog c on c.code = pm.code
         where pm.week_start = w.week_start
         group by pm.player_id)
      select player_id, p, dense_rank() over (order by p desc) pos from pts where p > 0
    loop
      if r.pos <= 3 then
        perform reward_give(r.player_id, reward_amount('top' || r.pos), 'top', 'Top ' || r.pos || ' de la semana',
                            'top:' || to_char(w.week_start, 'YYYY-MM-DD'));
        if r.pos = 1 then perform award_badge(r.player_id, 'top1_semana', to_char(w.week_start, 'DD/MM/YYYY')); end if;
      end if;
    end loop;
  end loop;

  -- 4) Victorias (todas las colas menos ARAM Caos, sin remakes) + primera victoria del día de cada jugador (día = 6:00 Madrid)
  for r in
    select mp.player_id, mp.match_id, mp.champion, mt.ended_at
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mp.win and mt.ended_at >= v_since and reward_queue_ok(mt.queue_id)
  loop
    perform reward_give(r.player_id, reward_amount('victoria'), 'victoria', r.champion, 'win:' || r.match_id);
  end loop;
  for r in
    select distinct on (mp.player_id, ((mt.ended_at at time zone 'Europe/Madrid') - interval '6 hours')::date)
           mp.player_id, mp.champion, ((mt.ended_at at time zone 'Europe/Madrid') - interval '6 hours')::date as dia
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mp.win and mt.ended_at >= v_since and reward_queue_ok(mt.queue_id)
     order by mp.player_id, ((mt.ended_at at time zone 'Europe/Madrid') - interval '6 hours')::date, mt.ended_at
  loop
    perform reward_give(r.player_id, reward_amount('primera_victoria'), 'primera_victoria', r.champion, 'pvd:' || r.dia);
  end loop;

  -- 5) Pentakill y Partida Perfecta
  for r in
    select mp.player_id, mp.match_id, mp.champion from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= v_since and reward_queue_ok(mt.queue_id) and coalesce((mp.extra_stats->>'pentakills')::int, 0) > 0
  loop
    perform reward_give(r.player_id, reward_amount('pentakill'), 'pentakill', r.champion, 'penta:' || r.match_id);
    perform award_badge(r.player_id, 'pentakill', r.champion);
  end loop;
  for r in
    select player_id, split_part(category, ':', 2) as match_id, detail from events
     where category like 'perfecta:%' and occurred_at >= v_since and player_id is not null
       and not exists (select 1 from matches mt where mt.match_id = split_part(category, ':', 2) and not reward_queue_ok(mt.queue_id))
  loop
    perform reward_give(r.player_id, reward_amount('perfecta'), 'perfecta', r.detail, 'perfecta:' || r.match_id);
  end loop;

  -- 6) Partida del mes del grupo (cuando el mes ya terminó)
  for r in
    select distinct on (period) period, player_id, champion, score from best_matches
     order by period, score desc
  loop
    v_end := ((r.period || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Madrid';
    if v_end <= now() and v_end >= v_since then
      if reward_give(r.player_id, reward_amount('partida_mes'), 'partida_mes', r.champion || ' · ' || round(r.score) || ' pts', 'pmes:' || r.period) then null; end if;
      perform award_badge(r.player_id, 'partida_mes', r.period);
    end if;
  end loop;

  -- 7) Retos: 1º / 2º / 3º
  for r in
    select cr.player_id, cr.position, ch.id, ch.name from challenge_results cr join challenges ch on ch.id = cr.challenge_id
     where ch.finished_at >= v_since and cr.position <= 3 and cr.player_id is not null
  loop
    perform reward_give(r.player_id, reward_amount('reto' || r.position), 'reto', r.name || ' · ' || r.position || 'º', 'reto:' || r.id);
    perform award_badge(r.player_id, 'reto_podio', r.name);
    if r.position = 1 then perform award_badge(r.player_id, 'reto_ganador', r.name); end if;
  end loop;

  -- 8) Insignias por acumulado
  for r in
    select pm.player_id, count(*) n, count(*) filter (where pm.tier = 'hard') h
      from player_missions pm where pm.completed_at >= v_since group by pm.player_id
  loop
    if r.n >= 10 then perform award_badge(r.player_id, 'misiones10', null); end if;
    if r.n >= 50 then perform award_badge(r.player_id, 'misiones50', null); end if;
    if r.h >= 25 then perform award_badge(r.player_id, 'dificiles25', null); end if;
  end loop;
  -- Racha de 5 victorias seguidas (todas las colas, sin remakes)
  for r in
    with g as (
      select mp.player_id, mp.win, mt.ended_at from match_participants mp join matches mt on mt.match_id = mp.match_id
       where mt.ended_at >= v_since and not (not mp.win and mt.duration_seconds < 300)),
    s as (select player_id, win, sum(case when win then 0 else 1 end) over (partition by player_id order by ended_at) grp from g)
    select player_id from s where win group by player_id, grp having count(*) >= 5
  loop
    perform award_badge(r.player_id, 'racha5', null);
  end loop;
  -- Subida de liga (SoloQ)
  for r in
    with x as (
      select player_id, tier, recorded_at,
             lag(tier) over (partition by player_id order by recorded_at) prev
        from rank_snapshots where queue_type = 'RANKED_SOLO_5x5' and tier is not null)
    select distinct on (player_id) player_id, tier from x
     where recorded_at >= v_since and prev is not null
       and array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], tier)
         > array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], prev)
     order by player_id, recorded_at
  loop
    perform award_badge(r.player_id, 'subio_liga', r.tier);
  end loop;
  -- Terminó un split en Oro o más (SoloQ)
  for r in
    select sr.player_id, sp.name from split_ranks sr join splits sp on sp.id = sr.split_id
     where sr.queue_type = 'RANKED_SOLO_5x5' and sp.ends_at is not null and sp.ends_at <= now() and sp.ends_at >= v_since
       and sr.last_tier in ('GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER')
  loop
    perform award_badge(r.player_id, 'split_oro', r.name);
  end loop;
end;
$$;
