-- ============================================================
-- Arreglo: el cron de referencias-elo buscaba la contraseña del cron
-- en Vault como 'cron_secret', pero en Vault se llama 'CRON_SECRET'
-- (en mayúsculas). Al no encontrarla, mandaba la cabecera vacía y la
-- función respondía 401. Esto vuelve a programar el mismo job (mismo
-- nombre = se actualiza, no se duplica) con el nombre correcto.
-- ============================================================
select cron.schedule(
  'referencias-elo-cada-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://mvupiohecvoiwuxwjdrt.supabase.co/functions/v1/referencias-elo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
