// Cron: cada 10 min (ver cron job "referencias-elo-cada-10min").
// Recolector de referencias por elo para "Tu rendimiento" de la app.
//
// En cada corrida:
//  1. Elige una división (va rotando: Bronce → … → Master+ → Bronce …).
//  2. Toma 2 jugadores al azar de esa división en LAN.
//  3. Baja sus últimas partidas de SoloQ de los últimos 14 días y suma los
//     números de los 10 jugadores (CS, oro, visión, KP, minutos) en
//     elo_referencias, por división + rol + día.
// Hierro no se recolecta: solo sirve de referencia la división de ARRIBA de
// la tuya, y nadie está por debajo de Hierro.
//
// Pocas llamadas por corrida (≤ 11) para no quitarle cupo de la key al resto
// de SharkTracker. Si Riot responde 429 (límite), se corta y sigue la próxima.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const REGION_GAME = 'la1';
const REGION_API = 'americas';
const COLA = 'RANKED_SOLO_5x5';

const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'];
const DIVISIONES = ['I', 'II', 'III', 'IV'];
const ROLES = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
const JUGADORES_POR_CORRIDA = 2;
const PARTIDAS_POR_JUGADOR = 5;
const MAX_PARTIDAS = 8;
const DIAS = 14;
const MIN_DURACION = 10 * 60; // se ignoran remakes y rendiciones tempranas
const TURNO_MS = 10 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

class LimiteRiot extends Error {}

async function riotFetch(url: string) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
  if (res.status === 429) throw new LimiteRiot('Riot: límite de peticiones (429), se sigue en la próxima corrida');
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const alAzar = <T>(lista: T[], n: number): T[] => {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
};

// Jugadores de una división (con su puuid).
async function jugadoresDe(tier: string): Promise<string[]> {
  if (tier === 'MASTER') {
    const liga = await riotFetch(`https://${REGION_GAME}.api.riotgames.com/lol/league/v4/masterleagues/by-queue/${COLA}`);
    return (liga.entries ?? []).map((e: any) => e.puuid).filter(Boolean);
  }
  const division = DIVISIONES[Math.floor(Math.random() * DIVISIONES.length)];
  const pagina = 1 + Math.floor(Math.random() * 3);
  const entradas = await riotFetch(
    `https://${REGION_GAME}.api.riotgames.com/lol/league/v4/entries/${COLA}/${tier}/${division}?page=${pagina}`
  );
  return (entradas ?? []).map((e: any) => e.puuid).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const tier = TIERS[Math.floor(Date.now() / TURNO_MS) % TIERS.length];
  const log: string[] = [`División: ${tier}`];
  let sumadas = 0;

  try {
    const elegidos = alAzar(await jugadoresDe(tier), JUGADORES_POR_CORRIDA);
    if (!elegidos.length) log.push('Riot no devolvió jugadores para esta división');
    const desde = Math.floor((Date.now() - DIAS * 86400000) / 1000);

    // IDs de partidas de SoloQ recientes de los elegidos (sin repetir).
    const ids = new Set<string>();
    for (const puuid of elegidos) {
      const suyas: string[] = await riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&startTime=${desde}&start=0&count=${PARTIDAS_POR_JUGADOR}`
      );
      suyas.forEach((id) => ids.add(id));
    }

    // Las que ya se sumaron antes no se vuelven a pedir.
    const lista = [...ids];
    const { data: yaEstan, error } = lista.length
      ? await supabase.from('elo_referencias_partidas').select('match_id').in('match_id', lista)
      : { data: [], error: null };
    if (error) throw error;
    const vistas = new Set((yaEstan ?? []).map((m: any) => m.match_id));
    const nuevas = lista.filter((id) => !vistas.has(id)).slice(0, MAX_PARTIDAS);

    for (const matchId of nuevas) {
      const { info } = await riotFetch(`https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/${matchId}`);
      if (!info || info.queueId !== 420 || (info.gameDuration ?? 0) < MIN_DURACION) continue;
      const participantes = info.participants ?? [];
      if (participantes.some((p: any) => p.gameEndedInEarlySurrender)) continue;

      const minutos = info.gameDuration / 60;
      const killsEquipo: Record<number, number> = {};
      for (const p of participantes) killsEquipo[p.teamId] = (killsEquipo[p.teamId] ?? 0) + (p.kills ?? 0);

      const filas = participantes
        .filter((p: any) => ROLES.has(p.teamPosition))
        .map((p: any) => ({
          tier,
          rol: p.teamPosition,
          minutos: Math.round(minutos * 100) / 100,
          cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
          oro: p.goldEarned ?? 0,
          vision: p.visionScore ?? 0,
          kp: killsEquipo[p.teamId] > 0
            ? Math.round(((p.kills ?? 0) + (p.assists ?? 0)) / killsEquipo[p.teamId] * 1000) / 1000
            : 0,
        }));
      if (!filas.length) continue;

      const terminada = info.gameEndTimestamp ?? (info.gameCreation + info.gameDuration * 1000);
      const dia = new Date(terminada).toISOString().slice(0, 10);
      const { data: sumada, error: rpcErr } = await supabase.rpc('registrar_partida_referencia', {
        p_match_id: matchId, p_dia: dia, p_filas: filas,
      });
      if (rpcErr) { log.push(`ERROR al sumar ${matchId}: ${rpcErr.message}`); continue; }
      if (sumada) sumadas++;
    }
  } catch (e) {
    log.push(e instanceof LimiteRiot ? e.message : `ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  log.push(`Partidas sumadas: ${sumadas}`);
  return new Response(JSON.stringify({ ok: true, log }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
