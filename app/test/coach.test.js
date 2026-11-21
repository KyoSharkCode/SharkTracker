require('./electron-falso');
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEstadoPartida } = require('../src/game-state');
const { crearSesion } = require('../src/coach');
const { normalizar, fabrica } = require('../src/ajustes-app');

const jugador = (nombre, team, extra = {}) => ({ riotId: `${nombre}#LAN`, summonerName: nombre, championName: nombre, team, items: [], scores: {}, isDead: false, respawnTimer: 0, ...extra });
const partida = (t, { posicion = 'UTILITY', modo = 'CLASSIC', mapa = 11 } = {}) => ({
  gameData: { gameTime: t, mapNumber: mapa, gameMode: modo },
  activePlayer: { riotId: 'Kyo#LAN', level: 5, currentGold: 300, championStats: { currentHealth: 700, maxHealth: 1000 } },
  allPlayers: [jugador('Kyo', 'ORDER', { position: posicion }), jugador('Vi', 'ORDER', { position: 'JUNGLE' }), jugador('Zed', 'CHAOS')],
  events: { Events: [{ EventID: 0, EventName: 'GameStart', EventTime: 0 }] },
});
const esperar = () => new Promise((r) => setImmediate(r));

// Una sesión con todo simulado: la Edge Function, la voz, los ajustes y el disco.
function montar({ coach = {}, respuesta } = {}) {
  const m = { pedidos: [], dicho: [], guardado: null, reloj: 0 };
  m.ajustes = { coach: { ...fabrica().coach, activo: true, ...coach } };
  m.sesion = crearSesion({
    pedir: async (cuerpo) => { m.pedidos.push(cuerpo); return typeof respuesta === 'function' ? respuesta(cuerpo) : respuesta; },
    hablar: (texto) => m.dicho.push(texto),
    ajustes: () => m.ajustes,
    ahora: () => m.reloj,
    leer: () => m.guardado ?? [],
    guardar: (lista) => { m.guardado = lista; },
  });
  m.tick = (t, opciones, extras = { rol: 'soporte' }) => {
    const d = partida(t, opciones);
    m.sesion.tick(d, crearEstadoPartida().actualizar(d), extras);
  };
  return m;
}
const OK = { estado: 'ok', hablar: true, texto: 'Dragón en dos minutos: backea y trae ward de control.', uso: { entrada: 1900, salida: 40, usd: 0.0015 } };

test('ajustes del coach: apagado de fábrica y valores dentro de rango', () => {
  assert.equal(fabrica().coach.activo, false);
  const c = normalizar({ coach: { activo: true, volumen: 500, intervalo: 5, tope: 99, voz: 3 } }).coach;
  assert.deepEqual([c.activo, c.volumen, c.intervalo, c.tope, c.voz], [true, 100, 60, 12, '']);
});

test('objetivo cerca: consulta, lo dice en voz y suma el coste', async () => {
  const m = montar({ respuesta: OK });
  m.sesion.iniciarPartida();
  m.tick(190); m.reloj = 10000; m.tick(200);
  await esperar();
  assert.equal(m.pedidos.length, 1);
  assert.equal(m.pedidos[0].accion, 'consejo');
  assert.equal(m.pedidos[0].situacion.tipo, 'objetivo');
  assert.equal(m.pedidos[0].estado.rol, 'soporte');
  assert.deepEqual(m.dicho, [OK.texto]);
  const p = m.sesion.estado().partida;
  assert.equal(p.consejos[0].minuto, '3:10');
  assert.equal(m.pedidos[0].estado.actividad.enBaseHace, null);
  assert.ok(Array.isArray(m.pedidos[0].bitacora));
  assert.equal(p.usd, 0.0015);
  // Al terminar la partida queda en el historial.
  m.sesion.terminarPartida();
  assert.equal(m.guardado[0].consejos.length, 1);
  assert.equal(m.guardado[0].campeon, 'Kyo');
  assert.equal(m.sesion.estado().partida, null);
});

test('apagado, silenciado, otro rol u otro modo: no se consulta nada', async () => {
  for (const caso of [{ coach: { activo: false } }, { coach: { silenciado: true } }, { extras: { rol: 'mid' } }, { opciones: { modo: 'ARAM', mapa: 12 } }]) {
    const m = montar({ coach: caso.coach, respuesta: OK });
    m.sesion.iniciarPartida();
    m.tick(190, caso.opciones, caso.extras); m.reloj = 10000; m.tick(200, caso.opciones, caso.extras);
    await esperar();
    assert.equal(m.pedidos.length, 0, JSON.stringify(caso));
    m.sesion.terminarPartida();
    assert.equal(m.guardado, null); // sin consultas no se guarda nada
  }
});

test('el filtro dice que no: no habla, pero el coste cuenta', async () => {
  const m = montar({ respuesta: { estado: 'ok', hablar: false, texto: '', uso: { entrada: 400, salida: 20, usd: 0.00005 } } });
  m.sesion.iniciarPartida();
  m.tick(190); m.reloj = 10000; m.tick(200);
  await esperar();
  assert.deepEqual(m.dicho, []);
  assert.equal(m.sesion.estado().partida.usd, 0.00005);
});

test('límite de gasto: el coach se detiene hasta la próxima partida', async () => {
  const m = montar({ respuesta: { estado: 'limite_dia' } });
  m.sesion.iniciarPartida();
  m.tick(190); m.reloj = 10000; m.tick(200);
  await esperar();
  assert.equal(m.sesion.estado().partida.bloqueo, 'limite_dia');
  m.reloj = 400000; m.tick(390); // Vacuolarvas en 90 s y sin ward de control: ya no consulta
  await esperar();
  assert.equal(m.pedidos.length, 1);
});

test('respuesta que llega tarde no se dice', async () => {
  const m = montar({});
  const d = partida(200);
  // La respuesta "tarda" 20 s (el reloj avanza mientras se espera).
  const sesion = crearSesion({
    pedir: async () => { m.reloj += 20000; return OK; },
    hablar: (texto) => m.dicho.push(texto), ajustes: () => m.ajustes, ahora: () => m.reloj, leer: () => [], guardar: () => {},
  });
  sesion.iniciarPartida();
  sesion.tick(partida(190), crearEstadoPartida().actualizar(partida(190)), { rol: 'soporte' });
  m.reloj += 10000;
  sesion.tick(d, crearEstadoPartida().actualizar(d), { rol: 'soporte' });
  await esperar();
  assert.deepEqual(m.dicho, []);
});

test('lectura a pedido (Ctrl + F10): consulta en la siguiente lectura', async () => {
  const m = montar({ respuesta: { ...OK, texto: 'Vas bien de visión; lo que te está costando son las muertes antes de cada dragón.' } });
  assert.equal(m.sesion.pedirLectura(), false); // sin partida no hay nada que leer
  m.sesion.iniciarPartida();
  m.tick(100);
  assert.equal(m.sesion.pedirLectura(), true);
  m.reloj = 5000; m.tick(105);
  await esperar();
  assert.equal(m.pedidos[0].situacion.tipo, 'pedido');
  assert.equal(m.dicho.length, 1);
  m.ajustes.coach.silenciado = true;
  assert.equal(m.sesion.pedirLectura(), false);
});
