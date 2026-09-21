-- ============================================================
-- Roster inicial — mismo grupo que JUGADORES en OLD/actualizar_datos.py.
-- puuid/icon_id quedan NULL: se completan solos cuando la Edge
-- Function de ingesta corra por primera vez y consulte Riot.
-- ============================================================
insert into players (riot_game_name, riot_tag_line) values
  ('Pinea',          'Pinea'),
  ('Galactic Shark', 'AYK'),
  ('El Buñuelito',   'KyA'),
  ('ゆうき まこと',      '1411'),
  ('adrianNOOBYT',   'LAN'),
  ('Ostia',          'LAN')
on conflict (riot_game_name, riot_tag_line) do nothing;
