// Edge Function — Pantalla de carga de la app de escritorio.
//
// La llama la app (con tu sesión de Discord) mientras carga la partida y
// devuelve el panel listo para dibujar: los 10 jugadores con su campeón,
// rango, LP, winrate de la temporada y etiquetas ("Main del campeón",
// "En racha").
//
// "Verify JWT" va ENCENDIDO (default): la llama un usuario con sesión, y
// además solo responde a cuentas vinculadas en SharkTracker (así nadie de
// fuera puede gastar la key de Riot, que vive en los Secrets de Supabase).
//
// Cupo de la key (la comparte con la web):
//  - Lo esencial (quiénes juegan + rango) se pide mientras la key esté por
//    debajo del 85 % de su límite de 2 min; lo que falte queda "pendiente" y
//    la app vuelve a llamar a los ~15 s para completarlo.
//  - Lo extra (maestría → "Main del campeón") solo si está por debajo del 60 %.
//  - Primero los rivales, después tu equipo. Los de SharkTracker salen de la
//    base de datos (0 peticiones).
//  - Caché: el panel de una partida 10 min (si varios de SharkTracker están
//    en la misma partida, se arma una sola vez) y el rango de cada jugador 30 min.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
const REGION_GAME = 'la1';

const CUPO_ESENCIAL = 0.85;
const CUPO_EXTRA = 0.6;
const VENTANA_MIN_S = 60;
const CACHE_PARTIDA_MS = 10 * 60 * 1000;
const CACHE_RANGO_MS = 30 * 60 * 1000;
const BLOQUEO_MS = 30 * 1000;

const COLAS: Record<number, string> = {
  420: 'Clasificatoria Solo/Duo', 440: 'Clasificatoria Flex', 400: 'Normal (reclutamiento)', 430: 'Normal',
  490: 'Partida Rápida', 450: 'ARAM', 2400: 'ARAM', 700: 'Clash', 1700: 'Arena', 1710: 'Arena', 1720: 'Arena', 1750: 'Arena',
};
// Colas con campeón al azar o sin roles fijos: "Main del campeón" / "Fuera de su main"
// no dicen nada, así que ni se muestran ni se gasta la key pidiendo maestrías.
const SIN_MAINS = new Set([450, 2400, 1700, 1710, 1720, 1750, 900, 1900]);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Riot, con freno de cupo ──
class Ocupado extends Error {}
let uso = 0; // fracción más alta usada de la key en las ventanas largas (lo dice Riot en cada respuesta)
function leerVentanas(texto: string | null): Map<number, number> {
  const m = new Map<number, number>();
  for (const parte of (texto ?? '').split(',')) {
    const [valor, segundos] = parte.split(':').map(Number);
    if (Number.isFinite(valor) && Number.isFinite(segundos)) m.set(segundos, valor);
  }
  return m;
}
async function riot(url: string, cupoMax: number): Promise<any | null> {
  if (uso >= cupoMax) throw new Ocupado();
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
  const limites = leerVentanas(res.headers.get('X-App-Rate-Limit'));
  for (const [segundos, usado] of leerVentanas(res.headers.get('X-App-Rate-Limit-Count'))) {
    const limite = limites.get(segundos);
    if (segundos >= VENTANA_MIN_S && limite) uso = Math.max(uso, usado / limite);
  }
  if (res.status === 429) { uso = 1; throw new Ocupado(); }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Riot respondió ${res.status}`);
  return res.json();
}

// Diccionario de campeones (lo mantiene sync-live-status en ddragon_cache).
async function campeones(): Promise<Map<number, { clave: string; nombre: string }>> {
  const { data } = await supabase.from('ddragon_cache').select('champions').maybeSingle();
  const dict = new Map<number, { clave: string; nombre: string }>();
  for (const c of Object.values<any>(data?.champions ?? {})) dict.set(parseInt(c.key), { clave: c.id, nombre: c.name });
  return dict;
}

const nombreRiot = (p: any) => p.riotId
  || (p.riotIdGameName && p.riotIdTagline ? `${p.riotIdGameName}#${p.riotIdTagline}` : p.riotIdGameName ?? p.summonerName ?? 'Jugador');

// Entrada de liga de Riot → lo que dibuja la app.
const rangoDe = (e: any, cola: string) => e ? {
  // Riot manda la división como "rank" (I–IV); la base de SharkTracker, como "division".
  cola, tier: e.tier, division: e.rank ?? e.division ?? '', lp: e.leaguePoints ?? e.lp ?? 0,
  victorias: e.wins ?? 0, derrotas: e.losses ?? 0, racha: !!e.hotStreak,
} : null;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    return await armarPanel(req);
  } catch (e) {
    if (e instanceof Ocupado) return json({ estado: 'riot_ocupado' });
    console.error('[pantalla-carga]', e);
    return json({ error: 'Error inesperado' }, 500);
  }
});

