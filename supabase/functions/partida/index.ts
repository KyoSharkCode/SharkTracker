// Edge Function — Página de partida (partidas.html).
//
// POST { action: 'detalle', match_id }
//   Devuelve el detalle completo de la partida (10 jugadores, objetos,
//   runas, hechizos, baneos, stats) + el timeline recortado (oro por
//   minuto y objetivos). La PRIMERA vez lo pide a Riot y lo guarda en
//   match_details; después sale de ahí sin volver a llamar a Riot.
//   Solo se aceptan partidas donde jugó alguien del roster, para que
//   nadie pueda usar la API key con partidas ajenas.
//
// POST { action: 'analisis', match_id, player_id }
//   Análisis de IA (Gemini) de ESE jugador del roster en ESA partida.
//   Se genera solo cuando alguien lo pide y queda guardado en match_ai
//   para siempre: la partida ya jugada nunca cambia.
//
// "Verify JWT" puede quedar ENCENDIDO: la página la llama con la anon key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
const GEMINI_API_KEY = (Deno.env.get('GEMINI_API_KEY') ?? '').trim();
const REGION_API = 'americas';
// Si cambia el prompt o el formato del análisis, subir este número:
// los análisis guardados con otra versión se regeneran al pedirlos.
const AI_VERSION = 1;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const QUEUE_NAMES: Record<number, string> = {
  420: 'SoloQ', 440: 'Flex', 400: 'Reclutamiento', 430: 'Normal (a ciegas)', 490: 'Normal (Quickplay)',
  450: 'ARAM', 1700: 'Arena', 1710: 'Arena', 900: 'URF', 1900: 'URF', 1020: 'Uno para todos',
  700: 'Clash', 720: 'Clash ARAM', 480: 'Swiftplay', 0: 'Personalizada',
};

async function riot(url: string) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
  if (res.status === 404) throw new HttpError(404, 'Riot no encontró esa partida.');
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'La API key de Riot venció o no es válida (renuévala en los Secrets).');
  if (res.status === 429) throw new HttpError(503, 'Riot está limitando las consultas. Prueba de nuevo en un minuto.');
  if (!res.ok) throw new HttpError(502, `Riot respondió ${res.status}.`);
  return res.json();
}
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

