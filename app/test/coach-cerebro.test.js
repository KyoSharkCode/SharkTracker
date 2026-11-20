const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEstadoPartida } = require('../src/game-state');
const { resumir, crearCoach, rolCoach, T } = require('../src/coach-cerebro');

const jugador = (nombre, team, extra = {}) => ({
  riotId: `${nombre}#LAN`, summonerName: nombre, championName: nombre, team, items: [], scores: {}, isDead: false, respawnTimer: 0, ...extra,
});
function partida({ t = 600, eventos = [], yo = {}, oro = 500, vida = [800, 1000], jugadores } = {}) {
  return {
    gameData: { gameTime: t, mapNumber: 11, gameMode: 'CLASSIC' },
    activePlayer: { riotId: 'Kyo#LAN', level: 7, currentGold: oro, championStats: { currentHealth: vida[0], maxHealth: vida[1], resourceType: 'MANA', resourceValue: 300, resourceMax: 600 } },
    allPlayers: jugadores ?? [
      jugador('Kyo', 'ORDER', { position: 'UTILITY', scores: { kills: 1, deaths: 2, assists: 7, creepScore: 20, wardScore: 18 }, ...yo }),
      jugador('Vi', 'ORDER', { position: 'JUNGLE', scores: { kills: 3 } }),
      jugador('Zed', 'CHAOS', { position: 'MIDDLE', level: 9, scores: { kills: 4 }, isDead: true, respawnTimer: 12, items: [{ itemID: 3142, displayName: 'Filo fantasmal de Youmuu', slot: 0 }] }),
      jugador('Lux', 'CHAOS', { position: 'UTILITY', scores: { kills: 1 } }),
    ],
    events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }, ...eventos] },
  };
}
const leer = (datos, extras = {}) => resumir(datos, crearEstadoPartida().actualizar(datos), { rol: 'soporte', ...extras });

test('rol del coach: el de la partida, y si no el de Meta', () => {
  assert.equal(rolCoach('UTILITY', 'mid'), 'soporte');
  assert.equal(rolCoach('', 'jungle'), 'jungla');
  assert.equal(rolCoach('', null), null);
});

test('resumen: tus datos, tu equipo y los objetivos con su reloj', () => {
  const d = partida({
    t: 190,
    yo: { items: [{ itemID: 2055, displayName: 'Centinela de control', slot: 2, count: 2 }, { itemID: 3364, displayName: 'Lente del oráculo', slot: 6 }, { itemID: 3865, displayName: 'Atlas del mundo', slot: 0 }] },
    eventos: [{ EventID: 1, EventName: 'TurretKilled', EventTime: 150, TurretKilled: 'Turret_T2_L_03_A', KillerName: 'Vi' }],
  });
  const r = leer(d);
  assert.equal(r.minuto, '3:10');
  assert.equal(r.vida, 80);
  assert.equal(r.mana, 50);
  assert.equal(r.kda, '1/2/7');
  assert.equal(r.vision.wardsControl, 2);
  assert.equal(r.vision.trinket, 'Lente del oráculo');
  assert.deepEqual(r.objetos, ['Atlas del mundo']);
  assert.deepEqual(r.equipo, { kills: 4, torres: 1, dragones: 0, muertos: 0, jungla: { viva: true, reaparece: 0 } });
  assert.deepEqual(r.objetivos.find((o) => o.clave === 'dragon'), { clave: 'dragon', nombre: 'Dragón', en: 110 });
});

test('del rival solo sale el marcador: ni nombres, ni campeones, ni objetos', () => {
  const r = leer(partida());
  assert.deepEqual(r.rival, { kills: 5, torres: 0, dragones: 0, muertos: 1 });
  const texto = JSON.stringify(r);
  for (const prohibido of ['Zed', 'Lux', 'Youmuu']) assert.equal(texto.includes(prohibido), false, prohibido);
});

test('siguiente compra: nombre y lo que falta', () => {
  const r = leer(partida(), { siguiente: { objetivo: { nombre: 'Redención', coste: 2300, falta: 0 }, componente: null } });
  assert.deepEqual(r.siguienteCompra, { nombre: 'Redención', falta: 0, componente: null });
});

test('objetivo: avisa ~2 min antes, una sola vez', () => {
  const c = crearCoach();
  const en = (t, ahora) => { const d = partida({ t }); return c.siguiente(leer(d), d, ahora); };
  assert.equal(en(100, 0), null);                       // dragón en 200 s: todavía no
  const s = en(180, 80000);                             // dragón en 120 s
  assert.equal(s.tipo, 'objetivo');
  assert.equal(s.directo, true);
  assert.match(s.motivo, /Dragón aparece en 120 s/);
  assert.equal(en(181, 81000), null);                   // el mismo dragón no se repite
});

