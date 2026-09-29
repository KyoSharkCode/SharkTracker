// "Cerebro" del overlay en partida.
//
// Recibe lo que devuelve la Live Client Data API (/liveclientdata/allgamedata)
// cada segundo y calcula lo que el overlay tiene que dibujar:
//   - Barón / Dragón Ancestral: cuánto le queda al buff y quién lo tiene.
//   - Anuncios: el próximo objetivo épico cuando falta 1:30 o menos
//     (Dragón/Ancestral, Vacuolarvas, Heraldo, Barón).
//   - Toast de objetivo: 5 s al caer un dragón (y el alma, si es el 4.º),
//     las Vacuolarvas (cuántas de 3 lleva el equipo) o el Heraldo.
//   - Diferencia de oro por fila del Tab (valor de los objetos de cada jugador,
//     que es lo que el propio Tab muestra; el oro sin gastar del rival no se ve).
//   - Tu rendimiento contra la división de arriba de la tuya (rendimiento.js).
//
// Solo usa información que el juego ya muestra (eventos de la partida y el
// estado de los jugadores). No depende de Electron: se puede probar en Node.

const { calcularRendimiento } = require('./rendimiento');

// Tiempos en segundos de partida. Riot los cambia entre temporadas:
// si un anuncio sale desfasado, se ajusta aquí.
const TIEMPOS = {
  dragon:    { primera: 5 * 60, reaparece: 5 * 60 },
  ancestral: { reaparece: 6 * 60 },          // tras el alma, y tras cada Ancestral
  larvas:    { primera: 8 * 60 },             // Vacuolarvas
  heraldo:   { primera: 15 * 60 },
  baron:     { primera: 20 * 60, reaparece: 6 * 60 },   // 20:00 visto en partida real (antes 25:00)
};
const DURACION_BUFF = { baron: 180, ancestral: 150 };
const AVISO_ANTES = 90;      // anunciar cuando falta 1:30 o menos
const AVISO_INHIB = 60;      // inhibidor a punto de reaparecer: avisar a 1:00
const INHIB_REAPARECE = 5 * 60;
const TOAST_DURACION = 5;    // segundos

const DRAGON_ES = {
  Fire: 'Infernal', Water: 'Océano', Earth: 'Montaña', Air: 'Nube',
  Hextech: 'Hextech', Chemtech: 'Quimtech', Elder: 'Ancestral',
};

// Estructuras: el nombre dice de quién es y dónde está.
//   Turret_T1_L_03_A → torre del equipo 1 (ORDER), carril superior (L), exterior.
//   Barracks_T2_R1   → inhibidor del equipo 2 (CHAOS), carril inferior (R).
const CARRIL = { L: 'carril superior', C: 'carril medio', R: 'carril inferior' };
const NIVEL_TORRE = {
  L: { '03': 'Exterior', '02': 'Interior', '01': 'De inhibidor' },
  R: { '03': 'Exterior', '02': 'Interior', '01': 'De inhibidor' },
  C: { '05': 'Exterior', '04': 'Interior', '03': 'De inhibidor', '02': 'De Nexo', '01': 'De Nexo' },
};
function leerEstructura(nombre = '') {
  const m = /_T([12])_([LCR])_?(\d+)?/.exec(nombre);
  if (!m) return null;
  const [, equipo, carril, num] = m;
  return {
    dueño: equipo === '1' ? 'blue' : 'red',
    carril: CARRIL[carril] ?? '',
    nivel: NIVEL_TORRE[carril]?.[String(num ?? '').padStart(2, '0')] ?? '',
  };
}

// Equipo en la API: ORDER = azul, CHAOS = rojo.
const lado = (team) => (team === 'ORDER' ? 'blue' : team === 'CHAOS' ? 'red' : null);

