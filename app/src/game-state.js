// "Cerebro" del overlay en partida.
//
// Recibe lo que devuelve la Live Client Data API (/liveclientdata/allgamedata)
// cada segundo y calcula lo que el overlay tiene que dibujar:
//   - Barón / Dragón Ancestral: cuánto le queda al buff y quién lo tiene.
//   - Anuncios: el próximo objetivo épico cuando falta 1:30 o menos
//     (Dragón/Ancestral, Vacuolarvas, Heraldo, Barón).
//   - Toast de dragón: 5 s al caer un dragón (y el alma, si es el 4.º).
//
// Solo usa información que el juego ya muestra (eventos de la partida y el
// estado de los jugadores). No depende de Electron: se puede probar en Node.

// Tiempos en segundos de partida. Riot los cambia entre temporadas:
// si un anuncio sale desfasado, se ajusta aquí.
const TIEMPOS = {
  dragon:    { primera: 5 * 60, reaparece: 5 * 60 },
  ancestral: { reaparece: 6 * 60 },          // tras el alma, y tras cada Ancestral
  larvas:    { primera: 8 * 60 },             // Vacuolarvas
  heraldo:   { primera: 15 * 60 },
  baron:     { primera: 25 * 60, reaparece: 6 * 60 },
};
const DURACION_BUFF = { baron: 180, ancestral: 150 };
const AVISO_ANTES = 90;      // anunciar cuando falta 1:30 o menos
const TOAST_DURACION = 5;    // segundos

const DRAGON_ES = {
  Fire: 'Infernal', Water: 'Océano', Earth: 'Montaña', Air: 'Nube',
  Hextech: 'Hextech', Chemtech: 'Quimtech', Elder: 'Ancestral',
};

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
    const ficha = (p) => ({ nombre: p.championName, corto: iniciales(p.championName) });

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

    // ── Toast del último dragón (5 s) ──
    let toast = null;
    const ultimoDragon = [...eventos].reverse().find((e) => e.EventName === 'DragonKill');
    if (ultimoDragon && t - ultimoDragon.EventTime <= TOAST_DURACION) {
      const eq = ladoDe(ultimoDragon.KillerName);
      const tipo = DRAGON_ES[ultimoDragon.DragonType] ?? ultimoDragon.DragonType;
      const esAlma = alma && alma.EventTime === ultimoDragon.EventTime;
      toast = {
        titulo: ultimoDragon.DragonType === 'Elder' ? 'Dragón Ancestral tomado'
          : esAlma ? `¡Alma ${tipo}!` : `${tipo} tomado`,
        tipo: ultimoDragon.DragonType,
        equipo: eq,
        esMio: eq === miLado,
        robado: ultimoDragon.Stolen === 'True' || ultimoDragon.Stolen === true,
        dragones: eq ? cuenta[eq] : 0,
      };
    }

    // ── Próximos objetivos ──
    const ultimo = (nombre, filtro = () => true) =>
      [...eventos].reverse().find((e) => e.EventName === nombre && filtro(e));
    const proximos = [];
    const agregar = (clave, nombre, aparece) => {
      if (aparece == null) return;
      const falta = aparece - t;
      if (falta > 0 && falta <= AVISO_ANTES) proximos.push({ clave, nombre, falta: Math.ceil(falta) });
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
    if (!ultimo('HordeKill')) agregar('larvas', 'Vacuolarvas', TIEMPOS.larvas.primera);
    if (!ultimo('HeraldKill')) agregar('heraldo', 'Heraldo', TIEMPOS.heraldo.primera);
    const ultBaron = ultimo('BaronKill');
    agregar('baron', 'Barón', ultBaron ? ultBaron.EventTime + TIEMPOS.baron.reaparece : TIEMPOS.baron.primera);
    proximos.sort((a, b) => a.falta - b.falta);

    return { tiempo: t, miLado, baron, ancestral, toast, proximos, dragones: cuenta };
  }

  return { actualizar };
}

module.exports = { crearEstadoPartida, TIEMPOS, DURACION_BUFF, iniciales };
