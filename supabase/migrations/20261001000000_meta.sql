-- ============================================================
-- "Meta" de la app de escritorio (tier list, builds, runas, counters).
--
-- Los datos vienen del MCP público de OP.GG, nunca los pide la app:
--  - meta-tier (cron cada 6 h): tier list de los 5 roles → meta_tier.
--  - meta (la llama la app): ficha de un campeón en un rol (build, runas,
--    hechizos, habilidades, counters) en Esmeralda+ → meta_campeon, que
--    hace de caché (24 h o hasta que cambie el parche).
--
-- Orden: correr este SQL, crear las Functions meta-tier (Verify JWT
-- APAGADO) y meta (Verify JWT encendido). El cron de abajo empieza a
-- llamar a meta-tier solo; para no esperar 6 h, se puede probar con
-- "Test" en meta-tier añadiendo la cabecera x-cron-secret.
-- ============================================================

-- ── 1) Tier list por rol ─────────────────────────────────────
-- posicion: top / jungle / mid / adc / support (como OP.GG).
-- champion_id: id numérico de Riot (el "key" de DDragon).
-- tier: 1 = OP … 5 = débil. rank: puesto en el rol ahora; rank_prev_patch:
-- puesto en el parche anterior (para las tendencias).
create table if not exists meta_tier (
  posicion        text     not null,
  champion_id     integer  not null,
  campeon         text     not null,            -- nombre en inglés que manda OP.GG
  tier            smallint,
  rank            smallint,
  rank_prev       smallint,
  rank_prev_patch smallint,
  partidas        integer,
  victorias       integer,
  pick_rate       numeric,
  ban_rate        numeric,
  role_rate       numeric,                      -- cuánto se juega en este rol (0–1)
  kda             numeric,
  is_rip          boolean  not null default false,
  actualizado     timestamptz not null default now(),
  primary key (posicion, champion_id)
);

-- ── 2) Ficha de cada campeón (caché) ─────────────────────────
create table if not exists meta_campeon (
  champion_id integer not null,
  posicion    text    not null,
  elo         text    not null,                 -- emerald_plus
  parche      text,
  datos       jsonb   not null,
  actualizado timestamptz not null default now(),
  primary key (champion_id, posicion, elo)
);

-- ── 3) Estado: parche y última actualización de la tier list ──
create table if not exists meta_estado (
  id          smallint primary key default 1 check (id = 1),
  parche      text,
  actualizado timestamptz,
  error       text
);
insert into meta_estado (id) values (1) on conflict (id) do nothing;

-- Lectura para quien inicia sesión (no hay datos de nadie); solo las Functions escriben.
alter table meta_tier    enable row level security;
alter table meta_campeon enable row level security;
alter table meta_estado  enable row level security;
drop policy if exists "lectura con sesion" on meta_tier;
drop policy if exists "lectura con sesion" on meta_campeon;
drop policy if exists "lectura con sesion" on meta_estado;
create policy "lectura con sesion" on meta_tier    for select to authenticated using (true);
create policy "lectura con sesion" on meta_campeon for select to authenticated using (true);
create policy "lectura con sesion" on meta_estado  for select to authenticated using (true);

-- ── 4) Cron: tier list cada 6 h (minuto 17 para no chocar con los demás) ──
select cron.schedule(
  'meta-tier-cada-6h',
  '17 */6 * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/meta-tier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
