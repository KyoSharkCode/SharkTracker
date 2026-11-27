// Electron no existe en las pruebas (Node puro): los módulos que lo importan solo usan
// `app` dentro de funciones que las pruebas no llaman. Esto lo reemplaza por un objeto vacío.
const Module = require('module');
const cargar = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'electron') {
    // ST_PRUEBA_DIR: carpeta propia de la prueba (userData, videos…) para las que tocan archivos.
    const fs = require('fs');
    const path = require('path');
    const base = process.env.ST_PRUEBA_DIR;
    return {
      app: { getPath: (nombre) => (base ? path.join(base, nombre) : require('os').tmpdir()) },
      // La "papelera" de las pruebas: el archivo desaparece.
      shell: { trashItem: async (ruta) => fs.rmSync(ruta), showItemInFolder: () => {}, openPath: async () => '' },
    };
  }
  return cargar.call(this, pedido, ...resto);
};
