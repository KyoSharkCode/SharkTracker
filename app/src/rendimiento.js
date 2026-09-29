// "Tu rendimiento": tus números de la partida contra el promedio de la
// división de ARRIBA de la tuya (datos de la tabla elo_referencias de
// SharkTracker, últimos 14 días). Sin Electron: se prueba en Node.

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_ES = {
  BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino',
  EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Master+',
};
const ROL_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
// Roles como los guarda la web (players.primary_role) → como los da Riot.
const ROL_WEB = { TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MIDDLE', ADC: 'BOTTOM', SUPPORT: 'UTILITY' };

const DESDE_MINUTO = 5;     // antes, los números por minuto engañan
const MIN_MUESTRAS = 30;    // con menos, la referencia no es fiable

// Con qué división te comparas: la de arriba. Master, GM y Challenger van juntos
// (Master+) y se comparan entre ellos. Sin rango de SoloQ → contra Oro.
function tierObjetivo(tier) {
  const i = TIERS.indexOf(String(tier ?? '').toUpperCase());
  if (i === -1) return 'GOLD';
  return TIERS[Math.min(i + 1, TIERS.indexOf('MASTER'))];
}

// referencia: { tier, rolPrincipal, porRol: { MIDDLE: {muestras, cs_min, oro_min, vision_min, kp}, … } }
// yo: tu fila de allPlayers; equipo: los 5 de tu equipo; oroActual: activePlayer.currentGold.
function calcularRendimiento({ t, yo, equipo, oroActual, valorObjetos, referencia }) {
  if (!yo || !referencia || t < DESDE_MINUTO * 60) return null;
  const rol = ROL_ES[yo.position] ? yo.position : referencia.rolPrincipal;
  const base = { tier: referencia.tier, division: TIER_ES[referencia.tier] ?? referencia.tier, rol: ROL_ES[rol] ?? null };
  const ref = rol ? referencia.porRol?.[rol] : null;
  if (!ref || Number(ref.muestras) < MIN_MUESTRAS) return { ...base, sinDatos: true, metricas: [] };

  const min = t / 60;
  const s = yo.scores ?? {};
  const killsEquipo = equipo.reduce((n, p) => n + (p.scores?.kills ?? 0), 0);
  // Oro: el juego no dice cuánto llevas ganado, así que se estima con el valor
  // de tus objetos + el oro que tienes sin gastar (se queda algo corto:
  // no cuenta pociones ni wards gastados).
  const tuyo = {
    cs: (s.creepScore ?? 0) / min,
    oro: (valorObjetos(yo) + (oroActual ?? 0)) / min,
    vision: (s.wardScore ?? 0) / min,
    kp: killsEquipo > 0 ? ((s.kills ?? 0) + (s.assists ?? 0)) / killsEquipo : null,
  };
  const metrica = (clave, etiqueta, valor, refValor, formato) => {
    const r = Number(refValor);
    if (valor == null || !Number.isFinite(r)) return { clave, etiqueta, valor: '—', referencia: formato(r), arriba: null };
    return { clave, etiqueta, valor: formato(valor), referencia: formato(r), arriba: valor >= r };
  };
  const decimal = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');
  const entero = (n) => (Number.isFinite(n) ? String(Math.round(n)) : '—');
  const porcentaje = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');
  return {
    ...base,
    sinDatos: false,
    metricas: [
      metrica('cs', 'CS/min', tuyo.cs, ref.cs_min, decimal),
      metrica('oro', 'Oro/min', tuyo.oro, ref.oro_min, entero),
      metrica('vision', 'Visión/min', tuyo.vision, ref.vision_min, (n) => (Number.isFinite(n) ? n.toFixed(2) : '—')),
      metrica('kp', 'KP', tuyo.kp, ref.kp, porcentaje),
    ],
  };
}

module.exports = { tierObjetivo, calcularRendimiento, ROL_WEB, TIER_ES, MIN_MUESTRAS };
