// Electron no existe en las pruebas (Node puro): los módulos que lo importan solo usan
// `app` dentro de funciones que las pruebas no llaman. Esto lo reemplaza por un objeto vacío.
const Module = require('module');
const cargar = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'electron') return { app: { getPath: () => require('os').tmpdir() } };
  return cargar.call(this, pedido, ...resto);
};
