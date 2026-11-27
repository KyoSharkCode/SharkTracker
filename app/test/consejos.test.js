const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEstadoPartida } = require('../src/game-state');
const { crearConsejos } = require('../src/consejos');

const J = (nombre, team, extra = {}) => ({ riotId: `${nombre}#LAN`, summonerName: nombre, championName: nombre, rawChampionName: `game_character_displayname_${nombre}`, team, items: [], scores: {}, level: 6, isDead: false, respawnTimer: 0, ...extra });
function partida({ t = 600, eventos = [], yo = {}, oro = 300, nivel = 6, rivales = {}, aliados = {}, modo = 'CLASSIC', mapa = 11 } = {}) {
  return {
    gameData: { gameTime: t, mapNumber: mapa, gameMode: modo },
    activePlayer: { riotId: 'Kyo#LAN', level: nivel, currentGold: oro },
    allPlayers: [
      J('Kyo', 'ORDER', { position: 'MIDDLE', ...yo }),
      J('Vi', 'ORDER', { position: 'JUNGLE', ...aliados }), J('Jinx', 'ORDER', { position: 'BOTTOM', ...aliados }),
      J('Zed', 'CHAOS', { position: 'MIDDLE', ...rivales.Zed }), J('Lux', 'CHAOS', { position: 'UTILITY', ...rivales.Lux }), J('Darius', 'CHAOS', { position: 'TOP', ...rivales.Darius }),
    ],
    events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }, ...eventos] },
  };
}
const TIPS = { Zed: ['La Armadura es particularmente efectiva contra él.', 'Es vulnerable tras usar Sombra Viviente.'] };
// Una partida que avanza: cada paso es una lectura.
function sesion() {
  const c = crearConsejos();
  const juego = crearEstadoPartida();
  return (datos, extras = {}) => c.procesar(datos, juego.actualizar(datos), { tips: TIPS, ...extras });
}
const muerte = (id, t, asesino = 'Zed') => ({ EventID: id, EventName: 'ChampionKill', EventTime: t, KillerName: asesino, VictimName: 'Kyo' });
const muerta = { isDead: true, respawnTimer: 20 };

test('morir con 2 niveles menos: lo dice, con el campeón y su consejo oficial debajo', () => {
  const paso = sesion();
  paso(partida({ t: 590 }));
  const c = paso(partida({ t: 600, yo: muerta, eventos: [muerte(1, 600)], rivales: { Zed: { level: 8 } } }));
  assert.equal(c.tipo, 'muerte');
  assert.equal(c.titulo, 'Consejo');
  assert.match(c.texto, /^Peleaste con 2 niveles menos que Zed\. .*igualar el nivel con farmeo/);
  assert.equal(c.pie, 'Contra Zed: La Armadura es particularmente efectiva contra él.');
  assert.deepEqual(c.campeon, { nombre: 'Zed', clave: 'Zed' });
  assert.equal(c.segundos, 16);
});

test('morir sin nada especial: el consejo oficial contra ese campeón, distinto cada vez', () => {
  const paso = sesion();
  paso(partida({ t: 590 }));
  const a = paso(partida({ t: 600, yo: muerta, eventos: [muerte(1, 600)] }));
  assert.equal(a.texto, 'Contra Zed: La Armadura es particularmente efectiva contra él.');
  assert.equal(a.pie, null);
  const b = paso(partida({ t: 700, yo: muerta, eventos: [muerte(1, 600), muerte(2, 700)] }));
  assert.equal(b.texto, 'Contra Zed: Es vulnerable tras usar Sombra Viviente.');
});

test('otras razones de una muerte: desventaja numérica, oro sin gastar, objetivo cerca, tercera vez', () => {
  let paso = sesion();
  paso(partida({ t: 590 }));
  assert.match(paso(partida({ t: 600, yo: muerta, aliados: { isDead: true }, eventos: [muerte(1, 600)] })).texto, /quedaban 0 de los tuyos contra 3 rivales/);

  paso = sesion();
  paso(partida({ t: 590 }));
  assert.match(paso(partida({ t: 600, oro: 1400, yo: muerta, eventos: [muerte(1, 600)] })).texto, /Moriste con 1400 de oro sin gastar/);

  paso = sesion();
  paso(partida({ t: 250 }));
  assert.match(paso(partida({ t: 260, yo: muerta, eventos: [muerte(1, 260)] })).texto, /Moriste a 40 segundos de que salga Dragón/);

  paso = sesion();
  paso(partida({ t: 590 }));
  paso(partida({ t: 600, yo: muerta, eventos: [muerte(1, 600)] }));
  paso(partida({ t: 700, yo: muerta, eventos: [muerte(1, 600), muerte(2, 700)] }));
  const c = paso(partida({ t: 800, yo: muerta, eventos: [muerte(1, 600), muerte(2, 700), muerte(3, 800)] }));
  assert.match(c.texto, /^Zed ya te mató tres veces/);
});

