// Consejos en pantalla: una tarjeta que reacciona a lo que pasa en TU partida
// (idea de Kyo, nov 2026: como los consejos de Overwatch al morir). Sin IA, sin
// coste y al instante: son reglas sobre lo que ya lee el overlay. Sin Electron
// (se prueba en Node).
//
// Fuente: la Live Client Data API (allgamedata) + lo que calcula game-state.js.
// De los rivales solo se usa lo que el juego ya te enseña: quién te mató y su
// nivel (marcador), cuántos están vivos, y los objetivos y estructuras que caen.
// Los consejos "contra {campeón}" son los oficiales de Riot (Data Dragon,
// enemytips): datos fijos, iguales para todos.
//
// Cada consejo: { tipo: 'muerte' | 'partida', titulo, texto, pie, campeon, segundos }.


// Tu línea según tu rol, como la nombra el juego en las torres (L arriba, C medio, R abajo).
const CARRIL_ROL = { TOP: 'L', MIDDLE: 'C', BOTTOM: 'R', UTILITY: 'R' };

const T = {
  entre: 45,          // segundos mínimos entre dos consejos que no sean de muerte
  pelea: 8,           // con una kill en los últimos 8 s, espera (hay pelea)
  cola: 30,           // un consejo que no pudo salir espera hasta 30 s; después ya no viene al caso
  niveles: 2,         // diferencia de nivel con quien te mató que ya pesa
  oroMuerte: 1200,    // morir con este oro encima = un objeto que no usaste
  objetivoCerca: 75,  // morir a menos de esto de un objetivo
  oro: 1500,          // oro acumulado en vivo (si no se sabe la siguiente compra)
  oroEspera: 60,      // llevas este rato pudiendo comprar
  oroCada: 300,
  ventajaCada: 180,
  ventaja: 3,         // rivales muertos de más para hablar de ventana
  gasto: 40,          // oro que baja de golpe = compraste (estás en base)
  controles: [600, 900], // minutos 10 y 15: farmeo contra tu referencia
  tope: 16,           // consejos por partida, sin contar las muertes
};

const nombresDe = (p) => [p?.riotId, p?.summonerName, p?.riotIdGameName, p?.riotId?.split('#')[0]].filter(Boolean);
function jugadorPropio(datos) {
  const mios = new Set(nombresDe(datos?.activePlayer));
  return (datos?.allPlayers ?? []).find((p) => nombresDe(p).some((n) => mios.has(n))) ?? null;
}
const clave = (p) => (p?.rawChampionName ?? '').replace(/^game_character_displayname_/, '') || (p?.championName ?? '').replace(/[^A-Za-z]/g, '');
const estructura = (nombre = '') => { const m = /_T([12])_([LCR])/.exec(nombre); return m ? { team: m[1] === '1' ? 'ORDER' : 'CHAOS', carril: m[2] } : null; };
const veces = (n) => (n === 2 ? 'dos' : n === 3 ? 'tres' : n === 4 ? 'cuatro' : String(n));

