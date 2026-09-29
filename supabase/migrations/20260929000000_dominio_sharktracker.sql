-- ============================================================
-- Dominio propio: los avisos de Discord (enlaces a perfiles y partidas,
-- logo del bot) pasan a usar https://sharktracker.lol/
--
-- Correr SOLO cuando https://sharktracker.lol ya abra la web.
-- ============================================================
update discord_settings set site_url = 'https://sharktracker.lol/';
alter table discord_settings alter column site_url set default 'https://sharktracker.lol/';
