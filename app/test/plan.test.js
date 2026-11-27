const test = require('node:test');
const assert = require('node:assert/strict');
const { armarPedido, validarPlan } = require('../src/plan');

const cat = {
  campeones: { 103: { id: 'Ahri', nombre: 'Ahri' }, 238: { id: 'Zed', nombre: 'Zed' }, 64: { id: 'LeeSin', nombre: 'Lee Sin' }, 89: { id: 'Leona', nombre: 'Leona' } },
  objetos: {
    1056: { nombre: 'Anillo de Doran' }, 6655: { nombre: 'Tempestad de Luden' }, 3020: { nombre: 'Botas de hechicero' }, 3111: { nombre: 'Botas de mercurio' },
    3157: { nombre: 'Reloj de arena de Zhonya' }, 3089: { nombre: 'Sombrero mortal de Rabadon' }, 3135: { nombre: 'Bastón del vacío' }, 3102: { nombre: 'Velo de la banshee' },
  },
  runas: { 8100: { nombre: 'Dominación' }, 8112: { nombre: 'Electrocutar' }, 8139: { nombre: 'Sabor a sangre' }, 8200: { nombre: 'Brujería' }, 8214: { nombre: 'Invocar a Aery' }, 8226: { nombre: 'Banda de maná' }, 8000: { nombre: 'Precisión' }, 8009: { nombre: 'Presencia de ánimo' } },
};
const pagina = (principal, clave, secundaria, extra = {}) => ({ principal, runas_principales: [clave, 8139], secundaria, runas_secundarias: [8009], fragmentos: [5008], partidas: 900, winrate: 0.52, ...extra });
const grupo = (id, winrate = 0.5) => ({ ids: [id], partidas: 400, winrate });
const datos = {
  campeon: 103, rol: 'mid', rivales: [238, 64, 999], aliados: [89], rivalLinea: 238,
  ficha: { inicio: grupo(1056), core: { ids: [6655], partidas: 1 }, botas: grupo(3020), cuarto: [grupo(3157, 0.56), grupo(3089)], quinto: [grupo(3089), grupo(3135)], sexto: [], runas: pagina(8100, 8112, 8000) },
  matchup: { winrate: 0.47, partidas: 1200, ventaja: 'rival', solo_kills: 'rival', estilo: 'defensivo', consejo: 'Cuida su nivel 6.', botas: [grupo(3111)], runas: [pagina(8100, 8112, 8000), pagina(8200, 8214, 8000, { winrate: 0.55 })] },
  adaptada: { resumen: '2 de daño físico, 1 asesino', sugerencias: [{ item: 3157, motivo: 'Tienen 1 asesino' }, { item: 3102, motivo: 'Mucho control' }], botas: { item: 3111, motivo: '2 de control' } },
};

test('opciones reales: runas sin repetir, botas y situacionales con su motivo', () => {
  const { pedido, paginas } = armarPedido(datos, cat);
  assert.deepEqual(pedido.campeon, { id: 103, nombre: 'Ahri', clave: 'Ahri' });
  assert.deepEqual(pedido.rivales.map((r) => r.nombre), ['Zed', 'Lee Sin']); // el campeón desconocido no entra
  assert.equal(pedido.rivalLinea.nombre, 'Zed');
  assert.equal(pedido.runas.length, 2);                                        // la página repetida del enfrentamiento se descarta
  assert.deepEqual([pedido.runas[0].clave, pedido.runas[0].fuente, pedido.runas[1].clave, pedido.runas[1].winrate], ['Electrocutar', 'general', 'Invocar a Aery', 55]);
  assert.equal(paginas[1].principal, 8200);
  assert.deepEqual(pedido.botas.map((b) => b.id), [3020, 3111]);
  assert.equal(pedido.botas[1].motivo, '2 de control');
  const zhonya = pedido.situacionales.find((s) => s.id === 3157);
  assert.deepEqual([zhonya.puesto, zhonya.winrate, zhonya.motivo], ['4.º', 56, 'Tienen 1 asesino']);
  assert.equal(pedido.situacionales.filter((s) => s.id === 3089).length, 1);  // Rabadon sale en 4.º y 5.º: una sola vez
  assert.ok(pedido.situacionales.some((s) => s.id === 3102 && s.puesto === null)); // solo lo sugiere la build adaptada
  assert.equal(pedido.enfrentamiento.winrate, 47);
});

test('sin ficha o sin rol no hay pedido', () => {
  assert.equal(armarPedido({ ...datos, ficha: null }, cat), null);
  assert.equal(armarPedido({ ...datos, rol: null }, cat), null);
});

test('la IA elige, no inventa: lo que no está en las opciones se descarta', () => {
  const { pedido } = armarPedido(datos, cat);
  const plan = validarPlan({
    linea: 'Juega atrás hasta el nivel 6.', composicion: 'Ganan las peleas largas.', evita: 'No pelees a solas en el río.',
    runas: { opcion: 2, motivo: 'Aery para hostigar.' },
    botas: { id: 3047, motivo: 'Inventadas' },                                   // no estaban en las opciones
    objetos: [{ id: 3157, motivo: 'Contra el asesino.' }, { id: 9999, motivo: 'Inventado' }, { id: 3157, motivo: 'Repetido' }, { id: 3089, motivo: 'Daño.' }],
    alternativa: 'Si vas por delante, Rabadon antes.',
  }, pedido);
  assert.deepEqual(plan.runas, { opcion: 2, clave: 'Invocar a Aery', motivo: 'Aery para hostigar.' });
  assert.equal(plan.botas, null);
  assert.deepEqual(plan.objetos.map((o) => o.id), [3157, 3089]);
  assert.equal(plan.objetos[0].nombre, 'Reloj de arena de Zhonya');
});

test('sin las tres líneas del plan, no hay plan', () => {
  const { pedido } = armarPedido(datos, cat);
  assert.equal(validarPlan({ linea: 'a', composicion: '', evita: 'c' }, pedido), null);
  assert.equal(validarPlan(null, pedido), null);
});
