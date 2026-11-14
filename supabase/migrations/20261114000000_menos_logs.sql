-- ============================================================
-- Menos logs: agrupar las tareas programadas y no sincronizar con
-- Riot cuando nadie está jugando.
--
-- Cada ejecución de pg_cron y cada llamada a una Edge Function deja
-- varias líneas en los logs de Supabase (Postgres, API y Functions),
-- y cada consulta que hace una Edge Function a la base deja otra más.
-- Antes había unas 7.500 ejecuciones al día, a cualquier hora, y eso
-- superaba el 1 GB de "Log Ingestion" del plan gratis.
--
-- Cambios:
--   1. Un solo job por minuto ('tareas-programadas') sustituye a los
--      que ya existían cada minuto, cada 3, cada 5 y cada 10 minutos.
--      Las tareas son las mismas y con la misma frecuencia, salvo:
--   2. sync-riot-data y sync-matches van a su ritmo normal (1 y 3 min)
--      solo si alguien está en partida o terminó una hace menos de
--      30 minutos. Si no, van cada 15 minutos (el rango y el historial
--      solo cambian al jugar).
--   3. Cada tarea va en su propio bloque: si una falla, las demás
--      siguen ejecutándose (igual que cuando eran jobs separados).
--
-- No cambia: sync-live-status y sync-twitch-status (cada minuto),
-- discord (cada minuto), badges (cada 3 min), retos y misiones (cada
-- 5 min), referencias-elo (cada 10 min) y los jobs diarios / cada hora
-- / meta-tier, que siguen como estaban.
--
-- Se puede ejecutar más de una vez.
-- ============================================================
create extension if not exists pg_net;

-- ── ¿Alguien jugando o con una partida recién terminada? ──
-- live_status.updated_at se escribe al empezar y al terminar cada partida.
create or replace function public.hay_partidas_recientes()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.live_status
    where in_game or updated_at > now() - interval '30 minutes'
  );
$$;

-- ── Llamada a una Edge Function con el secreto del cron ──
create or replace function public.llamar_edge_function(nombre text)
returns void
language plpgsql
as $$
begin
  perform net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/' || nombre,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- ── El job único: decide qué toca en este minuto ──
create or replace function public.tareas_programadas()
returns void
language plpgsql
as $$
declare
  minuto int := extract(minute from now())::int;
  activo boolean := public.hay_partidas_recientes();
begin
  -- Cada minuto
  begin perform public.llamar_edge_function('sync-live-status');
  exception when others then raise warning 'tareas_programadas: sync-live-status: %', sqlerrm; end;

  begin perform public.llamar_edge_function('sync-twitch-status');
  exception when others then raise warning 'tareas_programadas: sync-twitch-status: %', sqlerrm; end;

  begin perform public.discord_tick();
  exception when others then raise warning 'tareas_programadas: discord: %', sqlerrm; end;

  -- Rango y LP: cada minuto si hay actividad; si no, cada 15 min.
  -- (Las maestrías se piden en los minutos 0 y 30, que siempre entran.)
  if activo or minuto % 15 = 0 then
    begin perform public.llamar_edge_function('sync-riot-data');
    exception when others then raise warning 'tareas_programadas: sync-riot-data: %', sqlerrm; end;
  end if;

  -- Cada 3 minutos
  if minuto % 3 = 0 then
    -- Historial de partidas: cada 3 min si hay actividad; si no, cada 15.
    if activo or minuto % 15 = 0 then
      begin perform public.llamar_edge_function('sync-matches');
      exception when others then raise warning 'tareas_programadas: sync-matches: %', sqlerrm; end;
    end if;

    begin
      perform public.compute_recent_badges();
      perform public.compute_weekly_badges();
      perform public.compute_season_king();
    exception when others then raise warning 'tareas_programadas: badges: %', sqlerrm; end;
  end if;

  -- Cada 5 minutos
  if minuto % 5 = 0 then
    begin perform public.close_due_challenges();
    exception when others then raise warning 'tareas_programadas: cerrar-retos: %', sqlerrm; end;

    begin perform public.recalc_missions_rewards();
    exception when others then raise warning 'tareas_programadas: misiones-recompensas: %', sqlerrm; end;
  end if;

  -- Cada 10 minutos
  if minuto % 10 = 0 then
    begin perform public.llamar_edge_function('referencias-elo');
    exception when others then raise warning 'tareas_programadas: referencias-elo: %', sqlerrm; end;
  end if;
end;
$$;

revoke execute on function public.hay_partidas_recientes(), public.llamar_edge_function(text), public.tareas_programadas()
  from public, anon, authenticated;

-- ── Sustituir los jobs antiguos por el nuevo ──
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in (
      'sync-riot-data-minutely',
      'sync-matches-every-3min',
      'sync-live-status-minutely',
      'sync-twitch-status-minutely',
      'discord',
      'compute-all-badges',
      'cerrar-retos',
      'misiones-recompensas',
      'referencias-elo-cada-10min'
    );
    perform cron.schedule('tareas-programadas', '* * * * *', 'select public.tareas_programadas()');
  end if;
end $$;

-- Comprobación: deberían quedar 'tareas-programadas' más los jobs
-- diarios / cada hora / cada 6 h (limpiezas y meta-tier).
select jobname, schedule from cron.job order by jobname;
