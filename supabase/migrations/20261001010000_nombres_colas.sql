-- ============================================================
-- Nombre de cola de partidas ya guardadas: Arena (1750) y ARAM de
-- temporada (2400) se guardaban como "Modo Destacado" porque
-- sync-matches no conocía esos números. Desde ahora se guardan bien;
-- esto arregla las que ya estaban.
-- ============================================================
update matches set queue_type = 'Arena' where queue_id in (1700, 1710, 1720, 1750) and queue_type <> 'Arena';
update matches set queue_type = 'ARAM'  where queue_id in (450, 2400)              and queue_type <> 'ARAM';
