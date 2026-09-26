// ============================================================
// Roles probables por campeón — para ordenar el lobby en vivo.
//
// Riot (Spectator) no dice en qué línea va cada jugador, así que se
// estima: 1) probabilidades de juego por posición de Meraki Analytics
// (se piden en vivo; si no cargan, se usa la tabla de respaldo de abajo),
// 2) Aplastar = jungla casi seguro, 3) otros hechizos dan pistas,
// 4) para los del grupo, en qué rol han jugado ese campeón.
// Luego se reparte 1 rol por jugador (el reparto más probable de los
// 120 posibles) y se marca con "?" lo que no está claro.
// ============================================================

export const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
export const ROLE_SHORT = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };

// Respaldo: rol principal primero, secundarios después.  T J M A S
const FALLBACK = `Aatrox:T Ahri:M Akali:MT Akshan:MT Alistar:S Ambessa:TJ Amumu:JS Anivia:M Annie:MS Aphelios:A Ashe:AS AurelionSol:M Aurora:MT
Azir:M Bard:S Belveth:J Blitzcrank:S Brand:SM Braum:S Briar:J Caitlyn:A Camille:T Cassiopeia:MT Chogath:TM Corki:MA Darius:T Diana:JM
DrMundo:TJ Draven:A Ekko:JM Elise:J Evelynn:J Ezreal:A Fiddlesticks:J Fiora:T Fizz:M Galio:MS Gangplank:T Garen:T Gnar:T Gragas:JTM
Graves:J Gwen:TJ Hecarim:J Heimerdinger:MST Hwei:MS Illaoi:T Irelia:TM Ivern:J Janna:S Jarvan:J JarvanIV:J Jax:TJ Jayce:TM Jhin:A Jinx:A
Kaisa:A Kalista:A Karma:SM Karthus:JM Kassadin:M Katarina:M Kayle:TM Kayn:J Kennen:TM Khazix:J Kindred:J Kled:T KogMaw:A KSante:T
Leblanc:M LeeSin:J Leona:S Lillia:J Lissandra:M Lucian:AM Lulu:S Lux:SM Malphite:TS Malzahar:M Maokai:SJT MasterYi:J Mel:MS Milio:S
MissFortune:A MonkeyKing:JT Mordekaiser:T Morgana:SJ Naafiri:M Nami:S Nasus:T Nautilus:S Neeko:MS Nidalee:J Nilah:A Nocturne:J Nunu:J
Olaf:JT Orianna:M Ornn:T Pantheon:TSJ Poppy:TJS Pyke:S Qiyana:MJ Quinn:T Rakan:S Rammus:J RekSai:J Rell:S Renata:S Renekton:T Rengar:JT
Riven:T Rumble:TM Ryze:MT Samira:A Sejuani:J Senna:SA Seraphine:SA Sett:TS Shaco:JS Shen:TS Shyvana:J Singed:T Sion:T Sivir:A Skarner:JT
Smolder:AM Sona:S Soraka:S Swain:SMA Sylas:MJ Syndra:M TahmKench:TS Taliyah:JM Talon:MJ Taric:S Teemo:T Thresh:S Tristana:AM Trundle:JT
Tryndamere:T TwistedFate:M Twitch:AJ Udyr:JT Urgot:T Varus:AM Vayne:AT Veigar:MA Velkoz:SM Vex:M Vi:J Viego:J Viktor:M Vladimir:MT
Volibear:TJ Warwick:JT Xayah:A Xerath:SM XinZhao:J Yasuo:MTA Yone:MT Yorick:T Yunara:A Yuumi:S Zaahen:TJ Zac:J Zed:MJ Zeri:A Ziggs:MA
Zilean:SM Zoe:M Zyra:SJ`;
const LETTER = { T: 'TOP', J: 'JUNGLE', M: 'MIDDLE', A: 'BOTTOM', S: 'UTILITY' };
const fallback = {};
FALLBACK.split(/\s+/).filter(Boolean).forEach(tok => {
  const [id, roles] = tok.split(':');
  const w = [0.72, 0.2, 0.08];
  fallback[id] = Object.fromEntries(ROLES.map(r => [r, 0.01]));
  [...roles].forEach((c, i) => { fallback[id][LETTER[c]] = w[i] ?? 0.05; });
});

