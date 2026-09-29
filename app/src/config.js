// Configuración de la app. Todo lo de acá es PÚBLICO a propósito:
// la URL y la anon key de Supabase son las mismas que usa la web de
// SharkTracker (lo que protege los datos son las reglas RLS de la base).
// Las claves privadas (Riot, etc.) NUNCA van en la app: viven en las
// Edge Functions de Supabase.

module.exports = {
  SUPABASE_URL: 'https://mvupiohecvoiwuxwjdrt.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12dXBpb2hlY3ZvaXd1eHdqZHJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDI1NTcsImV4cCI6MjEwNTU3ODU1N30.6vNCdX63tpyGnGII15Mjznq7BwhafH9KmnI-Os2SO4M',

  // Enlace con el que Discord/Supabase devuelven a la app tras el login.
  // Tiene que estar en Supabase → Authentication → URL Configuration → Redirect URLs.
  PROTOCOL: 'sharktracker',
  AUTH_REDIRECT: 'sharktracker://auth-callback',
};
