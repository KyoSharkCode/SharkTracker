// Build adaptada al equipo enemigo (Parte C de En Vivo). Corre en el proceso main.
//
// Parte de la build de OP.GG (la ficha de la función "meta") y la ajusta con
// reglas simples según los campeones rivales:
//   - se curan mucho        → objeto con Heridas Graves
//   - 3+ de daño físico     → armadura / Botas de acero
//   - 3+ de daño mágico     → resistencia mágica / Mercurios
//   - mucho control         → Mercurios (tenacidad)
//   - 2+ tanques            → penetración
//   - 2+ asesinos           → objeto defensivo
// Primero se busca entre los situacionales de OP.GG; si ninguno sirve, en el
// catálogo de objetos (etiquetas de DDragon, se actualiza solo con cada parche).
// Nunca cambia nada solo: devuelve sugerencias y el orden; el usuario decide.

// Riot no dice quién se cura o tiene mucho control: listas escritas a mano (id de DDragon).
const CURAN = new Set([
  'Soraka', 'Aatrox', 'Vladimir', 'DrMundo', 'Warwick', 'Sylas', 'Yuumi', 'Fiddlesticks', 'Swain', 'Briar',
  'Nami', 'Sona', 'Olaf', 'Volibear', 'Illaoi', 'Zac', 'Maokai', 'Mordekaiser', 'Gwen', 'Trundle', 'Milio',
  'Seraphine', 'Renekton', 'Nidalee', 'Kayn', 'Viego', 'Belveth',
]);
const CONTROL = new Set([
  'Leona', 'Nautilus', 'Amumu', 'Morgana', 'Lissandra', 'Sejuani', 'Maokai', 'Rell', 'Alistar', 'Thresh',
  'Blitzcrank', 'Ashe', 'Malphite', 'Annie', 'Veigar', 'Zyra', 'Lux', 'Rakan', 'Taric', 'Braum', 'Ornn', 'Zac',
  'JarvanIV', 'Vi', 'Skarner', 'Poppy', 'Rammus', 'Galio', 'Neeko', 'Seraphine', 'Cassiopeia', 'Sion', 'Nunu',
  'MonkeyKing', 'Lillia', 'Zilean', 'Bard', 'Nami', 'Pyke', 'Jhin', 'Varus', 'Sona', 'Renata',
]);

// Objetos preferidos por necesidad y por tipo de campeón (se comprueba que existan en el parche).
const PREFERIDOS = {
  heridas:  { ad: [3033, 6609], ap: [3165], tanque: [3075] },
  armadura: { ad: [6333, 3026], ap: [3157], tanque: [3143, 3110, 3075] },
  mr:       { ad: [3156, 3139], ap: [3102], tanque: [4401, 3065, 2504] },
  pen:      { ad: [3036, 6694], ap: [3135, 3137], tanque: [] },
  defensa:  { ad: [3026, 3156, 6333], ap: [3157, 3102], tanque: [] },
};
const DEFENSIVOS = new Set([3026, 3156, 6333, 3157, 3102, 3139, 3814]);
const BOTAS_ACERO = 3047;
const MERCURIOS = 3111;
const ETIQUETA_CLASE = { ad: 'Damage', ap: 'SpellDamage', tanque: 'Health' };

const TITULO = {
  heridas: 'Heridas Graves', armadura: 'Más armadura', mr: 'Más resistencia mágica',
  pen: 'Penetración', defensa: 'Sobrevivir al burst',
};

// ¿Qué hace este objeto? (para saber si cumple una necesidad)
function cumple(necesidad, obj, id) {
  if (!obj) return false;
  const t = obj.tags ?? [];
  switch (necesidad) {
    case 'heridas': return !!obj.heridas;
    case 'armadura': return t.includes('Armor');
    case 'mr': return t.includes('SpellBlock');
    case 'pen': return t.includes('ArmorPenetration') || t.includes('MagicPenetration');
    case 'defensa': return DEFENSIVOS.has(Number(id));
    default: return false;
  }
}

// Tipo de tu campeón según los objetos de su build: daño físico, mágico o tanque.
function claseDe(ficha, objetos) {
  const ids = [...(ficha.core?.ids ?? []), ...(ficha.cuarto ?? []).map((g) => g.ids[0])];
  const n = { ad: 0, ap: 0, tanque: 0 };
  for (const id of ids) {
    const t = objetos[id]?.tags ?? [];
    if (t.includes('SpellDamage')) n.ap++;
    else if (t.includes('Damage') || t.includes('CriticalStrike') || t.includes('AttackSpeed')) n.ad++;
    else if (t.includes('Health') || t.includes('Armor') || t.includes('SpellBlock')) n.tanque++;
  }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
}

