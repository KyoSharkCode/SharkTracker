-- ============================================================
-- Twitch verificado + funciones del Admin Dashboard
--
-- Requiere haber corrido antes 20260923010000_profile_editing_and_claim_approval.sql
-- (tablas admins y claim_requests).
-- ============================================================

-- Para poder DESVINCULAR una cuenta (admin) sin borrar la fila del perfil.
alter table player_profiles alter column user_id drop not null;


-- ============================================================
-- 1) TWITCH CON LOGIN (verificado)
--
-- "Mi Twitch" en el menú conecta la cuenta de Twitch a la sesión de
-- Discord (Supabase: linkIdentity). Al volver, el sitio llama a
-- link_my_twitch(), que lee el usuario DIRECTO de la identidad de
-- Twitch guardada por Supabase (auth.identities) — nunca de lo que
-- mande el navegador — y lo guarda en player_profiles.twitch_username,
-- que es lo que ya usa sync-twitch-status.
-- ============================================================
create or replace function link_my_twitch()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid;
  v_login  text;
begin
  if auth.uid() is null then
    raise exception 'Tienes que iniciar sesión.';
  end if;
  select id into v_player from players where user_id = auth.uid();
  if v_player is null then
    raise exception 'Tu cuenta de LoL todavía no está vinculada.';
  end if;

  -- Supabase guarda el login de Twitch en identity_data->>'name'.
  select lower(coalesce(identity_data->>'name', identity_data->>'full_name'))
    into v_login
    from auth.identities
   where user_id = auth.uid() and provider = 'twitch'
   order by updated_at desc nulls last
   limit 1;
  if v_login is null then
    raise exception 'No hay ninguna cuenta de Twitch conectada.';
  end if;
  if v_login !~ '^[a-z0-9_]{3,25}$' then
    raise exception 'Twitch devolvió un usuario inválido.';
  end if;

  -- Es SU Twitch (verificado): si otro perfil lo tenía cargado a mano, se le quita.
  update player_profiles set twitch_username = null
   where lower(twitch_username) = v_login and player_id <> v_player;
  update player_profiles set twitch_username = v_login where player_id = v_player;
  return v_login;
end;
$$;
grant execute on function link_my_twitch() to authenticated;

create or replace function unlink_my_twitch()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid;
begin
  select id into v_player from players where user_id = auth.uid();
  if v_player is null then
    raise exception 'Tu cuenta de LoL todavía no está vinculada.';
  end if;
  update player_profiles set twitch_username = null where player_id = v_player;
  -- Sin Twitch, sync-twitch-status deja de mirarlo: se apaga el "en vivo" a mano.
  update stream_status set is_live = false where player_id = v_player;
end;
$$;
grant execute on function unlink_my_twitch() to authenticated;


-- ============================================================
-- 2) ADMIN DASHBOARD (admin.html)
-- Todas verifican que quien llama esté en la tabla admins.
-- ============================================================

-- Lista de jugadores con su vínculo. El nombre de Discord vive en
-- auth.users (privado), por eso sale solo por acá y solo para admins.
create or replace function admin_list_players()
returns table (
  player_id uuid, riot_game_name text, riot_tag_line text, icon_id integer,
  user_id uuid, discord_name text, twitch_username text, twitch_verified boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede ver esto.';
  end if;
  return query
  select p.id, p.riot_game_name, p.riot_tag_line, p.icon_id, p.user_id,
         coalesce(u.raw_user_meta_data->'custom_claims'->>'global_name',
                  u.raw_user_meta_data->>'full_name',
                  u.raw_user_meta_data->>'name')::text,
         pp.twitch_username,
         exists (select 1 from auth.identities i
                  where i.user_id = p.user_id and i.provider = 'twitch'
                    and lower(i.identity_data->>'name') = lower(pp.twitch_username))
  from players p
  left join player_profiles pp on pp.player_id = p.id
  left join auth.users u on u.id = p.user_id
  order by p.riot_game_name;
end;
$$;
grant execute on function admin_list_players() to authenticated;

-- Desvincular: la cuenta de LoL queda libre para una nueva solicitud.
-- Se borra lo personal (apodo, bio, campeón elegido, Twitch) para que
-- quien la vincule después no herede lo de otra persona. El campeón por
-- defecto de players no se toca.
create or replace function admin_unlink_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede desvincular cuentas.';
  end if;
  update players set user_id = null where id = p_player_id;
  update player_profiles pp
     set user_id = null, display_name = p.riot_game_name, bio = null,
         favorite_champion = null, favorite_skin = null, twitch_username = null
    from players p
   where pp.player_id = p_player_id and p.id = p_player_id;
  update stream_status set is_live = false where player_id = p_player_id;
end;
$$;
grant execute on function admin_unlink_player(uuid) to authenticated;

-- Corregir o quitar el Twitch de alguien a mano (null o '' = quitar).
create or replace function admin_set_twitch(p_player_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_login text := nullif(lower(trim(p_username)), '');
begin
  if not exists (select 1 from admins a where a.user_id = auth.uid()) then
    raise exception 'Solo una administradora puede cambiar esto.';
  end if;
  if v_login is not null and v_login !~ '^[a-z0-9_]{3,25}$' then
    raise exception 'Usuario de Twitch inválido (3 a 25 letras, números o _).';
  end if;
  if not exists (select 1 from player_profiles where player_id = p_player_id) then
    raise exception 'Ese jugador todavía no tiene perfil (nadie lo vinculó).';
  end if;
  update player_profiles set twitch_username = v_login where player_id = p_player_id;
  if v_login is null then
    update stream_status set is_live = false where player_id = p_player_id;
  end if;
end;
$$;
grant execute on function admin_set_twitch(uuid, text) to authenticated;

-- Para que el contador de solicitudes del menú se actualice solo.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'claim_requests') then
    alter publication supabase_realtime add table public.claim_requests;
  end if;
end $$;

-- Solo usuarios con sesión pueden llamar a estas funciones (no anon).
revoke execute on function link_my_twitch(), unlink_my_twitch(), admin_list_players(),
  admin_unlink_player(uuid), admin_set_twitch(uuid, text) from public, anon;
grant execute on function link_my_twitch(), unlink_my_twitch(), admin_list_players(),
  admin_unlink_player(uuid), admin_set_twitch(uuid, text) to authenticated;
