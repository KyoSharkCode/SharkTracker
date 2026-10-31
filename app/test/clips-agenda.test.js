const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAgenda } = require('../src/clips-agenda');

// Reloj falso: los timers reales se reemplazan por node:test mock.timers.
const ajustes = { antes: 20, despues: 15 };

test('jugadas seguidas van en un solo clip', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const guardados = [];
  const agenda = crearAgenda({ alGuardar: async (c) => { guardados.push(c); }, margen: 0 });
  assert.equal(agenda.marcar({ desde: 0, etiqueta: 'Kill' }, ajustes), 'nueva');
  t.mock.timers.tick(5000);
  assert.equal(agenda.marcar({ desde: 5000, etiqueta: 'Barón' }, ajustes), 'unida');
  t.mock.timers.tick(20000);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(guardados.length, 1);
  assert.deepEqual(guardados[0].etiquetas, ['Kill', 'Barón']);
  assert.equal(guardados[0].segundos, 20 + 5 + 15);
});

test('una jugada lejos de la otra abre un clip nuevo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const guardados = [];
  const agenda = crearAgenda({ alGuardar: async (c) => { guardados.push(c); }, margen: 0 });
  agenda.marcar({ desde: 0, etiqueta: 'Kill' }, ajustes);
  t.mock.timers.tick(60000);
  assert.equal(agenda.marcar({ desde: 60000, etiqueta: 'Muerte' }, ajustes), 'nueva');
  await agenda.vaciar();
  assert.equal(guardados.length, 2);
});

test('no pasa del tope de 2 minutos', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const guardados = [];
  const agenda = crearAgenda({ alGuardar: async (c) => { guardados.push(c); }, margen: 0 });
  agenda.marcar({ desde: 0, etiqueta: 'Kill' }, ajustes);
  for (let s = 10; s <= 110; s += 10) { t.mock.timers.tick(10000); agenda.marcar({ desde: s * 1000, etiqueta: 'Kill' }, ajustes); }
  await agenda.vaciar();
  assert.ok(guardados.length >= 2);
  assert.ok(guardados.every((c) => c.segundos <= 120));
});