// ── Recorte del detalle de Riot: solo lo que la página usa ──
function trimMatch(md: any) {
  const info = md.info;
  const participants = (info.participants ?? []).map((p: any) => {
    const styles = p.perks?.styles ?? [];
    const ch = p.challenges ?? {};
    return {
      participantId: p.participantId,
      puuid: p.puuid,
      riotIdGameName: p.riotIdGameName ?? p.summonerName ?? '',
      riotIdTagline: p.riotIdTagline ?? '',
      profileIcon: p.profileIcon,
      championName: p.championName,
      championId: p.championId,
      champLevel: p.champLevel,
      teamId: p.teamId,
      subteamId: p.playerSubteamId ?? null,       // Arena
      placement: p.placement ?? p.subteamPlacement ?? null, // Arena
      teamPosition: p.teamPosition || p.individualPosition || '',
      win: !!p.win,
      kills: p.kills, deaths: p.deaths, assists: p.assists,
      cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
      gold: p.goldEarned,
      damage: p.totalDamageDealtToChampions,
      damageTaken: p.totalDamageTaken,
      mitigated: p.damageSelfMitigated,
      heal: p.totalHeal,
      shield: p.totalDamageShieldedOnTeammates,
      ccTime: p.timeCCingOthers,
      vision: p.visionScore,
      wardsPlaced: p.wardsPlaced, wardsKilled: p.wardsKilled, controlWards: p.visionWardsBoughtInGame,
      turretKills: p.turretKills, objectivesStolen: p.objectivesStolen,
      damageToObjectives: p.damageDealtToObjectives, damageToBuildings: p.damageDealtToBuildings,
      largestMultiKill: p.largestMultiKill, doubles: p.doubleKills, triples: p.tripleKills, quadras: p.quadraKills, pentas: p.pentaKills,
      firstBlood: !!p.firstBloodKill,
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      augments: [p.playerAugment1, p.playerAugment2, p.playerAugment3, p.playerAugment4].filter((a: number) => a),
      spells: [p.summoner1Id, p.summoner2Id],
      runes: {
        primaryStyle: styles[0]?.style ?? null,
        subStyle: styles[1]?.style ?? null,
        primary: (styles[0]?.selections ?? []).map((s: any) => s.perk),
        secondary: (styles[1]?.selections ?? []).map((s: any) => s.perk),
        shards: [p.perks?.statPerks?.offense, p.perks?.statPerks?.flex, p.perks?.statPerks?.defense].filter(Boolean),
      },
      killParticipation: ch.killParticipation ?? null,
      soloKills: ch.soloKills ?? null,
      csAt10: ch.laneMinionsFirst10Minutes ?? null,
      goldPerMinute: ch.goldPerMinute ?? null,
      damagePerMinute: ch.damagePerMinute ?? null,
      visionPerMinute: ch.visionScorePerMinute ?? null,
      maxCsAdvantage: ch.maxCsAdvantageOnLaneOpponent ?? null,
      skillshotsDodged: ch.skillshotsDodged ?? null,
      remake: !!p.gameEndedInEarlySurrender,
    };
  });
  const teams = (info.teams ?? []).map((t: any) => ({
    teamId: t.teamId,
    win: !!t.win,
    bans: (t.bans ?? []).map((b: any) => b.championId).filter((id: number) => id > 0),
    objectives: {
      champion: t.objectives?.champion?.kills ?? 0,
      tower: t.objectives?.tower?.kills ?? 0,
      inhibitor: t.objectives?.inhibitor?.kills ?? 0,
      dragon: t.objectives?.dragon?.kills ?? 0,
      baron: t.objectives?.baron?.kills ?? 0,
      riftHerald: t.objectives?.riftHerald?.kills ?? 0,
      horde: t.objectives?.horde?.kills ?? 0,
      atakhan: t.objectives?.atakhan?.kills ?? 0,
    },
  }));
  return {
    matchId: md.metadata?.matchId,
    queueId: info.queueId,
    queueName: QUEUE_NAMES[info.queueId] ?? info.gameMode ?? 'Partida',
    gameMode: info.gameMode,
    mapId: info.mapId,
    duration: info.gameDuration,
    startedAt: info.gameStartTimestamp ?? info.gameCreation,
    endedAt: info.gameEndTimestamp ?? (info.gameCreation + info.gameDuration * 1000),
    patch: (info.gameVersion ?? '').split('.').slice(0, 2).join('.'),
    teams,
    participants,
  };
}

// ── Recorte del timeline: oro total de cada jugador por minuto + objetivos ──
function trimTimeline(tl: any, participants: any[]) {
  const teamOf = new Map<number, number>(participants.map((p) => [p.participantId, p.teamId]));
  const frames = (tl.info?.frames ?? []).map((f: any) => {
    const gold: Record<string, number> = {};
    const cs: Record<string, number> = {};
    for (const [pid, pf] of Object.entries<any>(f.participantFrames ?? {})) {
      gold[pid] = pf.totalGold ?? 0;
      cs[pid] = (pf.minionsKilled ?? 0) + (pf.jungleMinionsKilled ?? 0);
    }
    return { t: Math.round((f.timestamp ?? 0) / 1000), gold, cs };
  });
  const events: any[] = [];
  for (const f of tl.info?.frames ?? []) {
    for (const e of f.events ?? []) {
      const t = Math.round((e.timestamp ?? 0) / 1000);
      if (e.type === 'ELITE_MONSTER_KILL') {
        const team = e.killerTeamId ?? teamOf.get(e.killerId);
        events.push({ t, type: e.monsterType, sub: e.monsterSubType ?? null, team });
      } else if (e.type === 'BUILDING_KILL') {
        // teamId = dueño del edificio; lo gana el otro equipo.
        events.push({ t, type: e.buildingType === 'INHIBITOR_BUILDING' ? 'INHIBITOR' : 'TOWER', team: e.teamId === 100 ? 200 : 100, lane: e.laneType ?? null });
      } else if (e.type === 'CHAMPION_KILL') {
        events.push({ t, type: 'KILL', team: teamOf.get(e.killerId) ?? (teamOf.get(e.victimId) === 100 ? 200 : 100), killer: e.killerId, victim: e.victimId });
      }
    }
  }
  return { frames, events };
}

