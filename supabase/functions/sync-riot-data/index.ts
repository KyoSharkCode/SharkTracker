// Edge Function — Etapa 1: resolver PUUID + sincronizar rango/LP
// por cola. Reemplaza la primera mitad de OLD/actualizar_datos.py.
// Corre cada 1 min vía Cron Trigger (pg_cron + pg_net).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solo
// en toda Edge Function — no hace falta configurarlos a mano.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Candado propio: esta función tiene "Verify JWT" apagado (la llama
// pg_cron, no un usuario con sesión), así que en vez de eso exige
// este header secreto — solo el cron job lo conoce.
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const REGION_API = 'americas';
const REGION_GAME = 'la1';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISIONLESS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIV_NUM: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
const MASTER_PLUS_BASE = 7 * 4 * 100;

// Mismo cálculo que elo_score_simple() en el script viejo — un
// puntaje comparable entre rangos para poder ordenar/graficar.
function eloScore(tier: string | null, division: string | null, lp: number | null): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  const ti = TIER_ORDER.indexOf(t);
  if (ti === -1) return null;
  if (DIVISIONLESS.includes(t)) return MASTER_PLUS_BASE + Math.max(0, lp ?? 0);
  const dn = division ? DIV_NUM[division.toUpperCase()] : undefined;
  if (dn === undefined) return null;
  return (ti * 4 + dn) * 100 + Math.max(0, Math.min(100, lp ?? 0));
}

