-- ============================================================
-- PÁGINA DE PARTIDA (partidas.html)
--
-- match_details: el detalle COMPLETO de una partida (los 10 jugadores,
-- objetos, runas, hechizos, baneos, stats) + el timeline recortado
-- (oro por minuto y objetivos) para la gráfica de oro. Lo llena la
-- Edge Function "partida" la PRIMERA vez que alguien abre la partida;
-- después se lee directo de acá, sin volver a pedirle nada a Riot.
--
-- match_ai: análisis de IA de UN jugador del roster en UNA partida.
-- Se genera solo cuando alguien lo pide y queda guardado para siempre
-- (una partida ya jugada nunca cambia).
--
-- Ninguna de las dos se borra con la limpieza de 30 días.
-- ============================================================

create table if not exists match_details (
  match_id   text primary key,
  data       jsonb not null,
  timeline   jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists match_ai (
  match_id   text not null references match_details(match_id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  analysis   jsonb not null,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

alter table match_details enable row level security;
alter table match_ai      enable row level security;
drop policy if exists "lectura publica" on match_details;
drop policy if exists "lectura publica" on match_ai;
create policy "lectura publica" on match_details for select using (true);
create policy "lectura publica" on match_ai      for select using (true);
-- Escritura SOLO desde la Edge Function (service_role).
revoke all on match_details, match_ai from anon, authenticated;
grant select on match_details, match_ai to anon, authenticated;
grant select, insert, update, delete on match_details, match_ai to service_role;
