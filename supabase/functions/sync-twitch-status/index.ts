// Edge Function — Etapa 5: ¿está alguien del grupo en vivo en Twitch?
// Escribe en stream_status. Soporta varios usuarios de Twitch a la vez
// (uno por cada player_profiles.twitch_username que no sea null).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWITCH_CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID')!;
const TWITCH_CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Token de acceso de app — dura ~60 días, se cachea y se reutiliza
// (se refresca solo, 1h antes de vencer, no en cada corrida).
async function getAppAccessToken(): Promise<string> {
  const { data: cached } = await supabase
    .from('twitch_token_cache').select('access_token, expires_at').maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60 * 60 * 1000) {
    return cached.access_token;
  }

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`token -> ${res.status}: ${detalle}`);
  }
  const json = await res.json();
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();

  await supabase.from('twitch_token_cache').upsert({
    id: true, access_token: json.access_token, expires_at: expiresAt,
  });

  return json.access_token;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    return await handle();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function handle(): Promise<Response> {
  const { data: profiles, error } = await supabase
    .from('player_profiles')
    .select('player_id, twitch_username')
    .not('twitch_username', 'is', null);
  if (error) return new Response(error.message, { status: 500 });

  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ ok: true, log: ['sin usuarios de Twitch configurados'] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const usernameToPlayerId = new Map<string, string>();
  for (const p of profiles) usernameToPlayerId.set((p.twitch_username as string).toLowerCase(), p.player_id as string);

  const token = await getAppAccessToken();
  const params = new URLSearchParams();
  for (const username of usernameToPlayerId.keys()) params.append('user_login', username);

  const res = await fetch(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
    headers: { 'Client-Id': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return new Response(`Twitch -> ${res.status}`, { status: 502 });
  const { data: streams } = await res.json();

  const liveUsernames = new Set<string>();
  const log: string[] = [];

  for (const stream of streams ?? []) {
    const username = (stream.user_login as string).toLowerCase();
    liveUsernames.add(username);
    const playerId = usernameToPlayerId.get(username);
    if (!playerId) continue;

    await supabase.from('stream_status').upsert({
      player_id: playerId,
      is_live: true,
      title: stream.title,
      game_name: stream.game_name,
      viewer_count: stream.viewer_count,
      started_at: stream.started_at,
      thumbnail_url: (stream.thumbnail_url as string).replace('{width}', '440').replace('{height}', '248'),
      updated_at: new Date().toISOString(),
    });
    log.push(`${username}: en vivo (${stream.viewer_count} viewers, ${stream.game_name})`);
  }

  // Todos los que tienen usuario configurado pero NO aparecieron en la
  // respuesta de Twitch están fuera de vivo — se actualizan también.
  for (const [username, playerId] of usernameToPlayerId) {
    if (liveUsernames.has(username)) continue;
    await supabase.from('stream_status').upsert({
      player_id: playerId, is_live: false, title: null, game_name: null,
      viewer_count: null, started_at: null, thumbnail_url: null,
      updated_at: new Date().toISOString(),
    });
  }

  return new Response(JSON.stringify({ ok: true, log }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