async function riotFetch(url: string) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// Mismo patrón de caché que sync-live-status — se refresca solo
// cuando Riot saca versión nueva, no en cada corrida.
async function getChampionDict(): Promise<Map<number, string>> {
  const versions: string[] = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
  const latest = versions[0];

  const { data: cached } = await supabase.from('ddragon_cache').select('version, champions').maybeSingle();

  let championsData: Record<string, any>;
  if (cached && cached.version === latest) {
    championsData = cached.champions;
  } else {
    const champJson = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${latest}/data/es_ES/champion.json`
    ).then((r) => r.json());
    championsData = champJson.data;
    await supabase.from('ddragon_cache').upsert({
      id: true, version: latest, champions: championsData, updated_at: new Date().toISOString(),
    });
  }

  const dict = new Map<number, string>();
  for (const info of Object.values<any>(championsData)) dict.set(parseInt(info.key), info.id);
  return dict;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: players, error } = await supabase.from('players').select('*');
  if (error) return new Response(error.message, { status: 500 });

  const champDict = await getChampionDict();
  const log: string[] = [];

  for (const player of players ?? []) {
    try {
      let puuid: string | null = player.puuid;

      // Resolver PUUID + ícono solo una vez, la primera corrida.
      if (!puuid) {
        const acc = await riotFetch(
          `https://${REGION_API}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
          `${encodeURIComponent(player.riot_game_name)}/${encodeURIComponent(player.riot_tag_line)}`
        );
        puuid = acc.puuid;
        const summ = await riotFetch(`https://${REGION_GAME}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`);
        await supabase.from('players').update({ puuid, icon_id: summ.profileIconId }).eq('id', player.id);
      }

      const entries = await riotFetch(`https://${REGION_GAME}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`);

      for (const entry of entries) {
        const tier = entry.tier as string;
        const division = entry.rank as string;
        const lp = entry.leaguePoints as number;
        const queueType = entry.queueType as string;

        // Igual que el script viejo: solo se guarda una fila nueva
        // si de verdad cambió algo desde la última — si no, la tabla
        // no crece por gusto cada minuto que el rango sigue igual.
        const { data: last } = await supabase
          .from('rank_snapshots')
          .select('tier, division, lp')
          .eq('player_id', player.id)
          .eq('queue_type', queueType)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const sinCambios = last && last.tier === tier && last.division === division && last.lp === lp;
        if (!sinCambios) {
          await supabase.from('rank_snapshots').insert({
            player_id: player.id,
            queue_type: queueType,
            tier,
            division,
            lp,
            wins: entry.wins,
            losses: entry.losses,
            elo_score: eloScore(tier, division, lp),
          });
          log.push(`${player.riot_game_name}: ${queueType} -> ${tier} ${division} ${lp}LP`);
        }

        // Récord de LP de temporada — se compara SIEMPRE, haya cambiado
        // o no la fila de arriba (por si el rango se mantuvo pero de
        // todas formas es el mejor que ha tenido este jugador).
        if (queueType === 'RANKED_SOLO_5x5') {
          const eloActual = eloScore(tier, division, lp);
          if (eloActual !== null && (player.record_lp_score === null || eloActual > player.record_lp_score)) {
            const esRecordNuevo = player.record_lp_score !== null; // false = primera corrida, no hay "récord" que batir todavía
            const label = `${tier} ${division}`.trim() + (lp ? ` (${lp} LP)` : '');
            await supabase.from('players').update({ record_lp_score: eloActual, record_lp_label: label }).eq('id', player.id);
            if (esRecordNuevo) {
              await supabase.from('events').insert({
                type: 'record_lp', category: 'record_lp', player_id: player.id, detail: label,
              });
              log.push(`${player.riot_game_name}: nuevo récord de temporada (${label})`);
            }
          }
        }
      }

      // ── Maestrías — top 3 campeones por puntos ──────────────────
      const topMasteries = await riotFetch(
        `https://${REGION_GAME}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=3`
      );
      await supabase.from('player_masteries').delete().eq('player_id', player.id);
      if (Array.isArray(topMasteries) && topMasteries.length) {
        await supabase.from('player_masteries').insert(
          topMasteries.map((m: any, i: number) => ({
            player_id: player.id,
            rank: i + 1,
            champion: champDict.get(m.championId) ?? 'Desconocido',
            level: m.championLevel,
            points: m.championPoints,
          }))
        );
      }
    } catch (e) {
      log.push(`ERROR ${player.riot_game_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Adelantamientos de ranking (SoloQ) ──────────────────────────
  // Compara la posición de ESTA corrida contra la de la corrida
  // anterior (guardada en ranking_positions) para detectar quién
  // superó a quién. No pide nada nuevo a Riot — usa los mismos
  // rank_snapshots que ya se acaban de guardar arriba.
  const { data: latestSolo } = await supabase
    .from('rank_snapshots')
    .select('player_id, elo_score, recorded_at')
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .order('recorded_at', { ascending: false });

  const eloPorJugador = new Map<string, number>();
  for (const row of latestSolo ?? []) {
    if (!eloPorJugador.has(row.player_id) && row.elo_score !== null) eloPorJugador.set(row.player_id, row.elo_score);
  }
  const ordenados = [...eloPorJugador.entries()].sort((a, b) => b[1] - a[1]);
  const posicionActual = new Map<string, number>();
  ordenados.forEach(([playerId], idx) => posicionActual.set(playerId, idx + 1));

  const { data: posicionesPrevias } = await supabase.from('ranking_positions').select('player_id, position');
  const posicionAnterior = new Map<string, number>((posicionesPrevias ?? []).map((p) => [p.player_id, p.position]));

  const paresNotificados = new Set<string>();
  for (const [playerIdI, posNowI] of posicionActual) {
    const posPrevI = posicionAnterior.get(playerIdI);
    if (posPrevI === undefined || posNowI >= posPrevI) continue;
    for (const [playerIdJ, posNowJ] of posicionActual) {
      if (playerIdJ === playerIdI) continue;
      const posPrevJ = posicionAnterior.get(playerIdJ);
      if (posPrevJ === undefined) continue;
      if (!(posPrevI > posPrevJ && posNowI < posNowJ)) continue;
      const clave = [playerIdI, playerIdJ].sort().join('-');
      if (paresNotificados.has(clave)) continue;
      paresNotificados.add(clave);

      await supabase.from('events').insert({
        type: 'adelantamiento', category: 'adelantamiento',
        player_id: playerIdI, previous_player_id: playerIdJ, detail: null,
      });
      log.push(`Adelantamiento: ${playerIdI} superó a ${playerIdJ}`);
    }
  }

  for (const [playerId, position] of posicionActual) {
    await supabase.from('ranking_positions').upsert({ player_id: playerId, position, updated_at: new Date().toISOString() });
  }

  return new Response(JSON.stringify({ ok: true, log }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
