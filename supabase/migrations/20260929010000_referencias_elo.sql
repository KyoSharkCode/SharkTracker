-- ============================================================
-- Referencias por elo para "Tu rendimiento" (overlay de la app).
--
-- La Edge Function referencias-elo toma cada 10 min unas pocas
-- partidas de SoloQ de jugadores de LAN de cada división y suma aquí
-- sus números por división + rol + día. No se guardan partidas ni
-- jugadores: solo sumas, así que la tabla se queda en unos cientos de
-- filas.
--
-- Rotación: solo cuentan los últimos 14 días (≈ un parche). Lo más
-- viejo se borra cada madrugada.
--
-- Orden: correr este SQL, crear la Function referencias-elo y listo
-- (el cron de abajo la empieza a llamar solo).
-- ============================================================

-- ── 1) Sumas por división, rol y día ─────────────────────────
-- tier: BRONZE … DIAMOND, y MASTER (= Master, Grandmaster y Challenger juntos).
-- rol: el teamPosition de Riot (TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY).
-- dia: día (UTC) en que terminó la partida.
create table if not exists elo_referencias (
  tier     text    not null,
  rol      text    not null,
  dia      date    not null,
  muestras integer not null default 0,   -- jugadores sumados
  minutos  numeric not null default 0,
  cs       bigint  not null default 0,
  oro      bigint  not null default 0,   -- oro ganado (goldEarned)
  vision   bigint  not null default 0,   -- puntuación de visión
  kp       numeric not null default 0,   -- suma de participaciones en kills (0–1)
  primary key (tier, rol, dia)
);

-- Partidas ya sumadas (para no contar dos veces la misma).
create table if not exists elo_referencias_partidas (
  match_id text primary key,
  dia      date not null
);

alter table elo_referencias          enable row level security;
alter table elo_referencias_partidas enable row level security;
-- Las sumas son públicas (no hay datos de nadie); la lista de partidas no hace falta leerla fuera.
drop policy if exists "lectura publica" on elo_referencias;
create policy "lectura publica" on elo_referencias for select using (true);

-- ── 2) Promedios listos para la app (últimos 14 días) ────────
create or replace view elo_referencias_promedio with (security_invoker = true) as
  select tier,
         rol,
         sum(muestras)::integer                               as muestras,
         round(sum(cs)     / nullif(sum(minutos), 0), 2)      as cs_min,
         round(sum(oro)    / nullif(sum(minutos), 0), 0)      as oro_min,
         round(sum(vision) / nullif(sum(minutos), 0), 3)      as vision_min,
         round(sum(kp)     / nullif(sum(muestras), 0), 3)     as kp
    from elo_referencias
   where dia > current_date - 14
   group by tier, rol;

grant select on elo_referencias_promedio to anon, authenticated, service_role;

-- ── 3) Sumar una partida (lo llama la Edge Function) ─────────
-- Todo o nada: si la partida ya estaba, no suma nada y devuelve false.
-- p_filas: [{tier, rol, minutos, cs, oro, vision, kp}, …] (los 10 jugadores).
create or replace function registrar_partida_referencia(p_match_id text, p_dia date, p_filas jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  nuevas integer;
begin
  insert into elo_referencias_partidas (match_id, dia) values (p_match_id, p_dia)
  on conflict (match_id) do nothing;
  get diagnostics nuevas = row_count;
  if nuevas = 0 then return false; end if;

  insert into elo_referencias as r (tier, rol, dia, muestras, minutos, cs, oro, vision, kp)
  select f.tier, f.rol, p_dia, count(*), sum(f.minutos), sum(f.cs), sum(f.oro), sum(f.vision), sum(f.kp)
    from jsonb_to_recordset(p_filas) as f(tier text, rol text, minutos numeric, cs integer, oro integer, vision integer, kp numeric)
   group by f.tier, f.rol
  on conflict (tier, rol, dia) do update set
    muestras = r.muestras + excluded.muestras,
    minutos  = r.minutos  + excluded.minutos,
    cs       = r.cs       + excluded.cs,
    oro      = r.oro      + excluded.oro,
    vision   = r.vision   + excluded.vision,
    kp       = r.kp       + excluded.kp;
  return true;
end;
$$;

-- ── 4) Rotación: borrar lo que tenga más de 14 días ──────────
create or replace function limpiar_referencias_elo()
returns void
language sql
security definer
set search_path = public
as $$
  delete from elo_referencias          where dia <= current_date - 14;
  delete from elo_referencias_partidas where dia <= current_date - 14;
$$;

-- Solo para la Edge Function y el cron (nadie de fuera puede sumar ni borrar).
revoke execute on function registrar_partida_referencia(text, date, jsonb), limpiar_referencias_elo()
  from public, anon, authenticated;
grant execute on function registrar_partida_referencia(text, date, jsonb), limpiar_referencias_elo()
  to service_role;

-- ── 5) Cron ──────────────────────────────────────────────────
-- Recolector cada 10 min (pocas llamadas a Riot por vez, para no
-- quitarle cupo de la key al resto de SharkTracker).
select cron.schedule(
  'referencias-elo-cada-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/referencias-elo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Limpieza diaria (04:17 UTC).
select cron.schedule('limpiar-referencias-elo', '17 4 * * *', 'select public.limpiar_referencias_elo()');
