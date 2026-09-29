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

const DESDE_MINUTO = 5;     // antes de esto no se colorea: los números por minuto saltan mucho
const MIN_MUESTRAS = 30;    // con menos, la referencia no es fiable

// Con qué división te comparas: la de arriba. Master, GM y Challenger van juntos
// (Master+) y se comparan entre ellos. Sin rango de SoloQ → contra Oro.
function tierObjetivo(tier) {
  const i = TIERS.indexOf(String(tier ?? '').toUpperCase());
  if (i === -1) return 'GOLD';
  return TIERS[Math.min(i + 1, TIERS.indexOf('MASTER'))];
}

// Siempre a la vista desde que empieza la partida. La comparación (azul/rojo)
// aparece cuando hay referencia y desde el minuto 5.
// referencia: { tier, rolPrincipal, porRol: { MIDDLE: {muestras, cs_min, oro_min, vision_min, kp}, … } } o null.
// yo: tu fila de allPlayers; equipo: los 5 de tu equipo; oroActual: activePlayer.currentGold.
// modo: gameData.gameMode ("CLASSIC" = Grieta del Invocador). En ARAM, Arena, etc.
// los promedios de la Grieta no sirven: se muestran tus números sin comparar.
function calcularRendimiento({ t, yo, equipo, oroActual, valorObjetos, referencia, modo }) {
  if (!yo) return null;
  const esGrieta = !modo || modo === 'CLASSIC';
  if (!esGrieta) referencia = null;
  const rol = ROL_ES[yo.position] ? yo.position : referencia?.rolPrincipal;
  const division = referencia ? (TIER_ES[referencia.tier] ?? referencia.tier) : null;
  const refRol = rol ? referencia?.porRol?.[rol] : null;
  const hayRef = !!refRol && Number(refRol.muestras) >= MIN_MUESTRAS;
  const aviso = !esGrieta ? 'Sin comparación en este modo'
    : !referencia ? 'Sin referencia por ahora'
    : !rol ? 'Sin rol detectado: no se puede comparar'
    : !hayRef ? `Reuniendo partidas de ${division}` : null;

  const min = Math.max(t / 60, 1);
  const s = yo.scores ?? {};
  const killsEquipo = equipo.reduce((n, p) => n + (p.scores?.kills ?? 0), 0);
  // Oro: el juego no dice cuánto llevas ganado, así que se estima con el valor
  // de tus objetos + el oro que tienes sin gastar (se queda algo corto:
  // no cuenta pociones ni wards gastados).
  const tuyo = {
    oro: (valorObjetos(yo) + (oroActual ?? 0)) / min,
    cs: (s.creepScore ?? 0) / min,
    vision: (s.wardScore ?? 0) / min,
    kp: killsEquipo > 0 ? ((s.kills ?? 0) + (s.assists ?? 0)) / killsEquipo : null,
  };
  const colorear = hayRef && t >= DESDE_MINUTO * 60;
  const metrica = (clave, etiqueta, valor, refValor, formato) => {
    const r = hayRef ? Number(refValor) : NaN;
    const comparable = colorear && valor != null && Number.isFinite(r);
    return {
      clave, etiqueta,
      valor: valor == null ? '—' : formato(valor),
      referencia: Number.isFinite(r) ? formato(r) : null,
      arriba: comparable ? valor >= r : null,
    };
  };
  const decimal = (n) => n.toFixed(1);
  const entero = (n) => String(Math.round(n));
  const porcentaje = (n) => `${Math.round(n * 100)}%`;
  return {
    division,
    rol: ROL_ES[rol] ?? null,
    aviso,
    metricas: [
      metrica('oro', 'Oro / min', tuyo.oro, refRol?.oro_min, entero),
      metrica('cs', 'CS / min', tuyo.cs, refRol?.cs_min, decimal),
      metrica('vision', 'Visión / min', tuyo.vision, refRol?.vision_min, (n) => n.toFixed(2)),
      metrica('kp', 'Particip. en kills', tuyo.kp, refRol?.kp, porcentaje),
    ],
  };
}

module.exports = { tierObjetivo, calcularRendimiento, ROL_WEB, TIER_ES, MIN_MUESTRAS };
