// Sesión de Discord (Supabase Auth) — corre en el proceso main.
//
// Flujo PKCE:
//   1. signIn() pide a Supabase la URL de Discord y la abre en el navegador.
//   2. Tras autorizar, Discord → Supabase → sharktracker://auth-callback?code=…
//   3. main.js recibe ese enlace y llama a handleCallback(), que canjea el
//      código (de un solo uso) por la sesión.
// La sesión se guarda cifrada en la carpeta de datos de la app (safeStorage
// usa el cifrado del sistema: DPAPI en Windows), así no hay que volver a
// iniciar sesión cada vez que se abre la app.

const { app, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const cfg = require('./config');
const { tierObjetivo, ROL_WEB } = require('./rendimiento');

// ── Almacenamiento de la sesión (cifrado) ──
let cache = null;
const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');
const puedeCifrar = () => safeStorage.isEncryptionAvailable();

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(sessionFile());
    cache = JSON.parse(puedeCifrar() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
  } catch {
    cache = {}; // primera vez, o archivo ilegible: se empieza sin sesión
  }
  return cache;
}
function persist() {
  const txt = JSON.stringify(cache ?? {});
  fs.writeFileSync(sessionFile(), puedeCifrar() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8'));
}
const storage = {
  getItem: (key) => load()[key] ?? null,
  setItem: (key, value) => { load()[key] = value; persist(); },
  removeItem: (key) => { delete load()[key]; persist(); },
};

// ── Cliente de Supabase (se crea al primer uso, con la app ya lista) ──
let supabase = null;
function client() {
  supabase ??= createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    // El Node de Electron 33 no trae WebSocket propio: se le pasa el de 'ws'.
    realtime: { transport: WebSocket },
  });
  return supabase;
}

// Abre Discord en el navegador para iniciar sesión.
async function signIn() {
  const { data, error } = await client().auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: cfg.AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  await shell.openExternal(data.url);
}

// Recibe sharktracker://auth-callback?code=… y lo canjea por la sesión.
async function handleCallback(url) {
  const u = new URL(url);
  const query = u.searchParams;
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const errorMsg = query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error');
  if (errorMsg) throw new Error(`Discord no completó el inicio de sesión: ${errorMsg.replace(/\+/g, ' ')}`);

  const code = query.get('code');
  if (!code) throw new Error('El enlace de vuelta no trae el código de inicio de sesión. Prueba de nuevo.');
  const { error } = await client().auth.exchangeCodeForSession(code);
  if (error) throw new Error(`No se pudo completar el inicio de sesión: ${error.message}`);
}

// Lo que la interfaz necesita saber: quién eres en Discord y tu cuenta de LoL vinculada.
async function getState() {
  const { data: { session } } = await client().auth.getSession();
  if (!session) return { loggedIn: false };

  const u = session.user;
  const meta = u.user_metadata ?? {};
  const discord = {
    name: meta.custom_claims?.global_name || meta.full_name || meta.name || 'Discord',
    username: meta.name || meta.full_name || '',
    avatar: meta.avatar_url || null,
  };

  // Cuenta de LoL vinculada en SharkTracker (players.user_id = tu usuario).
  let player = null;
  const { data, error } = await client()
    .from('players').select('id, riot_game_name, riot_tag_line, icon_id')
    .eq('user_id', u.id).maybeSingle();
  if (!error && data) player = data;

  return { loggedIn: true, discord, player };
}

// Promedios de referencia para "Tu rendimiento": los de la división de arriba
// de tu rango de SoloQ, por rol. Sin sesión o sin cuenta vinculada → null.
async function getReferencia() {
  const { data: { session } } = await client().auth.getSession();
  if (!session) return null;
  const { data: player } = await client()
    .from('players').select('id, primary_role').eq('user_id', session.user.id).maybeSingle();
  if (!player) return null;

  const { data: rango } = await client()
    .from('rank_latest').select('tier')
    .eq('player_id', player.id).eq('queue_type', 'RANKED_SOLO_5x5').maybeSingle();
  const tier = tierObjetivo(rango?.tier);

  const { data: filas, error } = await client()
    .from('elo_referencias_promedio').select('rol, muestras, cs_min, oro_min, vision_min, kp').eq('tier', tier);
  if (error) throw error;
  const porRol = {};
  for (const f of filas ?? []) porRol[f.rol] = f;
  return { tier, rolPrincipal: ROL_WEB[player.primary_role] ?? null, porRol };
}

// Pantalla de carga: rangos de los 10 jugadores (Edge Function pantalla-carga,
// que guarda la key de Riot). Devuelve { estado, completo, cola, aliados, rivales }.
async function getPantallaCarga() {
  const { data: { session } } = await client().auth.getSession();
  if (!session) return { estado: 'sin_sesion' };
  const { data, error } = await client().functions.invoke('pantalla-carga', { body: {} });
  if (error) return { estado: 'error' };
  return data;
}

// Cierra la sesión SOLO en esta app (la web de SharkTracker sigue con la suya).
async function signOut() {
  await client().auth.signOut({ scope: 'local' });
}

// Avisa cuando la sesión cambia (inicio, cierre, renovación).
function onChange(callback) {
  client().auth.onAuthStateChange((event) => {
    // Fuera del callback de Supabase: llamar a Supabase aquí dentro puede bloquearse.
    setTimeout(() => callback(event), 0);
  });
}

module.exports = { signIn, handleCallback, getState, getReferencia, getPantallaCarga, signOut, onChange, client };
