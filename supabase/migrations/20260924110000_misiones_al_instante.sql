-- ============================================================
-- Misiones y 🦷 al instante: en cuanto sync-matches guarda una
-- partida nueva, se recalculan las misiones y las recompensas en la
-- misma operación (sin esperar al reloj de cada 5 minutos).
--
-- · Un candado (advisory lock) hace que el reloj y las partidas nuevas
--   nunca calculen a la vez (así no se duplican avisos ni dientes).
-- · Si el recálculo fallara, NO bloquea el guardado de la partida:
--   solo deja un aviso en el log y el reloj lo recupera después.
-- · El reloj queda como respaldo, en un solo job cada 5 minutos.
-- ============================================================

create or replace function recalc_missions_rewards()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('sharktracker_recalc'));
  perform compute_missions();
  perform compute_rewards();
end;
$$;

create or replace function trg_recalc_after_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform recalc_missions_rewards();
  exception when others then
    raise warning 'Recalculo de misiones tras partida nueva fallo: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists match_participants_recalc on match_participants;
create trigger match_participants_recalc after insert on match_participants
  for each statement execute function trg_recalc_after_match();

revoke execute on function recalc_missions_rewards(), trg_recalc_after_match() from public, anon, authenticated;

-- ── Reloj de respaldo: un solo job que usa el mismo candado ──
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('misiones-semanales', 'recompensas', 'misiones-recompensas');
    perform cron.schedule('misiones-recompensas', '*/5 * * * *', 'select public.recalc_missions_rewards()');
  end if;
end $$;
