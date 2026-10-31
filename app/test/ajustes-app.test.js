require('./electron-falso');
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizar, fabrica } = require('../src/ajustes-app');

test('de fábrica: tema oscuro, clips apagados y con invitación', () => {
  const f = fabrica();
  assert.equal(f.tema, 'oscuro');
  assert.equal(f.clips.activo, false);
  assert.equal(f.clips.invitacion, true);
});

test('normalizar respeta lo válido y descarta basura', () => {
  const a = normalizar({ tema: 'claro', acento: 'lila', clips: { invitacion: false, antes: 99, limiteGB: 7 } });
  assert.equal(a.tema, 'claro');
  assert.equal(a.acento, 'lila');
  assert.equal(a.clips.invitacion, false);
  assert.equal(a.clips.antes, 30);       // se recorta al máximo
  assert.equal(a.clips.limiteGB, 10);    // 7 no es una opción: queda el de fábrica
  assert.equal(normalizar({ tema: 'rosa' }).tema, 'oscuro');
});
