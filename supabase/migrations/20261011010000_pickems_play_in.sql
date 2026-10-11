-- ============================================================
-- Pickems: series del Play-In de Worlds 2026
--
-- Cuatro equipos, doble eliminación, todo al mejor de 5 (15–18 de octubre,
-- Los Ángeles). El ganador del bracket pasa a la fase suiza.
-- Las series de rondas posteriores llevan el "hueco" del bracket como nombre
-- (ej. "Ganador FUR/MVK"): se vota por lado (equipo de arriba / de abajo) y,
-- cuando se sepa quién juega, la admin cambia el nombre sin tocar los votos.
-- Las horas se dejan vacías hasta que Riot confirme el horario.
-- Solo se cargan si el evento todavía no tiene series.
-- ============================================================
insert into pickem_matches (event_id, label, team1, team2, best_of, sort)
select e.id, v.label, v.team1, v.team2, 5, v.sort
  from pickem_events e
 cross join (values
   (1, 'Ronda 1',             'FURIA',                       'MVK Esports'),
   (2, 'Ronda 1',             'Cloud9 Kia',                  'Karmine Corp'),
   (3, 'Final de ganadores',  'Ganador FUR/MVK',             'Ganador C9/KC'),
   (4, 'Ronda de perdedores', 'Perdedor FUR/MVK',            'Perdedor C9/KC'),
   (5, 'Final de perdedores', 'Perdedor final de ganadores', 'Ganador ronda de perdedores'),
   (6, 'Gran final',          'Ganador final de ganadores',  'Ganador final de perdedores')
 ) as v(sort, label, team1, team2)
 where e.name = 'Worlds 2026 · Play-In'
   and not exists (select 1 from pickem_matches m where m.event_id = e.id);