// Perfil del equipo rival.
function perfilRival(rivales, campeones) {
  const p = { total: 0, fisico: 0, magico: 0, tanques: 0, asesinos: 0, curan: [], control: [] };
  for (const key of rivales) {
    const c = campeones[key];
    if (!c) continue;
    p.total++;
    const ataque = c.info?.attack ?? 5;
    const magia = c.info?.magic ?? 5;
    if (ataque >= magia + 2) p.fisico++;
    else if (magia >= ataque + 2) p.magico++;
    else { p.fisico += 0.5; p.magico += 0.5; }
    if (c.tags?.[0] === 'Tank') p.tanques++;
    if (c.tags?.[0] === 'Assassin') p.asesinos++;
    if (CURAN.has(c.id)) p.curan.push(c.nombre);
    if (CONTROL.has(c.id)) p.control.push(c.nombre);
  }
  return p;
}

function textoPerfil(p) {
  const partes = [];
  const n = (x) => String(x).replace('.5', ',5');
  if (p.fisico) partes.push(`${n(p.fisico)} de daño físico`);
  if (p.magico) partes.push(`${n(p.magico)} de daño mágico`);
  if (p.tanques) partes.push(`${p.tanques} tanque${p.tanques > 1 ? 's' : ''}`);
  if (p.asesinos) partes.push(`${p.asesinos} asesino${p.asesinos > 1 ? 's' : ''}`);
  if (p.curan.length) partes.push(`se cura${p.curan.length > 1 ? 'n' : ''}: ${p.curan.join(', ')}`);
  return partes.join(' · ');
}

// ficha: datos de la función "meta". miCampeon / rivales: ids numéricos (key de DDragon).
function adaptar(ficha, miCampeon, rivales, cat) {
  const { objetos, campeones } = cat;
  const clase = claseDe(ficha, objetos);
  const perfil = perfilRival((rivales ?? []).filter(Boolean).map(String), campeones);

  // ── Necesidades, de más a menos importante ──
  const necesidades = [];
  if (perfil.curan.length) necesidades.push(['heridas', `${perfil.curan.join(' y ')} se cura${perfil.curan.length > 1 ? 'n' : ''} mucho`]);
  const defensas = [
    ['armadura', perfil.fisico, `${String(perfil.fisico).replace('.5', ',5')} rivales hacen daño físico`],
    ['mr', perfil.magico, `${String(perfil.magico).replace('.5', ',5')} rivales hacen daño mágico`],
  ].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  for (const [k, , motivo] of defensas) necesidades.push([k, motivo]);
  if (perfil.tanques >= 2 && clase !== 'tanque') necesidades.push(['pen', `${perfil.tanques} tanques en el equipo rival`]);
  if (perfil.asesinos >= 2 && clase !== 'tanque') necesidades.push(['defensa', `${perfil.asesinos} asesinos con mucho daño de golpe`]);

  // ── Objeto para cada necesidad: primero OP.GG, luego preferidos, luego catálogo ──
  const core = new Set((ficha.core?.ids ?? []).map(Number));
  const opciones = [...(ficha.cuarto ?? []), ...(ficha.quinto ?? []), ...(ficha.sexto ?? [])]
    .map((g) => Number(g.ids[0])).filter((id, i, a) => a.indexOf(id) === i);
  const usados = new Set(core);
  const sugerencias = [];
  for (const [necesidad, motivo] of necesidades) {
    if ([...core].some((id) => cumple(necesidad, objetos[id], id))) continue; // la build ya lo trae
    let item = opciones.find((id) => !usados.has(id) && cumple(necesidad, objetos[id], id));
    const deOpgg = !!item;
    if (!item) item = (PREFERIDOS[necesidad]?.[clase] ?? []).find((id) => objetos[id] && !usados.has(id));
    if (!item && necesidad !== 'defensa') {
      const etiqueta = ETIQUETA_CLASE[clase];
      const candidato = Object.entries(objetos)
        .filter(([id, o]) => o.final && o.tags.includes(etiqueta) && !usados.has(Number(id)) && cumple(necesidad, o, id))
        .sort((a, b) => b[1].oro - a[1].oro)[0];
      if (candidato) item = Number(candidato[0]);
    }
    if (!item) continue;
    usados.add(item);
    sugerencias.push({ necesidad, titulo: TITULO[necesidad], motivo, item, deOpgg });
    if (sugerencias.length >= 3) break;
  }

  // ── Botas ──
  const botasOpgg = Number(ficha.botas?.ids?.[0]) || null;
  let botas = null;
  const necesitaMercurios = perfil.magico >= 3 || perfil.control.length >= 2;
  const necesitaAcero = perfil.fisico >= 3 && perfil.fisico > perfil.magico;
  if (necesitaMercurios && perfil.magico >= perfil.fisico && botasOpgg !== MERCURIOS && objetos[MERCURIOS]) {
    botas = { item: MERCURIOS, motivo: perfil.control.length >= 2 && perfil.magico < 3
      ? `mucho control: ${perfil.control.slice(0, 3).join(', ')}` : `${String(perfil.magico).replace('.5', ',5')} rivales hacen daño mágico` };
  } else if (necesitaAcero && botasOpgg !== BOTAS_ACERO && objetos[BOTAS_ACERO]) {
    botas = { item: BOTAS_ACERO, motivo: `${String(perfil.fisico).replace('.5', ',5')} rivales hacen daño físico` };
  }

  // ── Orden completo: inicio, core, botas, 4.º–6.º (las sugerencias primero) ──
  const huecos = [ficha.cuarto ?? [], ficha.quinto ?? [], ficha.sexto ?? []];
  const yaEnOrden = new Set([...core, botas?.item ?? botasOpgg].filter(Boolean));
  const pendientes = sugerencias.map((s) => s.item);
  const finales = huecos.map((lista) => {
    const sug = pendientes.shift();
    if (sug) { yaEnOrden.add(sug); return { item: sug, adaptado: true }; }
    const op = lista.map((g) => Number(g.ids[0])).find((id) => !yaEnOrden.has(id));
    if (op) yaEnOrden.add(op);
    return op ? { item: op, adaptado: false } : null;
  });

  return {
    clase,
    perfil,
    resumen: perfil.total ? textoPerfil(perfil) : '',
    sugerencias,
    botas,
    // Situacionales de OP.GG que encajan con este equipo (se marcan con ⭐).
    estrella: sugerencias.filter((s) => s.deOpgg).map((s) => s.item),
    orden: [
      { titulo: 'Inicio', items: (ficha.inicio?.ids ?? []).map(Number) },
      { titulo: 'Core', items: [...core] },
      { titulo: 'Botas', items: [botas?.item ?? botasOpgg].filter(Boolean), adaptado: !!botas },
      ...finales.map((f, i) => f && { titulo: `${i + 4}.º`, items: [f.item], adaptado: f.adaptado }).filter(Boolean),
    ],
  };
}

