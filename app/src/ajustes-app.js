// Ajustes de la app (Ajustes → Apariencia y Ajustes → Notificaciones).
// Se guardan en la carpeta de datos de la app (userData/ajustes.json), solo en
// este PC. Lo del overlay (piezas, posiciones, tamaño y transparencia) vive
// aparte, en overlay-config.js.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Colores de acento del mockup (Ajustes → Apariencia). Turquesa = el de SharkTracker.
const ACENTOS = {
  turquesa: '#00e5c7',
  lila: '#c19bf2',
  dorado: '#e8c766',
  azul: '#7db3f0',
  rojo: '#ea8a8a',
};

// Avisos de Windows (Ajustes → Notificaciones), los del mockup.
const AVISOS = ['dientes', 'misiones', 'semana', 'retos'];

function fabrica() {
  return {
    acento: 'turquesa',
    ventana: {
      siempreEncima: false, // la ventana de la app por encima de las demás
      bandeja: false,       // al cerrar, se queda en la bandeja (así siguen llegando los avisos)
      alIniciar: false,     // abrir SharkTracker al iniciar Windows
    },
    avisos: Object.fromEntries(AVISOS.map((a) => [a, true])),
  };
}

const archivo = () => path.join(app.getPath('userData'), 'ajustes.json');

// Mezcla lo guardado con los valores de fábrica y descarta basura.
function normalizar(datos) {
  const base = fabrica();
  if (typeof datos?.acento === 'string' && ACENTOS[datos.acento]) base.acento = datos.acento;
  for (const k of Object.keys(base.ventana)) {
    if (typeof datos?.ventana?.[k] === 'boolean') base.ventana[k] = datos.ventana[k];
  }
  for (const a of AVISOS) {
    if (typeof datos?.avisos?.[a] === 'boolean') base.avisos[a] = datos.avisos[a];
  }
  return base;
}

let cache = null;
function leer() {
  if (!cache) {
    try { cache = normalizar(JSON.parse(fs.readFileSync(archivo(), 'utf8'))); } catch { cache = fabrica(); }
  }
  return structuredClone(cache);
}

// Guarda solo lo que cambia: { acento } o { ventana: { bandeja: true } } o { avisos: { retos: false } }.
function guardar(cambios) {
  const actual = leer();
  cache = normalizar({
    acento: cambios?.acento ?? actual.acento,
    ventana: { ...actual.ventana, ...(cambios?.ventana ?? {}) },
    avisos: { ...actual.avisos, ...(cambios?.avisos ?? {}) },
  });
  try { fs.writeFileSync(archivo(), JSON.stringify(cache, null, 2)); } catch { /* sin disco: queda en memoria */ }
  return structuredClone(cache);
}

module.exports = { leer, guardar, fabrica, normalizar, ACENTOS, AVISOS };
