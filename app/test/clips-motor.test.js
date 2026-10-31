const test = require('node:test');
const assert = require('node:assert/strict');
const { argsAudio } = require('../src/clips-motor');

// v0.9.6: el audio se ubica contando muestras (-itsoffset) y con -copyts; nada de asetpts.
test('una pista: mezcla con -itsoffset y -copyts', () => {
  const a = argsAudio(['Mezcla'], 1.23456789);
  assert.deepEqual(a.entrada.slice(0, 2), ['-itsoffset', '1.234568']);
  assert.ok(a.entrada.includes('pipe:0'));
  assert.ok(a.salida.includes('-copyts'));
  assert.ok(!a.salida.join(' ').includes('asetpts'));
  assert.equal(a.entrada[a.entrada.indexOf('-ac') + 1], '2');
});

test('pistas separadas: un par de canales por pista', () => {
  const a = argsAudio(['Mezcla', 'Juego', 'Discord'], 0.5);
  assert.equal(a.entrada[a.entrada.indexOf('-ac') + 1], '6');
  const grafo = a.salida[a.salida.indexOf('-filter_complex') + 1];
  assert.match(grafo, /asplit=3/);
  assert.match(grafo, /c0=c4\|c1=c5\[p2\]/);
  assert.equal(a.salida.filter((x) => x === '-map').length, 4);
});
