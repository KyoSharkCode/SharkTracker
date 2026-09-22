-- ============================================================
-- Cron: dispara las 4 Edge Functions por HTTP (pg_net).
-- Refleja los jobs que ya existen en cron.job (creados a mano en
-- el dashboard) para que queden versionados como el resto del
-- backend. El secreto NUNCA se escribe acá — se guarda una vez en
-- Vault y este archivo solo lo referencia por nombre.
--
-- cron.schedule() con un jobname que ya existe ACTUALIZA ese job
-- en vez de duplicarlo, así que correr esto es seguro aunque los
-- jobs de abajo ya estén creados.
-- ============================================================
create extension if not exists pg_net;

-- ── PASO MANUAL, UNA SOLA VEZ, en el SQL Editor ──────────────
-- (no lo corras como parte de esta migración ni lo commitees con
-- el valor real puesto — dejalo comentado acá como referencia)
--
-- select vault.create_secret(
--   '<pegar acá el CRON_SECRET nuevo>',
--   'cron_secret',
--   'Header x-cron-secret para las Edge Functions disparadas por cron'
-- );
--
-- Si ya existe y estás ROTANDO el valor:
-- select vault.update_secret(
--   (select id from vault.secrets where name = 'cron_secret'),
--   '<CRON_SECRET nuevo>'
-- );

select cron.schedule(
  'sync-riot-data-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/sync-riot-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'sync-matches-every-3min',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/sync-matches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'sync-live-status-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/sync-live-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'sync-twitch-status-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/sync-twitch-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
