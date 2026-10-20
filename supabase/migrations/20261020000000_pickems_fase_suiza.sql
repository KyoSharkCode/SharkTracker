-- ============================================================
-- Pickems: fase suiza (formato del Pick'Em de LoL Esports)
--
-- · Un evento con kind = 'swiss' no tiene series: tiene equipos
--   (pickem_teams) con su récord (victorias / derrotas), que la admin va
--   subiendo ronda a ronda. Un equipo clasifica al llegar a 3 victorias y
--   queda eliminado al llegar a 3 derrotas.
-- · Cada jugador elige 8 equipos que clasifican (pickem_swiss_picks):
--     huecos '3-0', '3-1', '3-2' → récord exacto
--     huecos 'a1'…'a5'           → clasifica con cualquier récord
--   Un equipo solo puede ir en un hueco.
-- · Dientes, al decidirse el destino de cada equipo:
--     +10 si el equipo elegido clasifica
--     +15 extra si estaba en un hueco de récord y lo clavó
--   Máximo: 3 × 25 + 5 × 10 = 125.
-- · Pleno (premio perfect_prize + insignia): los 8 clasifican y los 3
--   récords exactos.
-- ============================================================

alter table pickem_events add column if not exists kind text not null default 'bracket';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pickem_events_kind_check') then
    alter table pickem_events add constraint pickem_events_kind_check check (kind in ('bracket', 'swiss'));
  end if;
end $$;

create table if not exists pickem_teams (
  event_id   bigint not null references pickem_events(id) on delete cascade,
  team       text not null,
  sort       integer not null default 100,   -- orden de la ronda 1: 1-2, 3-4… se enfrentan
  wins       integer not null default 0 check (wins between 0 and 3),
  losses     integer not null default 0 check (losses between 0 and 3),
  decided_at timestamptz,                     -- cuándo llegó a 3 victorias o 3 derrotas
  primary key (event_id, team),
  check (not (wins = 3 and losses = 3))
);

create table if not exists pickem_swiss_picks (
  player_id  uuid not null references players(id) on delete cascade,
  event_id   bigint not null references pickem_events(id) on delete cascade,
  slot       text not null check (slot in ('3-0', '3-1', '3-2', 'a1', 'a2', 'a3', 'a4', 'a5')),
  team       text not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, event_id, slot),
  unique (player_id, event_id, team)
);
create index if not exists pickem_swiss_picks_event_idx on pickem_swiss_picks (event_id);

create or replace function pickem_swiss_adv() returns integer language sql immutable as $$ select 10 $$;
create or replace function pickem_swiss_bonus() returns integer language sql immutable as $$ select 15 $$;

