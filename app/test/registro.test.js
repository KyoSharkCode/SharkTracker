const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearRegistro, TOPE_BYTES } = require('../src/registro');

const nuevo = () => {
  let t = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registro-'));
  return { r: crearRegistro({ dir, reloj: () => t }), avanzar: (ms) => { t += ms; } };
};

test('anota errores con su origen', () => {
  const { r } = nuevo();
  r.anotar('overlay', new Error('se rompió'), 'overlay.js:12');
  assert.match(r.leer(), /\[overlay\] Error: se rompió[\s\S]*· overlay\.js:12/);
});

test('el mismo error seguido se cuenta en vez de repetirse', () => {
  const { r, avanzar } = nuevo();
  for (let i = 0; i < 5; i++) { r.anotar('main', new Error('igual')); avanzar(1000); }
  r.anotar('main', 'otro');
  const txt = r.leer();
  assert.equal(txt.match(/Error: igual/g).length, 1);
  assert.match(txt, /se repitió 4 veces más/);
});

test('pasado un minuto, el mismo error se vuelve a anotar', () => {
  const { r, avanzar } = nuevo();
  r.anotar('main', 'x');
  avanzar(61 * 1000);
  r.anotar('main', 'x');
  assert.equal(r.leer().match(/\[main\] x/g).length, 2);
});

test('el archivo no crece sin límite', () => {
  const { r } = nuevo();
  const largo = 'y'.repeat(2000);
  for (let i = 0; i < 400; i++) r.anotar('main', `${i} ${largo}`);
  assert.ok(Buffer.byteLength(r.leer()) <= TOPE_BYTES);
  assert.match(r.leer(), /399 y/);
});
