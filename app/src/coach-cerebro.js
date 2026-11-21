// Coach de macro por voz (experimental): qué sabe de tu partida, qué recuerda de ella
// y cuándo vale la pena pedir un consejo. Sin Electron: se prueba en Node.
//
// Fuente: SOLO la Live Client Data API (allgamedata) y lo que el overlay ya calcula
// con ella (game-state.js). Nada de pantalla ni de memoria del juego.
//
// Reglas (acordadas con Kyo, nov 2026):
//  - El coach habla de TU partida: tu rol, tu oro, tus objetos, tu visión, tus
//    muertes y lo que viene (objetivos). Consejos de macro, nunca de reflejos.
//  - Del rival solo sale de aquí lo que el marcador ya enseña a todos: kills, torres,
//    dragones y CUÁNTOS están muertos. Nunca quién, dónde, sus objetos, su nivel ni
//    sus hechizos: esos campos no se incluyen, así que el modelo no puede usarlos.
//  - v2 (tras la primera prueba: "suena a notificaciones por voz"):
//      · Memoria: una BITÁCORA de la partida (muertes, compras, objetivos, controles
//        cada 5 min y lo que el coach ya dijo) viaja en cada consulta.
//      · Qué estás haciendo, deducido de los cambios: gastaste oro = estás en base;
//        tu CS del último minuto; si tu vida viene cayendo.
//      · Habla sobre todo en las pausas (muerta o recién comprada), con análisis.
//      · Los objetivos ya NO avisan por reloj: solo si se detecta un problema
//        (poca vida, oro sin gastar, sin ward de control, tu jungla muerta).
//      · Sin repasos periódicos. Y un atajo para pedir su lectura cuando tú quieras.

// Roles como los da la API del juego y como los usa Meta → nombre del coach.
const ROL_API = { TOP: 'top', JUNGLE: 'jungla', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'soporte' };
const ROL_META = { top: 'top', jungle: 'jungla', mid: 'mid', adc: 'adc', support: 'soporte' };
// Etapa de prueba: el coach solo está afinado para estos roles.
const ROLES_COACH = ['jungla', 'soporte'];

const WARD_CONTROL = 2055;      // id del Centinela de control
const HUECO_TRINKET = 6;

// Tiempos en segundos.
const T = {
  objetivoDesde: 110,   // un objetivo se mira cuando faltan 110 s o menos…
  objetivoHasta: 40,    // …y ya no si faltan menos de 40 s (no daría tiempo a nada)
  muerteMin: 12,        // muertes con menos espera que esto no dan tiempo a escuchar
  pelea: 8,             // con una kill en los últimos 8 s, se espera (hay pelea)
  entreDirectos: 25,    // mínimo entre dos consejos, aunque sea un momento importante
  entreLlamadas: 45,    // mínimo entre dos consultas que pasan por el filtro
  gasto: 40,            // oro que baja de golpe = compraste (estás en base)
  baseVentana: 12,      // tras comprar, cuánto dura el momento para hablarte
  baseCada: 150,        // como mucho un comentario "en base" cada 2:30
  baseReciente: 60,     // si compraste hace menos de esto, no se te manda a backear
  compraDesde: 240,
  compraCada: 300,
  compraEspera: 45,     // llevas este rato pudiendo comprar y sigues fuera
  compraOro: 1500,      // sin "siguiente compra": oro acumulado que ya merece comentario
  ritmoCaduca: 25,
  control: 300,         // punto de control de la bitácora cada 5 min
  muestras: 90,         // segundos de historia para deducir qué haces
};
const BITACORA_MAX = 30;

const reloj = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const pct = (a, b) => (Number(b) > 0 ? Math.round((Number(a) / Number(b)) * 100) : null);
const nombresDe = (p) => [p?.riotId, p?.summonerName, p?.riotIdGameName, p?.riotId?.split('#')[0]].filter(Boolean);

function jugadorPropio(datos) {
  const mios = new Set(nombresDe(datos?.activePlayer));
  return (datos?.allPlayers ?? []).find((p) => nombresDe(p).some((n) => mios.has(n))) ?? null;
}

