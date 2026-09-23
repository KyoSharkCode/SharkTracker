// Edge Function — Agregar una cuenta al roster (Admin Dashboard).
//
// La llama admin.html con { game_name, tag_line }. Antes de agregar:
//   1) Verifica que quien llama tenga sesión Y esté en la tabla admins.
//   2) Busca el Riot ID en Riot (con RIOT_API_KEY, que vive en los
//      Secrets de Supabase y nunca pasa por el navegador).
//   3) Si existe, la guarda en players con su PUUID e ícono, usando el
//      nombre tal como lo escribe Riot (mayúsculas/acentos correctos).
// El resto (rango, partidas, en vivo) lo completan solos los syncs.
//
// "Verify JWT" puede quedar ENCENDIDO (default): la llama un usuario con sesión.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
const REGION_API = 'americas';
const REGION_GAME = 'la1';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // ── 1) ¿Quién llama? ──
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  const user = userData?.user;
  if (!user) return json({ error: 'Tienes que iniciar sesión.' }, 401);
  const { data: admin } = await supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!admin) return json({ error: 'Solo una administradora puede agregar cuentas.' }, 403);

  // ── Datos ──
  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const gameName = String(body?.game_name ?? '').trim();
  const tagLine = String(body?.tag_line ?? '').trim().replace(/^#/, '');
  if (gameName.length < 3 || gameName.length > 16 || tagLine.length < 2 || tagLine.length > 5) {
    return json({ error: 'Riot ID inválido: nombre de 3 a 16 caracteres y tag de 2 a 5.' }, 400);
  }

  // ── 2) ¿Existe en Riot? ──
  const accRes = await fetch(
    `https://${REGION_API}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: { 'X-Riot-Token': RIOT_API_KEY } },
  );
  if (accRes.status === 404) return json({ error: `No existe ninguna cuenta ${gameName}#${tagLine} en Riot.` }, 404);
  if (accRes.status === 401 || accRes.status === 403) return json({ error: 'La API key de Riot venció o no es válida (renuévala en los Secrets).' }, 502);
  if (!accRes.ok) return json({ error: `Riot respondió ${accRes.status}. Prueba de nuevo en un minuto.` }, 502);
  const acc = await accRes.json();

  // Ícono (si la cuenta nunca jugó en LAN, no tiene invocador: se agrega igual).
  let iconId: number | null = null;
  const summRes = await fetch(
    `https://${REGION_GAME}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${acc.puuid}`,
    { headers: { 'X-Riot-Token': RIOT_API_KEY } },
  );
  if (summRes.ok) iconId = (await summRes.json()).profileIconId ?? null;

  // ── ¿Ya está en el roster? (mismo PUUID = misma cuenta aunque cambie el nombre) ──
  const { data: dup } = await supabase.from('players').select('id, riot_game_name, riot_tag_line')
    .eq('puuid', acc.puuid).maybeSingle();
  if (dup) return json({ error: `Esa cuenta ya está en el roster como ${dup.riot_game_name}#${dup.riot_tag_line}.` }, 409);

  // ── 3) Guardar ──
  const { data: player, error } = await supabase.from('players').insert({
    riot_game_name: acc.gameName ?? gameName,
    riot_tag_line: acc.tagLine ?? tagLine,
    puuid: acc.puuid,
    icon_id: iconId,
  }).select('id, riot_game_name, riot_tag_line, icon_id').single();
  if (error) {
    if (error.code === '23505') return json({ error: 'Ese Riot ID ya está en el roster.' }, 409);
    return json({ error: error.message }, 500);
  }
  return json({ player, found_in_lan: iconId !== null });
});