// ── Siguiente compra (junto al minimapa) ──
// orden: ids de la build sin el inicio (core, botas, 4.º–6.º). misObjetos: ids que llevas.
// Devuelve el primer objeto de la build que te falta, cuánto te cuesta todavía (descontando
// los componentes que ya tienes) y el componente que conviene comprar ahora.
function siguienteCompra(orden, misObjetos, oro, objetos) {
  const inventario = new Map();
  for (const id of misObjetos) inventario.set(Number(id), (inventario.get(Number(id)) ?? 0) + 1);
  const usar = (inv, id) => { const n = inv.get(id) ?? 0; if (n) inv.set(id, n - 1); return n > 0; };
  // Coste que falta de un objeto: 0 si ya lo tienes; si no, su receta + lo que falte de cada componente.
  const falta = (inv, id) => {
    if (usar(inv, id)) return 0;
    const o = objetos[id];
    if (!o) return 0;
    const comps = o.desde ?? [];
    const receta = Math.max(0, o.oro - comps.reduce((s, c) => s + (objetos[c]?.oro ?? 0), 0));
    return receta + comps.reduce((s, c) => s + falta(inv, c), 0);
  };
  const tengo = new Map(inventario);
  const objetivo = orden.map(Number).find((id) => !usar(tengo, id));
  if (!objetivo || !objetos[objetivo]) return null;
  const inv = new Map(inventario);
  const coste = falta(inv, objetivo);
  const info = (id, c) => ({ id, nombre: objetos[id]?.nombre ?? '', img: objetos[id]?.img ?? null, coste: c, falta: Math.max(0, c - Math.floor(oro ?? 0)) });
  // Si no te alcanza para el objeto entero: el componente más caro que todavía te falta.
  let componente = null;
  if ((oro ?? 0) < coste) {
    const inv2 = new Map(inventario);
    const opciones = (objetos[objetivo].desde ?? []).map((c) => [c, falta(inv2, c)]).filter(([, f]) => f > 0)
      .sort((a, b) => b[1] - a[1]);
    if (opciones.length) componente = info(opciones[0][0], opciones[0][1]);
  }
  return { objetivo: info(objetivo, coste), componente };
}

module.exports = { adaptar, siguienteCompra };