test('acabas de morir: consejo directo mientras esperas', () => {
  const c = crearCoach();
  const viva = partida({ t: 700 });
  assert.notEqual(c.siguiente(leer(viva), viva, 0)?.tipo, 'muerte');
  const muerta = partida({ t: 705, yo: { isDead: true, respawnTimer: 22 } });
  const s = c.siguiente(leer(muerta), muerta, 5000);
  assert.equal(s.tipo, 'muerte');
  assert.match(s.motivo, /reapareces en 22 s/);
});

test('en plena pelea espera, salvo que estés muerta', () => {
  const c = crearCoach();
  const base = partida({ t: 170 });
  c.siguiente(leer(base), base, 0);
  const pelea = [{ EventID: 3, EventName: 'ChampionKill', EventTime: 178, KillerName: 'Vi', VictimName: 'Lux' }];
  const d = partida({ t: 180, eventos: pelea });
  assert.equal(c.siguiente(leer(d), d, 10000), null);   // dragón en 120 s, pero hay pelea
  const luego = partida({ t: 190, eventos: pelea });
  assert.equal(c.siguiente(leer(luego), luego, 20000).tipo, 'objetivo');
});

test('cambio grande: el rival llega a 3 dragones', () => {
  const c = crearCoach();
  const dragon = (id, t) => ({ EventID: id, EventName: 'DragonKill', EventTime: t, KillerName: 'Zed', DragonType: 'Fire' });
  const antes = partida({ t: 1400, eventos: [dragon(1, 400), dragon(2, 800)] });
  c.siguiente(leer(antes), antes, 0);
  const d = partida({ t: 1405, eventos: [dragon(1, 400), dragon(2, 800), dragon(3, 1403)] });
  const s = c.siguiente(leer(d), d, 60000);
  assert.equal(s.tipo, 'ritmo');
  assert.match(s.motivo, /rival lleva 3 dragones/);
});

test('lo que pasó antes de abrir la app no dispara nada', () => {
  const c = crearCoach();
  const d = partida({ t: 1500, eventos: [{ EventID: 9, EventName: 'BaronKill', EventTime: 1495, KillerName: 'Vi' }] });
  assert.equal(c.siguiente(leer(d), d, 0)?.tipo === 'ritmo', false);
});

test('por si acaso: compra, visión y repaso pasan por el filtro y respetan el intervalo', () => {
  const c = crearCoach({ intervalo: 75 });
  const compra = { objetivo: { nombre: 'Redención', coste: 2300, falta: 0 }, componente: null };
  const d = partida({ t: 620, oro: 2400 });
  const s = c.siguiente(leer(d, { siguiente: compra }), d, 100000);
  assert.equal(s.tipo, 'compra');
  assert.equal(s.directo, false);
  assert.match(s.motivo, /te alcanza para Redención/);
  // 10 s después: demasiado pronto para otra consulta.
  const d2 = partida({ t: 630, oro: 2400 });
  assert.equal(c.siguiente(leer(d2, { siguiente: compra }), d2, 110000), null);
  // Pasado el margen entre consultas: sin ward de control y con oro.
  const d3 = partida({ t: 620 + T.entreLlamadas + 1, oro: 300 });
  assert.equal(c.siguiente(leer(d3), d3, 100000 + (T.entreLlamadas + 1) * 1000).tipo, 'vision');
});

test('tope de consejos por partida y pausa tras hablar', () => {
  const c = crearCoach({ tope: 1, intervalo: 75 });
  const d = partida({ t: 180 });
  const s = c.siguiente(leer(d), d, 0);
  c.hablado(s, 'Dragón en dos minutos: backea y trae ward de control.', 1000, '3:00');
  assert.equal(c.dichos().length, 1);
  const muerta = partida({ t: 400, yo: { isDead: true, respawnTimer: 30 } });
  assert.equal(c.siguiente(leer(muerta), muerta, 400000), null); // ya se llegó al tope
});

test('apagado o silenciado: no pide nada ni suelta después lo acumulado', () => {
  const c = crearCoach();
  const antes = partida({ t: 1400 });
  c.siguiente(leer(antes), antes, 0, false);
  const baron = [{ EventID: 4, EventName: 'BaronKill', EventTime: 1402, KillerName: 'Vi' }];
  const d = partida({ t: 1403, eventos: baron });
  assert.equal(c.siguiente(leer(d), d, 1000, false), null);
  const d2 = partida({ t: 1404, eventos: baron });
  assert.notEqual(c.siguiente(leer(d2), d2, 60000, true)?.tipo, 'ritmo');
});