-- ============================================================
-- Reparto de la fase suiza (se puede volver a correr: recalcula)
-- ============================================================
create or replace function pickem_settle_swiss(p_event bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e pickem_events; t record; r record; v_exact boolean; v_rec text;
begin
  select * into e from pickem_events where id = p_event;
  if not found then return; end if;
  delete from wallet_tx where reason = 'pickem' and source_key like 'pickem_sw:' || p_event || ':%';
  for t in select * from pickem_teams where event_id = p_event and wins = 3 loop
    v_rec := '3-' || t.losses;
    for r in select * from pickem_swiss_picks where event_id = p_event and team = t.team loop
      v_exact := r.slot = v_rec;
      perform reward_give(r.player_id, pickem_swiss_adv() + case when v_exact then pickem_swiss_bonus() else 0 end, 'pickem',
                          t.team || ' clasifica ' || v_rec || case when v_exact then ' (récord exacto)' else '' end || ' · ' || e.name,
                          'pickem_sw:' || p_event || ':' || t.team || ':' || r.player_id);
    end loop;
  end loop;
end;
$$;

-- ============================================================
-- Jugadores: elegir (o quitar con null) el equipo de un hueco.
-- Si ese equipo ya estaba en otro hueco, se mueve.
-- ============================================================
create or replace function save_swiss_pick(p_event bigint, p_slot text, p_team text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_player uuid := my_player_id(); e pickem_events;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión.'; end if;
  if v_player is null then raise exception 'Primero vincula tu cuenta de LoL a tu perfil.'; end if;
  select * into e from pickem_events where id = p_event;
  if not found or e.kind <> 'swiss' then raise exception 'Esa fase no existe.'; end if;
  if e.opens_at is not null and now() < e.opens_at then raise exception 'Estos Pickems todavía no se abren.'; end if;
  if now() >= e.locks_at or e.finished_at is not null then raise exception 'Los Pickems ya cerraron.'; end if;
  if p_slot not in ('3-0', '3-1', '3-2', 'a1', 'a2', 'a3', 'a4', 'a5') then raise exception 'Hueco no válido.'; end if;
  delete from pickem_swiss_picks where player_id = v_player and event_id = p_event and slot = p_slot;
  if p_team is not null then
    if not exists (select 1 from pickem_teams where event_id = p_event and team = p_team) then raise exception 'Ese equipo no juega esta fase.'; end if;
    delete from pickem_swiss_picks where player_id = v_player and event_id = p_event and team = p_team;
    insert into pickem_swiss_picks (player_id, event_id, slot, team) values (v_player, p_event, p_slot, p_team);
  end if;
end;
$$;

-- ============================================================
-- Admin
-- ============================================================
-- Récord de un equipo (victorias y derrotas, de 0 a 3). Reparte los 🦷 al momento.
create or replace function admin_set_swiss_record(p_event bigint, p_team text, p_wins integer, p_losses integer)
returns void language plpgsql security definer set search_path = public as $$
declare e pickem_events; t pickem_teams;
begin
  if not is_admin() then raise exception 'Solo una administradora puede cargar resultados.'; end if;
  select * into e from pickem_events where id = p_event;
  if not found or e.kind <> 'swiss' then raise exception 'Esa fase no existe.'; end if;
  if e.finished_at is not null then raise exception 'Esa fase ya está finalizada.'; end if;
  if now() < e.locks_at and (p_wins > 0 or p_losses > 0) then raise exception 'Los Pickems siguen abiertos: los resultados se cargan después del cierre.'; end if;
  if p_wins not between 0 and 3 or p_losses not between 0 and 3 or (p_wins = 3 and p_losses = 3) then raise exception 'Récord no válido.'; end if;
  select * into t from pickem_teams where event_id = p_event and team = p_team for update;
  if not found then raise exception 'Ese equipo no está en la fase.'; end if;
  update pickem_teams set wins = p_wins, losses = p_losses,
         decided_at = case when p_wins = 3 or p_losses = 3 then coalesce(case when (t.wins = 3 or t.losses = 3) then t.decided_at end, now()) end
   where event_id = p_event and team = p_team;
  perform pickem_settle_swiss(p_event);
end;
$$;

-- Lista de equipos de una fase suiza, en el orden de la ronda 1 (1 vs 2, 3 vs 4…).
-- Los equipos que ya no están se borran junto con sus elecciones; los que siguen conservan su récord.
create or replace function admin_save_swiss_teams(p_event bigint, p_teams text[])
returns void language plpgsql security definer set search_path = public as $$
declare e pickem_events; i integer;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  select * into e from pickem_events where id = p_event;
  if not found or e.kind <> 'swiss' then raise exception 'Esa fase no existe.'; end if;
  if e.finished_at is not null then raise exception 'Esa fase ya está finalizada.'; end if;
  if array_length(p_teams, 1) is null or array_length(p_teams, 1) < 8 then raise exception 'Hacen falta al menos 8 equipos.'; end if;
  if (select count(distinct trim(x)) from unnest(p_teams) x) <> array_length(p_teams, 1) then raise exception 'Hay equipos repetidos.'; end if;
  delete from pickem_swiss_picks where event_id = p_event and team <> all (select trim(x) from unnest(p_teams) x);
  delete from pickem_teams where event_id = p_event and team <> all (select trim(x) from unnest(p_teams) x);
  for i in 1 .. array_length(p_teams, 1) loop
    insert into pickem_teams (event_id, team, sort) values (p_event, trim(p_teams[i]), i)
    on conflict (event_id, team) do update set sort = excluded.sort;
  end loop;
  perform pickem_settle_swiss(p_event);
end;
$$;

-- ── Las funciones generales también entienden la fase suiza ──
-- Finalizar: en una fase suiza, todos los equipos tienen que tener su destino decidido.
create or replace function admin_finish_pickem_event(p_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare e pickem_events; v_total integer; v_n integer := 0; r record;
begin
  if not is_admin() then raise exception 'Solo una administradora puede finalizar los Pickems.'; end if;
  select * into e from pickem_events where id = p_id for update;
  if not found then raise exception 'Ese evento no existe.'; end if;
  if e.finished_at is not null then raise exception 'Ese evento ya está finalizado.'; end if;
  if e.kind = 'swiss' then
    if not exists (select 1 from pickem_teams where event_id = p_id) then raise exception 'La fase no tiene equipos.'; end if;
    if exists (select 1 from pickem_teams where event_id = p_id and wins < 3 and losses < 3) then
      raise exception 'Faltan equipos por decidir (todos tienen que llegar a 3 victorias o 3 derrotas).';
    end if;
    update pickem_events set finished_at = now() where id = p_id;
    -- Pleno: 8 elecciones, todas clasifican, y los 3 huecos de récord exactos
    for r in
      select pk.player_id
        from pickem_swiss_picks pk join pickem_teams t on t.event_id = pk.event_id and t.team = pk.team
       where pk.event_id = p_id
       group by pk.player_id
      having count(*) = 8
         and count(*) filter (where t.wins = 3) = 8
         and count(*) filter (where pk.slot in ('3-0', '3-1', '3-2') and pk.slot = '3-' || t.losses and t.wins = 3) = 3
    loop
      insert into prize_claims (player_id, item_id, item_name, price)
      values (r.player_id, 'pickem-perfecto', e.perfect_prize || ' · ' || e.name, 0);
      perform award_badge(r.player_id, 'pickem_perfecto', e.name);
      v_n := v_n + 1;
    end loop;
    return v_n;
  end if;
  select count(*) into v_total from pickem_matches where event_id = p_id;
  if v_total = 0 then raise exception 'El evento no tiene series.'; end if;
  if exists (select 1 from pickem_matches where event_id = p_id and score1 is null) then
    raise exception 'Faltan resultados por cargar.';
  end if;
  update pickem_events set finished_at = now() where id = p_id;
  for r in
    select pk.player_id
      from pickem_picks pk join pickem_matches m on m.id = pk.match_id
     where m.event_id = p_id and pk.team = pickem_winner(m.id)
     group by pk.player_id
    having count(*) = v_total
  loop
    insert into prize_claims (player_id, item_id, item_name, price)
    values (r.player_id, 'pickem-perfecto', e.perfect_prize || ' · ' || e.name, 0);
    perform award_badge(r.player_id, 'pickem_perfecto', e.name);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Borrar una fase: quita también los 🦷 de la fase suiza.
create or replace function admin_delete_pickem_event(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  delete from wallet_tx where reason in ('pickem', 'apuesta', 'apuesta_premio', 'apuesta_devuelta')
     and split_part(source_key, ':', 2) in (select id::text from pickem_matches where event_id = p_id);
  delete from wallet_tx where reason = 'pickem' and source_key like 'pickem_sw:' || p_id || ':%';
  delete from pickem_events where id = p_id;
end;
$$;

-- ============================================================
-- Worlds 2026 · Fase suiza: 16 equipos en el orden de la ronda 1
-- (23/10, al mejor de 1). Cierra el 23/10 a las 18:30, hora de España
-- (el primer partido es a las 12:00 CDT = 19:00 en España).
-- ============================================================
do $$
declare v_ev bigint; v_teams text[] := array[
  'Gen.G', 'Invictus Gaming',
  'Team Liquid Alienware', 'CTBC Flying Oyster',
  'Anyone''s Legend', 'Karmine Corp',
  'G2 Esports', 'Dplus KIA',
  'Hanwha Life Esports', 'Top Esports',
  'LOS', 'T1',
  'Team Secret Whales', 'LYON',
  'Bilibili Gaming', 'Movistar KOI'];
  i integer;
begin
  select id into v_ev from pickem_events where name = 'Worlds 2026 · Fase suiza';
  if v_ev is null then
    insert into pickem_events (name, opens_at, locks_at, bg_image, bg_focus)
    values ('Worlds 2026 · Fase suiza', timestamp '2026-10-19 00:00' at time zone 'Europe/Madrid',
            timestamp '2026-10-23 18:30' at time zone 'Europe/Madrid', 'assets/pickems/fondo-fase-suiza.webp', '50% 22%')
    returning id into v_ev;
  end if;
  update pickem_events set kind = 'swiss', locks_at = timestamp '2026-10-23 18:30' at time zone 'Europe/Madrid'
   where id = v_ev and finished_at is null;
  if not exists (select 1 from pickem_teams where event_id = v_ev) then
    for i in 1 .. array_length(v_teams, 1) loop
      insert into pickem_teams (event_id, team, sort) values (v_ev, v_teams[i], i);
    end loop;
  end if;
end $$;

-- ── Seguridad y Realtime ──
do $$
declare t text;
begin
  foreach t in array array['pickem_teams', 'pickem_swiss_picks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('create policy "lectura publica" on %I for select using (true)', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

revoke execute on function pickem_settle_swiss(bigint) from public, anon, authenticated;
revoke execute on function save_swiss_pick(bigint, text, text), admin_set_swiss_record(bigint, text, integer, integer),
                           admin_save_swiss_teams(bigint, text[]) from public, anon;
grant execute on function save_swiss_pick(bigint, text, text), admin_set_swiss_record(bigint, text, integer, integer),
                          admin_save_swiss_teams(bigint, text[]) to authenticated;

-- ============================================================
-- Discord: los avisos del bracket ya no miran las fases suizas
-- ============================================================
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

  for e in select * from pickem_events where kind <> 'swiss' loop   -- la fase suiza tiene sus propios avisos
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

-- ============================================================
-- Avisos de Discord de la fase suiza (mismo tipo "pickems")
-- ============================================================
create or replace function discord_scan_pickems_swiss()
returns void language plpgsql security definer set search_path = public as $$
declare
  s discord_settings;
  e pickem_events;
  t pickem_teams;
  v_open timestamptz;
  v_url text;
  v_ids uuid[];
  v_exact uuid[];
  v_rec text;
begin
  select * into s from discord_settings;
  if not found or not s.enabled or s.enabled_at is null then return; end if;

  for e in select * from pickem_events where kind = 'swiss' loop
    v_url := dc_site() || 'pickems.html?id=' || e.id;
    continue when not exists (select 1 from pickem_teams where event_id = e.id);

    -- 🔮 Se abren los Pickems
    v_open := coalesce(e.opens_at, e.created_at);
    if e.finished_at is null and v_open <= now() and now() < e.locks_at and v_open >= s.enabled_at - interval '1 day' then
      perform discord_enqueue('general', 'pickems', 'pickems_abre:' || e.id, jsonb_build_object(
        'title', '🔮 ¡Se abren los Pickems de ' || e.name || '!',
        'description', 'Elige los **8 equipos que clasifican** y clava los récords **3-0, 3-1 y 3-2**: '
                       || '+' || pickem_swiss_adv() || ' 🦷 por clasificado y +' || pickem_swiss_bonus() || ' extra por récord exacto (hasta **🦷 '
                       || (3 * (pickem_swiss_adv() + pickem_swiss_bonus()) + 5 * pickem_swiss_adv()) || '**). '
                       || 'Si lo aciertas todo, te llevas **' || e.perfect_prize || '**.' || E'\n'
                       || 'Cierra el **' || dc_day(e.locks_at) || ' a las ' || to_char(e.locks_at at time zone 'Europe/Madrid', 'HH24:MI') || '** (hora de España).'
                       || E'\n' || '[Hacer mis elecciones](' || v_url || ')',
        'color', 4063186, 'url', v_url,
        'image', jsonb_build_object('url', dc_pickem_image(e)),
        'timestamp', v_open));
    end if;

    -- ⏰ Últimas 12 horas: quién no completó sus 8 elecciones
    if e.finished_at is null and now() >= e.locks_at - interval '12 hours' and now() < e.locks_at
       and e.locks_at - interval '12 hours' >= s.enabled_at - interval '1 hour' then
      select array_agg(p.id) into v_ids from players p
       where p.user_id is not null
         and (select count(*) from pickem_swiss_picks pk where pk.player_id = p.id and pk.event_id = e.id) < 8;
      perform discord_enqueue('general', 'pickems', 'pickems_cierre:' || e.id, jsonb_build_object(
        'title', '⏰ Últimas 12 horas para los Pickems de ' || e.name,
        'description', 'Cierra el **' || dc_day(e.locks_at) || ' a las ' || to_char(e.locks_at at time zone 'Europe/Madrid', 'HH24:MI') || '** (hora de España).'
                       || case when v_ids is null then E'\n' || '¡Todo el grupo tiene sus 8 elecciones! 🦈'
                               else E'\n' || 'Todavía les faltan elecciones a ' || dc_names(v_ids) || '.' end
                       || E'\n' || '[Completar mis elecciones](' || v_url || ')',
        'color', 16758087, 'url', v_url,
        'timestamp', e.locks_at - interval '12 hours'));
    end if;

    -- ✅ / 💀 Cada equipo que cierra su destino
    for t in select * from pickem_teams where event_id = e.id and decided_at is not null and decided_at >= s.enabled_at loop
      v_rec := t.wins || '-' || t.losses;
      if t.wins = 3 then
        select array_agg(player_id) filter (where slot <> v_rec), array_agg(player_id) filter (where slot = v_rec)
          into v_ids, v_exact from pickem_swiss_picks where event_id = e.id and team = t.team;
        perform discord_enqueue('general', 'pickems', 'pickems_sw:' || e.id || ':' || t.team || ':' || v_rec, jsonb_build_object(
          'title', '✅ ' || t.team || ' clasifica ' || v_rec,
          'description', e.name || E'\n'
                         || case when v_exact is not null then 'Clavaron el récord ' || dc_names(v_exact) || ' (**+🦷 ' || (pickem_swiss_adv() + pickem_swiss_bonus()) || '**).' || E'\n' else '' end
                         || case when v_ids is not null then 'Lo tenían como clasificado ' || dc_names(v_ids) || ' (**+🦷 ' || pickem_swiss_adv() || '**).'
                                 when v_exact is null then 'Nadie lo vio venir. 👀' else '' end
                         || E'\n' || '[Ver la fase suiza](' || v_url || ')',
          'color', 4063186, 'url', v_url, 'timestamp', t.decided_at));
      else
        select array_agg(player_id) into v_ids from pickem_swiss_picks where event_id = e.id and team = t.team;
        perform discord_enqueue('general', 'pickems', 'pickems_sw:' || e.id || ':' || t.team || ':' || v_rec, jsonb_build_object(
          'title', '💀 ' || t.team || ' queda eliminado (' || v_rec || ')',
          'description', e.name || E'\n'
                         || case when v_ids is null then 'Nadie confiaba en ellos. 🧊'
                                 else 'Lo tenían como clasificado ' || dc_names(v_ids) || '.' end
                         || E'\n' || '[Ver la fase suiza](' || v_url || ')',
          'color', 16740238, 'url', v_url, 'timestamp', t.decided_at));
      end if;
    end loop;

    -- 🏆 Fase finalizada: quién hizo pleno
    if e.finished_at is not null and e.finished_at >= s.enabled_at then
      select array_agg(x.player_id) into v_ids from (
        select pk.player_id
          from pickem_swiss_picks pk join pickem_teams tt on tt.event_id = pk.event_id and tt.team = pk.team
         where pk.event_id = e.id
         group by pk.player_id
        having count(*) = 8 and count(*) filter (where tt.wins = 3) = 8
           and count(*) filter (where pk.slot in ('3-0', '3-1', '3-2') and pk.slot = '3-' || tt.losses and tt.wins = 3) = 3) x;
      perform discord_enqueue('general', 'pickems', 'pickems_fin:' || e.id, jsonb_build_object(
        'title', '🏆 Terminaron los Pickems de ' || e.name,
        'description', case when v_ids is null then 'Nadie hizo pleno esta vez. ¡A por la siguiente fase!'
                            else dc_names(v_ids) || case when array_length(v_ids, 1) = 1 then ' acertó' else ' acertaron' end
                                 || ' los 8 clasificados y los 3 récords, y se lleva **' || e.perfect_prize || '**. 👑' end
                       || E'\n' || '[Ver la clasificación](' || v_url || ')',
        'color', 11111423, 'url', v_url,
        'image', jsonb_build_object('url', dc_pickem_image(e)),
        'timestamp', e.finished_at));
    end if;
  end loop;
end;
$$;

create or replace function discord_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform discord_scan();
  if to_regprocedure('public.discord_scan_live()') is not null then perform discord_scan_live(); end if;
  if to_regprocedure('public.discord_scan_rewind()') is not null then perform discord_scan_rewind(); end if;
  perform discord_scan_pickems();
  perform discord_scan_pickems_swiss();
  perform discord_send();
  delete from discord_outbox where created_at < now() - interval '30 days';
end;
$$;

revoke execute on function discord_scan_pickems(), discord_scan_pickems_swiss(), discord_tick() from public, anon, authenticated;