async function getRosterPuuids(): Promise<Map<string, string>> {
  const { data } = await supabase.from('players').select('id, puuid').not('puuid', 'is', null);
  return new Map((data ?? []).map((p: any) => [p.puuid, p.id]));
}

async function detalle(matchId: string) {
  const { data: cached } = await supabase.from('match_details').select('data, timeline').eq('match_id', matchId).maybeSingle();
  if (cached) return { data: cached.data, timeline: cached.timeline, cached: true };

  const md = await riot(`https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/${matchId}`);
  const roster = await getRosterPuuids();
  if (!(md.info?.participants ?? []).some((p: any) => roster.has(p.puuid))) {
    throw new HttpError(403, 'En esa partida no jugó nadie del roster.');
  }
  const data = trimMatch(md);
  let timeline = null;
  try {
    const tl = await riot(`https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`);
    timeline = trimTimeline(tl, data.participants);
  } catch (_) { /* sin timeline: la página se muestra igual, sin la gráfica */ }

  await supabase.from('match_details').upsert({ match_id: matchId, data, timeline });
  return { data, timeline, cached: false };
}

const fmtMin = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const EVENT_ES: Record<string, string> = {
  DRAGON: 'Dragón', BARON_NASHOR: 'Barón', RIFTHERALD: 'Heraldo', HORDE: 'Larvas del Vacío', ATAKHAN: 'Atakhan',
  ELDER_DRAGON: 'Dragón Ancestral', TOWER: 'Torre', INHIBITOR: 'Inhibidor',
};

