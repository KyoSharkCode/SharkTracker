const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../src/notificaciones-calculos');

test('la semana empieza el lunes a las 6:00 de Madrid', () => {
  // Jueves 15/10/2026 12:00 UTC → lunes 13/10 6:00 Madrid (4:00 UTC, horario de verano).
  assert.equal(n.inicioSemana(new Date('2026-10-15T12:00:00Z')).toISOString(), '2026-10-12T04:00:00.000Z');
  // Lunes a las 5:00 de Madrid todavía cuenta como la semana anterior.
  assert.equal(n.inicioSemana(new Date('2026-10-12T03:00:00Z')).toISOString(), '2026-10-05T04:00:00.000Z');
});

test('los dientes ganados van en un solo aviso', () => {
  const a = n.avisosDientes([{ amount: 50, reason: 'x' }, { amount: 25, reason: 'x' }, { amount: -10, reason: 'compra' }]);
  assert.equal(a.length, 1);
  assert.equal(a[0].titulo, '+75 dientes');
});

test('premio entregado y rechazado', () => {
  const a = n.avisosDientes([], [{ status: 'entregado', item_name: 'Skin' }, { status: 'rechazado', item_name: 'RP' }]);
  assert.deepEqual(a.map((x) => x.titulo), ['Premio entregado', 'Premio no disponible']);
});

test('reto terminado con ganador y tu puesto', () => {
  const [a] = n.avisosRetos([], [{ id: 3, name: 'Copa', ganador: 'Alex', miPuesto: 2 }]);
  assert.equal(a.cuerpo, 'Ganó Alex · tú quedaste 2.º.');
});

test('máximo 4 avisos: los demás se juntan', () => {
  const muchos = Array.from({ length: 6 }, (_, i) => ({ titulo: `A${i}` }));
  const r = n.limitar(muchos);
  assert.equal(r.length, 4);
  assert.equal(r[3].titulo, '3 novedades más');
});

test('resumen de la semana vacío no avisa', () => {
  assert.equal(n.avisoSemana({}), null);
  assert.match(n.avisoSemana({ misiones: 1, top: 3 }).cuerpo, /Top 3 de la semana · 1 misión/);
});