// Rol del coach: el de la partida si el juego lo da; si no, el que ya dedujo la app (Meta).
function rolCoach(posicion, rolMeta) {
  return ROL_API[posicion] ?? ROL_META[rolMeta] ?? null;
}

// De quién era una estructura caída: Turret_T1_… / Barracks_T2_… (T1 = ORDER, T2 = CHAOS).
function dueñoEstructura(nombre = '') {
  const m = /_T([12])_/.exec(nombre);
  return m ? (m[1] === '1' ? 'ORDER' : 'CHAOS') : null;
}

// Resumen compacto de la partida para el modelo. `estado` = lo que devuelve
// game-state.js (objetivos, dragones, buffs, rendimiento); `siguiente` = la
// "siguiente compra" que la app ya calcula (build-adaptada.js).
// Devuelve null si no se puede saber quién eres.
function resumir(datos, estado, { rol = null, siguiente = null } = {}) {
  const yo = jugadorPropio(datos);
  if (!yo) return null;
  const a = datos.activePlayer ?? {};
  const st = a.championStats ?? {};
  const t = Number(datos?.gameData?.gameTime) || 0;
  const jugadores = datos.allPlayers ?? [];
  const aliados = jugadores.filter((p) => p.team === yo.team);
  const rivales = jugadores.filter((p) => p.team && p.team !== yo.team);
  const eventos = datos?.events?.Events ?? [];
  const s = yo.scores ?? {};
  const suma = (lista, campo) => lista.reduce((n, p) => n + (Number(p.scores?.[campo]) || 0), 0);
  const items = yo.items ?? [];
  const miLado = yo.team === 'ORDER' ? 'blue' : 'red';
  const suLado = miLado === 'blue' ? 'red' : 'blue';
  // Torres que TIRÓ cada equipo = torres caídas del otro.
  const caidas = eventos.filter((e) => e.EventName === 'TurretKilled').map((e) => dueñoEstructura(e.TurretKilled));
  const jungla = aliados.find((p) => p.position === 'JUNGLE' && p !== yo) ?? null;
  const min = Math.max(t / 60, 1);
  const metrica = (clave) => {
    const m = estado?.rendimiento?.metricas?.find((x) => x.clave === clave);
    return m && m.referencia != null ? { valor: m.valor, referencia: m.referencia, bajo: m.arriba === false } : null;
  };
  const buff = (b, nombre) => (b ? { nombre, de: b.esMio ? 'tu equipo' : 'rival', quedan: b.restante } : null);
  const compra = siguiente?.objetivo
    ? {
      nombre: siguiente.objetivo.nombre,
      falta: siguiente.objetivo.falta,
      componente: siguiente.componente ? { nombre: siguiente.componente.nombre, falta: siguiente.componente.falta } : null,
    } : null;

  return {
    t,
    minuto: reloj(t),
    rol,
    campeon: yo.championName ?? '',
    nivel: Number(a.level ?? yo.level) || 1,
    vida: pct(st.currentHealth, st.maxHealth),
    mana: st.resourceType === 'MANA' ? pct(st.resourceValue, st.resourceMax) : null,
    oro: Math.floor(Number(a.currentGold) || 0),
    muerta: !!yo.isDead,
    reaparece: yo.isDead ? Math.ceil(Number(yo.respawnTimer) || 0) : 0,
    kda: `${s.kills ?? 0}/${s.deaths ?? 0}/${s.assists ?? 0}`,
    muertes: Number(s.deaths) || 0,
    cs: Number(s.creepScore) || 0,
    csMin: Math.round(((Number(s.creepScore) || 0) / min) * 10) / 10,
    vision: {
      puntos: Math.round(Number(s.wardScore) || 0),
      wardsControl: items.filter((i) => Number(i.itemID) === WARD_CONTROL).reduce((n, i) => n + (Number(i.count) || 1), 0),
      trinket: items.find((i) => Number(i.slot) === HUECO_TRINKET)?.displayName ?? null,
      comparada: metrica('vision'),
    },
    farmeo: metrica('cs'),
    objetos: items.filter((i) => Number(i.slot) !== HUECO_TRINKET && Number(i.itemID) !== WARD_CONTROL).map((i) => i.displayName).filter(Boolean).slice(0, 6),
    inventario: items.map((i) => i.displayName).filter(Boolean), // todo lo que llevas (para detectar compras)
    siguienteCompra: compra,
    equipo: {
      kills: suma(aliados, 'kills'),
      torres: caidas.filter((d) => d && d !== yo.team).length,
      dragones: estado?.dragones?.[miLado] ?? 0,
      muertos: aliados.filter((p) => p.isDead).length,
      vivos: aliados.filter((p) => !p.isDead).length,
      jungla: jungla ? { viva: !jungla.isDead, reaparece: jungla.isDead ? Math.ceil(Number(jungla.respawnTimer) || 0) : 0 } : null,
    },
    // Del rival, solo lo que enseña el marcador a todos. Sin nombres ni campeones.
    rival: {
      kills: suma(rivales, 'kills'),
      torres: caidas.filter((d) => d === yo.team).length,
      dragones: estado?.dragones?.[suLado] ?? 0,
      muertos: rivales.filter((p) => p.isDead).length,
      vivos: rivales.filter((p) => !p.isDead).length,
    },
    alma: estado?.alma ? (estado.alma.equipo === miLado ? 'tu equipo' : 'rival') : null,
    objetivos: (estado?.objetivos ?? []).map((o) => ({ clave: o.clave, nombre: o.nombre, en: o.falta })),
    buffs: [buff(estado?.baron, 'Barón'), buff(estado?.ancestral, 'Dragón Ancestral')].filter(Boolean),
  };
}

