-- ============================================================
-- Fixes de "Primera Victoria del Día" (KNOWN_ISSUES.md, puntos 1 y 8)
-- + el mismo bug de día atrasado aplicado también a "Sin Rendirse"
-- ============================================================

-- 1) Datos completos de la victoria (issue 8): hoy daily_first_win_state
--    solo guarda day_start/player_id/won_at. Se agregan las columnas que
--    sync-matches ya tiene disponibles en el mismo momento en que detecta
--    la primera victoria, para que la tarjeta pueda mostrar campeón,
--    KDA, hechizos, lado y duración — igual que el sitio viejo.
alter table daily_first_win_state
  add column if not exists champion text,
  add column if not exists kills integer,
  add column if not exists deaths integer,
  add column if not exists assists integer,
  add column if not exists summoner_spells integer[],
  add column if not exists team text,
  add column if not exists duration_seconds integer;

-- 2) Bug del día atrasado (issue 1, y el mismo patrón para "Sin
--    Rendirse"): compute_recent_badges() ya corre cada 3 min y ya
--    calcula el corte de 6AM Madrid (v_day_start) para "Sin Rendirse"
--    — se reutiliza ese mismo cálculo para resetear tanto
--    daily_first_win_state como el badge "sin_rendirse" cuando cambia
--    el día y todavía nadie jugó/ganó en la ventana nueva (antes nada
--    los tocaba hasta la próxima partida/victoria, y se quedaban
--    pegados mostrando el dato de ayer).
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

  -- "Sin Rendirse" tiene el mismo problema que tenía "Primera Victoria"
  -- (issue 1): si hoy todavía nadie jugó ninguna partida de SoloQ, el
  -- insert de arriba no mete ninguna fila para esta categoría, así que
  -- el UPSERT del loop de abajo ni la toca — se quedaba pegada
  -- mostrando al ganador de AYER como si fuera de hoy. Si no hay
  -- resultado hoy Y lo que hay guardado es de antes del corte de hoy,
  -- se borra para que la web muestre "sin datos todavía" en vez del
  -- dato viejo.
  if not exists (select 1 from _recent_badge_results where category = 'sin_rendirse') then
    delete from weekly_badges
    where category = 'sin_rendirse' and updated_at < v_day_start;
  end if;

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

  -- Primera Victoria del Día — si la fila quedó con el día_start de
  -- ayer (o de una corrida anterior) y todavía nadie ganó en la
  -- ventana de hoy, se resetea a "nadie ha ganado todavía".
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
