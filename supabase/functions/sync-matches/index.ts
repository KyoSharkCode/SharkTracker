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
const MATCH_HISTORY_COUNT = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Mismo mapeo que ya tenía live_status.py para queues no-rankeadas.
const QUEUE_NAMES: Record<number, string> = {
  490: 'Partida Rápida', 420: 'Solo/Duo', 400: 'Reclutamiento', 440: 'Flex',
  430: 'LoL Classic', 450: 'ARAM', 700: 'Clash', 1700: 'Arena', 1710: 'Arena', 1720: 'Arena',
};

async function riotFetch(url: string) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } });
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

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

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
  const log: string[] = [];
  const diaInicio = inicioDiaMadridUTC(new Date());
  // Nombres de rol oficiales del sitio: TOP / JUNGLE / MID / ADC / SUPPORT.
  const mapaRoles: Record<string, string> = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUPPORT' };

  for (const player of players ?? []) {
    try {
      const ids: string[] = await riotFetch(
        `https://${REGION_API}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?start=0&count=${MATCH_HISTORY_COUNT}`
      );

      for (const matchId of ids) {
        // Si ya está guardada, no se vuelve a pedir ni reinsertar.
        const { data: existing } = await supabase
          .from('matches').select('match_id').eq('match_id', matchId).maybeSingle();
        if (existing) continue;

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
        const trackedByTeam: Record<number, { playerId: string; name: string }[]> = {};
        for (const p of info.participants ?? []) {
          teamDamageTotals[p.teamId] = (teamDamageTotals[p.teamId] ?? 0) + (p.totalDamageTaken ?? 0);
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

        await supabase.from('matches').insert({
          match_id: matchId,
          queue_id: info.queueId,
          queue_type: QUEUE_NAMES[info.queueId] ?? 'Modo Destacado',
          game_mode: info.gameMode,
          patch: (info.gameVersion ?? '').split('.').slice(0, 2).join('.'),
          duration_seconds: info.gameDuration,
          ended_at: endedAtIso,
          teams,
        });

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
            await supabase.from('events').insert({
              type: 'logro_partida', category: `perfecta:${matchId}`,
              player_id: playerId, detail: `${pp.championName} · ${pp.kills}/${pp.deaths}/${pp.assists}`,
            });
            log.push(`${nombreCorto}: Partida Perfecta (${pp.championName})`);
          }
          if ((pp.challenges?.flawlessAces ?? 0) > 0) {
            await supabase.from('events').insert({
              type: 'logro_partida', category: `ace:${matchId}`,
              player_id: playerId, detail: `${pp.championName} aniquiló al equipo rival sin bajas propias`,
            });
            log.push(`${nombreCorto}: Ace Perfecto (${pp.championName})`);
          }
          if ((pp.nexusKills ?? 0) > 0) {
            await supabase.from('events').insert({
              type: 'logro_partida', category: `terminador:${matchId}`,
              player_id: playerId, detail: `${pp.championName} dio el golpe final al Nexus`,
            });
            log.push(`${nombreCorto}: Terminador (${pp.championName})`);
          }

          // ── Primera victoria del día (SoloQ, día = 6AM España) ──
          if (pp.win && info.queueId === 420 && endedAtMs >= diaInicio.getTime()) {
            const { data: estado } = await supabase.from('daily_first_win_state').select('*').limit(1).maybeSingle();
            const mismoDia = estado?.day_start && new Date(estado.day_start).getTime() === diaInicio.getTime();
            const wonAtActual = mismoDia && estado?.won_at ? new Date(estado.won_at).getTime() : null;
            if (!mismoDia || wonAtActual === null || endedAtMs < wonAtActual) {
              const jugadorAnterior = mismoDia ? estado?.player_id ?? null : null;
              await supabase.from('daily_first_win_state').update({
                day_start: diaInicio.toISOString(), player_id: playerId, won_at: endedAtIso,
                champion: pp.championName, kills: pp.kills, deaths: pp.deaths, assists: pp.assists,
                summoner_spells: [pp.summoner1Id, pp.summoner2Id],
                team: pp.teamId === 100 ? 'blue' : 'red',
                duration_seconds: info.gameDuration,
              }).eq('singleton', true);
              if (jugadorAnterior !== playerId) {
                await supabase.from('events').insert({
                  type: 'primera_victoria_dia', category: 'primera_victoria_dia',
                  player_id: playerId, previous_player_id: jugadorAnterior, detail: null,
                });
                log.push(`${nombreCorto}: primera victoria del día`);
              }
            }
          }

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
              duo_con: duoCon,
            },
          });
        }
        if (rows.length) {
          await supabase.from('match_participants').upsert(rows, { onConflict: 'match_id,player_id' });
        }

        log.push(`Nueva partida ${matchId} (${QUEUE_NAMES[info.queueId] ?? info.queueId}) — ${rows.length} jugador(es) del grupo`);
      }

      // ── Rol principal + campeones recientes + posible Égida ──────
      // Se recalcula SIEMPRE (haya o no partidas nuevas esta corrida)
      // sobre las últimas 10 de SoloQ, para que la ventana se mueva
      // sola con el tiempo — mismo criterio que ya usan los badges.
      const { data: todasSolo } = await supabase
        .from('match_participants')
        .select('id, champion, role, win, lp_change, extra_stats, matches!inner(ended_at, queue_id)')
        .eq('player_id', player.id)
        .eq('matches.queue_id', 420);

      const recientesSolo = (todasSolo ?? [])
        .sort((a: any, b: any) => new Date(b.matches.ended_at).getTime() - new Date(a.matches.ended_at).getTime())
        .slice(0, 10);

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
      log.push(`ERROR ${player.riot_game_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, log }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
