// Plan de partida con IA (En Vivo, selección de campeones). Sin Electron: se prueba en Node.
//
// Regla de diseño (Kyo, nov 2026): **la IA elige, no inventa**. Aquí se arman las
// OPCIONES reales (build y runas de OP.GG para tu campeón, la guía del enfrentamiento
// y la build adaptada de la app) y se valida la respuesta: cualquier objeto o página de
// runas que no esté en esas opciones se descarta. La IA solo decide entre ellas y explica
// por qué, cruzándolas con la composición rival y con el estilo del jugador (que calcula
// la Edge Function `plan-partida` con el historial de SharkTracker).
//
// Todo son datos previos a la partida: lo que se ve en la selección de campeones.

const ROL_ES = { top: 'top', jungle: 'jungla', mid: 'mid', adc: 'ADC', support: 'soporte' };
const PUESTOS = [['cuarto', '4.º'], ['quinto', '5.º'], ['sexto', '6.º']];
const pct = (n) => (Number.isFinite(n) ? Math.round(n * 100) : null);

// datos: { campeon, rol, rivales: [id], aliados: [id], rivalLinea: id|null, ficha, matchup, adaptada }
//   ficha    = Meta de tu campeón (función `meta`), matchup = guía contra tu rival de línea,
//   adaptada = build-adaptada.js contra los rivales que ya eligieron.
// cat: catálogos de meta.js ({ campeones, objetos, runas }).
// Devuelve { pedido, paginas } o null si falta lo básico. `pedido` es lo que viaja a la
// Edge Function; `paginas` son las páginas de runas completas, para importar la elegida.
function armarPedido(datos, cat) {
  const { campeon, rol, ficha } = datos ?? {};
  if (!campeon || !ROL_ES[rol] || !ficha) return null;
  const nombreC = (id) => cat.campeones?.[id]?.nombre ?? null;
  const campeonDe = (id) => (nombreC(id) ? { id: Number(id), nombre: nombreC(id), clave: cat.campeones[id].id ?? null } : null);
  const nombreO = (id) => cat.objetos?.[id]?.nombre ?? null;
  const nombreR = (id) => cat.runas?.[id]?.nombre ?? null;
  const objetos = (ids) => (ids ?? []).map(Number).filter(nombreO).map((id) => ({ id, nombre: nombreO(id) }));
  const m = datos.matchup && typeof datos.matchup === 'object' ? datos.matchup : null;
  const a = datos.adaptada && typeof datos.adaptada === 'object' ? datos.adaptada : null;

  // Runas: la página general y las del enfrentamiento (sin repetir la misma).
  const paginas = [];
  const agregarPagina = (ru, fuente) => {
    if (!ru?.principal || !ru.runas_principales?.length) return;
    const firma = [...ru.runas_principales, ...(ru.runas_secundarias ?? [])].join(',');
    if (paginas.some((p) => p.firma === firma)) return;
    paginas.push({ firma, fuente, ...ru });
  };
  agregarPagina(ficha.runas, 'general');
  for (const ru of m?.runas ?? []) agregarPagina(ru, 'enfrentamiento');
  const runas = paginas.slice(0, 4).map((p, i) => ({
    opcion: i + 1,
    clave: nombreR(p.runas_principales[0]) ?? 'Runa clave',
    principal: nombreR(p.principal) ?? '',
    secundaria: nombreR(p.secundaria) ?? '',
    resto: [...p.runas_principales.slice(1), ...(p.runas_secundarias ?? [])].map(nombreR).filter(Boolean),
    fuente: p.fuente, winrate: pct(p.winrate), partidas: p.partidas ?? 0,
  }));

  // Botas: las de la ficha, las del enfrentamiento y la que sugiere la build adaptada.
  const idsBotas = [...(ficha.botas?.ids ?? []), ...(m?.botas ?? []).map((g) => g.ids?.[0]), a?.botas?.item].map(Number).filter(nombreO);
  const botas = [...new Set(idsBotas)].map((id) => ({
    id, nombre: nombreO(id), motivo: a?.botas?.item === id ? a.botas.motivo : null,
  }));

  // Situacionales: 4.º–6.º de OP.GG con su winrate, más lo que sugiere la build adaptada.
  const situ = new Map();
  for (const [campo, puesto] of PUESTOS) {
    for (const g of ficha[campo] ?? []) {
      const id = Number(g.ids?.[0]);
      if (!nombreO(id) || situ.has(id)) continue;
      situ.set(id, { id, nombre: nombreO(id), puesto, winrate: pct(g.winrate), partidas: g.partidas ?? 0, motivo: null });
    }
  }
  for (const s of a?.sugerencias ?? []) {
    const id = Number(s.item);
    if (!nombreO(id)) continue;
    situ.set(id, { ...(situ.get(id) ?? { id, nombre: nombreO(id), puesto: null, winrate: null, partidas: 0 }), motivo: s.motivo ?? null });
  }

  const pedido = {
    campeon: campeonDe(campeon),
    rol,
    rivalLinea: datos.rivalLinea ? campeonDe(datos.rivalLinea) : null,
    rivales: (datos.rivales ?? []).map(campeonDe).filter(Boolean),
    aliados: (datos.aliados ?? []).map(campeonDe).filter(Boolean),
    perfilRival: typeof a?.resumen === 'string' ? a.resumen : '',
    enfrentamiento: m ? {
      winrate: pct(m.winrate), partidas: m.partidas ?? 0, ventaja: m.ventaja ?? null, soloKills: m.solo_kills ?? null,
      estilo: m.estilo ?? null, consejo: typeof m.consejo === 'string' ? m.consejo.slice(0, 600) : null,
    } : null,
    inicio: objetos(ficha.inicio?.ids),
    core: objetos(ficha.core?.ids),
    botas,
    situacionales: [...situ.values()].slice(0, 14),
    runas,
  };
  if (!pedido.campeon) return null;
  return { pedido, paginas: paginas.slice(0, 4) };
}

const frase = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Lo que respondió la IA, contra las opciones que se le dieron. Devuelve el plan limpio
// o null si no trae las tres líneas del plan. Lo que no esté en las opciones se descarta.
function validarPlan(r, pedido) {
  const linea = frase(r?.linea, 260);
  const composicion = frase(r?.composicion, 260);
  const evita = frase(r?.evita, 260);
  if (!linea || !composicion || !evita) return null;
  const opcion = Number(r?.runas?.opcion);
  const pagina = pedido.runas.find((p) => p.opcion === opcion) ?? null;
  const bota = pedido.botas.find((b) => b.id === Number(r?.botas?.id)) ?? null;
  const vistos = new Set();
  const objetos = (Array.isArray(r?.objetos) ? r.objetos : []).map((o) => {
    const x = pedido.situacionales.find((s) => s.id === Number(o?.id));
    if (!x || vistos.has(x.id)) return null;
    vistos.add(x.id);
    return { id: x.id, nombre: x.nombre, motivo: frase(o?.motivo, 180) };
  }).filter(Boolean).slice(0, 3);
  return {
    linea, composicion, evita,
    runas: pagina ? { opcion: pagina.opcion, clave: pagina.clave, motivo: frase(r?.runas?.motivo, 180) } : null,
    botas: bota ? { id: bota.id, nombre: bota.nombre, motivo: frase(r?.botas?.motivo, 180) } : null,
    objetos,
    alternativa: frase(r?.alternativa, 220),
  };
}

module.exports = { armarPedido, validarPlan, ROL_ES };
