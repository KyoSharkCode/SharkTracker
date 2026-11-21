const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEstadoPartida } = require('../src/game-state');
const { resumir, crearCoach, rolCoach } = require('../src/coach-cerebro');

const jugador = (nombre, team, extra = {}) => ({
  riotId: `${nombre}#LAN`, summonerName: nombre, championName: nombre, team, items: [], scores: {}, isDead: false, respawnTimer: 0, ...extra,
});
const WARD = { itemID: 2055, displayName: 'Centinela de control', slot: 2, count: 1 };
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
// Una lectura de la partida: observa y devuelve la situación a consultar (o null).
const paso = (c, datos, ahora, { extras, activo = true } = {}) => {
  const r = leer(datos, extras);
  c.observar(r, datos, activo);
  return activo ? c.siguiente(r, datos, ahora) : null;
};
const conWard = { items: [WARD] };

test('rol del coach: el de la partida, y si no el de Meta', () => {
  assert.equal(rolCoach('UTILITY', 'mid'), 'soporte');
  assert.equal(rolCoach('', 'jungle'), 'jungla');
  assert.equal(rolCoach('', null), null);
});

test('resumen: tus datos, tu equipo y los objetivos con su reloj', () => {
  const d = partida({
    t: 190,
    yo: { items: [{ ...WARD, count: 2 }, { itemID: 3364, displayName: 'Lente del oráculo', slot: 6 }, { itemID: 3865, displayName: 'Atlas del mundo', slot: 0 }] },
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
  assert.deepEqual(r.equipo, { kills: 4, torres: 1, dragones: 0, muertos: 0, vivos: 2, jungla: { viva: true, reaparece: 0 } });
  assert.deepEqual(r.objetivos.find((o) => o.clave === 'dragon'), { clave: 'dragon', nombre: 'Dragón', en: 110 });
});

test('del rival solo sale el marcador: ni nombres, ni campeones, ni objetos', () => {
  const c = crearCoach();
  const d = partida({ eventos: [{ EventID: 1, EventName: 'ChampionKill', EventTime: 590, KillerName: 'Zed', VictimName: 'Vi' }] });
  const r = leer(d);
  c.observar(r, d);
  assert.deepEqual(r.rival, { kills: 5, torres: 0, dragones: 0, muertos: 1, vivos: 1 });
  const texto = JSON.stringify([r, c.bitacora()]);
  for (const prohibido of ['Zed', 'Lux', 'Youmuu']) assert.equal(texto.includes(prohibido), false, prohibido);
});

test('objetivo sin ningún problema: el coach calla (ya no avisa por reloj)', () => {
  const c = crearCoach();
  for (let t = 195; t <= 255; t += 5) assert.equal(paso(c, partida({ t, oro: 60, yo: conWard }), t * 1000), null);
});

test('objetivo con un problema: habla, una sola vez, y dice cuál', () => {
  const c = crearCoach();
  assert.equal(paso(c, partida({ t: 170, vida: [300, 1000], oro: 60, yo: conWard }), 0), null); // faltan 130 s: todavía no
  const s = paso(c, partida({ t: 200, vida: [300, 1000], oro: 60, yo: conWard }), 30000);
  assert.equal(s.tipo, 'objetivo');
  assert.equal(s.directo, true);
  assert.match(s.motivo, /Dragón aparece en 100 s y tienes 30 % de vida/);
  assert.equal(paso(c, partida({ t: 205, vida: [300, 1000], oro: 60, yo: conWard }), 90000), null);
});

test('compra: se anota, cuenta como "estás en base" y abre un momento para hablar', () => {
  const c = crearCoach();
  paso(c, partida({ t: 400, oro: 1300, yo: conWard }), 0);
  const d = partida({ t: 401, oro: 200, yo: { items: [WARD, { itemID: 3067, displayName: 'Gema ardiente', slot: 1 }] } });
  const s = paso(c, d, 1000);
  assert.equal(s.tipo, 'base');
  assert.deepEqual(c.bitacora().at(-1), { minuto: '6:41', tipo: 'compra', detalle: 'Compraste Gema ardiente' });
  assert.equal(c.actividad(leer(partida({ t: 409, oro: 200 }))).enBaseHace, 8);
});

test('recién comprada no se le manda a preparar el objetivo como si siguiera fuera', () => {
  const c = crearCoach();
  paso(c, partida({ t: 180, oro: 900, vida: [300, 1000], yo: conWard }), 0);
  assert.equal(paso(c, partida({ t: 181, oro: 100, vida: [300, 1000], yo: conWard }), 1000).tipo, 'base');
  // Dragón en 100 s y con poca vida, pero acaba de comprar: no hay aviso de objetivo.
  assert.equal(paso(c, partida({ t: 200, oro: 100, vida: [300, 1000], yo: conWard }), 40000), null);
});

test('muerte: va a la bitácora con su contexto y abre una pausa para hablar', () => {
  const c = crearCoach();
  paso(c, partida({ t: 700, yo: conWard }), 0);
  const muerta = partida({ t: 705, oro: 900, yo: { ...conWard, isDead: true, respawnTimer: 22, scores: { kills: 1, deaths: 3, assists: 7 } } });
  const s = paso(c, muerta, 5000);
  assert.equal(s.tipo, 'muerte');
  assert.match(s.motivo, /reaparece en 22 s/);
  assert.match(c.bitacora().at(-1).detalle, /muerte número 3\) con 900 de oro sin gastar; quedaban vivos 1 de tu equipo y 1 rivales/);
});

test('en plena pelea espera, salvo que estés muerta', () => {
  const c = crearCoach();
  const pelea = [{ EventID: 3, EventName: 'ChampionKill', EventTime: 198, KillerName: 'Vi', VictimName: 'Lux' }];
  paso(c, partida({ t: 180, vida: [300, 1000], yo: conWard }), 0);
  assert.equal(paso(c, partida({ t: 200, vida: [300, 1000], yo: conWard, eventos: pelea }), 10000), null);
  assert.equal(paso(c, partida({ t: 210, vida: [300, 1000], yo: conWard, eventos: pelea }), 20000).tipo, 'objetivo');
});

test('cambio grande: el rival llega a 3 dragones (y queda en la bitácora)', () => {
  const c = crearCoach();
  const dragon = (id, t) => ({ EventID: id, EventName: 'DragonKill', EventTime: t, KillerName: 'Zed', DragonType: 'Fire' });
  paso(c, partida({ t: 1400, yo: conWard, eventos: [dragon(1, 400), dragon(2, 800)] }), 0);
  const s = paso(c, partida({ t: 1405, yo: conWard, eventos: [dragon(1, 400), dragon(2, 800), dragon(3, 1403)] }), 60000);
  assert.equal(s.tipo, 'ritmo');
  assert.match(s.motivo, /El rival lleva 3 dragones/);
  assert.ok(c.bitacora().some((b) => b.detalle === 'El rival tomó un dragón (lleva 3)'));
});

test('lo que pasó antes de abrir la app no dispara nada', () => {
  const c = crearCoach();
  const d = partida({ t: 1500, yo: conWard, eventos: [{ EventID: 9, EventName: 'BaronKill', EventTime: 1495, KillerName: 'Vi' }] });
  assert.equal(paso(c, d, 0), null);
});

test('oro acumulado: solo tras un rato pudiendo comprar, y pasa por el filtro', () => {
  const c = crearCoach();
  const compra = { objetivo: { nombre: 'Redención', coste: 2300, falta: 0 }, componente: null };
  const en = (t) => paso(c, partida({ t, oro: 2400, yo: conWard }), t * 1000, { extras: { siguiente: compra } });
  assert.equal(en(620), null);            // acaba de alcanzarle: se le da tiempo a backear sola
  assert.equal(en(650), null);
  const s = en(670);
  assert.equal(s.tipo, 'compra');
  assert.equal(s.directo, false);
  assert.match(s.motivo, /le alcanza para Redención y no ha vuelto a base/);
  assert.equal(en(700), null);            // no se insiste
});

test('ya no hay repasos periódicos ni avisos de visión sueltos', () => {
  const c = crearCoach();
  for (let t = 600; t <= 900; t += 10) assert.equal(paso(c, partida({ t, oro: 300, yo: conWard }), t * 1000), null);
});

test('lectura a pedido: sale ya, aunque se haya llegado al tope', () => {
  const c = crearCoach({ tope: 1 });
  const s = paso(c, partida({ t: 200, vida: [300, 1000], yo: conWard }), 0);
  c.hablado(s, 'Llegas al dragón con 30 % de vida: mejor tarde y sana.', 1000, '3:20');
  assert.deepEqual(c.bitacora().at(-1), { minuto: '3:20', tipo: 'coach', detalle: 'Llegas al dragón con 30 % de vida: mejor tarde y sana.' });
  const muerta = partida({ t: 400, yo: { ...conWard, isDead: true, respawnTimer: 30 } });
  assert.equal(paso(c, muerta, 400000), null); // tope alcanzado
  c.pedir();
  assert.equal(paso(c, partida({ t: 402, yo: conWard }), 402000).tipo, 'pedido');
});

test('control cada 5 minutos en la bitácora', () => {
  const c = crearCoach();
  paso(c, partida({ t: 601, yo: conWard }), 0);
  assert.match(c.bitacora().at(-1).detalle, /^Control: nivel 7, KDA 1\/2\/7, 20 de CS/);
});

test('apagado o silenciado: lleva la bitácora pero no junta nada que decir', () => {
  const c = crearCoach();
  paso(c, partida({ t: 1400, yo: conWard }), 0, { activo: false });
  const baron = [{ EventID: 4, EventName: 'BaronKill', EventTime: 1402, KillerName: 'Vi' }];
  paso(c, partida({ t: 1403, yo: conWard, eventos: baron }), 1000, { activo: false });
  assert.ok(c.bitacora().some((b) => b.detalle === 'Tu equipo tomó el Barón'));
  assert.equal(paso(c, partida({ t: 1404, yo: conWard, eventos: baron }), 60000), null);
});
