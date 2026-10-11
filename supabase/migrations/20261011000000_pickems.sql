-- ============================================================
-- Pickems (estilo Pick'Em de LoL Esports)
--
-- · La admin crea un "evento" (ej. Worlds 2026 · Play-In) con su hora de
--   cierre y sus series (equipo 1 vs equipo 2, al mejor de 1/3/5).
-- · Los jugadores con la cuenta vinculada predicen el marcador de cada serie
--   hasta la hora de cierre. Las predicciones son públicas: cualquiera, sin
--   iniciar sesión, las puede ver.
-- · Cuando la admin carga el resultado de una serie se reparten los 🦷:
--     acierta el ganador pero no el marcador → pickem_ganador (10)
--     acierta ganador y marcador             → pickem_exacto  (50)
--   (en un BO1 acertar el ganador ya es acertar el marcador).
--   Si la admin corrige un resultado, los 🦷 de esa serie se recalculan.
-- · Al finalizar el evento, quien acertó TODAS las series con el marcador
--   exacto recibe la Skin Definitiva (como premio real pendiente de entrega
--   en el Admin) y la insignia "Pickem perfecto".
-- ============================================================

-- ── Cantidades editables (se suman a las de la tienda) ──
update reward_settings
   set amounts = jsonb_build_object('pickem_ganador', 10, 'pickem_exacto', 50) || amounts
 where singleton;

-- ── Tablas ──
create table if not exists pickem_events (
  id          bigint generated always as identity primary key,
  name        text not null,
  locks_at    timestamptz not null,       -- hasta aquí se puede votar
  finished_at timestamptz,                -- la admin lo cerró y se repartió la skin
  created_at  timestamptz not null default now()
);

create table if not exists pickem_matches (
  id         bigint generated always as identity primary key,
  event_id   bigint not null references pickem_events(id) on delete cascade,
  label      text,                        -- ej. "Ronda 1", "Final del Play-In"
  team1      text not null,
  team2      text not null,
  best_of    integer not null check (best_of in (1, 3, 5)),
  starts_at  timestamptz,
  sort       integer not null default 100,
  score1     integer,                     -- resultado (null = todavía no se jugó)
  score2     integer,
  created_at timestamptz not null default now()
);
create index if not exists pickem_matches_event_idx on pickem_matches (event_id, sort, id);

create table if not exists pickem_picks (
  player_id  uuid not null references players(id) on delete cascade,
  match_id   bigint not null references pickem_matches(id) on delete cascade,
  score1     integer not null,
  score2     integer not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
create index if not exists pickem_picks_match_idx on pickem_picks (match_id);

-- Marcador válido para una serie al mejor de N: el ganador llega a ceil(N/2)
-- y el perdedor se queda por debajo (BO3 → 2-0, 2-1, 1-2, 0-2).
create or replace function pickem_valid_score(p_best_of integer, p_s1 integer, p_s2 integer)
returns boolean language sql immutable as $$
  select p_s1 is not null and p_s2 is not null and p_s1 >= 0 and p_s2 >= 0
     and greatest(p_s1, p_s2) = (p_best_of + 1) / 2
     and least(p_s1, p_s2) < (p_best_of + 1) / 2
$$;

-- Insignia para el pleno
insert into badges (code, name, description, icon, sort) values
  ('pickem_perfecto', 'Pickem perfecto', 'Acertó todos los marcadores de unos Pickems.', '🔮', 50)
on conflict (code) do nothing;

-- Premio "Skin Definitiva": no está a la venta (inactivo, se da solo por el pleno).
-- Existe para que el canje aparezca en "Premios por entregar" del Admin.
insert into shop_items (id, kind, name, description, collection, price, active, icon, sort)
values ('pickem-perfecto', 'premio', 'Skin Definitiva', 'Premio por acertar todos los Pickems de un evento.', 'Pickems', 0, false, 'skin', 900)
on conflict (id) do nothing;

-- ── Evento inicial: Worlds 2026 · Play-In (cierra el 15/10 a las 6:00, hora de España) ──
insert into pickem_events (name, locks_at)
select 'Worlds 2026 · Play-In', timestamp '2026-10-15 06:00' at time zone 'Europe/Madrid'
 where not exists (select 1 from pickem_events);

-- ============================================================
-- Reparto de 🦷 de una serie (se puede volver a correr: recalcula)
-- ============================================================
create or replace function pickem_settle_match(p_match bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m pickem_matches;
  e pickem_events;
  r record;
  v_label text;
begin
  select * into m from pickem_matches where id = p_match;
  if not found then return; end if;
  select * into e from pickem_events where id = m.event_id;
  -- Borra lo que se haya pagado antes por esta serie (por si se corrigió el resultado)
  delete from wallet_tx where reason = 'pickem' and source_key like 'pickem:' || p_match || ':%';
  if m.score1 is null or m.score2 is null then return; end if;
  v_label := m.team1 || ' ' || m.score1 || '-' || m.score2 || ' ' || m.team2 || ' · ' || e.name;
  for r in select * from pickem_picks where match_id = p_match loop
    if r.score1 = m.score1 and r.score2 = m.score2 then
      perform reward_give(r.player_id, reward_amount('pickem_exacto'), 'pickem', 'Marcador exacto: ' || v_label,
                          'pickem:' || p_match || ':' || r.player_id);
    elsif (r.score1 > r.score2) = (m.score1 > m.score2) then
      perform reward_give(r.player_id, reward_amount('pickem_ganador'), 'pickem', 'Ganador acertado: ' || v_label,
                          'pickem:' || p_match || ':' || r.player_id);
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Jugadores: guardar / borrar su predicción
-- ============================================================
create or replace function save_pickem_pick(p_match bigint, p_score1 integer, p_score2 integer)
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
  if now() >= e.locks_at then raise exception 'Los Pickems ya cerraron.'; end if;
  if p_score1 is null and p_score2 is null then
    delete from pickem_picks where player_id = v_player and match_id = p_match;
    return;
  end if;
  if not pickem_valid_score(m.best_of, p_score1, p_score2) then raise exception 'Marcador no válido para un BO%.', m.best_of; end if;
  insert into pickem_picks (player_id, match_id, score1, score2) values (v_player, p_match, p_score1, p_score2)
  on conflict (player_id, match_id) do update set score1 = excluded.score1, score2 = excluded.score2, updated_at = now();
end;
$$;

-- ============================================================
-- Admin
-- ============================================================
-- Crear (p_id null) o editar un evento.
create or replace function admin_save_pickem_event(p_id bigint, p_name text, p_locks_at timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Ponle un nombre.'; end if;
  if p_locks_at is null then raise exception 'Falta la hora de cierre.'; end if;
  if p_id is null then
    insert into pickem_events (name, locks_at) values (trim(p_name), p_locks_at) returning id into v_id;
  else
    update pickem_events set name = trim(p_name), locks_at = p_locks_at where id = p_id and finished_at is null returning id into v_id;
    if v_id is null then raise exception 'Ese evento no existe o ya está finalizado.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function admin_delete_pickem_event(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  delete from wallet_tx where reason = 'pickem' and split_part(source_key, ':', 2) in (select id::text from pickem_matches where event_id = p_id);
  delete from pickem_events where id = p_id;
end;
$$;

-- Crear (p_id null) o editar una serie. El formato (BO) no se puede cambiar si ya hay votos.
create or replace function admin_save_pickem_match(p_id bigint, p_event bigint, p_label text, p_team1 text, p_team2 text,
                                                   p_best_of integer, p_starts_at timestamptz, p_sort integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; m pickem_matches;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  if coalesce(trim(p_team1), '') = '' or coalesce(trim(p_team2), '') = '' then raise exception 'Faltan los equipos.'; end if;
  if p_best_of not in (1, 3, 5) then raise exception 'El formato tiene que ser BO1, BO3 o BO5.'; end if;
  if p_id is null then
    if exists (select 1 from pickem_events where id = p_event and finished_at is not null) then raise exception 'Ese evento ya está finalizado.'; end if;
    insert into pickem_matches (event_id, label, team1, team2, best_of, starts_at, sort)
    values (p_event, nullif(trim(p_label), ''), trim(p_team1), trim(p_team2), p_best_of, p_starts_at, coalesce(p_sort, 100))
    returning id into v_id;
  else
    select * into m from pickem_matches where id = p_id;
    if not found then raise exception 'Esa serie no existe.'; end if;
    if m.best_of <> p_best_of and exists (select 1 from pickem_picks where match_id = p_id) then
      raise exception 'Ya hay votos en esta serie: no se puede cambiar el formato.';
    end if;
    update pickem_matches set label = nullif(trim(p_label), ''), team1 = trim(p_team1), team2 = trim(p_team2),
           best_of = p_best_of, starts_at = p_starts_at, sort = coalesce(p_sort, sort)
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_delete_pickem_match(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar los Pickems.'; end if;
  if exists (select 1 from pickem_matches m join pickem_events e on e.id = m.event_id where m.id = p_id and e.finished_at is not null) then
    raise exception 'Ese evento ya está finalizado.';
  end if;
  delete from wallet_tx where reason = 'pickem' and source_key like 'pickem:' || p_id || ':%';
  delete from pickem_matches where id = p_id;
end;
$$;

-- Cargar (o corregir, o borrar con nulls) el resultado de una serie y repartir sus 🦷.
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
  if (p_score1 is not null or p_score2 is not null) and not pickem_valid_score(m.best_of, p_score1, p_score2) then
    raise exception 'Marcador no válido para un BO%.', m.best_of;
  end if;
  update pickem_matches set score1 = p_score1, score2 = p_score2 where id = p_match;
  perform pickem_settle_match(p_match);
end;
$$;

-- Finalizar: con todos los resultados cargados, da la Skin Definitiva a quien acertó todo.
-- Devuelve cuántos jugadores hicieron pleno.
create or replace function admin_finish_pickem_event(p_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare e pickem_events; v_total integer; v_n integer := 0; r record; v_claim bigint;
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
     where m.event_id = p_id and pk.score1 = m.score1 and pk.score2 = m.score2
     group by pk.player_id
    having count(*) = v_total
  loop
    insert into prize_claims (player_id, item_id, item_name, price)
    values (r.player_id, 'pickem-perfecto', 'Skin Definitiva · ' || e.name, 0) returning id into v_claim;
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
  foreach t in array array['pickem_events', 'pickem_matches', 'pickem_picks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('create policy "lectura publica" on %I for select using (true)', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;

revoke execute on function pickem_settle_match(bigint) from public, anon, authenticated;
revoke execute on function save_pickem_pick(bigint, integer, integer), admin_save_pickem_event(bigint, text, timestamptz),
                           admin_delete_pickem_event(bigint),
                           admin_save_pickem_match(bigint, bigint, text, text, text, integer, timestamptz, integer),
                           admin_delete_pickem_match(bigint), admin_set_pickem_result(bigint, integer, integer),
                           admin_finish_pickem_event(bigint) from public, anon;
grant execute on function save_pickem_pick(bigint, integer, integer), admin_save_pickem_event(bigint, text, timestamptz),
                          admin_delete_pickem_event(bigint),
                          admin_save_pickem_match(bigint, bigint, text, text, text, integer, timestamptz, integer),
                          admin_delete_pickem_match(bigint), admin_set_pickem_result(bigint, integer, integer),
                          admin_finish_pickem_event(bigint) to authenticated;

-- ── Realtime ──
do $$
declare tbl text;
begin
  for tbl in select unnest(array['pickem_events', 'pickem_matches', 'pickem_picks']) loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;
