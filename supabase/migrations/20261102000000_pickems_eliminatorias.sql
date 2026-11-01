-- ============================================================
-- Pickems · Worlds 2026 · Eliminatorias.
--
-- Mismo sistema que el Play-In (bracket, solo ganador, el equipo
-- avanza solo), con los puntos del Pick'Em de Riot:
--   Cuartos de final +10 · Semifinales +20 · Final +80  (máximo 160)
-- Pleno = Skin Definitiva. Apuesta con bote compartido en la final
-- (se abre cuando se conocen los finalistas).
--
-- Cuadro:  DK–BLG y KC–T1 → semifinal 1 · TES–IG y GEN–LYON → semifinal 2.
--
-- ⚠️ CIERRE: revisa la hora de abajo (hora de España) antes de ejecutar,
-- o cámbiala después desde Admin → Pickems.
-- Las series solo se crean si la fase todavía no tiene ninguna.
-- Se puede ejecutar más de una vez.
-- ============================================================
do $$
declare
  v_lock timestamptz := timestamp '2026-11-03 22:00' at time zone 'Europe/Madrid';   -- ⚠️ cierre
  v_ev bigint; q1 bigint; q2 bigint; q3 bigint; q4 bigint; s1 bigint; s2 bigint;
begin
  select id into v_ev from pickem_events where name = 'Worlds 2026 · Eliminatorias';
  if v_ev is null then
    insert into pickem_events (name, opens_at, locks_at, bg_image, bg_focus)
    values ('Worlds 2026 · Eliminatorias', now(), v_lock,
            'assets/pickems/fondo-eliminatorias.webp', '8% 38%')
    returning id into v_ev;
  end if;

  update pickem_events
     set kind = 'bracket', locks_at = v_lock, opens_at = least(coalesce(opens_at, now()), now())
   where id = v_ev;

  if not exists (select 1 from pickem_matches where event_id = v_ev) then
    insert into pickem_matches (event_id, label, col, sort, team1, team2, best_of, points)
    values (v_ev, 'Cuartos de final', 1, 1, 'Dplus KIA', 'Bilibili Gaming', 5, 10) returning id into q1;
    insert into pickem_matches (event_id, label, col, sort, team1, team2, best_of, points)
    values (v_ev, 'Cuartos de final', 1, 2, 'Karmine Corp', 'T1', 5, 10) returning id into q2;
    insert into pickem_matches (event_id, label, col, sort, team1, team2, best_of, points)
    values (v_ev, 'Cuartos de final', 1, 3, 'Top Esports', 'Invictus Gaming', 5, 10) returning id into q3;
    insert into pickem_matches (event_id, label, col, sort, team1, team2, best_of, points)
    values (v_ev, 'Cuartos de final', 1, 4, 'Gen.G', 'LYON', 5, 10) returning id into q4;

    insert into pickem_matches (event_id, label, col, sort, src1_match, src1_win, src2_match, src2_win, best_of, points)
    values (v_ev, 'Semifinales', 2, 5, q1, true, q2, true, 5, 20) returning id into s1;
    insert into pickem_matches (event_id, label, col, sort, src1_match, src1_win, src2_match, src2_win, best_of, points)
    values (v_ev, 'Semifinales', 2, 6, q3, true, q4, true, 5, 20) returning id into s2;

    insert into pickem_matches (event_id, label, col, sort, src1_match, src1_win, src2_match, src2_win, best_of, points, bets_enabled)
    values (v_ev, 'Final', 3, 7, s1, true, s2, true, 5, 80, true);
  end if;
end $$;

-- Comprobación: 7 series y la hora de cierre.
select e.name, e.kind, e.locks_at at time zone 'Europe/Madrid' as cierre_espana,
       count(m.id) as series, sum(m.points) as puntos_maximos
from pickem_events e left join pickem_matches m on m.event_id = e.id
where e.name = 'Worlds 2026 · Eliminatorias'
group by e.id;
