// Conexión con Supabase — un solo lugar para toda la web.
//
// La URL y la anon key son PÚBLICAS a propósito (cualquiera las ve con F12):
// lo que protege los datos son las reglas RLS y los permisos de la base,
// no esconder esta llave. Tenerlas acá solo evita repetirlas en cada página.
//
// La versión de supabase-js está FIJADA (no "@2" = "la última que salga"),
// para que una versión nueva con fallos no entre sola en la web. Para
// actualizarla, cambiar el número acá y probar la web.
//
// Uso:  import { createSupabase } from './assets/supabase.js';
//       const supabase = createSupabase();

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

export const SUPABASE_URL = 'https://mvupiohecvoiwuxwjdrt.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12dXBpb2hlY3ZvaXd1eHdqZHJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDI1NTcsImV4cCI6MjEwNTU3ODU1N30.6vNCdX63tpyGnGII15Mjznq7BwhafH9KmnI-Os2SO4M';

export function createSupabase(options) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
}
