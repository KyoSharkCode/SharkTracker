const test = require('node:test');
const assert = require('node:assert/strict');
const { tierObjetivo, calcularRendimiento } = require('../src/rendimiento');

test('se compara con la división de arriba', () => {
  assert.equal(tierObjetivo('GOLD'), 'PLATINUM');
  assert.equal(tierObjetivo('DIAMOND'), 'MASTER');
  assert.equal(tierObjetivo('CHALLENGER'), 'MASTER');
  assert.equal(tierObjetivo(null), 'GOLD');
});

const yo = { position: 'MIDDLE', scores: { creepScore: 120, wardScore: 15, kills: 4, assists: 6 }, items: [] };
const equipo = [yo, { scores: { kills: 6 } }];
const referencia = { tier: 'PLATINUM', porRol: { MIDDLE: { muestras: 50, cs_min: 7, oro_min: 400, vision_min: 0.8, kp: 0.5 } } };
const base = { yo, equipo, oroActual: 500, valorObjetos: () => 3500, referencia, modo: 'CLASSIC' };

test('a los 15 min compara y colorea', () => {
  const r = calcularRendimiento({ ...base, t: 15 * 60 });
  assert.equal(r.division, 'Platino');
  assert.equal(r.aviso, null);
  const cs = r.metricas.find((m) => m.clave === 'cs');
  assert.equal(cs.valor, '8.0');
  assert.equal(cs.arriba, true);
  assert.equal(r.metricas.find((m) => m.clave === 'kp').valor, '100%');
});

test('antes del minuto 5 no colorea', () => {
  const r = calcularRendimiento({ ...base, t: 3 * 60 });
  assert.ok(r.metricas.every((m) => m.arriba === null));
});

test('en ARAM no compara', () => {
  const r = calcularRendimiento({ ...base, t: 15 * 60, modo: 'ARAM' });
  assert.equal(r.aviso, 'Sin comparación en este modo');
});

test('con pocas muestras avisa que está reuniendo partidas', () => {
  const pocas = { ...referencia, porRol: { MIDDLE: { ...referencia.porRol.MIDDLE, muestras: 5 } } };
  const r = calcularRendimiento({ ...base, t: 15 * 60, referencia: pocas });
  assert.match(r.aviso, /Reuniendo partidas/);
});
