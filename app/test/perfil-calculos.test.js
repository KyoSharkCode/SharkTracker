const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/perfil-calculos');

const partida = (o = {}) => ({ cola: 420, duracion: 1800, win: true, kills: 5, deaths: 2, assists: 5, cs: 210, oro: 12000, dano: 20000, vision: 30, kp: 0.5, campeon: 'Ahri', lado: 'blue', terminada: '2026-10-10T20:00:00Z', ...o });

test('textoRango', () => {
  assert.equal(c.textoRango({ tier: 'GOLD', division: 'II' }), 'Oro II');
  assert.equal(c.textoRango({ tier: 'MASTER', division: 'I' }), 'Maestro');
  assert.equal(c.textoRango(null), 'Sin clasificar');
});

test('remake = menos de 5 minutos', () => {
  assert.equal(c.esRemake({ duracion: 200 }), true);
  assert.equal(c.esRemake({ duracion: 900 }), false);
});

test('resumen sin remakes', () => {
  const r = c.resumen([partida(), partida({ win: false }), partida({ duracion: 120 })]);
  assert.equal(r.partidas, 2);
  assert.equal(r.winrate, 0.5);
  assert.equal(r.csMin, 7);
  assert.equal(r.kda, 5);
});

test('racha de 3 victorias = Frenesí', () => {
  const tags = c.etiquetas([partida(), partida(), partida()], Date.parse('2026-10-11T00:00:00Z'));
  assert.ok(tags.some((t) => t.texto === 'Frenesí'));
});

test('racha de 3 derrotas = Marea baja', () => {
  const tags = c.etiquetas([partida({ win: false }), partida({ win: false }), partida({ win: false })], Date.parse('2026-10-20T00:00:00Z'));
  assert.ok(tags.some((t) => t.texto === 'Marea baja'));
});

test('más jugados: de más a menos, sin remakes', () => {
  const r = c.masJugados([partida({ campeon: 'Lux' }), partida(), partida(), partida({ campeon: 'Lux', duracion: 100 })]);
  assert.deepEqual(r.map((x) => [x.campeon, x.partidas]), [['Ahri', 2], ['Lux', 1]]);
});

test('aplanar lee la fila de la base', () => {
  const p = c.aplanar({ match_id: 'X', queue_id: 420, duration_seconds: 1500, match_participants: [{ champion: 'Briar', win: true, kills: 3, extra_stats: { kp: 0.6 } }] });
  assert.equal(p.campeon, 'Briar');
  assert.equal(p.kp, 0.6);
  assert.equal(p.deaths, 0);
});
