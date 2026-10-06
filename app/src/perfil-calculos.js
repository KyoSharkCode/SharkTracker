// Cálculos de "Mi Perfil" a partir de los datos de SharkTracker (sin Electron:
// se prueba en Node). Partidas = filas de matches con su match_participants,
// de la más nueva a la más vieja.

const DURACION_REMAKE = 5 * 60;
const esRemake = (p) => (p.duracion ?? 0) < DURACION_REMAKE;

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Retador',
};
const SIN_DIVISION = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const textoRango = (r) => (r?.tier
  ? `${TIER_ES[r.tier] ?? r.tier}${SIN_DIVISION.includes(r.tier) ? '' : ' ' + (r.division ?? '')}`.trim()
  : 'Sin clasificar');

// Colas → pestañas del historial.
const PESTANAS = [
  { clave: 'solo', nombre: 'SoloQ', colas: [420] },
  { clave: 'flex', nombre: 'Flex', colas: [440] },
  { clave: 'normal', nombre: 'Normal', colas: [400, 430] },
  { clave: 'rapida', nombre: 'Partida Rápida', colas: [490] },
  { clave: 'aram', nombre: 'ARAM', colas: [450, 2400] },  // 2400 = ARAM de temporada (Caos)
  { clave: 'arena', nombre: 'Arena', colas: [1700, 1710, 1720, 1750] },
];

// Fila de la base → partida plana y cómoda de usar.
function aplanar(m) {
  const p = m.match_participants?.[0] ?? {};
  return {
    matchId: m.match_id, cola: m.queue_id, terminada: m.ended_at, duracion: m.duration_seconds ?? 0,
    campeon: p.champion, win: !!p.win, kills: p.kills ?? 0, deaths: p.deaths ?? 0, assists: p.assists ?? 0,
    cs: p.cs ?? 0, oro: p.gold ?? 0, dano: p.damage_to_champions ?? 0, vision: p.vision_score ?? 0,
    rol: p.role, lado: p.team, runa: p.keystone_perk ?? null, hechizos: p.summoner_spells ?? [],
    lp: typeof p.lp_change === 'number' ? p.lp_change : null,
    kp: typeof p.extra_stats?.kp === 'number' ? p.extra_stats.kp : null,
    egida: !!p.extra_stats?.posible_egida,
  };
}

// Promedios de tus últimas N partidas de esas colas (sin remakes). Por defecto, SoloQ.
function resumen(partidas, colas = [420], n = 20) {
  const lista = partidas.filter((p) => colas.includes(p.cola) && !esRemake(p)).slice(0, n);
  if (!lista.length) return null;
  const minutos = lista.reduce((s, p) => s + p.duracion / 60, 0) || 1;
  const suma = (k) => lista.reduce((s, p) => s + p[k], 0);
  const conKp = lista.filter((p) => p.kp !== null);
  const victorias = lista.filter((p) => p.win).length;
  return {
    partidas: lista.length,
    victorias,
    winrate: victorias / lista.length,
    kda: (suma('kills') + suma('assists')) / Math.max(suma('deaths'), 1),
    csMin: suma('cs') / minutos,
    oroMin: suma('oro') / minutos,
    visionMin: suma('vision') / minutos,
    danoMin: suma('dano') / minutos,
    kp: conKp.length ? conKp.reduce((s, p) => s + p.kp, 0) / conKp.length : null,
  };
}

// Radar: 4 ejes con referencia (los mismos de "Tu rendimiento" en partida).
// Valor 1 = igual que la referencia; se recorta a 1.5 para que el gráfico no explote.
const MAX_SIN_REF = { csMin: 9, oroMin: 500, visionMin: 2, kp: 0.7 };
function radar(res, ref) {
  if (!res) return null;
  const ejes = [
    { clave: 'csMin', nombre: 'CS/min', tuyo: res.csMin, ref: ref?.cs_min, formato: (n) => n.toFixed(1) },
    { clave: 'oroMin', nombre: 'Oro/min', tuyo: res.oroMin, ref: ref?.oro_min, formato: (n) => String(Math.round(n)) },
    { clave: 'visionMin', nombre: 'Visión/min', tuyo: res.visionMin, ref: ref?.vision_min, formato: (n) => n.toFixed(2) },
    { clave: 'kp', nombre: 'Particip.', tuyo: res.kp, ref: ref?.kp, formato: (n) => `${Math.round(n * 100)}%` },
  ];
  const hayRef = ejes.every((e) => Number.isFinite(Number(e.ref)) && Number(e.ref) > 0);
  return {
    hayRef,
    ejes: ejes.map((e) => {
      const r = Number(e.ref);
      const base = hayRef ? r : MAX_SIN_REF[e.clave] / 1.5;
      return {
        nombre: e.nombre,
        valor: e.tuyo == null ? '—' : e.formato(e.tuyo),
        referencia: hayRef ? e.formato(r) : null,
        escala: e.tuyo == null ? 0 : Math.min(e.tuyo / base, 1.5) / 1.5, // 0..1 del radio
        arriba: hayRef && e.tuyo != null ? e.tuyo >= r : null,
      };
    }),
  };
}

