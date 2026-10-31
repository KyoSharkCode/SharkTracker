const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDetector, clasificar, titulo } = require('../src/clips-eventos');

const soyYo = (n) => n === 'Kyo';
const TODOS = { kill: true, asistencia: true, muerte: true, objetivo: true, estructura: true, ulti: true, cadaUlti: false };

test('clasificar: kill, asistencia, muerte y lo ajeno', () => {
  assert.equal(clasificar({ EventName: 'ChampionKill', KillerName: 'Kyo' }, soyYo).etiqueta, 'Kill');
  assert.equal(clasificar({ EventName: 'ChampionKill', KillerName: 'X', Assisters: ['Kyo'] }, soyYo).etiqueta, 'Asistencia');
  assert.equal(clasificar({ EventName: 'ChampionKill', KillerName: 'X', VictimName: 'Kyo' }, soyYo).etiqueta, 'Muerte');
  assert.equal(clasificar({ EventName: 'ChampionKill', KillerName: 'X', VictimName: 'Y' }, soyYo), null);
});

test('clasificar: multikill, robo y estructuras', () => {
  assert.equal(clasificar({ EventName: 'Multikill', KillerName: 'Kyo', KillStreak: 3 }, soyYo).etiqueta, 'Triple kill');
  assert.equal(clasificar({ EventName: 'BaronKill', KillerName: 'Kyo', Stolen: 'True' }, soyYo).etiqueta, 'Robo de Barón');
  assert.equal(clasificar({ EventName: 'DragonKill', KillerName: 'X', Assisters: ['Kyo'], DragonType: 'Elder' }, soyYo).etiqueta, 'Ancestral');
  assert.equal(clasificar({ EventName: 'TurretKilled', KillerName: 'Kyo' }, soyYo).tipo, 'estructura');
});

test('título: lo más vistoso primero y la multikill se come la kill', () => {
  assert.equal(titulo(['Kill', 'Barón', 'Triple kill']), 'Triple kill + Barón');
  assert.equal(titulo(['Muerte', 'Asistencia']), 'Asistencia + Muerte');
  assert.equal(titulo([]), 'Clip');
});

const datos = (eventos) => ({
  activePlayer: { riotId: 'Kyo#LAN', abilities: { R: { abilityLevel: 1 } } },
  allPlayers: [{ riotId: 'Kyo#LAN', summonerName: 'Kyo' }],
  events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }, ...eventos] },
});

test('detector: lo que ya pasó al abrir no hace clip; lo nuevo sí', () => {
  const d = crearDetector();
  assert.deepEqual(d.procesar(datos([{ EventID: 1, EventName: 'ChampionKill', KillerName: 'Kyo' }]), 1000, TODOS), []);
  const r = d.procesar(datos([{ EventID: 1, EventName: 'ChampionKill', KillerName: 'Kyo' }, { EventID: 2, EventName: 'ChampionKill', KillerName: 'Kyo' }]), 2000, TODOS);
  assert.equal(r.length, 1);
  assert.equal(r[0].etiqueta, 'Kill');
});

test('detector: la ulti seguida de una kill hace empezar el clip en la ulti', () => {
  const d = crearDetector();
  d.procesar(datos([]), 0, TODOS);
  d.ulti(5000, datos([]), TODOS);
  const r = d.procesar(datos([{ EventID: 1, EventName: 'ChampionKill', KillerName: 'Kyo' }]), 9000, TODOS);
  assert.equal(r[0].t, 5000);
});

test('detector: con el tipo apagado no hay clip', () => {
  const d = crearDetector();
  d.procesar(datos([]), 0, TODOS);
  const r = d.procesar(datos([{ EventID: 1, EventName: 'ChampionKill', KillerName: 'X', VictimName: 'Kyo' }]), 1000, { ...TODOS, muerte: false });
  assert.deepEqual(r, []);
});
