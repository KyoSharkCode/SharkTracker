-- ============================================================
-- Arreglo: "UPDATE requires a WHERE clause" al pulsar Activar/Reiniciar.
-- Supabase bloquea UPDATE/DELETE sin WHERE en llamadas desde la web
-- (pg_safeupdate). Se redefinen las dos funciones con su WHERE.
-- ============================================================

create or replace function admin_set_missions_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede cambiar esto.';
  end if;
  update mission_settings set enabled = p_enabled,
         enabled_at = case when p_enabled and not enabled then now() else enabled_at end
   where singleton;
  if p_enabled then perform compute_missions(); end if;
end;
$$;

-- Reiniciar TODO lo de misiones (para empezar de cero en el lanzamiento).
create or replace function admin_reset_missions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Solo una administradora puede reiniciar las misiones.';
  end if;
  -- "where true": Supabase bloquea UPDATE/DELETE sin WHERE (pg_safeupdate).
  delete from mission_weeks where true;          -- borra también player_missions (cascade)
  delete from reroll_grants where true;
  delete from player_rerolls where true;
  delete from events where type in ('mision_completada', 'mision_grupal', 'reroll_ganado');
  update mission_settings set enabled = false, enabled_at = null where singleton;
end;
$$;
