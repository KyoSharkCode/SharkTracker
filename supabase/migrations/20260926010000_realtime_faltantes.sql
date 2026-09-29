-- ============================================================
-- Realtime: dar de alta las tablas que las páginas ya escuchan pero
-- que nunca se habían agregado a la publicación supabase_realtime
-- (sin esto, esas secciones no se actualizaban solas):
--   - live_games            → página En vivo (lobby, baneos)
--   - player_masteries      → perfil (maestrías)
--   - daily_first_win_state → perfil (primera victoria del día)
--
-- Las tres ya tienen lectura pública por RLS y se escriben poco
-- (solo cuando cambian), así que no generan tráfico de más.
-- Es seguro correrlo más de una vez.
-- ============================================================
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['live_games', 'player_masteries', 'daily_first_win_state']) loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