// Etiquetas activas (últimas 30 SoloQ, sin remakes). Mismas ideas que la web.
function etiquetas(partidas, ahora = Date.now()) {
  const lista = partidas.filter((p) => p.cola === 420 && !esRemake(p)).slice(0, 30);
  const tags = [];
  const pct = (a, b) => Math.round((a / b) * 100);

  // Racha (3+ seguidas) y tilt: viene de perder hace poco y la última fue un desastre
  // o gana claramente menos justo después de perder.
  if (lista.length >= 3) {
    const primero = lista[0].win;
    let n = 0;
    for (const p of lista) { if (p.win === primero) n++; else break; }
    if (n >= 3) tags.push(primero
      ? { tipo: 'racha-buena', icono: 'fuego', texto: 'Frenesí', detalle: `${n} victorias` }
      : { tipo: 'racha-mala', icono: 'hielo', texto: 'Marea baja', detalle: `${n} derrotas` });
  }
  const ultima = lista[0];
  if (ultima && !ultima.win && ahora - new Date(ultima.terminada).getTime() < 12 * 3600 * 1000) {
    const porque = [];
    if (ultima.deaths >= 7 && ultima.kills + ultima.assists <= ultima.deaths / 2) {
      porque.push(`${ultima.kills}/${ultima.deaths}/${ultima.assists} con ${ultima.campeon}`);
    }
    const cronologica = [...lista].reverse();
    const trasPerder = [];
    for (let i = 1; i < cronologica.length; i++) {
      const prev = cronologica[i - 1], p = cronologica[i];
      const hueco = new Date(p.terminada) - new Date(prev.terminada) - p.duracion * 1000;
      if (!prev.win && hueco < 2 * 3600 * 1000) trasPerder.push(p);
    }
    const wr = (l) => pct(l.filter((p) => p.win).length, l.length);
    if (trasPerder.length >= 6 && lista.length >= 12 && wr(trasPerder) <= wr(lista) - 12) {
      porque.push(`gana el ${wr(trasPerder)}% tras perder`);
    }
    if (porque.length) tags.push({ tipo: 'tilt', icono: '⚡', texto: 'Tilteado', detalle: porque.join(' · ') });
  }

  // Lado del mapa: 4+ partidas en cada lado y 10+ puntos de diferencia.
  const lado = (l) => lista.filter((p) => p.lado === l);
  const azul = lado('blue'), rojo = lado('red');
  if (azul.length >= 4 && rojo.length >= 4) {
    const wa = pct(azul.filter((p) => p.win).length, azul.length);
    const wr = pct(rojo.filter((p) => p.win).length, rojo.length);
    if (wa - wr >= 10) tags.push({ tipo: 'lado-azul', icono: '●', texto: 'Mejor en lado Azul', detalle: `${wa}%` });
    if (wr - wa >= 10) tags.push({ tipo: 'lado-rojo', icono: '●', texto: 'Mejor en lado Rojo', detalle: `${wr}%` });
  }

  // Campeones: el más jugado (5+) y los que van claramente bien o mal (4+ partidas).
  const porCampeon = new Map();
  for (const p of lista) {
    const c = porCampeon.get(p.campeon) ?? { n: 0, v: 0 };
    c.n++; if (p.win) c.v++;
    porCampeon.set(p.campeon, c);
  }
  const campeones = [...porCampeon.entries()].sort((a, b) => b[1].n - a[1].n);
  if (campeones[0] && campeones[0][1].n >= 5) {
    tags.push({ tipo: 'amante', icono: '♥', texto: `Amante de ${campeones[0][0]}`, detalle: `${campeones[0][1].n} partidas` });
  }
  for (const [nombre, c] of campeones) {
    if (c.n < 4) continue;
    const w = pct(c.v, c.n);
    if (w >= 60) tags.push({ tipo: 'bueno', icono: '✓', texto: `Bueno con ${nombre}`, detalle: `${w}%` });
    else if (w <= 40) tags.push({ tipo: 'malo', icono: '✗', texto: `Malo con ${nombre}`, detalle: `${w}%` });
  }
  return tags;
}

// Historial de elo (SoloQ): puntos para la gráfica + etiquetas de inicio y fin.
function historialElo(snapshots) {
  const pts = (snapshots ?? []).filter((s) => typeof s.elo_score === 'number');
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((s) => s.elo_score));
  const max = Math.max(...pts.map((s) => s.elo_score));
  const t0 = new Date(pts[0].recorded_at).getTime();
  const t1 = new Date(pts.at(-1).recorded_at).getTime();
  const rango = Math.max(max - min, 50);
  return {
    puntos: pts.map((s) => ({
      x: t1 > t0 ? (new Date(s.recorded_at).getTime() - t0) / (t1 - t0) : 0,
      y: 1 - (s.elo_score - min) / rango, // 0 = arriba
    })),
    inicio: textoRango(pts[0]) + (pts[0].lp != null && !SIN_DIVISION.includes(pts[0].tier) ? ` · ${pts[0].lp} LP` : ''),
    fin: textoRango(pts.at(-1)) + (pts.at(-1).lp != null ? ` · ${pts.at(-1).lp} LP` : ''),
    subida: pts.at(-1).elo_score - pts[0].elo_score,
  };
}

// Radar por pestaña (la misma que el historial). En la Grieta se compara con la
// referencia de la división de arriba; en ARAM y Arena, sin comparar.
const GRIETA = ['solo', 'flex', 'normal', 'rapida'];
function rendimientoPorCola(partidas, ref) {
  return Object.fromEntries(PESTANAS.map((t) => {
    const res = resumen(partidas, t.colas);
    return [t.clave, { nombre: t.nombre, grieta: GRIETA.includes(t.clave), resumen: res, radar: radar(res, GRIETA.includes(t.clave) ? ref : null) }];
  }));
}

// Historial por pestaña: últimas 10 de cada cola.
function historial(partidas) {
  return PESTANAS.map((t) => ({
    clave: t.clave, nombre: t.nombre,
    partidas: partidas.filter((p) => t.colas.includes(p.cola)).slice(0, 10).map((p) => ({ ...p, remake: esRemake(p) })),
  }));
}

module.exports = { aplanar, resumen, radar, rendimientoPorCola, etiquetas, historialElo, historial, textoRango, esRemake, TIERS, TIER_ES };
