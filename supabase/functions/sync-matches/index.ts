// Cron: cada 3 min (ver cron job "sync-matches-every-3min").
// Edge Function — Etapa 2: historial de partidas (TODOS los modos,
// no solo SoloQ). Reemplaza la mitad de partidas de
// OLD/actualizar_datos.py. Guarda en matches + match_participants.
//
// Pendiente para una etapa futura (no aquí todavía):
//  - consejos de IA (ai_advice)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const REGION_API = 'americas';
const REGION_PARTIDA = 'LA1'; // prefijo de los match_id (servidor la1)
const MATCH_HISTORY_COUNT = 10;
const HISTORY_DAYS = 30; // igual que cleanup_old_history()

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Mismo mapeo que ya tenía live_status.py para queues no-rankeadas.
const QUEUE_NAMES: Record<number, string> = {
  490: 'Partida Rápida', 420: 'Solo/Duo', 400: 'Reclutamiento', 440: 'Flex',
  430: 'LoL Classic', 450: 'ARAM', 2400: 'ARAM', 700: 'Clash', 1700: 'Arena', 1710: 'Arena', 1720: 'Arena', 1750: 'Arena',
};

class LimiteRiot extends Error {}

async function riotFetch(url: string) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
  // Límite de la key: no tiene sentido seguir con los demás jugadores en esta corrida.
  if (res.status === 429) throw new LimiteRiot('Riot: límite de peticiones (429), se sigue en la próxima corrida');
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// LP ganado/perdido en UNA partida SoloQ: compara el elo_score justo
// antes y justo después del fin de la partida, usando los mismos
// rank_snapshots que ya guarda sync-riot-data. Si no hay un punto de
// rango a ambos lados (p.ej. partida muy vieja, o el jugador aún no
// tenía historial), devuelve null en vez de adivinar.
async function calcularLpChange(playerId: string, endedAtIso: string): Promise<number | null> {
  const { data: antes } = await supabase
    .from('rank_snapshots').select('elo_score')
    .eq('player_id', playerId).eq('queue_type', 'RANKED_SOLO_5x5')
    .lte('recorded_at', endedAtIso).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
  const { data: despues } = await supabase
    .from('rank_snapshots').select('elo_score')
    .eq('player_id', playerId).eq('queue_type', 'RANKED_SOLO_5x5')
    .gt('recorded_at', endedAtIso).order('recorded_at', { ascending: true }).limit(1).maybeSingle();
  if (!antes || !despues || antes.elo_score == null || despues.elo_score == null) return null;
  return despues.elo_score - antes.elo_score;
}

