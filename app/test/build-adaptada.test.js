const test = require('node:test');
const assert = require('node:assert/strict');
const { siguienteCompra } = require('../src/build-adaptada');

// Catálogo mínimo: espada larga (350) + martillo (1100, desde espada) → objeto final (3000, desde martillo + espada).
const objetos = {
  1036: { nombre: 'Espada larga', oro: 350 },
  3044: { nombre: 'Martillo', oro: 1100, desde: [1036] },
  6692: { nombre: 'Final', oro: 3000, desde: [3044, 1036] },
  3047: { nombre: 'Botas', oro: 1100 },
};

test('primer objeto que falta y su coste completo', () => {
  const r = siguienteCompra([6692, 3047], [], 5000, objetos);
  assert.equal(r.objetivo.id, 6692);
  assert.equal(r.objetivo.coste, 3000);
  assert.equal(r.objetivo.falta, 0);
  assert.equal(r.componente, null);
});

test('descuenta los componentes que ya llevas', () => {
  const r = siguienteCompra([6692], [3044], 0, objetos);
  assert.equal(r.objetivo.coste, 3000 - 1100);
});

test('sin oro suficiente sugiere el componente más caro que falta', () => {
  const r = siguienteCompra([6692], [], 400, objetos);
  assert.equal(r.componente.id, 3044);
  assert.equal(r.objetivo.falta, 2600);
});

test('si ya tienes todo, no hay siguiente compra', () => {
  assert.equal(siguienteCompra([6692], [6692], 0, objetos), null);
});
