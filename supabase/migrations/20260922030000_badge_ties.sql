-- ============================================================
-- Empates en badges (KNOWN_ISSUES2.md, punto 4)
-- El sitio viejo mostraba varios avatares/nombres cuando dos o más
-- jugadores empataban en una categoría. El nuevo solo puede guardar UN
-- player_id por categoría en weekly_badges — se agrega player_ids
-- (array) y se recalculan las categorías que el viejo SÍ soportaba con
-- empate: Top Asesino, Top Observador, Sin Rendirse, Escalador,
-- Agresivo, KDA Player, Maestro del Champion Pool, El Tortuga, El
-- Asistente, Pentakills, El Ladrón, El Destructor, Stop. Las que el
-- viejo NUNCA soportó con empate (OTP del Torneo, Dúo Dinámico, El
-- Farmeador, El Defensor, Horas en la Grieta) quedan igual, solo
-- envueltas en un array de un elemento para que el frontend sea
-- uniforme.
-- ============================================================

alter table weekly_badges add column if not exists player_ids uuid[] not null default '{}';
alter table weekly_badges add column if not exists champion text;
update weekly_badges set player_ids = array[player_id]
  where player_id is not null and player_ids = '{}';

-- ── compute_recent_badges(): Top Asesino, Top Observador, Sin Rendirse ──
create or replace function compute_recent_badges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_prev_players uuid[];
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
    category text primary key, player_ids uuid[], valor numeric, detail text
  );

  -- Top Asesino — total de kills en sus últimas 10 (empate inclusivo)
  insert into _recent_badge_results
  select 'top_asesino', array_agg(player_id order by player_id), valor,
    valor || ' kills en sus últimas 10 partidas'
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, sum(kills) as valor from _recent_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- Top Observador — mejor promedio de visión en sus últimas 10
  insert into _recent_badge_results
  select 'top_observador', array_agg(player_id order by player_id), valor,
    valor || ' de visión en promedio'
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, round(avg(vision_score), 1) as valor from _recent_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- Sin Rendirse — partidas de SoloQ jugadas HOY (día = 6AM España)
  v_madrid_now := now() at time zone 'Europe/Madrid';
  if extract(hour from v_madrid_now) >= 6 then
    v_day_start := (date_trunc('day', v_madrid_now) + interval '6 hours') at time zone 'Europe/Madrid';
  else
    v_day_start := (date_trunc('day', v_madrid_now) - interval '1 day' + interval '6 hours') at time zone 'Europe/Madrid';
  end if;

  insert into _recent_badge_results
  select 'sin_rendirse', array_agg(player_id order by player_id), valor,
    valor || ' partida' || (case when valor <> 1 then 's' else '' end) || ' hoy'
  from (
    select player_id, valor, max(valor) over () as mx
    from (
      select mp.player_id, count(*) as valor
      from match_participants mp
      join matches m on m.match_id = mp.match_id
      where m.queue_id = 420 and m.ended_at >= v_day_start
      group by mp.player_id
    ) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- "Sin Rendirse" es día-dependiente (issue 1 de KNOWN_ISSUES.md): si
  -- hoy todavía nadie jugó, se borra si lo guardado es de antes del
  -- corte de hoy, para no mostrar el dato de ayer como si fuera de hoy.
  if not exists (select 1 from _recent_badge_results where category = 'sin_rendirse') then
    delete from weekly_badges
    where category = 'sin_rendirse' and updated_at < v_day_start;
  end if;

  for r in select * from _recent_badge_results loop
    select player_ids into v_prev_players from weekly_badges where category = r.category;
    if v_prev_players is distinct from r.player_ids then
      insert into events (type, category, player_id, previous_player_id, detail)
      values ('badge_reciente', r.category, r.player_ids[1],
              case when v_prev_players is not null and array_length(v_prev_players, 1) > 0
                   then v_prev_players[1] else null end, r.detail);
    end if;
    insert into weekly_badges (category, player_id, player_ids, value, detail, updated_at)
    values (r.category, r.player_ids[1], r.player_ids, r.valor, r.detail, now())
    on conflict (category) do update
      set player_id = excluded.player_id, player_ids = excluded.player_ids,
          value = excluded.value, detail = excluded.detail, updated_at = now();
  end loop;

  -- Primera Victoria del Día — mismo reset de siempre si cambió el día
  -- y todavía nadie ganó en la ventana nueva.
  update daily_first_win_state
  set day_start = null, player_id = null, won_at = null,
      champion = null, kills = null, deaths = null, assists = null,
      summoner_spells = null, team = null, duration_seconds = null
  where singleton = true
    and day_start is not null
    and day_start <> v_day_start;
end;
$$;

grant execute on function compute_recent_badges() to service_role;

-- ── compute_weekly_badges(): 15 categorías, 10 con empate ──
create or replace function compute_weekly_badges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_prev_players uuid[];
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
    category text primary key, player_ids uuid[], valor numeric, detail text, champion text
  );

  -- OTP del Torneo — mismo campeón más veces repetido esta semana (el
  -- viejo NUNCA mostró empate acá, se mantiene un solo ganador). Se
  -- guarda el campeón aparte (issue 5 de KNOWN_ISSUES2.md) para que el
  -- frontend pueda mostrar su ícono, no solo el nombre en texto.
  insert into _badge_results
  select 'otp_del_torneo', array[player_id], veces, veces || ' partidas con ' || champion, champion
  from (
    select distinct on (player_id) player_id, champion, count(*) as veces
    from _weekly_stats group by player_id, champion
    order by player_id, count(*) desc
  ) x
  where veces > 0 order by veces desc limit 1;

  -- Maestro del Champion Pool — más campeones DISTINTOS ganados esta semana
  insert into _badge_results
  select 'champion_pool', array_agg(player_id order by player_id), valor,
    valor || ' campeones distintos ganados', null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, count(distinct champion) filter (where win) as valor
          from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- El Escalador — subida de elo_score en SoloQ en 7 días
  insert into _badge_results
  select 'escalador', array_agg(player_id order by player_id), delta, 'Mejor jugador de la semana', null
  from (
    select player_id, delta, max(delta) over () as mx
    from (
      select l.player_id, (l.elo_now - b.elo_before) as delta
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
    ) d
    where delta > 0
  ) y
  where delta = mx
  group by delta;

  -- Horas en la Grieta — minutos totales jugados esta semana (sin empate en el viejo)
  insert into _badge_results
  select 'horas_en_la_grieta', array[player_id], valor,
    valor || ' minutos jugados esta semana', null
  from (select player_id, round(sum(duration_seconds) / 60.0, 1) as valor
        from _weekly_stats group by player_id) x
  where valor > 0 order by valor desc limit 1;

  -- Agresivo
  insert into _badge_results
  select 'agresivo', array_agg(player_id order by player_id), valor,
    valor || ' primera' || (case when valor <> 1 then 's' else '' end) || ' sangre', null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, count(*) filter (where primera_sangre) as valor
          from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- KDA Player
  insert into _badge_results
  select 'kda_player', array_agg(player_id order by player_id), score,
    case when bool_or(perfecto) then 'KDA Perfecto' else score || ' KDA' end, null
  from (
    select player_id, score, perfecto, max(score) over () as mx
    from (
      select player_id, (sum(deaths) = 0) as perfecto,
        case when sum(deaths) = 0 then 999
             else round((sum(kills) + sum(assists))::numeric / sum(deaths), 2) end as score
      from _weekly_stats group by player_id
    ) x
  ) y
  where score = mx
  group by score;

  -- Pentakills
  insert into _badge_results
  select 'pentakills', array_agg(player_id order by player_id), valor,
    valor || ' pentakill' || (case when valor <> 1 then 's' else '' end), null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, sum(pentakills) as valor from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- Dúo Dinámico (sin empate en el viejo)
  insert into _badge_results
  select 'duo_dinamico', array[player_id], veces,
    'con ' || partner || ' (' || veces || ' partida' || (case when veces <> 1 then 's' else '' end) || ' juntos)', null
  from (
    select distinct on (player_id) player_id, partner, veces
    from (
      select player_id, partner, count(*) as veces
      from (select player_id, jsonb_array_elements_text(duo_con) as partner from _weekly_stats) p
      group by player_id, partner
    ) c order by player_id, veces desc
  ) best
  order by veces desc limit 1;

  -- El Farmeador — mejor CS/min de UNA partida en los últimos 7 días (sin
  -- empate en el viejo). El campeón ya está en esa misma fila (es la
  -- partida puntual con mejor CS/min), se guarda aparte para el ícono.
  insert into _badge_results
  select 'farmeador', array[player_id], cs_min, cs_min || ' CS/min con ' || champion, champion
  from (
    select player_id, champion, round(cs / greatest(duration_seconds / 60.0, 1), 1) as cs_min
    from _weekly_stats
  ) x where cs_min > 0 order by cs_min desc limit 1;

  -- El Defensor (sin empate en el viejo). El valor sigue siendo el
  -- PROMEDIO de la semana (no se toca esa lógica), pero para el ícono
  -- (issue 5) se toma el campeón de su partida individual con mayor
  -- daño absorbido — es una aproximación razonable, no necesariamente
  -- "el" campeón responsable del promedio exacto.
  insert into _badge_results
  select 'defensor', array[player_id], pct, pct || '% del daño de su equipo, en promedio esta semana',
    (select ws.champion from _weekly_stats ws
     where ws.player_id = x.player_id and ws.damage_taken_pct > 0
     order by ws.damage_taken_pct desc limit 1)
  from (
    select player_id, round(avg(damage_taken_pct), 1) as pct
    from _weekly_stats where damage_taken_pct > 0 group by player_id
  ) x where pct > 0 order by pct desc limit 1;

  -- El Ladrón
  insert into _badge_results
  select 'ladron', array_agg(player_id order by player_id), valor,
    valor || ' objetivo' || (case when valor <> 1 then 's' else '' end) || ' robado' || (case when valor <> 1 then 's' else '' end), null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, sum(objetivos_robados) as valor from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- El Destructor
  insert into _badge_results
  select 'destructor', array_agg(player_id order by player_id), valor,
    valor || ' estructura' || (case when valor <> 1 then 's' else '' end) || ' destruida' || (case when valor <> 1 then 's' else '' end), null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, sum(estructuras_destruidas) as valor from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- Stop
  insert into _badge_results
  select 'stop', array_agg(player_id order by player_id), valor, round(valor) || 's de CC aplicado', null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, sum(tiempo_cc) as valor from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  -- El Tortuga — MENOS partidas jugadas esta semana (empate inclusivo en el mínimo)
  insert into _badge_results
  select 'tortuga', array_agg(player_id order by player_id), valor,
    valor || ' partida' || (case when valor <> 1 then 's' else '' end) || ' esta semana', null
  from (
    select player_id, valor, min(valor) over () as mn
    from (select player_id, count(*) as valor from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mn
  group by valor;

  -- El Asistente
  insert into _badge_results
  select 'asistente', array_agg(player_id order by player_id), valor, valor || ' asistencias esta semana', null
  from (
    select player_id, valor, max(valor) over () as mx
    from (select player_id, sum(assists) as valor from _weekly_stats group by player_id) x
    where valor > 0
  ) y
  where valor = mx
  group by valor;

  for r in select * from _badge_results loop
    select player_ids into v_prev_players from weekly_badges where category = r.category;
    if v_prev_players is distinct from r.player_ids then
      insert into events (type, category, player_id, previous_player_id, detail)
      values ('badge_semanal', r.category, r.player_ids[1],
              case when v_prev_players is not null and array_length(v_prev_players, 1) > 0
                   then v_prev_players[1] else null end, r.detail);
    end if;
    insert into weekly_badges (category, player_id, player_ids, value, detail, champion, updated_at)
    values (r.category, r.player_ids[1], r.player_ids, r.valor, r.detail, r.champion, now())
    on conflict (category) do update
      set player_id = excluded.player_id, player_ids = excluded.player_ids,
          value = excluded.value, detail = excluded.detail, champion = excluded.champion, updated_at = now();
  end loop;
end;
$$;

grant execute on function compute_weekly_badges() to service_role;