// Día de referencia = 6AM hora de España (mismo criterio que "Sin
// Rendirse" en compute_recent_badges, pero calculado en JS porque
// esta función sí necesita cruzarlo contra timestamps de partidas).
function offsetMadridMinutos(fecha: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' }).formatToParts(fecha);
  const match = (partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1').match(/GMT([+-]\d+)/);
  return (match ? parseInt(match[1]) : 1) * 60;
}
function inicioDiaMadridUTC(fecha: Date): Date {
  const offsetMin = offsetMadridMinutos(fecha);
  const muroMadrid = new Date(fecha.getTime() + offsetMin * 60000);
  const hora = muroMadrid.getUTCHours();
  const inicioMuro = new Date(Date.UTC(
    muroMadrid.getUTCFullYear(), muroMadrid.getUTCMonth(), muroMadrid.getUTCDate() - (hora < 6 ? 1 : 0), 6, 0, 0
  ));
  return new Date(inicioMuro.getTime() - offsetMin * 60000);
}

async function diagnostico(nombre: string): Promise<Response> {
  const { data: jugadores } = await supabase.from('players')
    .select('id, riot_game_name, riot_tag_line, puuid').ilike('riot_game_name', `${nombre}%`);
  const salida: any[] = [];
  for (const j of jugadores ?? []) {
    const r: any = { jugador: `${j.riot_game_name}#${j.riot_tag_line}`, puuid_inicio: j.puuid?.slice(0, 12) ?? null };
    const intento = async (clave: string, fn: () => Promise<any>) => {
      try { r[clave] = await fn(); } catch (e) { r[clave] = `ERROR: ${e instanceof Error ? e.message.replace(RIOT_API_KEY, '***') : e}`; }
    };
    if (j.puuid) {
      // ¿De qué cuenta es el PUUID guardado?
      await intento('cuenta_del_puuid', async () => {
        const a = await riotFetch(`https://${REGION_API}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${j.puuid}`);
        return `${a.gameName}#${a.tagLine}`;
      });
      const desde = Math.floor((Date.now() - HISTORY_DAYS * 86400000) / 1000);
      await intento('ids_30_dias', () => riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${j.puuid}/ids?startTime=${desde}&start=0&count=${MATCH_HISTORY_COUNT}`));
      await intento('ids_sin_filtro', () => riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${j.puuid}/ids?start=0&count=${MATCH_HISTORY_COUNT}`));
      // ARAM: Caos (cola 2400): ¿la lista con filtro de cola sí la trae?
      await intento('ids_cola_2400', () => riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${j.puuid}/ids?queue=2400&start=0&count=${MATCH_HISTORY_COUNT}`));
      await intento('ids_cola_450', () => riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${j.puuid}/ids?queue=450&start=0&count=${MATCH_HISTORY_COUNT}`));
      // ¿Se pueden pedir por id las partidas suyas que vimos en vivo?
      const { data: vivas } = await supabase.from('live_games').select('game_id, participants').order('updated_at', { ascending: false }).limit(200);
      const suyas = (vivas ?? []).filter((v: any) => JSON.stringify(v.participants ?? []).includes(j.riot_game_name.trim())).slice(0, 3);
      r.vistas_en_vivo_por_id = [];
      for (const v of suyas) {
        const id = `${REGION_PARTIDA}_${v.game_id}`;
        const res = await fetch(`https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/${id}`, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
        const md = res.ok ? await res.json() : null;
        r.vistas_en_vivo_por_id.push({ match_id: id, http: res.status, cola: md?.info?.queueId ?? null,
          esta_el: md ? (md.info?.participants ?? []).some((p: any) => p.puuid === j.puuid) : null });
      }
      const todos = [...new Set([...(Array.isArray(r.ids_30_dias) ? r.ids_30_dias : []), ...(Array.isArray(r.ids_sin_filtro) ? r.ids_sin_filtro : [])])];
      const { data: guardadas } = todos.length ? await supabase.from('matches').select('match_id').in('match_id', todos) : { data: [] };
      const { data: conEl } = todos.length ? await supabase.from('match_participants').select('match_id').eq('player_id', j.id).in('match_id', todos) : { data: [] };
      r.guardadas = (guardadas ?? []).map((m: any) => m.match_id);
      r.con_el = (conEl ?? []).map((m: any) => m.match_id);
    }
    // ¿Qué cuenta corresponde HOY a su Riot ID?
    await intento('puuid_de_su_riot_id', async () => {
      const a = await riotFetch(`https://${REGION_API}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(j.riot_game_name.trim())}/${encodeURIComponent(j.riot_tag_line.trim())}`);
      return { inicio: a.puuid.slice(0, 12), igual_al_guardado: a.puuid === j.puuid };
    });
    salida.push(r);
  }
  return new Response(JSON.stringify(salida.length ? salida : { error: `No hay jugadores que empiecen por "${nombre}"` }, null, 2),
    { headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Modo diagnóstico (a mano, desde el SQL Editor): body {"diagnostico": "nombre"}.
  // No guarda nada: dice qué cuenta es el PUUID guardado y qué partidas lista Riot.
  const cuerpo = await req.json().catch(() => ({}));
  if (cuerpo?.diagnostico) return diagnostico(String(cuerpo.diagnostico));

  const { data: players, error } = await supabase
    .from('players')
    .select('id, puuid, riot_game_name')
    .not('puuid', 'is', null);
  if (error) return new Response(error.message, { status: 500 });

  // puuid -> player_id, para reconocer quién del grupo aparece en cada partida.
  const puuidToPlayerId = new Map<string, string>();
  const playerIdToName = new Map<string, string>();
  for (const p of players ?? []) {
    puuidToPlayerId.set(p.puuid as string, p.id as string);
    playerIdToName.set(p.id as string, p.riot_game_name as string);
  }

  // Caché compartida DENTRO de esta corrida — si dos del grupo jugaron
  // juntos, el detalle de esa partida se pide a Riot una sola vez.
  const matchCache = new Map<string, any>();
  // Cada línea se escribe también en Supabase → Edge Functions → sync-matches → Logs.
  const lineas: string[] = [];
  const log = { push: (texto: string) => { lineas.push(texto); console.log(`[sync-matches] ${texto}`); } };
  // Inserta un evento y lo anota en el log (o anota el error si falló).
  const evento = async (row: Record<string, unknown>, texto: string) => {
    const { error } = await supabase.from('events').insert(row);
    log.push(error ? `ERROR evento (${texto}): ${error.message}` : texto);
  };
  const diaInicio = inicioDiaMadridUTC(new Date());
  // Nombres de rol oficiales del sitio: TOP / JUNGLE / MID / ADC / SUPPORT.
  const mapaRoles: Record<string, string> = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUPPORT' };

  // Orden al azar en cada corrida: si Riot corta por límite, el que se queda sin
  // turno no es siempre el mismo (antes, los últimos de la lista podían no avanzar nunca).
  const turno = [...(players ?? [])].sort(() => Math.random() - 0.5);
  let cortado = false;

  // Riot a veces deja de actualizar la lista de partidas de una cuenta (a una
  // se le quedó congelada semanas aunque seguía jugando). Por eso también se
  // piden por su id las partidas que vimos EN VIVO (sync-live-status) o en la
  // pantalla de carga de la app en los últimos 2 días y que aún no están guardadas.
  const extraPorJugador = new Map<string, string[]>();
  try {
    const hace = new Date(Date.now() - 2 * 86400000).toISOString();
    const [{ data: vivas }, { data: cargas }] = await Promise.all([
      supabase.from('live_games').select('game_id').gte('updated_at', hace),
      supabase.from('carga_partidas').select('game_id').gte('updated_at', hace),
    ]);
    const vistas = [...new Set([...(vivas ?? []), ...(cargas ?? [])].map((x: any) => `${REGION_PARTIDA}_${x.game_id}`))];
    const { data: ya } = vistas.length ? await supabase.from('matches').select('match_id').in('match_id', vistas) : { data: [] };
    const guardadasYa = new Set((ya ?? []).map((m: any) => m.match_id));
    for (const matchId of vistas.filter((id) => !guardadasYa.has(id))) {
      const res = await fetch(`https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/${matchId}`, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
      if (res.status === 429) throw new LimiteRiot('Riot: límite de peticiones (429), se sigue en la próxima corrida');
      if (!res.ok) { // 404: sigue en curso o Riot no la publica
        if (res.status !== 404) log.push(`Partida vista en vivo ${matchId}: Riot respondió ${res.status}`);
        continue;
      }
      const detalle = await res.json();
      matchCache.set(matchId, detalle);
      for (const p of detalle.info?.participants ?? []) {
        const pid = puuidToPlayerId.get(p.puuid);
        if (pid) extraPorJugador.set(pid, [...(extraPorJugador.get(pid) ?? []), matchId]);
      }
    }
  } catch (e) {
    if (e instanceof LimiteRiot) cortado = true;
    log.push(`ERROR partidas vistas en vivo: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const player of turno) {
    if (cortado) break;
    try {
      // Solo partidas de los últimos 30 días (lo mismo que conserva la limpieza
      // diaria). Si no, las de un jugador inactivo se borraban cada noche y se
      // volvían a "descubrir" al rato, repitiendo sus logros en el feed.
      const desde = Math.floor((Date.now() - HISTORY_DAYS * 86400000) / 1000);
      const deRiot: string[] = await riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?startTime=${desde}&start=0&count=${MATCH_HISTORY_COUNT}`
      );
      const extra = (extraPorJugador.get(player.id) ?? []).filter((id) => !deRiot.includes(id));
      if (extra.length) log.push(`${player.riot_game_name}: ${extra.length} partida(s) vistas en vivo que Riot no lista en su historial`);
      const ids = [...deRiot, ...extra];

      // Qué partidas ya están guardadas, y en cuáles ya está ESTE jugador. Una partida
      // con amigos se guarda una sola vez para todos: si al guardarla no se reconoció
      // a este jugador (p. ej. su PUUID estaba desactualizado), quedaba fuera para
      // siempre. Ahora se le añade.
      const [{ data: existentes, error: existErr }, { data: mias, error: miasErr }] = ids.length
        ? await Promise.all([
          supabase.from('matches').select('match_id').in('match_id', ids),
          supabase.from('match_participants').select('match_id').eq('player_id', player.id).in('match_id', ids),
        ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (existErr) throw existErr;
      if (miasErr) throw miasErr;
      const yaGuardadas = new Set((existentes ?? []).map((m: any) => m.match_id));
      const conEl = new Set((mias ?? []).map((m: any) => m.match_id));
      const pendientes = ids.filter((id) => !conEl.has(id)).length;
      if (!ids.length) log.push(`${player.riot_game_name}: Riot no devuelve partidas suyas en los últimos ${HISTORY_DAYS} días`);
      else if (pendientes) log.push(`${player.riot_game_name}: ${ids.length} partidas recientes en Riot, ${pendientes} por guardar`);

      for (const matchId of ids) {
        if (conEl.has(matchId)) continue;
        const soloFaltaEl = yaGuardadas.has(matchId);

        if (!matchCache.has(matchId)) {
          const detail = await riotFetch(`https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/${matchId}`);
          matchCache.set(matchId, detail);
        }
        const md = matchCache.get(matchId);
        const info = md.info;

        // Daño recibido TOTAL por equipo (los 10, no solo el grupo) — para
        // poder calcular después qué % absorbió cada uno de los suyos
        // ("El Defensor"). Y qué jugadores del grupo cayeron en el mismo
        // equipo en esta partida — para "Dúo Dinámico".
        const teamDamageTotals: Record<number, number> = {};
        // Kills y daño a campeones de cada equipo — para la participación en
        // kills y el % de daño (puntuación de "Mejor partida del mes").
        const teamKills: Record<number, number> = {};
        const teamChampDamage: Record<number, number> = {};
        const trackedByTeam: Record<number, { playerId: string; name: string }[]> = {};
        for (const p of info.participants ?? []) {
          teamDamageTotals[p.teamId] = (teamDamageTotals[p.teamId] ?? 0) + (p.totalDamageTaken ?? 0);
          teamKills[p.teamId] = (teamKills[p.teamId] ?? 0) + (p.kills ?? 0);
          teamChampDamage[p.teamId] = (teamChampDamage[p.teamId] ?? 0) + (p.totalDamageDealtToChampions ?? 0);
          const pid = puuidToPlayerId.get(p.puuid);
          if (pid) {
            (trackedByTeam[p.teamId] ??= []).push({ playerId: pid, name: playerIdToName.get(pid) ?? '' });
          }
        }

        const teams: Record<string, unknown> = {};
        for (const t of info.teams ?? []) {
          const lado = t.teamId === 100 ? 'blue' : 'red';
          const obj = t.objectives ?? {};
          teams[lado] = {
            victoria: !!t.win,
            barones: obj.baron?.kills ?? 0,
            dragones: obj.dragon?.kills ?? 0,
            heraldos: obj.riftHerald?.kills ?? 0,
            vacuolarvas: obj.horde?.kills ?? 0,
            torres: obj.tower?.kills ?? 0,
            inhibidores: obj.inhibitor?.kills ?? 0,
            damage_taken_total: teamDamageTotals[t.teamId] ?? 0,
            baneos: (t.bans ?? []).map((b: any) => ({
              championId: (b.championId ?? -1) > -1 ? b.championId : null,
              pickTurn: b.pickTurn,
            })),
          };
        }

        const endedAtMs = info.gameEndTimestamp ?? (info.gameCreation + info.gameDuration * 1000);
        const endedAtIso = new Date(endedAtMs).toISOString();

        // Los logros y la primera victoria se aplican solo DESPUÉS de guardar
        // bien la partida (ver abajo), para no avisar de algo que no quedó guardado.
        const efectos: (() => Promise<void>)[] = [];

        const rows = [];
        for (const pp of info.participants ?? []) {
          const playerId = puuidToPlayerId.get(pp.puuid);
          if (!playerId) continue; // no es del grupo, se ignora
          const nombreCorto = playerIdToName.get(playerId) ?? '';

          const estilos = pp.perks?.styles ?? [];
          const teamTotal = teamDamageTotals[pp.teamId] ?? 0;
          const damageTakenPct = teamTotal > 0
            ? Math.round((pp.totalDamageTaken ?? 0) / teamTotal * 1000) / 10
            : 0;
          const duoCon = (trackedByTeam[pp.teamId] ?? [])
            .filter((x) => x.playerId !== playerId)
            .map((x) => x.name);

          // LP ganado/perdido — solo tiene sentido en SoloQ (420),
          // el resto de colas se queda en null (no manejan LP).
          const lpChange = info.queueId === 420 ? await calcularLpChange(playerId, endedAtIso) : null;

          // ── Logros de una sola partida — como esta fila solo se arma
          // para partidas genuinamente NUEVAS, cada logro se dispara
          // una única vez, sin necesidad de guardar estado aparte.
          if (pp.deaths === 0 && (pp.kills > 0 || pp.assists > 0)) {
            efectos.push(() => evento({
              type: 'logro_partida', category: `perfecta:${matchId}`,
              player_id: playerId, detail: `${pp.championName} · ${pp.kills}/${pp.deaths}/${pp.assists}`,
            }, `${nombreCorto}: Partida Perfecta (${pp.championName})`));
          }
          if ((pp.challenges?.flawlessAces ?? 0) > 0) {
            efectos.push(() => evento({
              type: 'logro_partida', category: `ace:${matchId}`,
              player_id: playerId, detail: `${pp.championName} aniquiló al equipo rival sin bajas propias`,
            }, `${nombreCorto}: Ace Perfecto (${pp.championName})`));
          }
          if ((pp.nexusKills ?? 0) > 0) {
            efectos.push(() => evento({
              type: 'logro_partida', category: `terminador:${matchId}`,
              player_id: playerId, detail: `${pp.championName} dio el golpe final al Nexus`,
            }, `${nombreCorto}: Terminador (${pp.championName})`));
          }

          // ── Primera victoria del día (SoloQ, día = 6AM España) ──
          if (pp.win && info.queueId === 420 && endedAtMs >= diaInicio.getTime()) efectos.push(async () => {
            const { data: estado, error: estErr } = await supabase.from('daily_first_win_state').select('*').limit(1).maybeSingle();
            if (estErr) { log.push(`ERROR primera victoria (${nombreCorto}): ${estErr.message}`); return; }
            const mismoDia = estado?.day_start && new Date(estado.day_start).getTime() === diaInicio.getTime();
            const wonAtActual = mismoDia && estado?.won_at ? new Date(estado.won_at).getTime() : null;
            if (!mismoDia || wonAtActual === null || endedAtMs < wonAtActual) {
              const jugadorAnterior = mismoDia ? estado?.player_id ?? null : null;
              const { error: fwErr } = await supabase.from('daily_first_win_state').update({
                day_start: diaInicio.toISOString(), player_id: playerId, won_at: endedAtIso,
                champion: pp.championName, kills: pp.kills, deaths: pp.deaths, assists: pp.assists,
                summoner_spells: [pp.summoner1Id, pp.summoner2Id],
                team: pp.teamId === 100 ? 'blue' : 'red',
                duration_seconds: info.gameDuration,
              }).eq('singleton', true);
              if (fwErr) { log.push(`ERROR primera victoria (${nombreCorto}): ${fwErr.message}`); return; }
              if (jugadorAnterior !== playerId) {
                await evento({
                  type: 'primera_victoria_dia', category: 'primera_victoria_dia',
                  player_id: playerId, previous_player_id: jugadorAnterior, detail: null,
                }, `${nombreCorto}: primera victoria del día`);
              }
            }
          });

          rows.push({
            match_id: matchId,
            player_id: playerId,
            champion: pp.championName,
            team: pp.teamId === 100 ? 'blue' : 'red',
            win: !!pp.win,
            kills: pp.kills,
            deaths: pp.deaths,
            assists: pp.assists,
            cs: (pp.totalMinionsKilled ?? 0) + (pp.neutralMinionsKilled ?? 0),
            gold: pp.goldEarned,
            damage_to_champions: pp.totalDamageDealtToChampions,
            damage_taken: pp.totalDamageTaken,
            vision_score: pp.visionScore,
            role: pp.teamPosition,
            lp_change: lpChange,
            keystone_perk: estilos[0]?.selections?.[0]?.perk ?? null,
            secondary_style: estilos[1]?.style ?? null,
            summoner_spells: [pp.summoner1Id, pp.summoner2Id],
            extra_stats: {
              objetivos_robados: pp.objectivesStolen ?? 0,
              estructuras_destruidas: (pp.turretKills ?? 0) + (pp.inhibitorKills ?? 0),
              tiempo_cc: pp.timeCCingOthers ?? 0,
              wards_colocadas: pp.wardsPlaced ?? 0,
              wards_control: pp.visionWardsBoughtInGame ?? 0,
              primera_sangre: !!pp.firstBloodKill,
              pentakills: pp.pentaKills ?? 0,
              damage_taken_pct: damageTakenPct,
              // Participación en kills (0–1) y % del daño del equipo a campeones.
              kp: (teamKills[pp.teamId] ?? 0) > 0
                ? Math.round(((pp.kills ?? 0) + (pp.assists ?? 0)) / teamKills[pp.teamId] * 1000) / 1000
                : 0,
              dmg_share: (teamChampDamage[pp.teamId] ?? 0) > 0
                ? Math.round((pp.totalDamageDealtToChampions ?? 0) / teamChampDamage[pp.teamId] * 1000) / 10
                : 0,
              duo_con: duoCon,
            },
          });
        }
        if (!rows.some((r: any) => r.player_id === player.id)) {
          // Riot dice que jugó esta partida, pero su PUUID no aparece en ella:
          // el PUUID guardado no es el de su cuenta (o es de otra key).
          log.push(`AVISO ${player.riot_game_name}: no aparece en ${matchId} con el PUUID guardado; revisa su PUUID / Riot ID`);
          if (soloFaltaEl) continue;
        }
        // ── Guardado: partida + jugadores del grupo. Si algo falla, se deshace
        // para que la próxima corrida la vuelva a intentar (antes quedaba
        // guardada "a medias", sin jugadores, y nunca se reintentaba).
        const { error: matchErr } = soloFaltaEl ? { error: null } : await supabase.from('matches').insert({
          match_id: matchId,
          queue_id: info.queueId,
          queue_type: QUEUE_NAMES[info.queueId] ?? 'Modo Destacado',
          game_mode: info.gameMode,
          patch: (info.gameVersion ?? '').split('.').slice(0, 2).join('.'),
          duration_seconds: info.gameDuration,
          ended_at: endedAtIso,
          teams,
        });
        if (matchErr) {
          log.push(`ERROR al guardar ${matchId}: ${matchErr.message}`);
          continue;
        }
        if (rows.length) {
          const { error: rowsErr } = await supabase.from('match_participants').upsert(rows, { onConflict: 'match_id,player_id' });
          if (rowsErr) {
            if (!soloFaltaEl) await supabase.from('matches').delete().eq('match_id', matchId);
            log.push(`ERROR al guardar jugadores de ${matchId} (se reintentará): ${rowsErr.message}`);
            continue;
          }
        }
        yaGuardadas.add(matchId);
        conEl.add(matchId);
        if (soloFaltaEl) {
          // Partida vieja que se rellena: sin logros ni avisos (ya pasaron).
          log.push(`Partida ${matchId} ya estaba guardada sin ${player.riot_game_name}: se le añadió`);
          continue;
        }

        // Ya está todo guardado: ahora sí, logros y primera victoria.
        for (const efecto of efectos) await efecto();

        log.push(`Nueva partida ${matchId} (${QUEUE_NAMES[info.queueId] ?? info.queueId}) — ${rows.length} jugador(es) del grupo`);
      }

      // ── Rol principal + campeones recientes + posible Égida ──────
      // Se recalcula SIEMPRE (haya o no partidas nuevas esta corrida)
      // sobre las últimas 10 de SoloQ, para que la ventana se mueva
      // sola con el tiempo — mismo criterio que ya usan los badges.
      // Se parte de matches para que la base ordene por fecha y devuelva
      // solo esas 10 (antes se descargaba todo el mes y se recortaba acá).
      const { data: ultimasSolo, error: soloErr } = await supabase
        .from('matches')
        .select('ended_at, match_participants!inner(id, player_id, champion, role, win, lp_change, extra_stats)')
        .eq('queue_id', 420)
        .eq('match_participants.player_id', player.id)
        .order('ended_at', { ascending: false })
        .limit(10);
      if (soloErr) throw soloErr;

      const recientesSolo: any[] = (ultimasSolo ?? []).map((m: any) => ({
        ...m.match_participants[0],
        matches: { ended_at: m.ended_at },
      }));

      // Reintento de lp_change — si una partida se procesó ANTES de que
      // sync-riot-data alcanzara a registrar el cambio de rango posterior,
      // quedó en null. Se reintenta cada corrida hasta que se resuelva solo.
      for (const r of recientesSolo) {
        if (r.lp_change !== null) continue;
        const nuevoLp = await calcularLpChange(player.id, r.matches.ended_at);
        if (nuevoLp !== null) {
          await supabase.from('match_participants').update({ lp_change: nuevoLp }).eq('id', r.id);
          r.lp_change = nuevoLp; // para que la Égida de abajo ya lo vea actualizado en esta misma corrida
          log.push(`${player.riot_game_name}: lp_change resuelto en reintento (${nuevoLp})`);
        }
      }

      const roleCount: Record<string, number> = {};
      const champCount: Record<string, number> = {};
      for (const r of recientesSolo) {
        if (r.role) roleCount[r.role] = (roleCount[r.role] ?? 0) + 1;
        if (r.champion) champCount[r.champion] = (champCount[r.champion] ?? 0) + 1;
      }
      const topRoles = Object.entries(roleCount).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([r, c]) => ({ rol: mapaRoles[r] ?? r, cantidad: c }));
      const topRecent = Object.entries(champCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([c, n]) => ({ campeon: c, cantidad: n }));

      await supabase.from('players').update({
        primary_role: topRoles[0]?.rol ?? null,
        top_roles: topRoles,
        top_recent_champions: topRecent,
      }).eq('id', player.id);

      // Posible Égida de Valor — compara cada victoria contra la
      // mediana de LP ganado en las OTRAS victorias de la ventana.
      const victoriasConLp = recientesSolo.filter((r: any) => r.win && typeof r.lp_change === 'number' && r.lp_change > 0);
      if (victoriasConLp.length >= 5) {
        for (const v of victoriasConLp) {
          const otras = victoriasConLp.filter((o: any) => o.id !== v.id).map((o: any) => o.lp_change as number).sort((a, b) => a - b);
          const n = otras.length;
          const mediana = n % 2 ? otras[(n - 1) / 2] : (otras[n / 2 - 1] + otras[n / 2]) / 2;
          const esEgida = mediana > 0 && (v.lp_change as number) >= mediana * 1.6;
          const yaEstabaMarcada = !!v.extra_stats?.posible_egida;
          if (esEgida !== yaEstabaMarcada) {
            await supabase.from('match_participants').update({
              extra_stats: { ...(v.extra_stats ?? {}), posible_egida: esEgida },
            }).eq('id', v.id);
            // Evento para el Historial de Logros — solo al detectarla por
            // primera vez (no cada vez que se recalcula la ventana).
            if (esEgida && !yaEstabaMarcada) {
              await supabase.from('events').insert({
                type: 'posible_egida', category: 'posible_egida',
                player_id: player.id, detail: `${v.champion} · +${v.lp_change} LP`,
              });
              log.push(`${player.riot_game_name}: posible Égida de Valor (+${v.lp_change} LP)`);
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof LimiteRiot) { cortado = true; log.push(e.message); continue; }
      if (String(e).includes('/by-puuid/') && String(e).endsWith('-> 400')) {
        // PUUID de otra key (lo renueva sync-riot-data; si no puede, lo dice en sus Logs).
        log.push(`${player.riot_game_name}: su PUUID guardado no vale con la key actual; se salta hasta que sync-riot-data lo renueve`);
        continue;
      }
      log.push(`ERROR ${player.riot_game_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, log: lineas }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
