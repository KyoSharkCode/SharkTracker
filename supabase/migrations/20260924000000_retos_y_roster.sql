-- ============================================================
-- RETOS + GESTIÓN DEL ROSTER (Admin Dashboard)
--
-- Requiere haber corrido antes:
--   20260923010000_profile_editing_and_claim_approval.sql  (tabla admins)
--   20260923020000_twitch_link_and_admin.sql
--
-- Un reto = nombre + fecha de inicio + fecha de fin + participantes
-- elegidos a mano. Se cierra SOLO al llegar la fecha de fin (pg_cron,
-- cada 5 min) o antes con "Finalizar ahora". Gana el rango SoloQ más
-- alto entre sus participantes al momento del cierre.
--
-- Nada de la temporada se reinicia: badges, Rey de la Temporada,
-- primera victoria e historial siguen igual. El reto solo "toma una
-- foto" del ranking al cerrarse y la guarda para siempre.
-- ============================================================

create table if not exists challenges (
  id               bigint generated always as identity primary key,
  name             text not null check (char_length(trim(name)) between 3 and 60),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  finished_at      timestamptz,          -- null = programado o en curso
  winner_player_id uuid references players(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint challenges_fechas_ok check (ends_at > starts_at)
);

create table if not exists challenge_participants (
  challenge_id bigint not null references challenges(id) on delete cascade,
  player_id    uuid   not null references players(id) on delete cascade,
  primary key (challenge_id, player_id)
);

-- Foto final. Guarda nombre/ícono/campeón COPIADOS: si más adelante
-- alguien sale del roster, el reto terminado se sigue viendo igual.
create table if not exists challenge_results (
  challenge_id      bigint not null references challenges(id) on delete cascade,
  position          integer not null,
  player_id         uuid references players(id) on delete set null,
  riot_game_name    text not null,
  riot_tag_line     text not null,
  display_name      text,
  icon_id           integer,
  favorite_champion text,
  favorite_skin     integer,
  primary_role      text,
  tier              text,
  division          text,
  lp                integer,
  elo_score         integer,
  season_wins       integer,
  season_losses     integer,
  -- Solo partidas SoloQ jugadas ENTRE el inicio y el fin del reto
  -- (el historial se guarda 30 días: en retos más largos cuenta lo que haya).
  reto_games        integer not null default 0,
  reto_wins         integer not null default 0,
  reto_kills        integer not null default 0,
  reto_deaths       integer not null default 0,
  reto_assists      integer not null default 0,
  reto_lp_net       integer,
  primary key (challenge_id, position)
);

alter table challenges             enable row level security;
alter table challenge_participants enable row level security;
alter table challenge_results      enable row level security;
drop policy if exists "lectura publica" on challenges;
drop policy if exists "lectura publica" on challenge_participants;
drop policy if exists "lectura publica" on challenge_results;
create policy "lectura publica" on challenges             for select using (true);
create policy "lectura publica" on challenge_participants for select using (true);
create policy "lectura publica" on challenge_results      for select using (true);
-- Escritura SOLO por las funciones de abajo (verifican admin).
revoke all on challenges, challenge_participants, challenge_results from anon, authenticated;
grant select on challenges, challenge_participants, challenge_results to anon, authenticated;
grant select, insert, update, delete on challenges, challenge_participants, challenge_results to service_role;


-- ============================================================
-- Cerrar un reto (uso interno). Toma la foto y elige al ganador.
-- ============================================================
create or replace function finish_challenge(p_challenge_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch challenges;
  v_end timestamptz;
  v_winner uuid;
  v_winner_name text;
begin
  select * into v_ch from challenges where id = p_challenge_id for update;
  if not found then raise exception 'Ese reto no existe.'; end if;
  if v_ch.finished_at is not null then return; end if;   -- ya estaba cerrado
  if v_ch.starts_at > now() then
    raise exception 'Ese reto todavía no empezó: bórralo en vez de finalizarlo.';
  end if;
  v_end := least(v_ch.ends_at, now());

  insert into challenge_results (
    challenge_id, position, player_id, riot_game_name, riot_tag_line, display_name,
    icon_id, favorite_champion, favorite_skin, primary_role,
    tier, division, lp, elo_score, season_wins, season_losses,
    reto_games, reto_wins, reto_kills, reto_deaths, reto_assists, reto_lp_net)
  select v_ch.id,
         row_number() over (order by r.elo_score desc nulls last, r.wins desc nulls last, p.riot_game_name),
         p.id, p.riot_game_name, p.riot_tag_line, pp.display_name,
         p.icon_id, coalesce(pp.favorite_champion, p.favorite_champion),
         case when pp.favorite_champion is not null then pp.favorite_skin else p.favorite_skin end,
         p.primary_role,
         r.tier, r.division, r.lp, r.elo_score, r.wins, r.losses,
         coalesce(m.games, 0), coalesce(m.wins, 0), coalesce(m.kills, 0),
         coalesce(m.deaths, 0), coalesce(m.assists, 0), m.lp_net
    from challenge_participants cp
    join players p on p.id = cp.player_id
    left join player_profiles pp on pp.player_id = p.id
    left join lateral (
      select rs.tier, rs.division, rs.lp, rs.elo_score, rs.wins, rs.losses
        from rank_snapshots rs
       where rs.player_id = p.id and rs.queue_type = 'RANKED_SOLO_5x5'
         and rs.recorded_at <= v_end
       order by rs.recorded_at desc limit 1
    ) r on true
    left join lateral (
      select count(*)::int games,
             count(*) filter (where mp.win)::int wins,
             sum(mp.kills)::int kills, sum(mp.deaths)::int deaths, sum(mp.assists)::int assists,
             sum(mp.lp_change)::int lp_net
        from match_participants mp
        join matches mt on mt.match_id = mp.match_id
       where mp.player_id = p.id and mt.queue_id = 420
         and mt.ended_at >= v_ch.starts_at and mt.ended_at <= v_end
    ) m on true
   where cp.challenge_id = v_ch.id;

  select player_id, coalesce(display_name, riot_game_name)
    into v_winner, v_winner_name
    from challenge_results
   where challenge_id = v_ch.id and position = 1 and elo_score is not null;

  update challenges
     set finished_at = now(), ends_at = v_end, winner_player_id = v_winner
   where id = v_ch.id;

  -- Aparece en "Logros recientes" del index.
  if v_winner is not null then
    insert into events (type, icon, player_id, detail)
    values ('reto_ganado', '🏆', v_winner, v_ch.name);
  end if;
end;
$$;
revoke execute on function finish_challenge(bigint) from public, anon, authenticated;

-- Llamada por pg_cron: cierra los retos cuya fecha de fin ya pasó.
create or replace function close_due_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from challenges where finished_at is null and ends_at <= now() order by ends_at loop
    perform finish_challenge(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function close_due_challenges() from public, anon, authenticated;


-- ============================================================
-- Funciones del Admin Dashboard (todas verifican la tabla admins)
-- ============================================================

-- Crear reto con sus participantes.
create or replace function admin_create_challenge(
  p_name text, p_starts_at timestamptz, p_ends_at timestamptz, p_player_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_n integer;
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede crear retos.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 3 and 60 then
    raise exception 'El nombre debe tener entre 3 y 60 caracteres.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'La fecha de fin tiene que ser después de la de inicio.';
  end if;
  if p_ends_at <= now() then
    raise exception 'La fecha de fin ya pasó.';
  end if;
  select count(distinct x) into v_n
    from unnest(coalesce(p_player_ids, '{}')) x
   where exists (select 1 from players p where p.id = x);
  if v_n < 2 then
    raise exception 'Elige al menos 2 participantes.';
  end if;
  -- Un reto a la vez: no se pueden pisar las fechas con otro sin terminar.
  if exists (select 1 from challenges c
              where c.finished_at is null
                and c.starts_at < p_ends_at and p_starts_at < c.ends_at) then
    raise exception 'Las fechas se cruzan con otro reto que todavía no terminó.';
  end if;

  insert into challenges (name, starts_at, ends_at)
  values (trim(p_name), p_starts_at, p_ends_at)
  returning id into v_id;
  insert into challenge_participants (challenge_id, player_id)
  select distinct v_id, x from unnest(p_player_ids) x
   where exists (select 1 from players p where p.id = x);
  return v_id;
end;
$$;

-- Finalizar ahora (antes de la fecha de fin).
create or replace function admin_finish_challenge(p_challenge_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede finalizar retos.';
  end if;
  perform finish_challenge(p_challenge_id);
end;
$$;

-- Borrar un reto que todavía NO terminó (programado o en curso, sin resultados).
create or replace function admin_delete_challenge(p_challenge_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede borrar retos.';
  end if;
  if exists (select 1 from challenges where id = p_challenge_id and finished_at is not null) then
    raise exception 'Un reto terminado no se borra: queda en el salón de la fama.';
  end if;
  delete from challenges where id = p_challenge_id;
end;
$$;

-- Quitar una cuenta del roster. Se borra su historial de la temporada
-- (rangos, partidas, perfil); los retos YA TERMINADOS la conservan
-- porque guardaron su propia copia.
create or replace function admin_remove_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede quitar cuentas.';
  end if;
  if exists (select 1 from challenge_participants cp join challenges c on c.id = cp.challenge_id
              where cp.player_id = p_player_id and c.finished_at is null and c.starts_at <= now()) then
    raise exception 'Está participando en el reto en curso: espera a que termine.';
  end if;
  -- Referencias sin borrado en cascada (badges, feed, estados).
  update weekly_badges set player_id = null where player_id = p_player_id;
  delete from events where player_id = p_player_id;
  update events set previous_player_id = null where previous_player_id = p_player_id;
  update season_king_state set current_top1 = null where current_top1 = p_player_id;
  update daily_first_win_state set player_id = null where player_id = p_player_id;
  delete from players where id = p_player_id;
end;
$$;

revoke execute on function admin_create_challenge(text, timestamptz, timestamptz, uuid[]),
  admin_finish_challenge(bigint), admin_delete_challenge(bigint), admin_remove_player(uuid)
  from public, anon;
grant execute on function admin_create_challenge(text, timestamptz, timestamptz, uuid[]),
  admin_finish_challenge(bigint), admin_delete_challenge(bigint), admin_remove_player(uuid)
  to authenticated;


-- ============================================================
-- Arreglo: la limpieza diaria borraba TODOS los rangos de más de
-- 30 días, incluso el último. Quien no jugaba un mes quedaba como
-- "sin rango" (en el ranking y al cerrar un reto). Ahora siempre
-- se conserva el rango más reciente de cada jugador y cola.
-- ============================================================
create or replace function cleanup_old_history()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rank_snapshots rs
   where rs.recorded_at < now() - interval '30 days'
     and exists (select 1 from rank_snapshots newer
                  where newer.player_id = rs.player_id and newer.queue_type = rs.queue_type
                    and newer.recorded_at > rs.recorded_at);
  delete from matches where ended_at    < now() - interval '30 days';
  delete from events  where occurred_at < now() - interval '30 days';
end;
$$;

-- ============================================================
-- Realtime + cron
-- ============================================================
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['challenges', 'challenge_participants', 'challenge_results']) loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- Cierre automático cada 5 minutos (SQL puro: no llama a ninguna Edge Function).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cerrar-retos';
    perform cron.schedule('cerrar-retos', '*/5 * * * *', 'select public.close_due_challenges()');
  end if;
end $$;
