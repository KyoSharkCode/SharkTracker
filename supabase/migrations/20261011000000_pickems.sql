-- ============================================================
-- Pickems (estilo Pick'Em de LoL Esports)
--
-- · La admin crea un "evento" por fase (ej. Worlds 2026 · Play-In) con su
--   apertura, su cierre, su premio por pleno y sus series. La portada de
--   Pickems agrupa las fases por torneo (lo que va antes de " · "). Cada serie tiene sus equipos fijos (ronda 1) o los
--   recibe de otra serie: "ganador de la serie X" / "perdedor de la serie X".
-- · Cada jugador con la cuenta vinculada arma su bracket eligiendo el GANADOR
--   de cada serie: el equipo que elige pasa a la serie siguiente de SU bracket.
--   Se puede cambiar hasta la hora de cierre. Los votos son públicos.
-- · Cuando la admin carga el resultado de una serie, cada acierto da los 🦷
--   de esa serie (columna points, editable por serie). Si se corrige un
--   resultado, se recalcula todo el evento.
-- · Al finalizar el evento, quien acertó TODOS los ganadores recibe el premio
--   del pleno (perfect_prize, por defecto la Skin Definitiva: premio real
--   pendiente de entrega en el Admin) y la insignia.
-- · Apuestas (series con bets_enabled, p. ej. la gran final): se abren cuando
--   se conocen los dos equipos y cierran al empezar la serie (starts_at) o
--   cuando la admin las cierra. Los 🦷 apostados se descuentan al apostar.
--   Bote compartido: quienes aciertan recuperan lo suyo y se reparten lo de
--   quienes fallan, en proporción a lo que apostó cada uno. Si nadie acierta
--   o nadie falla, se devuelve todo. Apuesta mínima 10 🦷 y máxima 500 🦷.
-- ============================================================

-- ── Tablas ──
create table if not exists pickem_events (
  id          bigint generated always as identity primary key,
  name          text not null,               -- "Torneo · Fase", ej. "Worlds 2026 · Play-In"
  opens_at      timestamptz,                 -- desde aquí se puede votar (null = ya abierto)
  locks_at      timestamptz not null,        -- hasta aquí se puede armar el bracket
  perfect_prize text not null default 'Skin Definitiva',   -- premio por acertar todo
  finished_at timestamptz,                -- la admin lo cerró y se repartió la skin
  created_at  timestamptz not null default now()
);

create table if not exists pickem_matches (
  id             bigint generated always as identity primary key,
  event_id       bigint not null references pickem_events(id) on delete cascade,
  label          text,                    -- ej. "Ronda 1", "Gran final"
  bracket        text not null default 'superior' check (bracket in ('superior', 'inferior')),
  col            integer not null default 1,   -- columna dentro de su cuadro (para dibujar el bracket)
  sort           integer not null default 100, -- orden: una serie va siempre después de sus series de origen
  team1          text,                    -- equipo fijo; null = sale de src1
  team2          text,
  src1_match     bigint references pickem_matches(id) on delete set null,
  src1_win       boolean,                 -- true = ganador de src1_match, false = perdedor
  src2_match     bigint references pickem_matches(id) on delete set null,
  src2_win       boolean,
  best_of        integer not null default 5 check (best_of in (1, 3, 5)),
  points         integer not null default 10 check (points >= 0),
  starts_at      timestamptz,
  score1         integer,                 -- resultado (null = todavía no se jugó)
  score2         integer,
  bets_enabled   boolean not null default false,
  bets_closed_at timestamptz,             -- la admin cerró las apuestas a mano
  created_at     timestamptz not null default now(),
  check (team1 is not null or src1_match is not null),
  check (team2 is not null or src2_match is not null)
);
create index if not exists pickem_matches_event_idx on pickem_matches (event_id, sort, id);

create table if not exists pickem_picks (
  player_id  uuid not null references players(id) on delete cascade,
  match_id   bigint not null references pickem_matches(id) on delete cascade,
  team       text not null,               -- equipo que elige como ganador
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
create index if not exists pickem_picks_match_idx on pickem_picks (match_id);

create table if not exists pickem_bets (
  player_id  uuid not null references players(id) on delete cascade,
  match_id   bigint not null references pickem_matches(id) on delete cascade,
  team       text not null,
  amount     integer not null check (amount > 0),
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
create index if not exists pickem_bets_match_idx on pickem_bets (match_id);

-- Marcador válido para una serie al mejor de N (BO5 → 3-0, 3-1, 3-2, 2-3, 1-3, 0-3)
create or replace function pickem_valid_score(p_best_of integer, p_s1 integer, p_s2 integer)
returns boolean language sql immutable as $$
  select p_s1 is not null and p_s2 is not null and p_s1 >= 0 and p_s2 >= 0
     and greatest(p_s1, p_s2) = (p_best_of + 1) / 2
     and least(p_s1, p_s2) < (p_best_of + 1) / 2
$$;

-- Apuesta mínima y máxima por persona (🦷)
create or replace function pickem_min_bet() returns integer language sql immutable as $$ select 10 $$;
create or replace function pickem_max_bet() returns integer language sql immutable as $$ select 500 $$;

-- Insignia y premio del pleno
insert into badges (code, name, description, icon, sort) values
  ('pickem_perfecto', 'Pickem perfecto', 'Acertó todos los ganadores de unos Pickems.', '🔮', 50)
on conflict (code) do nothing;
-- No está a la venta (inactivo): existe para que el pleno aparezca en "Premios por entregar".
insert into shop_items (id, kind, name, description, collection, price, active, icon, sort)
values ('pickem-perfecto', 'premio', 'Skin Definitiva', 'Premio por acertar todos los Pickems de una fase.', 'Pickems', 0, false, 'skin', 900)
on conflict (id) do nothing;

-- ============================================================
-- Equipos de cada serie
-- ============================================================
-- Equipos REALES de una serie (slot 1 o 2): fijo, o ganador/perdedor real de su serie de origen.
create or replace function pickem_actual_team(p_match bigint, p_slot integer)
returns text language plpgsql stable set search_path = public as $$
declare m pickem_matches; v_src bigint; v_win boolean; s pickem_matches;
begin
  select * into m from pickem_matches where id = p_match;
  if not found then return null; end if;
  if p_slot = 1 and m.team1 is not null then return m.team1; end if;
  if p_slot = 2 and m.team2 is not null then return m.team2; end if;
  v_src := case p_slot when 1 then m.src1_match else m.src2_match end;
  v_win := case p_slot when 1 then m.src1_win else m.src2_win end;
  select * into s from pickem_matches where id = v_src;
  if not found or s.score1 is null then return null; end if;
  return pickem_actual_team(s.id, case when (s.score1 > s.score2) = v_win then 1 else 2 end);
end;
$$;

create or replace function pickem_winner(p_match bigint)
returns text language plpgsql stable set search_path = public as $$
declare m pickem_matches;
begin
  select * into m from pickem_matches where id = p_match;
  if not found or m.score1 is null then return null; end if;
  return pickem_actual_team(p_match, case when m.score1 > m.score2 then 1 else 2 end);
end;
$$;

-- Equipos de una serie en el bracket DE UN JUGADOR (según lo que eligió antes).
create or replace function pickem_player_team(p_player uuid, p_match bigint, p_slot integer)
returns text language plpgsql stable set search_path = public as $$
declare m pickem_matches; v_src bigint; v_win boolean; v_pick text; v_a text; v_b text;
begin
  select * into m from pickem_matches where id = p_match;
  if not found then return null; end if;
  if p_slot = 1 and m.team1 is not null then return m.team1; end if;
  if p_slot = 2 and m.team2 is not null then return m.team2; end if;
  v_src := case p_slot when 1 then m.src1_match else m.src2_match end;
  v_win := case p_slot when 1 then m.src1_win else m.src2_win end;
  select team into v_pick from pickem_picks where player_id = p_player and match_id = v_src;
  if v_pick is null then return null; end if;
  if v_win then return v_pick; end if;
  v_a := pickem_player_team(p_player, v_src, 1);
  v_b := pickem_player_team(p_player, v_src, 2);
  return case when v_pick = v_a then v_b else v_a end;
end;
$$;

-- Borra los votos de un jugador que ya no encajan en su bracket (cambió una serie anterior).
create or replace function pickem_prune_picks(p_player uuid, p_event bigint)
returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in
    select pk.match_id, pk.team from pickem_picks pk join pickem_matches m on m.id = pk.match_id
     where pk.player_id = p_player and m.event_id = p_event order by m.sort, m.id
  loop
    if r.team is distinct from pickem_player_team(p_player, r.match_id, 1)
       and r.team is distinct from pickem_player_team(p_player, r.match_id, 2) then
      delete from pickem_picks where player_id = p_player and match_id = r.match_id;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Reparto (se puede volver a correr: borra lo pagado y recalcula)
-- ============================================================
create or replace function pickem_settle_event(p_event bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e pickem_events;
  m record;
  r record;
  v_win text;
  v_w integer;
  v_l integer;
begin
  select * into e from pickem_events where id = p_event;
  if not found then return; end if;
  for m in select * from pickem_matches where event_id = p_event order by sort, id loop
    -- Aciertos del bracket
    delete from wallet_tx where reason = 'pickem' and source_key like 'pickem:' || m.id || ':%';
    v_win := pickem_winner(m.id);
    if v_win is not null then
      for r in select * from pickem_picks where match_id = m.id and team = v_win loop
        perform reward_give(r.player_id, m.points, 'pickem',
                            v_win || ' gana · ' || coalesce(m.label || ' · ', '') || e.name,
                            'pickem:' || m.id || ':' || r.player_id);
      end loop;
    end if;
    -- Apuestas (el descuento al apostar no se toca; aquí solo premios y devoluciones)
    delete from wallet_tx where reason in ('apuesta_premio', 'apuesta_devuelta') and source_key like 'apuesta_pago:' || m.id || ':%';
    if v_win is not null and exists (select 1 from pickem_bets where match_id = m.id) then
      select coalesce(sum(amount) filter (where team = v_win), 0), coalesce(sum(amount) filter (where team <> v_win), 0)
        into v_w, v_l from pickem_bets where match_id = m.id;
      for r in select * from pickem_bets where match_id = m.id loop
        if v_w = 0 or v_l = 0 then
          perform reward_give(r.player_id, r.amount, 'apuesta_devuelta', 'Apuesta devuelta · ' || coalesce(m.label, e.name),
                              'apuesta_pago:' || m.id || ':' || r.player_id);
        elsif r.team = v_win then
          perform reward_give(r.player_id, r.amount + floor(r.amount::numeric * v_l / v_w)::int, 'apuesta_premio',
                              'Apuesta ganada: ' || v_win || ' · ' || coalesce(m.label, e.name),
                              'apuesta_pago:' || m.id || ':' || r.player_id);
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Jugadores
-- ============================================================
-- Elegir (o quitar con null) el ganador de una serie en su bracket.
create or replace function save_pickem_pick(p_match bigint, p_team text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := my_player_id();
  m pickem_matches;
  e pickem_events;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión.'; end if;
  if v_player is null then raise exception 'Primero vincula tu cuenta de LoL a tu perfil.'; end if;
  select * into m from pickem_matches where id = p_match;
  if not found then raise exception 'Esa serie no existe.'; end if;
  select * into e from pickem_events where id = m.event_id;
  if e.opens_at is not null and now() < e.opens_at then raise exception 'Estos Pickems todavía no se abren.'; end if;
  if now() >= e.locks_at or e.finished_at is not null then raise exception 'Los Pickems ya cerraron.'; end if;
  if p_team is null then
    delete from pickem_picks where player_id = v_player and match_id = p_match;
  else
    if p_team is distinct from pickem_player_team(v_player, p_match, 1) and p_team is distinct from pickem_player_team(v_player, p_match, 2) then
      raise exception 'Primero elige los ganadores de las series anteriores.';
    end if;
    insert into pickem_picks (player_id, match_id, team) values (v_player, p_match, p_team)
    on conflict (player_id, match_id) do update set team = excluded.team, updated_at = now();
  end if;
  perform pickem_prune_picks(v_player, m.event_id);
end;
$$;

-- Apostar (o cambiar la apuesta; amount 0 o null = retirarla).
create or replace function place_pickem_bet(p_match bigint, p_team text, p_amount integer)
returns integer             -- saldo que queda
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := my_player_id();
  m pickem_matches;
  v_t1 text; v_t2 text;
  v_old integer;
  v_key text;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión.'; end if;
  if v_player is null then raise exception 'Primero vincula tu cuenta de LoL a tu perfil.'; end if;
  select * into m from pickem_matches where id = p_match;
  if not found or not m.bets_enabled then raise exception 'En esta serie no se apuesta.'; end if;
  v_t1 := pickem_actual_team(p_match, 1); v_t2 := pickem_actual_team(p_match, 2);
  if v_t1 is null or v_t2 is null then raise exception 'Las apuestas se abren cuando se conozcan los dos equipos.'; end if;
  if m.score1 is not null or m.bets_closed_at is not null or (m.starts_at is not null and now() >= m.starts_at) then
    raise exception 'Las apuestas de esta serie ya cerraron.';
  end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || v_player));
  v_key := 'apuesta:' || p_match || ':' || v_player;
  select amount into v_old from pickem_bets where player_id = v_player and match_id = p_match;
  -- Devuelve lo apostado antes (si había) y vuelve a apostar
  delete from wallet_tx where player_id = v_player and source_key = v_key;
  delete from pickem_bets where player_id = v_player and match_id = p_match;
  if coalesce(p_amount, 0) > 0 then
    if p_team is distinct from v_t1 and p_team is distinct from v_t2 then raise exception 'Ese equipo no juega esta serie.'; end if;
    if p_amount < pickem_min_bet() then raise exception 'La apuesta mínima es de % dientes.', pickem_min_bet(); end if;
    if p_amount > pickem_max_bet() then raise exception 'La apuesta máxima es de % dientes.', pickem_max_bet(); end if;
    if wallet_balance(v_player) < p_amount then
      raise exception 'No te alcanzan los dientes (tienes %).', wallet_balance(v_player);
    end if;
    insert into pickem_bets (player_id, match_id, team, amount) values (v_player, p_match, p_team, p_amount);
    perform reward_give(v_player, -p_amount, 'apuesta', p_team || ' · ' || coalesce(m.label, 'Pickems'), v_key);
  end if;
  return wallet_balance(v_player);
end;
$$;

-- ============================================================
-- Admin
-- ============================================================
create or replace function admin_save_pickem_event(p_id bigint, p_name text, p_opens_at timestamptz, p_locks_at timestamptz, p_perfect_prize text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Ponle un nombre.'; end if;
  if p_locks_at is null then raise exception 'Falta la hora de cierre.'; end if;
  if p_opens_at is not null and p_opens_at >= p_locks_at then raise exception 'La apertura tiene que ser antes del cierre.'; end if;
  if p_id is null then
    insert into pickem_events (name, opens_at, locks_at, perfect_prize)
    values (trim(p_name), p_opens_at, p_locks_at, coalesce(nullif(trim(p_perfect_prize), ''), 'Skin Definitiva')) returning id into v_id;
  else
    update pickem_events set name = trim(p_name), opens_at = p_opens_at, locks_at = p_locks_at,
           perfect_prize = coalesce(nullif(trim(p_perfect_prize), ''), perfect_prize)
     where id = p_id and finished_at is null returning id into v_id;
    if v_id is null then raise exception 'Ese evento no existe o ya está finalizado.'; end if;
  end if;
  return v_id;
end;
$$;

-- Borra el evento con sus series, votos y apuestas; devuelve lo apostado y quita lo pagado.
create or replace function admin_delete_pickem_event(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  delete from wallet_tx where reason in ('pickem', 'apuesta', 'apuesta_premio', 'apuesta_devuelta')
     and split_part(source_key, ':', 2) in (select id::text from pickem_matches where event_id = p_id);
  delete from pickem_events where id = p_id;
end;
$$;

-- Crear (p_id null) o editar una serie. Las series nuevas desde el Admin llevan equipos fijos;
-- en una serie que sale de otras, team1/team2 vacíos la dejan como está.
create or replace function admin_save_pickem_match(p_id bigint, p_event bigint, p_label text, p_team1 text, p_team2 text,
                                                   p_best_of integer, p_points integer, p_starts_at timestamptz,
                                                   p_sort integer, p_bets_enabled boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; m pickem_matches;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  if p_best_of not in (1, 3, 5) then raise exception 'El formato tiene que ser BO1, BO3 o BO5.'; end if;
  if p_points is null or p_points < 0 then raise exception 'Dientes por acierto no válidos.'; end if;
  if p_id is null then
    if coalesce(trim(p_team1), '') = '' or coalesce(trim(p_team2), '') = '' then raise exception 'Faltan los equipos.'; end if;
    if exists (select 1 from pickem_events where id = p_event and finished_at is not null) then raise exception 'Ese evento ya está finalizado.'; end if;
    insert into pickem_matches (event_id, label, team1, team2, best_of, points, starts_at, sort, col, bets_enabled)
    values (p_event, nullif(trim(p_label), ''), trim(p_team1), trim(p_team2), p_best_of, p_points, p_starts_at,
            coalesce(p_sort, 100), 1, coalesce(p_bets_enabled, false))
    returning id into v_id;
  else
    select * into m from pickem_matches where id = p_id;
    if not found then raise exception 'Esa serie no existe.'; end if;
    if m.best_of <> p_best_of and m.score1 is not null then raise exception 'Borra el resultado antes de cambiar el formato.'; end if;
    -- Un equipo fijo no puede quedar vacío; uno que sale de otra serie solo cambia si se escribe algo.
    if (m.src1_match is null and coalesce(trim(p_team1), '') = '') or (m.src2_match is null and coalesce(trim(p_team2), '') = '') then
      raise exception 'Faltan los equipos.';
    end if;
    -- Renombrar un equipo fijo también renombra los votos y apuestas que lo eligieron.
    if m.team1 is not null and trim(p_team1) <> m.team1 then
      update pickem_picks set team = trim(p_team1) where team = m.team1 and match_id in (select id from pickem_matches where event_id = m.event_id);
      update pickem_bets  set team = trim(p_team1) where team = m.team1 and match_id in (select id from pickem_matches where event_id = m.event_id);
    end if;
    if m.team2 is not null and trim(p_team2) <> m.team2 then
      update pickem_picks set team = trim(p_team2) where team = m.team2 and match_id in (select id from pickem_matches where event_id = m.event_id);
      update pickem_bets  set team = trim(p_team2) where team = m.team2 and match_id in (select id from pickem_matches where event_id = m.event_id);
    end if;
    update pickem_matches set label = nullif(trim(p_label), ''),
           team1 = case when src1_match is null then trim(p_team1) else team1 end,
           team2 = case when src2_match is null then trim(p_team2) else team2 end,
           best_of = p_best_of, points = p_points, starts_at = p_starts_at, sort = coalesce(p_sort, sort),
           bets_enabled = coalesce(p_bets_enabled, bets_enabled)
     where id = p_id returning id into v_id;
    if m.score1 is not null then perform pickem_settle_event(m.event_id); end if;
  end if;
  return v_id;
end;
$$;

-- Borra una serie (solo las que no alimentan a otras): devuelve sus apuestas y quita lo pagado.
create or replace function admin_delete_pickem_match(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  if exists (select 1 from pickem_matches m join pickem_events e on e.id = m.event_id where m.id = p_id and e.finished_at is not null) then
    raise exception 'Ese evento ya está finalizado.';
  end if;
  if exists (select 1 from pickem_matches where src1_match = p_id or src2_match = p_id) then
    raise exception 'Otras series dependen de esta: no se puede borrar.';
  end if;
  delete from wallet_tx where reason in ('pickem', 'apuesta', 'apuesta_premio', 'apuesta_devuelta') and split_part(source_key, ':', 2) = p_id::text;
  delete from pickem_matches where id = p_id;
end;
$$;

-- Cargar (o corregir, o borrar con nulls) el resultado de una serie y repartir los 🦷.
create or replace function admin_set_pickem_result(p_match bigint, p_score1 integer, p_score2 integer)
returns void language plpgsql security definer set search_path = public as $$
declare m pickem_matches; e pickem_events;
begin
  if not is_admin() then raise exception 'Solo una administradora puede cargar resultados.'; end if;
  select * into m from pickem_matches where id = p_match for update;
  if not found then raise exception 'Esa serie no existe.'; end if;
  select * into e from pickem_events where id = m.event_id;
  if e.finished_at is not null then raise exception 'Ese evento ya está finalizado.'; end if;
  if now() < e.locks_at then raise exception 'Los Pickems siguen abiertos: el resultado se carga después del cierre.'; end if;
  if p_score1 is not null or p_score2 is not null then
    if not pickem_valid_score(m.best_of, p_score1, p_score2) then raise exception 'Marcador no válido para un BO%.', m.best_of; end if;
    if pickem_actual_team(p_match, 1) is null or pickem_actual_team(p_match, 2) is null then
      raise exception 'Primero carga los resultados de las series anteriores.';
    end if;
  elsif exists (select 1 from pickem_matches where (src1_match = p_match or src2_match = p_match) and score1 is not null) then
    raise exception 'Primero borra los resultados de las series que salen de esta.';
  end if;
  update pickem_matches set score1 = p_score1, score2 = p_score2 where id = p_match;
  perform pickem_settle_event(m.event_id);
end;
$$;

-- Cerrar (o reabrir) a mano las apuestas de una serie.
create or replace function admin_close_pickem_bets(p_match bigint, p_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede cerrar apuestas.'; end if;
  update pickem_matches set bets_closed_at = case when p_closed then now() end where id = p_match;
end;
$$;

-- Finalizar: con todos los resultados cargados, da la Skin Definitiva a quien acertó todo.
-- Devuelve cuántos jugadores hicieron pleno.
create or replace function admin_finish_pickem_event(p_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare e pickem_events; v_total integer; v_n integer := 0; r record;
begin
  if not is_admin() then raise exception 'Solo una administradora puede finalizar los Pickems.'; end if;
  select * into e from pickem_events where id = p_id for update;
  if not found then raise exception 'Ese evento no existe.'; end if;
  if e.finished_at is not null then raise exception 'Ese evento ya está finalizado.'; end if;
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

-- ============================================================
-- Seguridad: lectura pública; todo cambio pasa por las funciones de arriba
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['pickem_events', 'pickem_matches', 'pickem_picks', 'pickem_bets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('create policy "lectura publica" on %I for select using (true)', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;

revoke execute on function pickem_settle_event(bigint), pickem_prune_picks(uuid, bigint) from public, anon, authenticated;
revoke execute on function save_pickem_pick(bigint, text), place_pickem_bet(bigint, text, integer),
                           admin_save_pickem_event(bigint, text, timestamptz, timestamptz, text), admin_delete_pickem_event(bigint),
                           admin_save_pickem_match(bigint, bigint, text, text, text, integer, integer, timestamptz, integer, boolean),
                           admin_delete_pickem_match(bigint), admin_set_pickem_result(bigint, integer, integer),
                           admin_close_pickem_bets(bigint, boolean), admin_finish_pickem_event(bigint) from public, anon;
grant execute on function save_pickem_pick(bigint, text), place_pickem_bet(bigint, text, integer),
                          admin_save_pickem_event(bigint, text, timestamptz, timestamptz, text), admin_delete_pickem_event(bigint),
                          admin_save_pickem_match(bigint, bigint, text, text, text, integer, integer, timestamptz, integer, boolean),
                          admin_delete_pickem_match(bigint), admin_set_pickem_result(bigint, integer, integer),
                          admin_close_pickem_bets(bigint, boolean), admin_finish_pickem_event(bigint) to authenticated;

-- ── Realtime ──
do $$
declare tbl text;
begin
  for tbl in select unnest(array['pickem_events', 'pickem_matches', 'pickem_picks', 'pickem_bets']) loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;
