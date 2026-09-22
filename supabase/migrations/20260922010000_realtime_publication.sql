-- ============================================================
-- Asegura que Realtime esté activado para las tablas que el
-- frontend escucha en vivo (canal 'sharktracker-live' en index.html).
--
-- Por qué esto va en una migración y no se deja como un check
-- manual en el dashboard: "Database > Replication" es un switch
-- que se activa a mano, tabla por tabla, y no queda registrado en
-- ningún archivo del repo. Si algún día se recrea el proyecto de
-- Supabase, se restaura desde un backup, o simplemente nadie
-- recuerda haberlo activado, no hay forma de saber desde el código
-- si el switch está prendido o apagado — es el mismo problema que
-- tuvimos con el secreto del cron. Esta migración lo deja
-- garantizado en SQL versionado: sin importar el estado actual del
-- switch en el dashboard, después de correr esto, Realtime va a
-- estar activo para estas tablas sí o sí.
--
-- Es segura de correr más de una vez (no falla si la tabla ya
-- estaba agregada a la publicación).
-- ============================================================
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array[
    'players',
    'rank_snapshots',
    'live_status',
    'stream_status',
    'weekly_badges',
    'events'
  ]) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