// Probabilidades de Meraki (por clave numérica del campeón), cargadas una vez.
let meraki = null;
export async function loadRoleRates() {
  if (meraki) return meraki;
  try {
    const r = await fetch('https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/championrates.json');
    if (!r.ok) throw new Error(r.status);
    meraki = (await r.json()).data ?? {};
  } catch { meraki = {}; }
  return meraki;
}

// Probabilidad base de cada rol para un campeón (0–1, suma 1)
function prior(champId, champNum) {
  const m = champNum != null ? meraki?.[String(champNum)] : null;
  let p = null;
  if (m) {
    const tot = ROLES.reduce((a, r) => a + (m[r]?.playRate ?? 0), 0);
    if (tot > 0) p = Object.fromEntries(ROLES.map(r => [r, Math.max(0.005, (m[r]?.playRate ?? 0) / tot)]));
  }
  if (!p) p = { ...(fallback[champId] ?? Object.fromEntries(ROLES.map(r => [r, 0.2]))) };
  return p;
}

// Hechizos: 11 Aplastar, 12 Teleport, 14 Prender, 3 Extenuación, 7 Curar, 21 Barrera, 1 Limpiar, 6 Fantasmal
function spellFactor(spells, role) {
  const s = new Set(spells ?? []);
  let f = 1;
  if (s.has(11)) f *= role === 'JUNGLE' ? 40 : 0.02; else f *= role === 'JUNGLE' ? 0.03 : 1;
  if (s.has(12)) f *= role === 'TOP' ? 2.2 : role === 'MIDDLE' ? 1.2 : role === 'UTILITY' ? 0.6 : 1;
  if (s.has(3)) f *= role === 'UTILITY' ? 2.2 : role === 'BOTTOM' ? 0.7 : 1;
  if (s.has(7)) f *= role === 'BOTTOM' ? 2 : role === 'UTILITY' ? 1.2 : 1;
  if (s.has(21) || s.has(1)) f *= role === 'BOTTOM' ? 1.4 : role === 'MIDDLE' ? 1.2 : 1;
  if (s.has(14)) f *= role === 'UTILITY' || role === 'MIDDLE' || role === 'TOP' ? 1.15 : 1;
  return f;
}

/**
 * Asigna roles a los 5 jugadores de un equipo.
 * players: [{ campeon, champNum, hechizos, history? }]  history = { TOP: n, JUNGLE: n, … } (partidas del grupo con ese campeón)
 * Devuelve el mismo array con .role y .sure (true/false), ordenado Top → Support.
 */
export function assignRoles(players) {
  if (players.length !== 5) return players.map(p => ({ ...p, role: null, sure: false }));
  const probs = players.map(p => {
    const base = prior(p.campeon, p.champNum);
    const hTot = p.history ? Object.values(p.history).reduce((a, b) => a + b, 0) : 0;
    const out = {};
    ROLES.forEach(r => {
      let v = base[r] * spellFactor(p.hechizos, r);
      if (hTot) v *= 1 + 8 * ((p.history[r] ?? 0) / hTot);          // cómo lo juega esa persona
      else if (p.mainRole) v *= p.mainRole === r ? 2.5 : 1;         // su rol principal, si no hay historial
      out[r] = Math.max(v, 1e-6);
    });
    return out;
  });
  const logp = probs.map(o => Object.fromEntries(ROLES.map(r => [r, Math.log(o[r])])));
  // Todas las permutaciones (120) → la de mayor probabilidad conjunta
  const perms = []; const permute = (arr, cur = []) => { if (!arr.length) return perms.push(cur); arr.forEach((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...cur, x])); };
  permute(ROLES);
  const scored = perms.map(pm => ({ pm, s: pm.reduce((a, r, i) => a + logp[i][r], 0) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  return players.map((p, i) => {
    const role = best.pm[i];
    // Seguridad: la mejor alternativa donde este jugador NO va en ese rol debe ser claramente peor (×4)
    const alt = scored.find(x => x.pm[i] !== role);
    const sure = !alt || best.s - alt.s > Math.log(4);
    return { ...p, role, sure };
  }).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}
