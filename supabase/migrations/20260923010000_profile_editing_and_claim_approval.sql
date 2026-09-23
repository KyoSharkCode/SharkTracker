-- ============================================================
-- 1) EDICIÓN DEL PERFIL (modo edición de perfil.html)
--
-- Campeón y skin favoritos: los valores que ya están en players
-- (favorite_champion / favorite_skin, cargados a mano) se quedan
-- ahí como "por defecto". Acá se agregan columnas propias en
-- player_profiles que el jugador sí puede editar. Mientras estén en
-- null, las páginas siguen mostrando el valor por defecto de players.
-- No se copia ni se borra nada: no se pierde ningún dato.
-- ============================================================

alter table player_profiles add column if not exists favorite_champion text;
alter table player_profiles add column if not exists favorite_skin integer;

-- Límites de largo (el sitio los respeta, pero acá se hacen cumplir
-- de verdad, así nadie puede saltearlos). Bio de 100 caracteres = 2 líneas.
alter table player_profiles drop constraint if exists player_profiles_display_name_len;
alter table player_profiles add constraint player_profiles_display_name_len
  check (display_name is null or char_length(display_name) <= 20);
alter table player_profiles drop constraint if exists player_profiles_bio_len;
alter table player_profiles add constraint player_profiles_bio_len
  check (bio is null or char_length(bio) <= 100);
alter table player_profiles drop constraint if exists player_profiles_favorite_skin_ok;
alter table player_profiles add constraint player_profiles_favorite_skin_ok
  check (favorite_skin is null or favorite_skin between 0 and 999);
alter table player_profiles drop constraint if exists player_profiles_favorite_champion_ok;
alter table player_profiles add constraint player_profiles_favorite_champion_ok
  check (favorite_champion is null or favorite_champion ~ '^[A-Za-z]{2,30}$');

-- La política "dueno edita su perfil" (init_schema) ya limita a SU
-- fila. Faltaba el permiso de UPDATE, y se da SOLO sobre estas
-- columnas: nadie puede cambiarse player_id, user_id ni twitch_username
-- desde el sitio.
revoke update on player_profiles from authenticated;
grant update (display_name, bio, favorite_champion, favorite_skin) on player_profiles to authenticated;

-- updated_at se pone solo en cada cambio.
create or replace function touch_player_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists player_profiles_touch on player_profiles;
create trigger player_profiles_touch before update on player_profiles
  for each row execute function touch_player_profiles_updated_at();


-- ============================================================
-- 2) VINCULAR CUENTA CON APROBACIÓN MANUAL
--
-- Antes: claim_player() vinculaba al instante a quien escribiera el
-- Riot ID primero. Ahora el jugador envía una SOLICITUD y una
-- administradora (KyoSumi) la aprueba o la rechaza desde login.html.
-- ============================================================

create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table admins enable row level security;
-- Cada quien puede saber si ÉL es admin (para mostrar el panel), nada más.
drop policy if exists "ver si soy admin" on admins;
create policy "ver si soy admin" on admins for select using (auth.uid() = user_id);

-- Primera admin: la cuenta de Discord que ya tiene vinculada a Galactic Shark.
insert into admins (user_id)
select user_id from players
where riot_game_name = 'Galactic Shark' and riot_tag_line = 'AYK' and user_id is not null
on conflict do nothing;

create table if not exists claim_requests (
  id           bigint generated always as identity primary key,
  player_id    uuid not null references players(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  discord_name text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
-- Una sola solicitud pendiente por persona a la vez.
create unique index if not exists claim_requests_one_pending_per_user
  on claim_requests (user_id) where status = 'pending';

alter table claim_requests enable row level security;
drop policy if exists "ver mis solicitudes o todas si soy admin" on claim_requests;
create policy "ver mis solicitudes o todas si soy admin" on claim_requests for select
  using (auth.uid() = user_id or exists (select 1 from admins a where a.user_id = auth.uid()));
revoke all on claim_requests from anon, authenticated;
grant select on claim_requests to authenticated;
grant select, insert, update, delete on claim_requests, admins to service_role;
grant select on admins to authenticated;

-- ── El jugador pide vincular una cuenta del roster ──
create or replace function request_claim(p_game_name text, p_tag_line text)
returns claim_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player players;
  v_req claim_requests;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Tienes que iniciar sesión con Discord primero.';
  end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    raise exception 'Tu Discord ya tiene una cuenta vinculada.';
  end if;

  select * into v_player from players
  where lower(riot_game_name) = lower(p_game_name)
    and lower(riot_tag_line)  = lower(p_tag_line);
  if not found then
    raise exception 'Esa cuenta no está en el roster del reto.';
  end if;
  if v_player.user_id is not null then
    raise exception 'Esa cuenta ya fue vinculada por otra persona.';
  end if;

  select coalesce(
           raw_user_meta_data->'custom_claims'->>'global_name',
           raw_user_meta_data->>'full_name',
           raw_user_meta_data->>'name')
    into v_name from auth.users where id = auth.uid();

  -- Si ya tenía otra solicitud pendiente, se reemplaza por esta.
  delete from claim_requests where user_id = auth.uid() and status = 'pending';

  insert into claim_requests (player_id, user_id, discord_name)
  values (v_player.id, auth.uid(), v_name)
  returning * into v_req;
  return v_req;
end;
$$;
grant execute on function request_claim(text, text) to authenticated;

-- ── Aprobar (solo admins) ──
create or replace function approve_claim(p_request_id bigint)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req claim_requests;
  v_player players;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede aprobar solicitudes.';
  end if;

  select * into v_req from claim_requests where id = p_request_id and status = 'pending' for update;
  if not found then
    raise exception 'Esa solicitud ya no está pendiente.';
  end if;

  select * into v_player from players where id = v_req.player_id for update;
  if v_player.user_id is not null then
    raise exception 'Esa cuenta ya está vinculada a otra persona.';
  end if;
  if exists (select 1 from players where user_id = v_req.user_id) then
    raise exception 'Ese Discord ya tiene otra cuenta vinculada.';
  end if;

  update players set user_id = v_req.user_id where id = v_player.id;

  insert into player_profiles (player_id, user_id, display_name)
  values (v_player.id, v_req.user_id, v_player.riot_game_name)
  on conflict (player_id) do update set user_id = excluded.user_id;

  update claim_requests set status = 'approved', resolved_at = now() where id = v_req.id;
  -- Otras solicitudes pendientes por la MISMA cuenta quedan rechazadas.
  update claim_requests set status = 'rejected', resolved_at = now()
  where player_id = v_player.id and status = 'pending';

  select * into v_player from players where id = v_player.id;
  return v_player;
end;
$$;
grant execute on function approve_claim(bigint) to authenticated;

-- ── Rechazar (solo admins) ──
create or replace function reject_claim(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede rechazar solicitudes.';
  end if;
  update claim_requests set status = 'rejected', resolved_at = now()
  where id = p_request_id and status = 'pending';
end;
$$;
grant execute on function reject_claim(bigint) to authenticated;

-- El vínculo directo sin aprobación queda desactivado desde el sitio.
revoke execute on function claim_player(text, text) from authenticated, anon, public;

-- ============================================================
-- 3) REALTIME — para que el ranking y los perfiles se actualicen
-- solos cuando alguien edita su perfil (apodo, bio, campeón/skin).
-- matches y match_participants se activaron a mano en el dashboard;
-- quedan también registrados acá. Seguro de correr varias veces.
-- ============================================================
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['player_profiles', 'matches', 'match_participants']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
