-- ============================================================
-- Caché de Data Dragon (versión + campeones). Estaba en el esquema
-- inicial pero nunca se creó en producción. sync-riot-data y
-- sync-live-status ya la usan: con la tabla, dejan de descargar el
-- JSON completo de campeones en cada corrida (solo cuando Riot saca
-- parche nuevo). Discord también toma de aquí la versión de los iconos.
-- ============================================================
create table if not exists ddragon_cache (
  id         boolean primary key default true,
  version    text not null,
  champions  jsonb not null,
  updated_at timestamptz not null default now(),
  constraint ddragon_cache_es_singleton check (id)
);
alter table ddragon_cache enable row level security;
revoke all on ddragon_cache from anon, authenticated;
grant select, insert, update on ddragon_cache to service_role;
