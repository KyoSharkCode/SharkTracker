-- ============================================================
-- Pantalla de carga (app): caché de la Edge Function pantalla-carga.
--
-- Guarda por un rato lo que ya se le preguntó a Riot, para no repetir
-- peticiones:
--   - carga_partidas: el panel completo de una partida (10 min). Si varios
--     de SharkTracker están en la MISMA partida, el primero lo arma y los
--     demás lo reciben sin gastar nada. "bloqueo" evita que dos lo armen
--     a la vez.
--   - carga_rangos: rango y maestría de cada jugador (30 min), por si te
--     vuelve a tocar alguien de la partida anterior.
--
-- Solo la Edge Function las usa (nadie de fuera las puede leer ni escribir).
-- Orden: correr este SQL, crear la Function pantalla-carga y listo.
-- ============================================================

create table if not exists carga_partidas (
  game_id    bigint primary key,
  datos      jsonb,                         -- panel armado (null mientras se arma)
  completo   boolean not null default false,
  bloqueo    timestamptz,                   -- alguien lo está armando hasta esta hora
  updated_at timestamptz not null default now()
);

create table if not exists carga_rangos (
  puuid      text primary key,
  datos      jsonb not null,                -- { solo, flex, maestria: {championId: [top 3]} }
  updated_at timestamptz not null default now()
);

alter table carga_partidas enable row level security;
alter table carga_rangos   enable row level security;
revoke all on carga_partidas, carga_rangos from anon, authenticated;
grant select, insert, update, delete on carga_partidas, carga_rangos to service_role;

-- Limpieza: lo de más de 1 hora ya no sirve.
create or replace function limpiar_cache_carga()
returns void
language sql
security definer
set search_path = public
as $$
  delete from carga_partidas where updated_at < now() - interval '1 hour';
  delete from carga_rangos   where updated_at < now() - interval '1 hour';
$$;
revoke execute on function limpiar_cache_carga() from public, anon, authenticated;
grant execute on function limpiar_cache_carga() to service_role;

select cron.schedule('limpiar-cache-carga', '23 * * * *', 'select public.limpiar_cache_carga()');