// El coach de UNA partida.
//   observar(r, datos, activo)  → cada segundo, SIEMPRE: lleva la bitácora, deduce qué haces
//                                  y junta los momentos que merecen consulta.
//   siguiente(r, datos, ahora)  → la situación a consultar ahora, o null:
//                                  { tipo, directo, motivo }. directo = va al modelo que
//                                  redacta; si no, primero pasa por el filtro.
// opciones: intervalo (s mínimos entre consejos), tope (consejos por partida, sin contar
// los que pides tú), topeLlamadas (consultas por partida).
function crearCoach({ intervalo = 75, tope = 10, topeLlamadas = 45 } = {}) {
  const vistos = new Set();      // situaciones ya consultadas (no se repiten)
  let cola = [];                 // momentos importantes que esperan su turno
  const dichos = [];             // consejos hablados: { minuto, tipo, texto }
  const bitacora = [];           // la historia de la partida: { minuto, tipo, detalle }
  let muestras = [];             // últimos 90 s: { t, cs, vida, oro }
  let llamadas = 0;
  let ultimoId = null;           // último EventID visto (lo anterior no cuenta)
  let muertaAntes = false;
  let inventarioAntes = null;
  let ultimaCompra = -Infinity;  // segundo de partida de la última compra (= estabas en base)
  let alcanzaDesde = null;       // desde cuándo te alcanza la siguiente compra
  let ultimoControl = 0;
  let pedido = false;            // pediste su lectura con el atajo
  let ultimoHablado = -Infinity; // ms
  let ultimaLlamada = -Infinity; // ms
  const ultimoTipo = {};         // tipo → segundo de partida de la última consulta

  const anotar = (r, tipo, detalle) => {
    bitacora.push({ minuto: r.minuto, tipo, detalle });
    // Si se llena, se van las entradas más viejas que no sean muertes ni palabras del coach.
    while (bitacora.length > BITACORA_MAX) {
      const i = bitacora.findIndex((b) => b.tipo !== 'muerte' && b.tipo !== 'coach');
      bitacora.splice(i < 0 ? 0 : i, 1);
    }
  };

  function eventosNuevos(datos) {
    const lista = datos?.events?.Events ?? [];
    const maxId = lista.reduce((m, e) => Math.max(m, Number(e.EventID) || 0), -1);
    // Primera lectura (la app se abrió a media partida) o partida nueva: lo viejo no cuenta.
    if (ultimoId === null || maxId < ultimoId) { ultimoId = maxId; return []; }
    const nuevos = lista.filter((e) => Number(e.EventID) > ultimoId);
    ultimoId = maxId;
    return nuevos;
  }

  // Un evento del juego → { detalle para la bitácora, grande: motivo si cambia la partida }.
  function leerEvento(e, r, datos) {
    const yo = jugadorPropio(datos);
    if (!yo) return null;
    const mios = new Set(nombresDe(yo));
    const equipoDe = (nombre) => (datos.allPlayers ?? []).find((p) => nombresDe(p).includes(nombre))?.team ?? null;
    const bando = (team) => (team ? (team === yo.team ? 'Tu equipo' : 'El rival') : null);
    const n = (quien) => (quien === 'Tu equipo' ? r.equipo.dragones : r.rival.dragones);
    switch (e.EventName) {
      case 'ChampionKill':
        if (mios.has(e.VictimName)) return null; // la muerte se anota aparte, con su contexto
        if (mios.has(e.KillerName)) return { tipo: 'jugada', detalle: 'Conseguiste una kill' };
        if ((e.Assisters ?? []).some((x) => mios.has(x))) return { tipo: 'jugada', detalle: 'Diste una asistencia' };
        return null;
      case 'BaronKill': {
        const q = bando(equipoDe(e.KillerName));
        return q && { tipo: 'objetivo', detalle: `${q} tomó el Barón`, grande: `${q} acaba de tomar el Barón` };
      }
      case 'HeraldKill': {
        const q = bando(equipoDe(e.KillerName));
        return q && { tipo: 'objetivo', detalle: `${q} tomó el Heraldo` };
      }
      case 'DragonKill': {
        const q = bando(equipoDe(e.KillerName));
        if (!q) return null;
        if (e.DragonType === 'Elder') return { tipo: 'objetivo', detalle: `${q} tomó el Dragón Ancestral`, grande: `${q} acaba de tomar el Dragón Ancestral` };
        const lleva = n(q);
        const grande = lleva === 3 ? `${q} lleva 3 dragones: el siguiente le da el alma` : lleva === 4 ? `${q} consiguió el alma del dragón` : null;
        return { tipo: 'objetivo', detalle: `${q} tomó un dragón (lleva ${lleva})`, grande };
      }
      case 'TurretKilled': {
        const d = dueñoEstructura(e.TurretKilled);
        return d && { tipo: 'objetivo', detalle: d === yo.team ? 'Tu equipo perdió una torre' : 'Tu equipo tiró una torre' };
      }
      case 'InhibKilled': {
        const d = dueñoEstructura(e.InhibKilled);
        const txt = d === yo.team ? 'Tu equipo perdió un inhibidor' : 'Tu equipo tiró un inhibidor rival';
        return d && { tipo: 'objetivo', detalle: txt, grande: txt };
      }
      default:
        if (/horde|grub|larva/i.test(e.EventName ?? '')) {
          const q = bando(equipoDe(e.KillerName));
          return q === 'Tu equipo' ? { tipo: 'objetivo', detalle: 'Tu equipo tomó una Vacuolarva' } : null; // las del rival no siempre se ven
        }
        return null;
    }
  }

  // Qué estás haciendo, deducido de los últimos segundos.
  function actividad(r) {
    const hace = (seg) => muestras.find((m) => m.t >= r.t - seg) ?? null;
    const m60 = muestras.length && r.t - muestras[0].t >= 50 ? hace(60) : null;
    const m10 = hace(10);
    const enBaseHace = Number.isFinite(ultimaCompra) ? Math.round(r.t - ultimaCompra) : null;
    return {
      enBaseHace: enBaseHace !== null && enBaseHace <= 120 ? enBaseHace : null,
      csUltimoMin: m60 ? r.cs - m60.cs : null,
      vidaHace10: m10 && m10 !== muestras[muestras.length - 1] ? m10.vida : null,
    };
  }

  // Problemas con los que llegarías a un objetivo (si no hay ninguno, el coach calla).
  function problemas(r) {
    const p = [];
    if (r.vida !== null && r.vida < 50) p.push(`tienes ${r.vida} % de vida`);
    if (r.mana !== null && r.mana < 30) p.push(`tienes ${r.mana} % de maná`);
    if (r.siguienteCompra ? r.siguienteCompra.falta === 0 : r.oro >= T.compraOro) p.push(`llevas ${r.oro} de oro sin gastar`);
    if (r.rol === 'soporte' && r.vision.wardsControl === 0 && r.oro >= 75) p.push('no llevas ward de control');
    if (r.rol !== 'jungla' && r.equipo.jungla && !r.equipo.jungla.viva) p.push(`tu jungla está muerta (reaparece en ${r.equipo.jungla.reaparece} s)`);
    return p;
  }

  // activo = false (apagado, silenciado u otro rol): se sigue llevando la bitácora, pero
  // no se junta nada que decir, para no soltarlo de golpe al reactivarlo.
  function observar(r, datos, activo = true) {
    const nuevos = eventosNuevos(datos);
    const acabaDeMorir = !!r?.muerta && !muertaAntes;
    muertaAntes = !!r?.muerta;
    if (!r) { cola = []; return; }

    // ── Compras: el oro solo baja de golpe en la tienda → estás en base ──
    const antes = muestras[muestras.length - 1] ?? null;
    if (antes && antes.oro - r.oro >= T.gasto && inventarioAntes) {
      const resto = [...inventarioAntes];
      const comprado = r.inventario.filter((n) => { const i = resto.indexOf(n); if (i >= 0) { resto.splice(i, 1); return false; } return true; });
      const seguida = r.t - ultimaCompra <= 15 && bitacora[bitacora.length - 1]?.tipo === 'compra';
      ultimaCompra = r.t;
      if (seguida && comprado.length) bitacora[bitacora.length - 1].detalle += `, ${comprado.join(', ')}`;
      else if (!seguida) anotar(r, 'compra', comprado.length ? `Compraste ${comprado.join(', ')}` : `Gastaste ${antes.oro - r.oro} de oro en la tienda`);
      if (activo && !seguida && r.t - (ultimoTipo.base ?? -Infinity) >= T.baseCada) {
        cola.push({ tipo: 'base', clave: `base:${Math.round(r.t)}`, directo: true, motivo: 'Acaba de comprar: está en base, a punto de salir', caduca: r.t + T.baseVentana });
      }
    }
    inventarioAntes = r.inventario;
    muestras.push({ t: r.t, cs: r.cs, vida: r.vida, oro: r.oro });
    muestras = muestras.filter((m) => m.t >= r.t - T.muestras);

    // ── Bitácora: tus jugadas, los objetivos y un control cada 5 min ──
    for (const e of nuevos) {
      const x = leerEvento(e, r, datos);
      if (!x) continue;
      anotar(r, x.tipo, x.detalle);
      if (activo && x.grande) cola.push({ tipo: 'ritmo', clave: `ritmo:${e.EventID}`, directo: true, motivo: x.grande, caduca: r.t + T.ritmoCaduca });
    }
    if (acabaDeMorir) {
      anotar(r, 'muerte', `Moriste (tu muerte número ${r.muertes}) con ${r.oro} de oro sin gastar; quedaban vivos ${r.equipo.vivos} de tu equipo y ${r.rival.vivos} rivales`);
      if (activo && r.reaparece >= T.muerteMin) {
        cola.push({ tipo: 'muerte', clave: `muerte:${Math.round(r.t)}`, directo: true, motivo: `Acaba de morir; reaparece en ${r.reaparece} s y puede escuchar con calma`, caduca: r.t + r.reaparece - 5 });
      }
    }
    if (r.t - ultimoControl >= T.control && r.t >= T.control) {
      ultimoControl = Math.floor(r.t / T.control) * T.control;
      anotar(r, 'control', `Control: nivel ${r.nivel}, KDA ${r.kda}, ${r.cs} de CS (${r.csMin} por minuto), ${r.vision.puntos} de visión`);
    }

    // ── Objetivos: solo si llegarías con un problema, y no si acabas de comprar ──
    const reciente = r.t - ultimaCompra < T.baseReciente;
    for (const o of activo && !r.muerta && !reciente ? r.objetivos : []) {
      const clave = `objetivo:${o.clave}:${Math.round((r.t + o.en) / 60)}`;
      if (o.en > T.objetivoDesde || o.en < T.objetivoHasta || vistos.has(clave) || cola.some((c) => c.clave === clave)) continue;
      const p = problemas(r);
      if (p.length) cola.push({ tipo: 'objetivo', clave, directo: true, motivo: `${o.nombre} aparece en ${o.en} s y ${p.join(', ')}`, caduca: r.t + o.en - T.objetivoHasta + 5 });
    }
    const alcanza = r.siguienteCompra ? r.siguienteCompra.falta === 0 : r.oro >= T.compraOro;
    alcanzaDesde = alcanza && !r.muerta ? (alcanzaDesde ?? r.t) : null;
    if (!activo) cola = [];
    cola = cola.filter((c) => c.caduca > r.t && !vistos.has(c.clave));
  }

  function siguiente(r, datos, ahora) {
    if (!r) return null;
    const salir = (c) => {
      vistos.add(c.clave);
      cola = cola.filter((x) => x.clave !== c.clave);
      llamadas++;
      ultimaLlamada = ahora;
      ultimoTipo[c.tipo] = r.t;
      return { tipo: c.tipo, directo: c.directo, motivo: c.motivo };
    };
    // 0) Lo pediste tú: sale ya, sin esperas ni topes de consejos.
    if (pedido) {
      pedido = false;
      if (llamadas < topeLlamadas) return salir({ tipo: 'pedido', clave: `pedido:${Math.round(r.t)}`, directo: true, motivo: 'Pidió tu lectura de la partida ahora mismo' });
    }
    if (dichos.filter((d) => d.tipo !== 'pedido').length >= tope || llamadas >= topeLlamadas) return null;
    const hayPelea = (datos?.events?.Events ?? []).some((e) => e.EventName === 'ChampionKill' && Number(e.EventTime) > r.t - T.pelea);
    const desdeHablado = (ahora - ultimoHablado) / 1000;
    const desdeLlamada = (ahora - ultimaLlamada) / 1000;

    // 1) Momentos importantes: saltan el intervalo normal, pero no se pisan entre sí.
    if (desdeHablado >= T.entreDirectos && desdeLlamada >= 5) {
      const orden = ['muerte', 'base', 'ritmo', 'objetivo'];
      const c = [...cola].sort((x, y) => orden.indexOf(x.tipo) - orden.indexOf(y.tipo))
        .find((x) => x.tipo === 'muerte' || x.tipo === 'base' || !hayPelea); // muerta o en base puedes escuchar
      if (c) return salir(c);
    }

    // 2) Oro acumulado: llevas un rato pudiendo comprar y sigues fuera. Pasa por el filtro.
    if (hayPelea || r.muerta || desdeHablado < intervalo || desdeLlamada < T.entreLlamadas) return null;
    const hace = (tipo) => r.t - (ultimoTipo[tipo] ?? -Infinity);
    if (r.t >= T.compraDesde && alcanzaDesde !== null && r.t - alcanzaDesde >= T.compraEspera
      && r.t - ultimaCompra >= T.baseReciente && hace('compra') >= T.compraCada) {
      const que = r.siguienteCompra ? `le alcanza para ${r.siguienteCompra.nombre}` : 'lleva mucho oro sin gastar';
      return salir({ tipo: 'compra', clave: `compra:${Math.round(r.t)}`, directo: false, motivo: `Lleva ${Math.round(r.t - alcanzaDesde)} s con ${r.oro} de oro: ${que} y no ha vuelto a base` });
    }
    return null;
  }

  // Se dijo en voz alta: cuenta para el intervalo, el tope y la bitácora.
  function hablado(situacion, texto, ahora, minuto) {
    dichos.push({ minuto, tipo: situacion.tipo, texto });
    bitacora.push({ minuto, tipo: 'coach', detalle: texto });
    ultimoHablado = ahora;
  }

  return {
    observar,
    siguiente,
    hablado,
    actividad,
    pedir: () => { pedido = true; },
    dichos: () => dichos.slice(),
    bitacora: () => bitacora.map((b) => ({ ...b })),
    llamadas: () => llamadas,
  };
}

module.exports = { resumir, crearCoach, rolCoach, jugadorPropio, ROLES_COACH, T };
