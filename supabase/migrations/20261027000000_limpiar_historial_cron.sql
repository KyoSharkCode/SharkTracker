-- ============================================================
-- Limpieza del historial de pg_cron.
--
-- pg_cron guarda una fila en cron.job_run_details por cada ejecución
-- de cada tarea programada (unas 7.200 al día en este proyecto) y no
-- borra nunca las antiguas. En un mes había llegado a 178 MB, casi
-- el 80 % de la base de datos.
--
-- Esta migración borra lo que tenga más de 7 días y programa una
-- tarea diaria que lo mantiene así. Solo es el registro de las
-- ejecuciones: las tareas y los datos de la web no cambian.
-- Se puede ejecutar más de una vez.
-- ============================================================

-- Tarea diaria (cron.schedule con un nombre que ya existe la actualiza).
select cron.schedule(
  'limpiar-historial-cron',
  '41 3 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '7 days'$$
);

-- Limpieza inicial de lo acumulado.
delete from cron.job_run_details where start_time < now() - interval '7 days';

-- Comprobación: debería quedar ~7 días de historial.
select count(*) as ejecuciones_guardadas, min(start_time) as desde
from cron.job_run_details;