async function analisis(matchId: string, playerId: string) {
  const { data: prev } = await supabase.from('match_ai').select('analysis, version').eq('match_id', matchId).eq('player_id', playerId).maybeSingle();
  if (prev && prev.version === AI_VERSION) return { analysis: prev.analysis, cached: true };
  if (!GEMINI_API_KEY) throw new HttpError(503, 'Falta configurar GEMINI_API_KEY.');

  const { data: player } = await supabase.from('players').select('id, puuid, riot_game_name, primary_role').eq('id', playerId).maybeSingle();
  if (!player?.puuid) throw new HttpError(404, 'Jugador no encontrado.');
  const { data: d, timeline: tl } = await detalle(matchId);
  const me = d.participants.find((p: any) => p.puuid === player.puuid);
  if (!me) throw new HttpError(400, 'Ese jugador no jugó esta partida.');
  if (me.remake) throw new HttpError(400, 'Fue un remake: no hay nada que analizar.');

  const mins = Math.max(1, d.duration / 60);
  const arena = d.participants.some((p: any) => p.subteamId);
  const fila = (p: any) => `${p.championName} (${p.teamPosition || '-'}) ${p.kills}/${p.deaths}/${p.assists}, ${p.cs} CS (${(p.cs / mins).toFixed(1)}/min), oro ${p.gold}, daño ${p.damage}, visión ${p.vision}`;
  const aliados = d.participants.filter((p: any) => (arena ? p.subteamId === me.subteamId : p.teamId === me.teamId) && p.puuid !== me.puuid);
  const rivales = d.participants.filter((p: any) => (arena ? p.subteamId !== me.subteamId : p.teamId !== me.teamId));
  const rivalCarril = !arena && me.teamPosition ? rivales.find((p: any) => p.teamPosition === me.teamPosition) : null;

  // Momentos clave desde el timeline: diferencia de oro por minuto + objetivos.
  let lineaOro = '';
  let objetivos = '';
  if (tl?.frames?.length && !arena) {
    const ids = (team: number) => d.participants.filter((p: any) => p.teamId === team).map((p: any) => String(p.participantId));
    const mine = ids(me.teamId), theirs = ids(me.teamId === 100 ? 200 : 100);
    const diffs = tl.frames.map((f: any) => {
      const a = mine.reduce((s: number, id: string) => s + (f.gold[id] ?? 0), 0);
      const b = theirs.reduce((s: number, id: string) => s + (f.gold[id] ?? 0), 0);
      return `${Math.round(f.t / 60)}': ${a - b >= 0 ? '+' : ''}${a - b}`;
    });
    lineaOro = diffs.filter((_: string, i: number) => i % 3 === 0 || i === diffs.length - 1).join(', ');
    objetivos = (tl.events ?? []).filter((e: any) => e.type !== 'KILL')
      .map((e: any) => `${fmtMin(e.t)} ${EVENT_ES[e.type] ?? e.type} para ${e.team === me.teamId ? 'su equipo' : 'el rival'}`).join('; ');
    const muertes = (tl.events ?? []).filter((e: any) => e.type === 'KILL' && e.victim === me.participantId).map((e: any) => fmtMin(e.t));
    if (muertes.length) objetivos += `\nMinutos en los que murió: ${muertes.join(', ')}`;
  }

  const prompt = `Eres un coach de League of Legends que habla en español neutro, directo y amable.
Analiza la actuación de ${player.riot_game_name} en ESTA partida concreta. Basate SOLO en estos datos (no inventes lo que no está).

Modo: ${d.queueName}. Duración: ${fmtMin(d.duration)}. Resultado: ${me.win ? 'VICTORIA' : 'DERROTA'}${arena ? `, puesto ${me.placement}` : ''}.
Rol principal habitual: ${player.primary_role ?? 'desconocido'}. Rol en esta partida: ${me.teamPosition || 'sin rol fijo'}.
Su partida: ${fila(me)}. Nivel ${me.champLevel}. Participación en kills: ${me.killParticipation != null ? Math.round(me.killParticipation * 100) + '%' : '?'}.
Daño recibido ${me.damageTaken}, mitigado ${me.mitigated}, curación ${me.heal}, CC ${me.ccTime}s. Wards: ${me.wardsPlaced} puestas, ${me.wardsKilled} destruidas, ${me.controlWards} de control.
CS a los 10 min: ${me.csAt10 ?? '?'}. Kills en solitario: ${me.soloKills ?? '?'}. Daño a objetivos: ${me.damageToObjectives}.
${rivalCarril ? `Rival directo: ${fila(rivalCarril)}.` : ''}
Aliados: ${aliados.map(fila).join(' | ')}
Rivales: ${rivales.map(fila).join(' | ')}
${lineaOro ? `Diferencia de oro de su equipo por minuto: ${lineaOro}` : ''}
${objetivos ? `Objetivos y momentos: ${objetivos}` : ''}

Responde SOLO con JSON válido, sin texto extra, con esta forma:
{
  "resumen": "2-3 frases: cómo fue su partida y qué la decidió",
  "nota": número del 1 al 10 (su desempeño, no el resultado),
  "bien": ["punto fuerte concreto con números", "..."],
  "mejorar": ["error o área de mejora concreta con números", "..."],
  "momentos": [{"minuto": "mm:ss", "texto": "qué pasó y por qué importó"}],
  "consejos": ["consejo accionable para la próxima partida", "..."]
}
"bien" y "mejorar": 2 a 4 elementos cada uno. "momentos": 2 a 4 (usa los minutos del timeline si los hay; si no, déjalo vacío). "consejos": 3 elementos. Frases cortas.`;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
  const res = await fetch(`${url}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 1200, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new HttpError(502, `La IA respondió ${res.status}. Prueba de nuevo en un rato.`);
  const out = await res.json();
  const texto: string = out?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let analysis: any = null;
  try { analysis = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* formato raro */ }
  if (!analysis || typeof analysis.resumen !== 'string' || !Array.isArray(analysis.consejos)) {
    throw new HttpError(502, 'La IA devolvió un formato inesperado, prueba de nuevo en un rato.');
  }
  await supabase.from('match_ai').upsert({ match_id: matchId, player_id: playerId, analysis, version: AI_VERSION, created_at: new Date().toISOString() });
  return { analysis, cached: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const matchId = String(body?.match_id ?? '');
  if (!/^[A-Z0-9]{2,5}_\d{5,15}$/.test(matchId)) return json({ error: 'match_id inválido' }, 400);
  try {
    if (body.action === 'analisis') {
      const playerId = String(body?.player_id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(playerId)) return json({ error: 'player_id inválido' }, 400);
      return json(await analisis(matchId, playerId));
    }
    return json(await detalle(matchId));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message ?? 'Error inesperado' }, 500);
  }
});
