-- ============================================================
-- Cron: una sola tarea ("tareas-programadas") que reparte todo.
--
-- Esta migración NO cambia nada en la base real. Deja por escrito
-- cómo está programado el cron en producción, que se había armado
-- a mano en Supabase y no figuraba en el repositorio.
--
-- Antes había una tarea de pg_cron por cada cosa (una por Edge
-- Function, otra para las insignias, otra para Discord, etc.).
-- Ahora hay una sola, "tareas-programadas", que corre cada minuto
-- y llama a public.tareas_programadas(). Esa función mira el minuto
-- del reloj y decide qué toca:
--
--   cada minuto       sync-live-status, sync-twitch-status y avisos
--                     de Discord (discord_tick)
--   cada minuto (*)   sync-riot-data
--   cada 3 min (*)    sync-matches
--   cada 3 min        insignias y Rey de la Temporada
--   cada 5 min        cierre de retos, misiones y recompensas
--   cada 10 min       referencias-elo
--
--   (*) Solo mientras hay actividad: alguien en partida, o con
--       cambios en live_status en los últimos 30 minutos. Sin
--       actividad bajan a una vez cada 15 minutos.
--
-- Qué contiene este archivo:
--   1) hay_partidas_recientes(): dice si hay actividad;
--   2) llamar_edge_function(nombre): llama a una Edge Function con
--      el secreto del cron;
--   3) tareas_programadas(): el reparto de arriba;
--   4) los permisos de esas tres funciones (solo el cron);
--   5) la tarea "tareas-programadas" y la baja de las tareas
--      antiguas a las que reemplaza.
--
-- Las tareas que no pasan por tareas_programadas() quedan como
-- estaban: cleanup-old-history, limpiar-referencias-elo,
-- limpiar-cache-carga, meta-tier-cada-6h y limpiar-historial-cron.
--
-- El secreto NO se escribe acá: se lee de Vault por su nombre
-- (CRON_SECRET), igual que en 20260922000000_cron_edge_functions.sql.
--
-- Refleja la base real al 18/11/2026, cuando tareas_programadas()
-- todavía llama a sync-twitch-status. Esa llamada la quita
-- 20261118000000_quitar_twitch.sql, que va después de este archivo.
-- Si quitar_twitch ya se ejecutó, no hace falta ejecutar este (y
-- volvería a poner la llamada a sync-twitch-status).
--
-- Se puede ejecutar más de una vez.
-- ============================================================

begin;

-- ── 1) ¿Hay actividad? ───────────────────────────────────────
-- Verdadero si alguien está en partida o si live_status cambió en
-- los últimos 30 minutos.
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


-- ── 2) Llamar a una Edge Function ────────────────────────────
-- Manda el secreto del cron en el encabezado x-cron-secret. La
-- llamada no espera la respuesta (pg_net la envía en segundo plano).
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


-- ── 3) El reparto ────────────────────────────────────────────
-- Cada bloque tiene su propio "exception": si una tarea falla, deja
-- un aviso en el registro y las demás siguen.
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


-- ── 4) Permisos ──────────────────────────────────────────────
-- Solo las usa el cron, que corre como el dueño de la base
-- (postgres), así que no necesitan ningún permiso extra. Se les
-- quita a todos los demás: nadie puede llamarlas desde la web ni
-- con la anon key.
revoke execute on function public.hay_partidas_recientes(),
                           public.llamar_edge_function(text),
                           public.tareas_programadas()
  from public, anon, authenticated, service_role;


-- ── 5) Cron ──────────────────────────────────────────────────
-- La tarea única. (cron.schedule con un nombre que ya existe la
-- actualiza en vez de duplicarla.)
select cron.schedule(
  'tareas-programadas',
  '* * * * *',
  'select public.tareas_programadas()'
);

-- Tareas antiguas, una por cada cosa: ahora las reparte
-- tareas_programadas(). Se dan de baja si todavía existen.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'sync-riot-data-minutely',      -- 20260922000000_cron_edge_functions.sql
  'sync-matches-every-3min',
  'sync-live-status-minutely',
  'sync-twitch-status-minutely',
  'compute-all-badges',           -- 20260921000000_init_schema.sql
  'cerrar-retos',                 -- 20260924000000_retos_y_roster.sql
  'discord',                      -- 20260924070000_discord_notificaciones.sql
  'misiones-recompensas',         -- 20260924110000_misiones_al_instante.sql
  'referencias-elo-cada-10min'    -- 20260929020000_referencias_elo_cron_secret.sql
);

commit;

-- Comprobación: las tareas que quedan programadas. Deberían ser 6:
-- cleanup-old-history, limpiar-cache-carga, limpiar-historial-cron,
-- limpiar-referencias-elo, meta-tier-cada-6h y tareas-programadas.
select jobname, schedule, active
from cron.job
order by jobname;
