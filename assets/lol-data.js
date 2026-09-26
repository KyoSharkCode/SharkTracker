// ============================================================
// Datos compartidos de LoL para Versus y Estadísticas.
// Catálogos de Data Dragon, nombres de rango/rol, carga de partidas
// (paginada: Supabase devuelve como máximo 1000 filas por consulta)
// y agregaciones comunes.
// ============================================================

export const DD = 'https://ddragon.leagueoflegends.com/cdn';
export let V = '15.19.1';
const CHAMPION_ID_OVERRIDES = { FiddleSticks: 'Fiddlesticks' };
export const champKey = (n) => CHAMPION_ID_OVERRIDES[(n || '').trim()] || (n || '').trim();
export const champImg = (n) => `${DD}/${V}/img/champion/${champKey(n)}.png`;
export const splashUrl = (n, skin) => n ? `${DD}/img/champion/splash/${champKey(n)}_${skin ?? 0}.jpg` : null;
export const profileIconUrl = (id) => id ? `${DD}/${V}/img/profileicon/${id}.png` : null;
export const iconOr1 = (id) => profileIconUrl(id) ?? profileIconUrl(1);
export const ICON_ONERROR = () => `this.onerror=null;this.src='${profileIconUrl(1)}';`;
export const HIDE = `this.style.visibility='hidden'`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const TIER_LABEL = { IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante' };
const DIVISIONLESS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const rankText = (r) => r?.tier ? `${TIER_LABEL[r.tier] ?? r.tier}${DIVISIONLESS.includes(r.tier) ? '' : ' ' + (r.division ?? '')}` : 'Sin rango';
export const emblemUrl = (tier) => `https://raw.communitydragon.org/14.10/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${(tier || 'unranked').toLowerCase()}.png`;

const ROLE_NORMALIZE = { TOP: 'TOP', JUNGLE: 'JUNGLE', JUNGLA: 'JUNGLE', MIDDLE: 'MID', MID: 'MID', BOTTOM: 'ADC', ADC: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT' };
export const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
export const roleLabel = (r) => r ? (ROLE_NORMALIZE[String(r).trim().toUpperCase()] ?? null) : null;

export const QUEUES = {
  soloq: { label: 'SoloQ', ids: [420] },
  flex: { label: 'Flex', ids: [440] },
  ranked: { label: 'SoloQ + Flex', ids: [420, 440] },
  todas: { label: 'Todas las colas', ids: null },
};

// Versión de Data Dragon + nombres de campeones en español.
export const champNames = {};
export const champNums = {};   // id de Data Dragon → clave numérica (para Meraki)
export async function loadCatalogs() {
  try { V = (await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json()))[0] || V; } catch {}
  try {
    const c = await fetch(`${DD}/${V}/data/es_ES/champion.json`).then(r => r.json());
    Object.values(c.data ?? {}).forEach(x => { champNames[x.id] = x.name; champNums[x.id] = Number(x.key); });
  } catch {}
}
export const champName = (id) => champNames[champKey(id)] ?? id;

// Remake = derrota de menos de 5 minutos (misma convención que el resto del sitio).
export const isRemake = (m) => !m.win && (m.matches?.duration_seconds ?? 0) < 300;

// Todas las participaciones (del roster) con su partida. Paginado de a 1000.
export async function fetchParticipations(supabase, { queueIds = null, sinceIso = null, playerIds = null } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('match_participants')
      .select('match_id, player_id, champion, team, win, kills, deaths, assists, cs, gold, damage_to_champions, damage_taken, vision_score, role, lp_change, extra_stats, matches!inner(match_id, queue_id, duration_seconds, ended_at)');
    if (playerIds) q = q.in('player_id', playerIds);
    if (queueIds) q = q.in('matches.queue_id', queueIds);
    if (sinceIso) q = q.gte('matches.ended_at', sinceIso);
    const { data, error } = await q.order('match_id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // Filtros aplicados de nuevo acá por si la consulta los ignoró.
  return out.filter(m => m.matches
    && (!playerIds || playerIds.includes(m.player_id))
    && (!queueIds || queueIds.includes(m.matches.queue_id))
    && (!sinceIso || m.matches.ended_at >= sinceIso)
    && !isRemake(m));
}

// Resumen de un grupo de participaciones.
export function aggregate(list) {
  const a = { games: 0, wins: 0, k: 0, d: 0, as: 0, cs: 0, gold: 0, dmg: 0, taken: 0, vision: 0, secs: 0, pentas: 0, fb: 0, lp: 0, lpGames: 0 };
  for (const m of list) {
    a.games++; if (m.win) a.wins++;
    a.k += m.kills ?? 0; a.d += m.deaths ?? 0; a.as += m.assists ?? 0;
    a.cs += m.cs ?? 0; a.gold += m.gold ?? 0; a.dmg += m.damage_to_champions ?? 0; a.taken += m.damage_taken ?? 0;
    a.vision += m.vision_score ?? 0; a.secs += m.matches?.duration_seconds ?? 0;
    a.pentas += m.extra_stats?.pentakills ?? 0; if (m.extra_stats?.primera_sangre) a.fb++;
    if (m.lp_change != null) { a.lp += m.lp_change; a.lpGames++; }
  }
  const mins = a.secs / 60 || 1;
  return {
    ...a,
    wr: a.games ? a.wins / a.games : null,
    kda: a.games ? (a.k + a.as) / Math.max(1, a.d) : null,
    kAvg: a.games ? a.k / a.games : null, dAvg: a.games ? a.d / a.games : null, aAvg: a.games ? a.as / a.games : null,
    csMin: a.games ? a.cs / mins : null, goldMin: a.games ? a.gold / mins : null,
    dmgMin: a.games ? a.dmg / mins : null, visMin: a.games ? a.vision / mins : null,
    hours: a.secs / 3600,
  };
}

export function groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); if (k == null) continue; (m.get(k) ?? m.set(k, []).get(k)).push(x); }
  return m;
}

export const pct = (x) => x == null ? '—' : `${Math.round(x * 100)}%`;
export const fix = (x, n = 1) => x == null ? '—' : x.toFixed(n);
export const kfmt = (n) => n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