test('si te mata un campeón sin consejo oficial y sin nada que destacar, no sale tarjeta', () => {
  const paso = sesion();
  paso(partida({ t: 590 }));
  assert.equal(paso(partida({ t: 600, yo: muerta, eventos: [muerte(1, 600, 'Lux')] })), null);
});

test('perder la torre de tu línea: el consejo sale una vez; la de otra línea, no', () => {
  const paso = sesion();
  paso(partida({ t: 700 }));
  const torre = (id, t, nombre) => ({ EventID: id, EventName: 'TurretKilled', EventTime: t, TurretKilled: nombre, KillerName: 'Zed' });
  assert.equal(paso(partida({ t: 710, eventos: [torre(1, 709, 'Turret_T1_L_03_A')] })), null); // la de arriba: no es tu línea
  const c = paso(partida({ t: 730, eventos: [torre(1, 709, 'Turret_T1_L_03_A'), torre(2, 729, 'Turret_T1_C_05_A')] }));
  assert.equal(c.tipo, 'partida');
  assert.match(c.texto, /^Perdiste una torre de tu línea\. Eso le da espacio al rival para rotar/);
  const otra = [torre(1, 709, 'Turret_T1_L_03_A'), torre(2, 729, 'Turret_T1_C_05_A'), torre(3, 900, 'Turret_T1_C_04_A')];
  assert.equal(paso(partida({ t: 901, eventos: otra })), null);
});

test('no se pisan: tras un consejo, el siguiente espera; y en plena pelea no sale', () => {
  const paso = sesion();
  paso(partida({ t: 1300 }));
  const baron = { EventID: 1, EventName: 'BaronKill', EventTime: 1301, KillerName: 'Zed' };
  const kill = { EventID: 2, EventName: 'ChampionKill', EventTime: 1301, KillerName: 'Zed', VictimName: 'Vi' };
  assert.equal(paso(partida({ t: 1302, eventos: [baron, kill] })), null);      // hay pelea
  assert.match(paso(partida({ t: 1312, eventos: [baron, kill] })).texto, /El rival tiene el Barón/);
  const inhib = { EventID: 3, EventName: 'InhibKilled', EventTime: 1320, InhibKilled: 'Barracks_T1_C1', KillerName: 'Zed' };
  assert.equal(paso(partida({ t: 1321, eventos: [baron, kill, inhib] })), null); // muy seguido
});

test('ventaja numérica y oro acumulado', () => {
  let paso = sesion();
  paso(partida({ t: 700 }));
  const muertos = { Zed: { isDead: true }, Lux: { isDead: true }, Darius: { isDead: true } };
  assert.match(paso(partida({ t: 701, rivales: muertos })).texto, /Hay 3 rivales muertos: es la ventana para ir por Dragón/);

  paso = sesion();
  const compra = { objetivo: { nombre: 'Sombrero mortal de Rabadon', falta: 0 }, componente: null };
  assert.equal(paso(partida({ t: 700, oro: 3700 }), { siguiente: compra }), null); // recién le alcanza
  assert.match(paso(partida({ t: 761, oro: 3750 }), { siguiente: compra }).texto, /Llevas 3750 de oro encima: te alcanza para Sombrero mortal de Rabadon/);
});

test('solo en la Grieta', () => {
  const paso = sesion();
  paso(partida({ t: 590, modo: 'ARAM', mapa: 12 }));
  assert.equal(paso(partida({ t: 600, modo: 'ARAM', mapa: 12, yo: muerta, eventos: [muerte(1, 600)], rivales: { Zed: { level: 9 } } })), null);
});
