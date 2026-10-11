-- ============================================================
-- Pickems: Play-In de Worlds 2026
--
-- Cuatro equipos, doble eliminación, todo al mejor de 5 (15–18 de octubre,
-- Los Ángeles). El ganador de la gran final pasa a la fase suiza.
-- Los Pickems cierran el 15/10 a las 6:00 (hora de España).
--
--   Cuadro superior:  Ronda 1 (x2) → Final de ganadores → Gran final
--   Cuadro inferior:  Semifinal (perdedores de la ronda 1)
--                     → Final (perdedor de la final de ganadores vs ganador de la semifinal)
--                     → Gran final
--
-- Las horas se dejan vacías hasta que Riot confirme el horario; la gran final
-- tiene apuestas. Solo se carga si todavía no existe el evento.
-- ============================================================
do $$
declare v_ev bigint; r1a bigint; r1b bigint; wf bigint; ls bigint; lf bigint;
begin
  if exists (select 1 from pickem_events where name = 'Worlds 2026 · Play-In') then return; end if;
  insert into pickem_events (name, locks_at)
  values ('Worlds 2026 · Play-In', timestamp '2026-10-15 06:00' at time zone 'Europe/Madrid') returning id into v_ev;

  insert into pickem_matches (event_id, label, bracket, col, sort, team1, team2, points)
  values (v_ev, 'Ronda 1', 'superior', 1, 1, 'FURIA', 'MVK Esports', 10) returning id into r1a;
  insert into pickem_matches (event_id, label, bracket, col, sort, team1, team2, points)
  values (v_ev, 'Ronda 1', 'superior', 1, 2, 'Cloud9 Kia', 'Karmine Corp', 10) returning id into r1b;
  insert into pickem_matches (event_id, label, bracket, col, sort, src1_match, src1_win, src2_match, src2_win, points)
  values (v_ev, 'Final de ganadores', 'superior', 2, 3, r1a, true, r1b, true, 15) returning id into wf;
  insert into pickem_matches (event_id, label, bracket, col, sort, src1_match, src1_win, src2_match, src2_win, points)
  values (v_ev, 'Semifinal inferior', 'inferior', 1, 4, r1a, false, r1b, false, 15) returning id into ls;
  insert into pickem_matches (event_id, label, bracket, col, sort, src1_match, src1_win, src2_match, src2_win, points)
  values (v_ev, 'Final inferior', 'inferior', 2, 5, wf, false, ls, true, 20) returning id into lf;
  insert into pickem_matches (event_id, label, bracket, col, sort, src1_match, src1_win, src2_match, src2_win, points, bets_enabled)
  values (v_ev, 'Gran final', 'superior', 3, 6, wf, true, lf, true, 30, true);
end $$;
