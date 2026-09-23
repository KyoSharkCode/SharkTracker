-- ============================================================
-- Consejo de IA del perfil (perfil.html → botón "IA").
-- Una fila por jugador. Se regenera SOLO si el jugador tiene una
-- partida de SoloQ más nueva que la usada la última vez
-- (last_match_id) — así no se gasta cuota de Gemini en cada click.
-- La escribe únicamente la Edge Function generate-profile-advice
-- (service_role); el sitio solo la lee.
-- ============================================================

create table if not exists profile_ai_advice (
  player_id     uuid primary key references players(id) on delete cascade,
  advice        jsonb not null,
  last_match_id text,
  generated_at  timestamptz not null default now()
);

alter table profile_ai_advice enable row level security;
drop policy if exists "lectura publica" on profile_ai_advice;
create policy "lectura publica" on profile_ai_advice for select using (true);
grant select on profile_ai_advice to anon, authenticated;
grant select, insert, update, delete on profile_ai_advice to service_role;
