const fs = require('fs');
const os = require('os');
const path = require('path');
// Carpeta propia para esta prueba: aquí se crean y se borran archivos de verdad.
process.env.ST_PRUEBA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-clips-'));
require('./electron-falso');
const test = require('node:test');
const assert = require('node:assert/strict');
const clips = require('../src/clips');

const carpeta = path.join(process.env.ST_PRUEBA_DIR, 'videos', 'SharkTracker');
const crear = (rel) => { const f = path.join(carpeta, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(1000)); };
const existe = (rel) => fs.existsSync(path.join(carpeta, ...rel.split('/')));
const A = 'Ahri 2026-11-27/2026-11-27 20-00-00 Ahri - Kill.mp4';
const B = 'Ahri 2026-11-27/2026-11-27 20-05-00 Ahri - Muerte.mp4';
const C = 'Zed 2026-11-27/2026-11-27 21-00-00 Zed - Triple kill.mp4';
const D = 'Zed 2026-11-27/2026-11-27 21-04-00 Zed - Torre.mp4';
test.after(() => fs.rmSync(process.env.ST_PRUEBA_DIR, { recursive: true, force: true }));

test('borrar no favoritos de una partida: los favoritos se quedan aunque se pidan, y las demás partidas no se tocan', async () => {
  [A, B, C, D].forEach(crear);
  clips.favorito(A, true);
  clips.favorito(C, true);
  const r = await clips.borrarNoFavoritos([A, B]); // A es favorito: no debe borrarse
  assert.deepEqual(r, { borrados: 1, fallidos: 0, liberado: 1000 });
  assert.deepEqual([A, B, C, D].map(existe), [true, false, true, true]);
});

test('borrar no favoritos de todas las partidas: solo quedan los favoritos', async () => {
  const r = await clips.borrarNoFavoritos();
  assert.equal(r.borrados, 1);
  assert.deepEqual([A, B, C, D].map(existe), [true, false, true, false]);
  const quedan = clips.galeria({ limiteGB: 10 }).clips;
  assert.deepEqual(quedan.map((c) => c.archivo).sort(), [A, C].sort());
  assert.ok(quedan.every((c) => c.favorito));
});

test('sin clips que borrar no pasa nada', async () => {
  assert.deepEqual(await clips.borrarNoFavoritos(), { borrados: 0, fallidos: 0, liberado: 0 });
  assert.deepEqual(await clips.borrarNoFavoritos(['../fuera.mp4', 'C:/Windows/algo.mp4']), { borrados: 0, fallidos: 0, liberado: 0 });
});
