const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEstadoPartida, iniciales } = require('../src/game-state');

const jugador = (nombre, team, items = [], extra = {}) => ({ riotId: `${nombre}#LAN`, summonerName: nombre, championName: nombre, team, items, scores: {}, ...extra });
const partida = ({ t = 1500, eventos = [], mapa = 11 } = {}) => ({
  gameData: { gameTime: t, mapNumber: mapa, gameMode: mapa === 12 ? 'ARAM' : 'CLASSIC' },
  activePlayer: { riotId: 'Kyo#LAN' },
  allPlayers: [
    jugador('Kyo', 'ORDER', [{ itemID: 1, price: 1000, count: 1 }]),
    jugador('Alex', 'ORDER'),
    jugador('Rival', 'CHAOS', [{ itemID: 2, price: 400, count: 1 }]),
    jugador('Otro', 'CHAOS'),
  ],
  events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }, ...eventos] },
});

test('iniciales de un campeón', () => {
  assert.equal(iniciales('Lee Sin'), 'LS');
  assert.equal(iniciales("Kai'Sa"), 'KA');
});

test('diferencia de oro por fila del Tab', () => {
  const e = crearEstadoPartida();
  const r = e.actualizar(partida());
  assert.equal(r.miLado, 'blue');
  assert.equal(r.oro[0].diferencia, 600);
});

test('Barón de tu equipo: buff con titulares y tiempo restante', () => {
  const e = crearEstadoPartida();
  const r = e.actualizar(partida({ t: 1300, eventos: [{ EventID: 5, EventName: 'BaronKill', EventTime: 1250, KillerName: 'Kyo' }] }));
  assert.equal(r.baron.esMio, true);
  assert.equal(r.baron.restante, 130);
  assert.equal(r.baron.titulares.length, 2);
});

test('quien muere después pierde el buff', () => {
  const e = crearEstadoPartida();
  const ev = [{ EventID: 5, EventName: 'BaronKill', EventTime: 1250, KillerName: 'Kyo' }];
  e.actualizar(partida({ t: 1260, eventos: ev }));
  const r = e.actualizar(partida({ t: 1280, eventos: [...ev, { EventID: 6, EventName: 'ChampionKill', EventTime: 1270, VictimName: 'Alex', KillerName: 'Rival' }] }));
  assert.equal(r.baron.titulares.length, 1);
});

test('en ARAM no hay Barón ni dragones', () => {
  const e = crearEstadoPartida();
  const r = e.actualizar(partida({ mapa: 12, eventos: [{ EventID: 5, EventName: 'BaronKill', EventTime: 1450, KillerName: 'Kyo' }] }));
  assert.equal(r.baron, null);
});
