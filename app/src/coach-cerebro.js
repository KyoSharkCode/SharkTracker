// Coach de macro por voz (experimental, etapa 1): qué sabe de tu partida y cuándo
// vale la pena pedir un consejo. Sin Electron: se prueba en Node.
//
// Fuente: SOLO la Live Client Data API (allgamedata) y lo que el overlay ya calcula
// con ella (game-state.js). Nada de pantalla ni de memoria del juego.
//
// Reglas (acordadas con Kyo, nov 2026):
//  - El coach habla de TU partida: tu rol, tu oro, tus objetos, tu visión, tus
//    muertes y lo que viene (objetivos). Consejos de macro, nunca de reflejos.
//  - Del rival solo sale de aquí lo que el marcador ya enseña a todos: kills, torres,
//    dragones y CUÁNTOS están muertos. Nunca quién, dónde, sus objetos, su nivel ni
//    sus hechizos: esos campos no se incluyen en el resumen, así que el modelo no
//    puede usarlos.
//  - No repite lo que el overlay ya muestra (un reloj a secas): por eso los avisos
//    de objetivos salen ~2 min antes, con tiempo para backear y preparar la zona.

// Roles como los da la API del juego y como los usa Meta → nombre del coach.
const ROL_API = { TOP: 'top', JUNGLE: 'jungla', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'soporte' };
const ROL_META = { top: 'top', jungle: 'jungla', mid: 'mid', adc: 'adc', support: 'soporte' };
// Etapa de prueba: el coach solo está afinado para estos roles.
const ROLES_COACH = ['jungla', 'soporte'];

const WARD_CONTROL = 2055;      // id del Centinela de control
const HUECO_TRINKET = 6;

// Tiempos en segundos.
const T = {
  objetivoDesde: 125,   // se avisa cuando faltan 2 min o menos…
  objetivoHasta: 25,    // …y ya no si faltan menos de 25 s (no daría tiempo a nada)
  muerteMin: 10,        // muertes con menos espera que esto no dan tiempo a escuchar
  pelea: 8,             // con una kill en los últimos 8 s, se espera (hay pelea)
  entreDirectos: 25,    // mínimo entre dos consejos, aunque sea un evento importante
  entreLlamadas: 45,    // mínimo entre dos consultas "por si acaso" (las que pasan por el filtro)
  revision: 90,         // repaso general cada 90 s
  revisionDesde: 180,   // …a partir del minuto 3
  compraDesde: 240,
  compraCada: 240,
  compraOro: 1500,      // sin "siguiente compra": oro acumulado que ya merece comentario
  visionDesde: 420,
  visionCada: 360,
  ritmoCaduca: 25,
};

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
    siguienteCompra: compra,
    equipo: {
      kills: suma(aliados, 'kills'),
      torres: caidas.filter((d) => d && d !== yo.team).length,
      dragones: estado?.dragones?.[miLado] ?? 0,
      muertos: aliados.filter((p) => p.isDead).length,
      jungla: jungla ? { viva: !jungla.isDead, reaparece: jungla.isDead ? Math.ceil(Number(jungla.respawnTimer) || 0) : 0 } : null,
    },
    // Del rival, solo lo que enseña el marcador a todos. Sin nombres ni campeones.
    rival: {
      kills: suma(rivales, 'kills'),
      torres: caidas.filter((d) => d === yo.team).length,
      dragones: estado?.dragones?.[suLado] ?? 0,
      muertos: rivales.filter((p) => p.isDead).length,
    },
    alma: estado?.alma ? (estado.alma.equipo === miLado ? 'tu equipo' : 'rival') : null,
    objetivos: (estado?.objetivos ?? []).map((o) => ({ clave: o.clave, nombre: o.nombre, en: o.falta })),
    buffs: [buff(estado?.baron, 'Barón'), buff(estado?.ancestral, 'Dragón Ancestral')].filter(Boolean),
  };
}

