// Clips automáticos (C2): qué eventos de la partida merecen un clip. Sin Electron
// (se prueba en Node con eventos de ejemplo).
//
// La Live Client Data API (allgamedata → events.Events) avisa kills, objetivos y
// estructuras con el nombre de quien lo hizo y de quienes ayudaron. Solo cuentan
// los eventos en los que participaste (autor, asistencia o víctima).
// La ulti no la avisa la API: main.js pasa cada pulsación de la tecla de la R
// (uiohook) y cuenta solo si en los 10 s siguientes participas en una kill u
// objetivo (o siempre, con "Cada ulti").

const VENTANA_ULTI = 10000;

// Tipos de evento con su interruptor en Ajustes → Clips → Eventos.
const TIPOS = ['kill', 'asistencia', 'muerte', 'objetivo', 'estructura', 'ulti', 'cadaUlti'];

const MULTI = { 2: 'Doble kill', 3: 'Triple kill', 4: 'Cuádruple kill', 5: 'Pentakill' };

// Para el nombre del clip: lo más vistoso de la jugada primero.
const PRIORIDAD = ['Pentakill', 'Cuádruple kill', 'Triple kill', 'Robo de Barón', 'Robo de Ancestral', 'Robo de dragón',
  'Barón', 'Ancestral', 'Atakhan', 'Doble kill', 'Robo de Heraldo', 'Heraldo', 'Dragón', 'Larvas', 'Kill', 'Inhibidor',
  'Asistencia', 'Torre', 'Ulti', 'Muerte', 'Clip'];

const verdadero = (v) => v === true || v === 'True' || v === 'true';

function nombresPropios(datos) {
  const a = datos?.activePlayer ?? {};
  const set = new Set();
  for (const n of [a.riotId, a.summonerName, a.riotIdGameName, a.riotId?.split('#')[0]]) if (n) set.add(n);
  // El nombre en los eventos a veces viene sin el #tag: se suma lo que tenga allPlayers.
  for (const p of datos?.allPlayers ?? []) {
    const suyos = [p.riotId, p.summonerName, p.riotIdGameName, p.riotId?.split('#')[0]].filter(Boolean);
    if (suyos.some((n) => set.has(n))) suyos.forEach((n) => set.add(n));
  }
  return set;
}

// ¿Qué es este evento para ti? → { tipo, etiqueta } o null si no participaste.
function clasificar(e, soyYo) {
  const autor = soyYo(e.KillerName);
  const ayude = (e.Assisters ?? []).some(soyYo);
  switch (e.EventName) {
    case 'ChampionKill':
      if (autor) return { tipo: 'kill', etiqueta: 'Kill' };
      if (ayude) return { tipo: 'asistencia', etiqueta: 'Asistencia' };
      if (soyYo(e.VictimName)) return { tipo: 'muerte', etiqueta: 'Muerte' };
      return null;
    case 'Multikill':
      return autor ? { tipo: 'kill', etiqueta: MULTI[Math.min(5, Number(e.KillStreak) || 2)] } : null;
    case 'DragonKill': {
      if (!autor && !ayude) return null;
      const anc = e.DragonType === 'Elder';
      const base = anc ? 'Ancestral' : 'Dragón';
      return { tipo: 'objetivo', etiqueta: verdadero(e.Stolen) ? `Robo de ${anc ? 'Ancestral' : 'dragón'}` : base };
    }
    case 'BaronKill':
      return autor || ayude ? { tipo: 'objetivo', etiqueta: verdadero(e.Stolen) ? 'Robo de Barón' : 'Barón' } : null;
    case 'HeraldKill':
      return autor || ayude ? { tipo: 'objetivo', etiqueta: verdadero(e.Stolen) ? 'Robo de Heraldo' : 'Heraldo' } : null;
    case 'TurretKilled':
      return autor || ayude ? { tipo: 'estructura', etiqueta: 'Torre' } : null;
    case 'InhibKilled':
      return autor || ayude ? { tipo: 'estructura', etiqueta: 'Inhibidor' } : null;
    default:
      if (/horde|grub|larva/i.test(e.EventName ?? '')) return autor || ayude ? { tipo: 'objetivo', etiqueta: 'Larvas' } : null;
      if (/atakhan/i.test(e.EventName ?? '')) return autor || ayude ? { tipo: 'objetivo', etiqueta: 'Atakhan' } : null;
      return null;
  }
}

// Detector de una partida. `procesar(datos, ahora)` se llama cada segundo con
// allgamedata y devuelve los momentos que piden clip: [{ t, tipo, etiqueta }].
// `ulti(ahora, datos)` se llama al pulsar la tecla de la R.
function crearDetector() {
  let ultimoId = null;   // EventID más alto ya visto (lo anterior no hace clip)
  let partida = null;    // EventTime del GameStart: si cambia, es otra partida
  let ultis = [];        // pulsaciones de la R aún sin jugada (últimos 10 s)

  function procesar(datos, ahora, eventos) {
    const lista = datos?.events?.Events ?? [];
    const inicio = lista.find((e) => e.EventName === 'GameStart')?.EventTime ?? null;
    const maxId = lista.reduce((m, e) => Math.max(m, Number(e.EventID) || 0), -1);
    // Primera lectura (o partida nueva / repetición): lo que ya pasó no hace clip.
    if (ultimoId === null || inicio !== partida || maxId < ultimoId) {
      ultimoId = maxId;
      partida = inicio;
      ultis = [];
      return [];
    }
    const nuevos = lista.filter((e) => Number(e.EventID) > ultimoId);
    if (!nuevos.length) return [];
    ultimoId = maxId;
    const nombres = nombresPropios(datos);
    const soyYo = (n) => !!n && nombres.has(n);
    ultis = ultis.filter((t) => ahora - t <= VENTANA_ULTI);
    const salida = [];
    for (const e of nuevos) {
      const c = clasificar(e, soyYo);
      if (!c) continue;
      // Ulti + jugada en los 10 s siguientes: el clip arranca en la ulti.
      const conUlti = ['kill', 'asistencia', 'objetivo'].includes(c.tipo) && ultis.length > 0;
      if (eventos[c.tipo]) salida.push({ t: conUlti ? Math.min(ahora, ultis[0]) : ahora, ...c });
      else if (conUlti && eventos.ulti) salida.push({ t: ultis[0], tipo: 'ulti', etiqueta: c.etiqueta });
      if (conUlti) ultis = [];
    }
    return salida;
  }

  // Pulsación de la tecla de la R. Solo cuenta si ya tienes la ulti (nivel ≥ 1).
  function ulti(ahora, datos, eventos) {
    if (!(Number(datos?.activePlayer?.abilities?.R?.abilityLevel) > 0)) return [];
    if (eventos.cadaUlti) return [{ t: ahora, tipo: 'cadaUlti', etiqueta: 'Ulti' }];
    if (eventos.ulti || eventos.kill || eventos.asistencia || eventos.objetivo) ultis.push(ahora);
    return [];
  }

  return { procesar, ulti };
}

// Nombre del clip con lo mejor de la jugada: "Triple kill + Barón".
function titulo(etiquetas) {
  const unicas = [...new Set(etiquetas)].sort((a, b) => {
    const ia = PRIORIDAD.indexOf(a); const ib = PRIORIDAD.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // Una multikill ya incluye sus kills.
  const sinKill = unicas.some((u) => /kill$/i.test(u) && u !== 'Kill') ? unicas.filter((u) => u !== 'Kill') : unicas;
  return sinKill.slice(0, 2).join(' + ') || 'Clip';
}

module.exports = { crearDetector, clasificar, titulo, TIPOS, VENTANA_ULTI };