// Nombre corto de campeón para las fichas ("Twisted Fate" → "TF", "Maokai" → "MA", "Kai'Sa" → "KA").
function iniciales(nombre = '') {
  const partes = nombre.replace(/['’.]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return (partes[0] ?? '?').slice(0, 2).toUpperCase();
}

function crearEstadoPartida() {
  // Recuerda quién tenía cada buff al detectarlo (por EventID): la API solo
  // dice quién está muerto AHORA, no quién lo estaba cuando cayó el objetivo.
  const titularesPorEvento = new Map();
  let ultimoGameId = null;
  // Promedios de referencia (llegan de Supabase al empezar la partida).
  let referencia = null;
  const setReferencia = (ref) => { referencia = ref; };
  // Coste TOTAL de cada objeto (DDragon item.json → gold.total). El "price" de la
  // API del juego es solo el último paso de la receta, no lo que vale el objeto.
  let precios = null;
  const setPrecios = (mapa) => { precios = mapa; };

  function actualizar(datos) {
    const t = datos?.gameData?.gameTime ?? 0;
    const jugadores = datos?.allPlayers ?? [];
    const eventos = datos?.events?.Events ?? [];

    // Partida nueva (el reloj volvió atrás): se olvida lo anterior.
    const gameId = eventos.find((e) => e.EventName === 'GameStart')?.EventTime ?? null;
    if (ultimoGameId !== null && t < 5 && gameId !== ultimoGameId) titularesPorEvento.clear();
    ultimoGameId = gameId;

    // ── Quién es quién ──
    const porNombre = new Map();
    for (const p of jugadores) {
      for (const n of [p.summonerName, p.riotIdGameName, p.riotId, p.riotId?.split('#')[0]]) {
        if (n) porNombre.set(n, p);
      }
    }
    const yo = porNombre.get(datos?.activePlayer?.riotId) ?? porNombre.get(datos?.activePlayer?.summonerName)
      ?? porNombre.get(datos?.activePlayer?.riotIdGameName) ?? null;
    const miLado = lado(yo?.team);
    const ladoDe = (nombre) => lado(porNombre.get(nombre)?.team);
    const claveCampeon = (p) => (p.rawChampionName ?? '').replace(/^game_character_displayname_/, '')
      || (p.championName ?? '').replace(/[^A-Za-z]/g, '');
    const ficha = (p) => ({ nombre: p.championName, corto: iniciales(p.championName), clave: claveCampeon(p) });

    // ── Buffs de Barón y Ancestral ──
    function buff(tipo, nombreEvento, filtro = () => true) {
      const ev = [...eventos].reverse().find((e) => e.EventName === nombreEvento && filtro(e));
      if (!ev) return null;
      const restante = ev.EventTime + DURACION_BUFF[tipo] - t;
      if (restante <= 0) return null;
      const equipo = ladoDe(ev.KillerName);
      if (!equipo) return null;

      if (!titularesPorEvento.has(ev.EventID)) {
        // Los del equipo que estaban vivos cuando lo detectamos.
        const vivos = jugadores.filter((p) => lado(p.team) === equipo && !p.isDead)
          .map((p) => p.riotId || p.summonerName);
        titularesPorEvento.set(ev.EventID, vivos);
      }
      // Quien muere después pierde el buff.
      const muertos = new Set(eventos
        .filter((e) => e.EventName === 'ChampionKill' && e.EventTime > ev.EventTime)
        .flatMap((e) => { const p = porNombre.get(e.VictimName); return p ? [p.riotId || p.summonerName] : []; }));
      const titulares = titularesPorEvento.get(ev.EventID)
        .filter((id) => !muertos.has(id))
        .map((id) => porNombre.get(id))
        .filter(Boolean)
        .map(ficha);
      if (!titulares.length) return null;

      return {
        tipo,
        restante: Math.ceil(restante),
        equipo,
        esMio: equipo === miLado,
        titulares,
      };
    }
    const baron = buff('baron', 'BaronKill');
    const ancestral = buff('ancestral', 'DragonKill', (e) => e.DragonType === 'Elder');

    // ── Dragones por equipo (para el alma y el toast) ──
    const dragonesElementales = eventos.filter((e) => e.EventName === 'DragonKill' && e.DragonType !== 'Elder');
    const cuenta = { blue: 0, red: 0 };
    let alma = null;
    for (const e of dragonesElementales) {
      const eq = ladoDe(e.KillerName);
      if (!eq) continue;
      cuenta[eq]++;
      if (cuenta[eq] === 4 && !alma) alma = { equipo: eq, tipo: DRAGON_ES[e.DragonType] ?? e.DragonType, EventTime: e.EventTime };
    }

    // ── Toast del último objetivo o estructura (5 s) ──
    // Regla de color: lo hace o lo tiene tu equipo → azul; el enemigo → rojo.
    const esLarva = (e) => /horde|grub|larva/i.test(e.EventName ?? '');
    const larvas = eventos.filter(esLarva);
    const cuentaLarvas = { blue: 0, red: 0 };
    const esToast = (e) => ['DragonKill', 'HeraldKill', 'TurretKilled', 'InhibKilled'].includes(e.EventName) || esLarva(e);
    let toast = null;
    const reciente = [...eventos].reverse().find((e) => esToast(e) && t - e.EventTime <= TOAST_DURACION);
    if (reciente) {
      const eq = ladoDe(reciente.KillerName);
      const base = { id: reciente.EventID, equipo: eq, esMio: eq === miLado, robado: reciente.Stolen === 'True' || reciente.Stolen === true };
      if (reciente.EventName === 'DragonKill') {
        const tipo = DRAGON_ES[reciente.DragonType] ?? reciente.DragonType;
        const esAlma = alma && alma.EventTime === reciente.EventTime;
        const dragones = eq ? cuenta[eq] : 0;
        toast = {
          ...base,
          icono: reciente.DragonType === 'Elder' ? 'elder' : 'dragon',
          tipo: esAlma ? 'alma' : reciente.DragonType,
          titulo: reciente.DragonType === 'Elder' ? 'Dragón Ancestral tomado'
            : esAlma ? `¡Alma ${tipo}!` : `${tipo} tomado`,
          dragones,
          puntos: reciente.DragonType === 'Elder' ? null : { llenos: dragones, total: 4 },
        };
      } else if (esLarva(reciente)) {
        for (const e of larvas) {
          if (e.EventTime > reciente.EventTime) continue;
          const q = ladoDe(e.KillerName);
          if (q) cuentaLarvas[q]++;
        }
        const n = eq ? cuentaLarvas[eq] : 0;
        toast = {
          ...base,
          icono: 'grubs',
          tipo: 'larvas',
          titulo: n >= 3 ? 'Vacuolarvas: ¡las 3!' : `Vacuolarvas: ${n} de 3`,
          puntos: { llenos: n, total: 3 },
        };
      } else if (reciente.EventName === 'HeraldKill') {
        toast = { ...base, icono: 'herald', tipo: 'heraldo', titulo: 'Heraldo tomado', puntos: null };
      } else {
        // Torre o inhibidor: la tira el equipo contrario al dueño (aunque la tire un súbdito).
        const esTorre = reciente.EventName === 'TurretKilled';
        const est = leerEstructura(esTorre ? reciente.TurretKilled : reciente.InhibKilled);
        const quienTira = est ? (est.dueño === 'blue' ? 'red' : 'blue') : eq;
        const aliado = quienTira === miLado;
        toast = {
          id: reciente.EventID,
          equipo: quienTira,
          esMio: aliado,
          robado: false,
          icono: esTorre ? 'tower' : 'inhibitor',
          tipo: 'estructura',
          titulo: esTorre ? (aliado ? 'Torre destruida' : 'Perdiste una torre')
            : (aliado ? 'Inhibidor destruido' : 'Perdiste un inhibidor'),
          detalle: esTorre ? [est?.nivel, est?.carril].filter(Boolean).join(' · ')
            : [est?.carril ? est.carril[0].toUpperCase() + est.carril.slice(1) : '', 'vuelve en 5:00'].filter(Boolean).join(' · '),
          puntos: null,
        };
      }
    }

    // ── Próximos objetivos ──
    const ultimo = (nombre, filtro = () => true) =>
      [...eventos].reverse().find((e) => e.EventName === nombre && filtro(e));
    const proximos = [];
    const agregar = (clave, nombre, aparece, extra = {}, antes = AVISO_ANTES) => {
      if (aparece == null) return;
      const falta = aparece - t;
      if (falta > 0 && falta <= antes) proximos.push({ clave, nombre, falta: Math.ceil(falta), ...extra });
    };
    // Dragón / Ancestral
    const ultDragon = ultimo('DragonKill');
    if (alma) {
      const ultAncestral = ultimo('DragonKill', (e) => e.DragonType === 'Elder');
      const base = Math.max(alma.EventTime, ultAncestral?.EventTime ?? 0);
      agregar('ancestral', 'Dragón Ancestral', base + TIEMPOS.ancestral.reaparece);
    } else {
      agregar('dragon', 'Dragón', ultDragon ? ultDragon.EventTime + TIEMPOS.dragon.reaparece : TIEMPOS.dragon.primera);
    }
    if (!larvas.length) agregar('larvas', 'Vacuolarvas', TIEMPOS.larvas.primera);
    if (!ultimo('HeraldKill')) agregar('heraldo', 'Heraldo', TIEMPOS.heraldo.primera);
    const ultBaron = ultimo('BaronKill');
    agregar('baron', 'Barón', ultBaron ? ultBaron.EventTime + TIEMPOS.baron.reaparece : TIEMPOS.baron.primera);
    // Inhibidores a punto de reaparecer (5:00 después de caer; aviso a 1:00).
    for (const e of eventos.filter((x) => x.EventName === 'InhibKilled')) {
      const est = leerEstructura(e.InhibKilled);
      if (!est) continue;
      // Si vuelve a caer antes de reaparecer, cuenta solo la última vez.
      const otraVez = eventos.some((x) => x.EventName === 'InhibKilled' && x.InhibKilled === e.InhibKilled && x.EventTime > e.EventTime);
      if (otraVez) continue;
      const esMio = est.dueño === miLado;
      agregar('inhib', esMio ? 'Tu inhibidor' : 'Inhibidor rival', e.EventTime + INHIB_REAPARECE,
        { esMio, detalle: `${est.carril[0].toUpperCase()}${est.carril.slice(1)} · reaparece` }, AVISO_INHIB);
    }
    proximos.sort((a, b) => a.falta - b.falta);

    // ── Diferencia de oro por fila del Tab ──
    // Fila i: el i-ésimo de tu equipo contra el i-ésimo del rival (mismo orden
    // que el marcador del juego). Positivo = va por delante tu equipo.
    // En el Tab el lado azul SIEMPRE va a la izquierda y el rojo a la derecha.
    const valorObjetos = (p) => (p.items ?? []).reduce(
      (suma, it) => suma + (precios?.[it.itemID] ?? it.price ?? 0) * (it.count || 1), 0);
    const aliados = jugadores.filter((p) => lado(p.team) === miLado);
    const enemigos = jugadores.filter((p) => lado(p.team) && lado(p.team) !== miLado);
    const oro = [];
    for (let i = 0; i < Math.min(aliados.length, enemigos.length); i++) {
      const a = valorObjetos(aliados[i]);
      const b = valorObjetos(enemigos[i]);
      oro.push({ diferencia: a - b, aliado: aliados[i].championName, enemigo: enemigos[i].championName });
    }

    const rendimiento = calcularRendimiento({
      t, yo, equipo: aliados, oroActual: datos?.activePlayer?.currentGold, valorObjetos, referencia,
    });

    return { tiempo: t, miLado, baron, ancestral, toast, proximos, dragones: cuenta, oro, rendimiento, aliadoIzquierda: miLado !== 'red' };
  }

  return { actualizar, setReferencia, setPrecios };
}

module.exports = { crearEstadoPartida, TIEMPOS, DURACION_BUFF, iniciales };