async function armarPanel(req: Request): Promise<Response> {
  uso = 0; // cada llamada empieza leyendo el cupo de nuevo (el worker puede reutilizarse)
  // ── 1) ¿Quién llama? Tiene que tener sesión y cuenta de LoL vinculada ──
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  const user = userData?.user;
  if (!user) return json({ error: 'Tienes que iniciar sesión.' }, 401);
  const { data: yo } = await supabase.from('players').select('puuid').eq('user_id', user.id).maybeSingle();
  if (!yo?.puuid) return json({ estado: 'sin_cuenta' });

  // ── 2) ¿En qué partida está? (1 petición) ──
  const partida = await riot(`https://${REGION_GAME}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${yo.puuid}`, CUPO_ESENCIAL);
  if (!partida?.gameId) return json({ estado: 'sin_partida' });
  const gameId = partida.gameId as number;

  // ── 3) Caché de la partida + "bloqueo" para no armarla dos veces a la vez ──
  const ahora = Date.now();
  const { error: insErr } = await supabase.from('carga_partidas')
    .insert({ game_id: gameId, bloqueo: new Date(ahora + BLOQUEO_MS).toISOString() });
  if (insErr && insErr.code !== '23505') throw insErr; // 23505 = ya existía la fila de esta partida
  if (insErr) {
    const { data: fila } = await supabase.from('carga_partidas').select('datos, completo, bloqueo, updated_at').eq('game_id', gameId).maybeSingle();
    const fresca = fila && ahora - new Date(fila.updated_at).getTime() < CACHE_PARTIDA_MS;
    if (fila?.completo && fresca) return json(desdeMiLado(fila.datos, yo.puuid));
    if (fila?.bloqueo && new Date(fila.bloqueo).getTime() > ahora) {
      return json(fila.datos ? { ...desdeMiLado(fila.datos, yo.puuid), estado: 'esperando' } : { estado: 'esperando' });
    }
    await supabase.from('carga_partidas').update({ bloqueo: new Date(ahora + BLOQUEO_MS).toISOString() }).eq('game_id', gameId);
  }

  // ── 4) Los 10 jugadores ──
  const dict = await campeones();
  const esFlex = partida.gameQueueConfigId === 440;
  const sinMains = SIN_MAINS.has(partida.gameQueueConfigId);
  const jugadores = (partida.participants ?? []).map((p: any) => ({
    puuid: p.puuid as string | null,
    equipo: p.teamId === 100 ? 'blue' : 'red',
    nombre: nombreRiot(p),
    championId: p.championId as number,
    campeon: dict.get(p.championId)?.nombre ?? 'Campeón',
    clave: dict.get(p.championId)?.clave ?? null,
  }));
  const miEquipo = jugadores.find((j: any) => j.puuid === yo.puuid)?.equipo ?? 'blue';

  // Los de SharkTracker: rango y maestrías desde la base de datos (0 peticiones).
  const puuids = jugadores.map((j: any) => j.puuid).filter(Boolean);
  const { data: nuestros } = await supabase.from('players').select('id, puuid').in('puuid', puuids);
  const idPorPuuid = new Map((nuestros ?? []).map((p: any) => [p.puuid, p.id]));
  const ids = [...idPorPuuid.values()];
  const { data: rangosST } = ids.length
    ? await supabase.from('rank_latest').select('player_id, queue_type, tier, division, lp, wins, losses').in('player_id', ids)
    : { data: [] };
  const { data: maestriasST } = ids.length
    ? await supabase.from('player_masteries').select('player_id, champion').in('player_id', ids)
    : { data: [] };

  // Caché de rangos (30 min) para el resto.
  const { data: cacheRangos } = await supabase.from('carga_rangos').select('puuid, datos, updated_at').in('puuid', puuids);
  const cache = new Map((cacheRangos ?? [])
    .filter((c: any) => ahora - new Date(c.updated_at).getTime() < CACHE_RANGO_MS)
    .map((c: any) => [c.puuid, c.datos]));

  const info = new Map<string, any>(); // puuid → { solo, flex, maestria: [championIds] | null }
  for (const j of jugadores) {
    if (!j.puuid) continue;
    const pid = idPorPuuid.get(j.puuid);
    if (pid) {
      const r = (cola: string) => (rangosST ?? []).find((x: any) => x.player_id === pid && x.queue_type === cola);
      info.set(j.puuid, {
        solo: rangoDe(r('RANKED_SOLO_5x5'), 'Solo/Duo'),
        flex: rangoDe(r('RANKED_FLEX_SR'), 'Flex'),
        mainsNombres: (maestriasST ?? []).filter((m: any) => m.player_id === pid).map((m: any) => m.champion),
        sharktracker: true,
      });
    } else if (cache.has(j.puuid)) {
      info.set(j.puuid, cache.get(j.puuid));
    }
  }

  // ── 5) Lo que falta, pidiéndolo a Riot: rivales primero ──
  const orden = [...jugadores.filter((j: any) => j.equipo !== miEquipo), ...jugadores.filter((j: any) => j.equipo === miEquipo)];
  const nuevos: { puuid: string; datos: any }[] = [];
  try {
    for (const j of orden) {
      if (!j.puuid || info.has(j.puuid)) continue;
      const entradas = await riot(`https://${REGION_GAME}.api.riotgames.com/lol/league/v4/entries/by-puuid/${j.puuid}`, CUPO_ESENCIAL) ?? [];
      const solo = entradas.find((e: any) => e.queueType === 'RANKED_SOLO_5x5');
      const flex = entradas.find((e: any) => e.queueType === 'RANKED_FLEX_SR');
      const datos = { solo: rangoDe(solo, 'Solo/Duo'), flex: rangoDe(flex, 'Flex'), maestria: null };
      info.set(j.puuid, datos);
      nuevos.push({ puuid: j.puuid, datos });
    }
  } catch (e) {
    if (!(e instanceof Ocupado)) throw e;
  }

  // Extra: maestría (top 3) solo si la key va holgada (y si la cola tiene mains).
  try {
    for (const j of sinMains ? [] : orden) {
      const d = j.puuid ? info.get(j.puuid) : null;
      if (!d || d.sharktracker || Array.isArray(d.maestria)) continue;
      const top = await riot(`https://${REGION_GAME}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${j.puuid}/top?count=3`, CUPO_EXTRA) ?? [];
      d.maestria = top.map((m: any) => m.championId);
      const previo = nuevos.find((n) => n.puuid === j.puuid);
      if (previo) previo.datos = d; else nuevos.push({ puuid: j.puuid, datos: d });
    }
  } catch (e) {
    if (!(e instanceof Ocupado)) throw e;
  }
  if (nuevos.length) {
    await supabase.from('carga_rangos').upsert(nuevos.map((n) => ({ puuid: n.puuid, datos: n.datos, updated_at: new Date().toISOString() })));
  }

  // ── 6) Armar el panel ──
  const panel = {
    cola: COLAS[partida.gameQueueConfigId] ?? 'Partida',
    jugadores: jugadores.map((j: any) => {
      const d = j.puuid ? info.get(j.puuid) : null;
      const rango = d ? (esFlex ? d.flex ?? d.solo : d.solo ?? d.flex) : null;
      let main: boolean | null = null;
      if (sinMains) main = null;
      else if (d?.sharktracker && d.mainsNombres?.length) main = d.mainsNombres.includes(j.clave);
      else if (Array.isArray(d?.maestria) && d.maestria.length) main = d.maestria.includes(j.championId);
      return {
        puuid: j.puuid, equipo: j.equipo, nombre: j.nombre, campeon: j.campeon, clave: j.clave,
        sharktracker: !!d?.sharktracker,
        pendiente: !!j.puuid && !d,
        rango,
        main,
      };
    }),
  };
  const completo = panel.jugadores.every((j: any) => !j.pendiente);
  await supabase.from('carga_partidas').update({
    datos: panel, completo, bloqueo: null, updated_at: new Date().toISOString(),
  }).eq('game_id', gameId);

  return json(desdeMiLado(panel, yo.puuid, completo));
}

// El panel se guarda igual para todos; aquí se separa en "tu equipo" y
// "rivales" según quién pregunta (en una premade cada uno ve su lado).
function desdeMiLado(panel: any, miPuuid: string, completo = true) {
  const lista = panel?.jugadores ?? [];
  const miEquipo = lista.find((j: any) => j.puuid === miPuuid)?.equipo ?? 'blue';
  const limpiar = (j: any) => ({ ...j, puuid: undefined });
  return {
    estado: 'ok',
    completo: completo && lista.every((j: any) => !j.pendiente),
    cola: panel?.cola ?? 'Partida',
    aliados: lista.filter((j: any) => j.equipo === miEquipo).map(limpiar),
    rivales: lista.filter((j: any) => j.equipo !== miEquipo).map(limpiar),
  };
}