// El coach de UNA partida: decide en cada lectura (1 por segundo) si hay algo que
// consultar. Devuelve una situación { tipo, directo, motivo } o null.
//   directo = true  → evento claro (objetivo cerca, acabas de morir, cambio grande):
//                     va directo al modelo que redacta.
//   directo = false → "por si acaso" (compra, visión, repaso): primero pasa por el filtro.
// opciones: intervalo (s mínimos entre consejos hablados), tope (consejos por partida),
// topeLlamadas (consultas por partida, cuenten o no como consejo).
function crearCoach({ intervalo = 75, tope = 10, topeLlamadas = 45 } = {}) {
  const vistos = new Set();      // situaciones ya consultadas (no se repiten)
  let cola = [];                 // eventos importantes que esperan su momento
  const dichos = [];             // consejos hablados: { minuto, tipo, texto }
  let llamadas = 0;
  let ultimoId = null;           // último EventID visto (lo anterior no cuenta)
  let muertaAntes = false;
  let ultimoHablado = -Infinity; // ms
  let ultimaLlamada = -Infinity; // ms
  const ultimoTipo = {};         // tipo → segundo de partida de la última consulta

  function eventosNuevos(datos) {
    const lista = datos?.events?.Events ?? [];
    const maxId = lista.reduce((m, e) => Math.max(m, Number(e.EventID) || 0), -1);
    // Primera lectura (la app se abrió a media partida) o partida nueva: lo viejo no cuenta.
    if (ultimoId === null || maxId < ultimoId) { ultimoId = maxId; return []; }
    const nuevos = lista.filter((e) => Number(e.EventID) > ultimoId);
    ultimoId = maxId;
    return nuevos;
  }

  // Cambios grandes de la partida (uno por evento).
  function ritmo(e, r, datos) {
    const yo = jugadorPropio(datos);
    const equipoDe = (nombre) => (datos.allPlayers ?? []).find((p) => nombresDe(p).includes(nombre))?.team ?? null;
    const mio = (team) => (team && yo ? team === yo.team : null);
    if (e.EventName === 'BaronKill') {
      const m = mio(equipoDe(e.KillerName));
      return m === null ? null : (m ? 'Tu equipo acaba de tomar el Barón' : 'El rival acaba de tomar el Barón');
    }
    if (e.EventName === 'DragonKill') {
      const m = mio(equipoDe(e.KillerName));
      if (m === null) return null;
      if (e.DragonType === 'Elder') return m ? 'Tu equipo acaba de tomar el Dragón Ancestral' : 'El rival acaba de tomar el Dragón Ancestral';
      const n = m ? r.equipo.dragones : r.rival.dragones;
      if (n === 3) return m ? 'Tu equipo lleva 3 dragones: el siguiente les da el alma' : 'El rival lleva 3 dragones: el siguiente le da el alma';
      if (n === 4) return m ? 'Tu equipo consiguió el alma del dragón' : 'El rival consiguió el alma del dragón';
      return null; // un dragón normal ya lo anuncia el overlay
    }
    if (e.EventName === 'InhibKilled') {
      const dueño = dueñoEstructura(e.InhibKilled);
      if (!dueño || !yo) return null;
      return dueño === yo.team ? 'Tu equipo perdió un inhibidor' : 'Tu equipo tiró un inhibidor rival';
    }
    return null;
  }

  // r = resumir(...). activo = false (apagado, silenciado u otro rol): solo se pone al
  // día con los eventos, para no soltar de golpe lo que pasó mientras estaba callado.
  function siguiente(r, datos, ahora, activo = true) {
    const nuevos = eventosNuevos(datos);
    const acabaDeMorir = !!r?.muerta && !muertaAntes;
    muertaAntes = !!r?.muerta;
    if (!r || !activo) { cola = []; return null; }

    for (const e of nuevos) {
      const motivo = ritmo(e, r, datos);
      if (motivo) cola.push({ tipo: 'ritmo', clave: `ritmo:${e.EventID}`, directo: true, motivo, caduca: r.t + T.ritmoCaduca });
    }
    if (acabaDeMorir && r.reaparece >= T.muerteMin) {
      cola.push({ tipo: 'muerte', clave: `muerte:${Math.round(r.t)}`, directo: true, motivo: `Acabas de morir; reapareces en ${r.reaparece} s`, caduca: r.t + r.reaparece - 4 });
    }
    for (const o of r.objetivos) {
      const clave = `objetivo:${o.clave}:${Math.round((r.t + o.en) / 60)}`;
      if (o.en <= T.objetivoDesde && o.en >= T.objetivoHasta && !vistos.has(clave) && !cola.some((c) => c.clave === clave)) {
        cola.push({ tipo: 'objetivo', clave, directo: true, motivo: `${o.nombre} aparece en ${o.en} s`, caduca: r.t + o.en - T.objetivoHasta + 5 });
      }
    }
    cola = cola.filter((c) => c.caduca > r.t && !vistos.has(c.clave));

    if (dichos.length >= tope || llamadas >= topeLlamadas) return null;
    const hayPelea = (datos?.events?.Events ?? []).some((e) => e.EventName === 'ChampionKill' && Number(e.EventTime) > r.t - T.pelea);
    const desdeHablado = (ahora - ultimoHablado) / 1000;
    const desdeLlamada = (ahora - ultimaLlamada) / 1000;
    const salir = (c) => {
      vistos.add(c.clave);
      cola = cola.filter((x) => x.clave !== c.clave);
      llamadas++;
      ultimaLlamada = ahora;
      ultimoTipo[c.tipo] = r.t;
      return { tipo: c.tipo, directo: c.directo, motivo: c.motivo };
    };

    // 1) Eventos importantes: saltan el intervalo normal, pero no se pisan entre sí.
    if (desdeHablado >= T.entreDirectos && desdeLlamada >= 5) {
      const orden = ['muerte', 'ritmo', 'objetivo'];
      const c = [...cola].sort((x, y) => orden.indexOf(x.tipo) - orden.indexOf(y.tipo))
        .find((x) => x.tipo === 'muerte' || !hayPelea); // muerta puedes escuchar aunque sigan peleando
      if (c) return salir(c);
    }

    // 2) "Por si acaso": respetan el intervalo entre consejos y no se piden en plena pelea ni muerta.
    if (hayPelea || r.muerta || desdeHablado < intervalo || desdeLlamada < T.entreLlamadas) return null;
    const hace = (tipo) => r.t - (ultimoTipo[tipo] ?? -Infinity);
    const alcanza = r.siguienteCompra ? r.siguienteCompra.falta === 0 : r.oro >= T.compraOro;
    if (r.t >= T.compraDesde && alcanza && hace('compra') >= T.compraCada) {
      const que = r.siguienteCompra ? `te alcanza para ${r.siguienteCompra.nombre}` : 'llevas mucho oro sin gastar';
      return salir({ tipo: 'compra', clave: `compra:${Math.round(r.t)}`, directo: false, motivo: `Tienes ${r.oro} de oro: ${que}` });
    }
    if (r.t >= T.visionDesde && r.vision.wardsControl === 0 && r.oro >= 75 && hace('vision') >= T.visionCada) {
      return salir({ tipo: 'vision', clave: `vision:${Math.round(r.t)}`, directo: false, motivo: 'No llevas ward de control y tienes oro para uno' });
    }
    if (r.t >= T.revisionDesde && hace('revision') >= T.revision) {
      return salir({ tipo: 'revision', clave: `revision:${Math.round(r.t)}`, directo: false, motivo: 'Repaso general: ¿hay algo de macro que valga la pena decir ahora?' });
    }
    return null;
  }

  // Se dijo en voz alta: cuenta para el intervalo, el tope y el "ya te lo dije".
  function hablado(situacion, texto, ahora, minuto) {
    dichos.push({ minuto, tipo: situacion.tipo, texto });
    ultimoHablado = ahora;
  }

  return {
    siguiente,
    hablado,
    dichos: () => dichos.slice(),
    llamadas: () => llamadas,
  };
}

module.exports = { resumir, crearCoach, rolCoach, jugadorPropio, ROLES_COACH, T };
