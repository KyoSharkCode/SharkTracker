// Edge Function — Etapa 4: quién está jugando ahora mismo.
// Reemplaza OLD/live_status.py. Escribe en live_status + live_games.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const REGION_GAME = 'la1';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DDRAGON_TTL_MS = 60 * 60 * 1000; // revisar si hay parche nuevo como mucho 1 vez por hora

// Mismo mapeo que sync-matches, para nombrar el modo de juego en vivo.
const QUEUE_NAMES: Record<number, string> = {
  490: 'Partida Rápida', 420: 'Solo/Duo', 400: 'Reclutamiento', 440: 'Flex',
  430: 'LoL Classic', 450: 'ARAM', 2400: 'ARAM', 700: 'Clash', 1700: 'Arena', 1710: 'Arena', 1720: 'Arena', 1750: 'Arena',
};

async function getChampionDict(): Promise<Map<number, string>> {
  const { data: cached } = await supabase.from('ddragon_cache').select('version, champions, updated_at').maybeSingle();

  // Si se revisó hace menos de 1 hora, se usa tal cual (el parche cambia
  // cada ~2 semanas: no hace falta preguntarle a Riot cada minuto).
  const fresco = cached?.updated_at && Date.now() - new Date(cached.updated_at).getTime() < DDRAGON_TTL_MS;
  let championsData: Record<string, any>;
  if (cached && fresco) {
    championsData = cached.champions;
  } else {
    const versions: string[] = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
    const latest = versions[0];
    if (cached && cached.version === latest) {
      championsData = cached.champions;
      await supabase.from('ddragon_cache').update({ updated_at: new Date().toISOString() }).eq('id', true);
    } else {
      const champJson = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${latest}/data/es_ES/champion.json`
      ).then((r) => r.json());
      championsData = champJson.data;
      await supabase.from('ddragon_cache').upsert({
        id: true, version: latest, champions: championsData, updated_at: new Date().toISOString(),
      });
    }
  }

  const dict = new Map<number, string>();
  for (const info of Object.values<any>(championsData)) dict.set(parseInt(info.key), info.id);
  return dict;
}

function extraerRunas(p: any) {
  const perks = p.perks ?? {};
  const perkIds = perks.perkIds ?? [];
  return { principal: perkIds[0] ?? null, secundario: perks.perkSubStyle ?? null };
}

function nombreRiot(p: any): string {
  if (p.riotId) return p.riotId;
  const gameName = p.riotIdGameName ?? p.gameName;
  const tagLine = p.riotIdTagline ?? p.tagLine;
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  return gameName ?? p.summonerName ?? 'Desconocido';
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: players, error } = await supabase
    .from('players').select('id, puuid, riot_game_name').not('puuid', 'is', null);
  if (error) return new Response(error.message, { status: 500 });

  const champDict = await getChampionDict();
  const log: string[] = [];
  const seenGames = new Set<number>();

  // Estado guardado de todos de una vez: solo se escribe cuando algo cambia.
  // (Antes se reescribía cada minuto aunque todo siguiera igual, y cada
  // escritura hacía recargar todas las páginas abiertas.)
  const { data: prevRows } = await supabase
    .from('live_status').select('player_id, in_game, game_id, champion, team');
  const prevByPlayer = new Map((prevRows ?? []).map((r: any) => [r.player_id, r]));

  for (const player of players ?? []) {
    try {
      const prevStatus: any = prevByPlayer.get(player.id) ?? null;
      const res = await fetch(
        `https://${REGION_GAME}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${player.puuid}`,
        { headers: { 'X-Riot-Token': RIOT_API_KEY } }
      );

      if (res.status === 404) {
        // No está en partida: solo se escribe si antes figuraba en una (o no había fila).
        if (prevStatus && !prevStatus.in_game) continue;
        const { error: upErr } = await supabase.from('live_status').upsert({
          player_id: player.id, in_game: false, game_id: null,
          champion: null, team: null, runes: null, summoner_spells: null,
          updated_at: new Date().toISOString(),
        });
        if (upErr) log.push(`ERROR ${player.riot_game_name}: ${upErr.message}`);
        continue;
      }

      if (res.status !== 200) {
        // 401/403/5xx — no confiable, no tocar lo que ya había guardado.
        log.push(`${player.riot_game_name}: spectator -> ${res.status}`);
        continue;
      }

      const body = await res.json();
      const participante = (body.participants ?? []).find((p: any) => p.puuid === player.puuid);
      if (!participante) continue;

      const gameId = body.gameId as number;
      const queueName = QUEUE_NAMES[body.gameQueueConfigId] ?? 'Modo Destacado';
      const equipo = participante.teamId === 100 ? 'blue' : 'red';
      const campeon = champDict.get(participante.championId) ?? 'Desconocido';

      // Rivalidad en vivo — otro del grupo en la MISMA partida pero
      // equipo CONTRARIO, y esto es nuevo (no se avisó ya en la corrida
      // anterior para esta misma partida).
      const esPartidaNueva = prevStatus?.game_id !== gameId;

      if (esPartidaNueva) {
        const { data: enMismaPartida } = await supabase
          .from('live_status').select('player_id, team')
          .eq('game_id', gameId).eq('in_game', true).neq('player_id', player.id);
        for (const otro of enMismaPartida ?? []) {
          if (otro.team && otro.team !== equipo) {
            await supabase.from('events').insert({
              type: 'rivalidad', category: 'rivalidad',
              player_id: player.id, previous_player_id: otro.player_id, detail: null,
            });
          }
        }
      }

      const sinCambios = prevStatus?.in_game && !esPartidaNueva
        && prevStatus.champion === campeon && prevStatus.team === equipo;
      if (!sinCambios) {
        const { error: upErr } = await supabase.from('live_status').upsert({
          player_id: player.id,
          in_game: true,
          game_id: gameId,
          champion: campeon,
          team: equipo,
          runes: extraerRunas(participante),
          summoner_spells: [participante.spell1Id, participante.spell2Id],
          updated_at: new Date().toISOString(),
        });
        if (upErr) log.push(`ERROR ${player.riot_game_name}: ${upErr.message}`);
      }

      // Lobby completo — una sola vez por gameId, aunque varios del
      // grupo compartan la misma partida. Solo se escribe si la partida es
      // nueva o si recién ahora Riot da la hora de inicio (en la pantalla
      // de carga todavía no la tiene).
      if (!seenGames.has(gameId)) {
        seenGames.add(gameId);
        const startedAt = body.gameStartTime ? new Date(body.gameStartTime).toISOString() : null;
        const { data: lgPrev } = await supabase
          .from('live_games').select('started_at').eq('game_id', gameId).maybeSingle();
        const lgSinCambios = lgPrev && (lgPrev.started_at !== null || startedAt === null);
        if (!lgSinCambios) {
          const participantes = (body.participants ?? []).map((p: any) => ({
            nombre: nombreRiot(p),
            campeon: champDict.get(p.championId) ?? 'Desconocido',
            equipo: p.teamId === 100 ? 'blue' : 'red',
            icono_invocador: p.profileIconId,
            hechizos: [p.spell1Id, p.spell2Id],
            runas: extraerRunas(p),
          }));
          const baneos = (body.bannedChampions ?? [])
            .sort((a: any, b: any) => (a.pickTurn ?? 0) - (b.pickTurn ?? 0))
            .map((b: any) => ({
              campeon: (b.championId ?? -1) > -1 ? (champDict.get(b.championId) ?? 'Desconocido') : null,
              equipo: b.teamId === 100 ? 'blue' : 'red',
            }));

          const { error: lgErr } = await supabase.from('live_games').upsert({
            game_id: gameId,
            queue_type: queueName,
            started_at: startedAt,
            bans: baneos,
            participants: participantes,
            updated_at: new Date().toISOString(),
          });
          if (lgErr) log.push(`ERROR partida ${gameId}: ${lgErr.message}`);
        }
      }

      log.push(`${player.riot_game_name}: en partida (${queueName})`);
    } catch (e) {
      log.push(`ERROR ${player.riot_game_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, log }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
