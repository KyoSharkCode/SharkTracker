-- ============================================================
-- Seguridad: cerrar funciones internas que se podían llamar desde
-- fuera sin iniciar sesión (con la anon key pública).
--
-- Estas 4 funciones solo las usan los cron jobs (que corren como
-- el dueño de la base, así que siguen funcionando igual). Al resto
-- de funciones internas ya se les había quitado este permiso; a
-- estas se les había olvidado.
-- ============================================================
revoke execute on function cleanup_old_history(),
                           compute_recent_badges(),
                           compute_weekly_badges(),
                           compute_season_king()
  from public, anon, authenticated;

grant execute on function cleanup_old_history(),
                          compute_recent_badges(),
                          compute_weekly_badges(),
                          compute_season_king()
  to service_role;