function crearConsejos() {
  let ultimoId = null;
  let ultimoT = -Infinity;      // segundo de partida del último consejo mostrado
  let total = 0;
  let oroAntes = null;
  let alcanzaDesde = null;
  let cola = [];                // consejos de partida que esperan su turno
  const vistos = new Set();     // consejos que salen una sola vez
  const ultimo = {};            // tipo → segundo de la última vez
  const asesinos = {};          // campeón → cuántas veces te mató
  const tipSiguiente = {};      // campeón → qué consejo oficial toca la próxima vez
  const usos = {};              // regla de muerte → cuántas veces se usó (para variar)

  function eventosNuevos(datos) {
    const lista = datos?.events?.Events ?? [];
    const maxId = lista.reduce((m, e) => Math.max(m, Number(e.EventID) || 0), -1);
    if (ultimoId === null || maxId < ultimoId) { ultimoId = maxId; return []; }
    const nuevos = lista.filter((e) => Number(e.EventID) > ultimoId);
    ultimoId = maxId;
    return nuevos;
  }

  // ── Al morir: la regla que mejor explica esta muerte ──
  function alMorir(e, c) {
    const { yo, datos, estado, tips, t } = c;
    const asesino = (datos.allPlayers ?? []).find((p) => nombresDe(p).includes(e.KillerName)) ?? null;
    const campeon = asesino ? { nombre: asesino.championName, clave: clave(asesino) } : null;
    const nivel = Number(datos.activePlayer?.level ?? yo.level) || 1;
    const aliados = (datos.allPlayers ?? []).filter((p) => p.team === yo.team && !p.isDead && p !== yo).length;
    const rivales = (datos.allPlayers ?? []).filter((p) => p.team && p.team !== yo.team && !p.isDead).length;
    const oro = Math.floor(Number(datos.activePlayer?.currentGold) || 0);
    const cerca = (estado?.objetivos ?? []).find((o) => o.falta > 0 && o.falta <= T.objetivoCerca);
    if (campeon) asesinos[campeon.clave] = (asesinos[campeon.clave] ?? 0) + 1;
    const lista = campeon ? (tips?.[campeon.clave] ?? []) : [];
    const oficial = () => { // el consejo oficial contra ese campeón, uno distinto cada vez
      if (!lista.length) return null;
      const i = tipSiguiente[campeon.clave] ?? 0;
      tipSiguiente[campeon.clave] = i + 1;
      return lista[i % lista.length];
    };
    const diferencia = asesino ? (Number(asesino.level) || 0) - nivel : 0;

    const reglas = [
      ['nivel', diferencia >= T.niveles, () => `Peleaste con ${diferencia} niveles menos que ${campeon.nombre}. Antes de volver a buscar esa pelea, céntrate en igualar el nivel con farmeo.`],
      ['numeros', rivales - aliados >= 2, () => `Moriste con tu equipo en desventaja: quedaban ${aliados} de los tuyos contra ${rivales} rivales. Con menos gente viva conviene soltar la zona y esperar a que reaparezcan.`],
      ['repetido', campeon && asesinos[campeon.clave] >= 3, () => `${campeon.nombre} ya te mató ${veces(asesinos[campeon.clave])} veces. No le des la pelea a solas: juega cerca de tu equipo y deja que sea él quien tenga que entrar.`],
      ['objetivo', !!cerca, () => `Moriste a ${cerca.falta} segundos de que salga ${cerca.nombre}: tu equipo llega con uno menos. El minuto antes de un objetivo se juega a no morir.`],
      ['oro', oro >= T.oroMuerte, () => `Moriste con ${oro} de oro sin gastar: era un objeto que te faltó en esa pelea. Cuando juntes para un componente grande, vuelve a base antes de pelear.`],
      ['torre', !asesino && /turret/i.test(e.KillerName ?? ''), () => 'Te mató una torre. Sin tu oleada delante, la torre te apunta a ti: entra solo cuando tus súbditos estén recibiendo los golpes.'],
    ].filter(([, aplica]) => aplica);
    // Entre las que aplican, la menos usada en esta partida (así no sale siempre la misma).
    reglas.sort((a, b) => (usos[a[0]] ?? 0) - (usos[b[0]] ?? 0));
    const regla = reglas[0] ?? null;
    if (regla) usos[regla[0]] = (usos[regla[0]] ?? 0) + 1;
    const tip = oficial();
    const texto = regla ? regla[2]() : (tip ? `Contra ${campeon.nombre}: ${tip}` : null);
    if (!texto) return null;
    return {
      tipo: 'muerte', titulo: 'Consejo', texto,
      pie: regla && tip ? `Contra ${campeon.nombre}: ${tip}` : null,
      campeon, regla: regla?.[0] ?? 'oficial',
      segundos: Math.min(16, Math.max(9, Math.ceil(Number(yo.respawnTimer) || 0))),
      t,
    };
  }

  // ── Lo que cambia en la partida (torres, inhibidores, dragones, Barón) ──
  function alPasar(e, c) {
    const { yo, datos, estado } = c;
    const equipoDe = (nombre) => (datos.allPlayers ?? []).find((p) => nombresDe(p).includes(nombre))?.team ?? null;
    const una = (id, texto) => (vistos.has(id) ? null : { id, texto });
    if (e.EventName === 'TurretKilled') {
      const s = estructura(e.TurretKilled);
      if (!s || s.carril !== CARRIL_ROL[yo.position]) return null;
      return s.team === yo.team
        ? una('torre-perdida', 'Perdiste una torre de tu línea. Eso le da espacio al rival para rotar: mantente pendiente de tus compañeros para apoyarlos y no avances sin visión.')
        : una('torre-ganada', 'Tiraste la torre de tu línea. Ya no hace falta quedarse empujando ahí: lleva esa presión a otra línea o al siguiente objetivo.');
    }
    if (e.EventName === 'InhibKilled') {
      const s = estructura(e.InhibKilled);
      if (!s) return null;
      return s.team === yo.team
        ? una(`inhib-perdido-${e.EventID}`, 'Perdieron un inhibidor: los supersúbditos van a empujar esa línea solos. Alguien tiene que limpiarla antes de salir a pelear por objetivos.')
        : una(`inhib-ganado-${e.EventID}`, 'Tiraron un inhibidor: los supersúbditos presionan por ustedes. Es buen momento para ir en grupo por Barón o Dragón.');
    }
    if (e.EventName === 'DragonKill' && e.DragonType !== 'Elder') {
      const team = equipoDe(e.KillerName);
      if (!team) return null;
      const mio = team === yo.team;
      const n = estado?.dragones?.[team === 'ORDER' ? 'blue' : 'red'] ?? 0;
      if (n === 3) {
        return mio
          ? una('alma-cerca', 'Tu equipo lleva 3 dragones: el siguiente les da el alma. Vale la pena llegar todos y con visión puesta antes de que salga.')
          : una('alma-rival-cerca', 'El rival lleva 3 dragones: con el siguiente consigue el alma. Ese dragón se disputa con todo el equipo o se cambia por otro objetivo, no se regala.');
      }
      return null;
    }
    if (e.EventName === 'BaronKill') {
      const team = equipoDe(e.KillerName);
      if (!team) return null;
      return team === yo.team
        ? una(`baron-${e.EventID}`, 'Tienen el Barón: agrúpense y empujen con las oleadas mientras dure. Peleen solo donde haya súbditos potenciados delante.')
        : una(`baron-rival-${e.EventID}`, 'El rival tiene el Barón: limpien oleadas bajo torre y no peleen en campo abierto hasta que se le acabe.');
    }
    return null;
  }

  // ── Situaciones que se sostienen en el tiempo ──
  function situacion(c) {
    const { yo, datos, estado, siguiente, t } = c;
    const hace = (tipo) => t - (ultimo[tipo] ?? -Infinity);
    const oro = Math.floor(Number(datos.activePlayer?.currentGold) || 0);
    const jugadores = datos.allPlayers ?? [];
    const muertosRival = jugadores.filter((p) => p.team && p.team !== yo.team && p.isDead).length;
    const muertosEquipo = jugadores.filter((p) => p.team === yo.team && p.isDead).length;

    // Acabas de comprar y sales de base sin ward de control (soporte y jungla).
    const compro = oroAntes !== null && oroAntes - oro >= T.gasto;
    if (compro && ['UTILITY', 'JUNGLE'].includes(yo.position) && oro >= 75 && t >= 300 && hace('ward') >= 240
      && !(yo.items ?? []).some((i) => Number(i.itemID) === 2055)) {
      return { id: 'ward', texto: `Te quedan ${oro} de oro y sales de base sin ward de control. Por 75 de oro llevas visión para el siguiente objetivo.` };
    }
    // Ventaja numérica: varios rivales muertos y tú con vida.
    if (!yo.isDead && muertosRival - muertosEquipo >= T.ventaja && hace('ventaja') >= T.ventajaCada) {
      const libre = (estado?.objetivos ?? []).find((o) => o.falta <= 0);
      return { id: 'ventaja', texto: `Hay ${muertosRival} rivales muertos: es la ventana para ${libre ? `ir por ${libre.nombre}` : 'tirar torres'}, antes de que reaparezcan.` };
    }
    // Oro acumulado: llevas un rato pudiendo comprar.
    const alcanza = siguiente?.objetivo ? siguiente.objetivo.falta === 0 : oro >= T.oro;
    alcanzaDesde = alcanza && !yo.isDead ? (alcanzaDesde ?? t) : null;
    if (alcanzaDesde !== null && t - alcanzaDesde >= T.oroEspera && t >= 240 && hace('oro') >= T.oroCada) {
      const que = siguiente?.objetivo ? `te alcanza para ${siguiente.objetivo.nombre}` : 'es un objeto entero';
      return { id: 'oro', texto: `Llevas ${oro} de oro encima: ${que}. Si la oleada lo permite, vuelve a base: ese oro no pelea por ti hasta que lo gastes.` };
    }
    // Farmeo contra tu referencia, en los minutos 10 y 15 (no para soporte).
    const control = T.controles.find((m) => t >= m && t < m + 20 && !vistos.has(`farmeo-${m}`));
    const cs = estado?.rendimiento?.metricas?.find((m) => m.clave === 'cs');
    if (control && yo.position !== 'UTILITY' && cs?.arriba === false) {
      return { id: `farmeo-${control}`, unica: true, texto: `Minuto ${control / 60}: vas en ${cs.valor} de CS por minuto y la referencia de ${estado.rendimiento.division ?? 'tu división'} es ${cs.referencia}. Entre jugadas, no dejes oleadas ni campamentos sin recoger.` };
    }
    return null;
  }

  // Cada segundo, con lo que leyó el overlay. Devuelve el consejo a mostrar o null.
  // extras: { tips: { Zed: ['…'] } (consejos oficiales contra cada campeón), siguiente (siguiente compra) }.
  function procesar(datos, estado, { tips = {}, siguiente = null } = {}) {
    const nuevos = eventosNuevos(datos);
    const yo = jugadorPropio(datos);
    const esGrieta = (datos?.gameData?.mapNumber ?? 11) === 11 && (datos?.gameData?.gameMode ?? 'CLASSIC') === 'CLASSIC';
    if (!yo || !esGrieta) return null;
    const t = Number(datos.gameData?.gameTime) || 0;
    const c = { yo, datos, estado, tips, siguiente, t };
    const mios = new Set(nombresDe(yo));
    const oro = Math.floor(Number(datos.activePlayer?.currentGold) || 0);

    let muerte = null;
    for (const e of nuevos) {
      if (e.EventName === 'ChampionKill' && mios.has(e.VictimName)) { muerte = alMorir(e, c) ?? muerte; continue; }
      const x = alPasar(e, c);
      if (x) cola.push({ ...x, unica: true, caduca: t + T.cola });
    }
    const pelea = (datos.events?.Events ?? []).some((e) => e.EventName === 'ChampionKill' && Number(e.EventTime) > t - T.pelea);
    const s = situacion(c);
    oroAntes = oro;
    if (muerte) { ultimoT = t; return muerte; }      // al morir puedes leer: sale siempre
    if (s && !cola.some((x) => x.id === s.id)) cola.push({ ...s, caduca: t + (s.id === 'ward' ? 10 : T.cola) });
    cola = cola.filter((x) => x.caduca > t && !vistos.has(x.id));
    if (!cola.length || total >= T.tope || t - ultimoT < T.entre) return null;
    const x = cola.find((k) => k.id === 'ward' || !pelea); // en base puedes leer aunque haya pelea lejos
    if (!x) return null;
    cola = cola.filter((k) => k !== x);
    if (x.unica) vistos.add(x.id);
    ultimo[x.id] = t;
    ultimoT = t;
    total++;
    return { tipo: 'partida', titulo: 'Consejo', texto: x.texto, pie: null, campeon: null, regla: x.id, segundos: 11, t };
  }

  return { procesar };
}

module.exports = { crearConsejos, T };
