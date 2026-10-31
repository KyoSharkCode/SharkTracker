const test = require('node:test');
const assert = require('node:assert/strict');
const { siguienteHabilidad, maximo } = require('../src/habilidades');

const jugador = (level, q = 0, w = 0, e = 0, r = 0) => ({ level, abilities: { Q: { abilityLevel: q }, W: { abilityLevel: w }, E: { abilityLevel: e }, R: { abilityLevel: r } } });
const ORDEN = ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W', 'R', 'W', 'W'];

test('máximo de puntos por nivel', () => {
  assert.equal(maximo('R', 5), 0);
  assert.equal(maximo('R', 6), 1);
  assert.equal(maximo('R', 16), 3);
  assert.equal(maximo('Q', 1), 1);
  assert.equal(maximo('Q', 9), 5);
});

test('nivel 1 sin puntos: la primera del orden', () => {
  assert.equal(siguienteHabilidad(jugador(1), ORDEN).tecla, 'Q');
});

test('sin puntos sin gastar no señala nada', () => {
  assert.equal(siguienteHabilidad(jugador(3, 1, 1, 1), ORDEN), null);
});

test('la R a nivel 6', () => {
  assert.equal(siguienteHabilidad(jugador(6, 3, 1, 1, 0), ORDEN).tecla, 'R');
});

test('si te desviaste, señala la que quedó pendiente', () => {
  // Nivel 3 con W y E subidas: falta la Q que pedía el orden.
  assert.equal(siguienteHabilidad(jugador(3, 0, 1, 1), ORDEN).tecla, 'Q');
});

test('dos puntos sin gastar', () => {
  const r = siguienteHabilidad(jugador(2), ORDEN);
  assert.equal(r.pendientes, 2);
});

test('sin orden no hay sugerencia', () => {
  assert.equal(siguienteHabilidad(jugador(2), []), null);
});
