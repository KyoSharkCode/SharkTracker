// Ajustes del overlay: qué piezas se ven y dónde van.
// Se guardan en la carpeta de datos de la app (userData/overlay.json), solo en
// este PC. Las posiciones están en coordenadas de una pantalla de 1920×1080
// (el overlay las escala a la resolución real).

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const PIEZAS = ['oro', 'buffs', 'anuncios', 'toasts', 'rendimiento'];

// Posiciones de fábrica (esquina superior izquierda de cada pieza).
const POSICIONES_FABRICA = {
  baron:       { x: 492,  y: 8 },
  ancestral:   { x: 1138, y: 8 },
  rendimiento: { x: 1690, y: 72 },   // arriba a la derecha (220 px de ancho)
  avisos:      { x: 1648, y: 280 },  // columna de anuncio + toast (262 px de ancho)
};

const archivo = () => path.join(app.getPath('userData'), 'overlay.json');
const archivoFondo = () => path.join(app.getPath('userData'), 'fondo-editor');

function fabrica() {
  return {
    visible: Object.fromEntries(PIEZAS.map((p) => [p, true])),
    posiciones: structuredClone(POSICIONES_FABRICA),
  };
}

// Mezcla lo guardado con los valores de fábrica (así una pieza nueva de una
// versión futura aparece aunque el archivo sea viejo) y descarta basura.
function normalizar(datos) {
  const base = fabrica();
  for (const p of PIEZAS) {
    if (typeof datos?.visible?.[p] === 'boolean') base.visible[p] = datos.visible[p];
  }
  for (const [id, pos] of Object.entries(datos?.posiciones ?? {})) {
    if (!base.posiciones[id]) continue;
    const x = Number(pos?.x), y = Number(pos?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      base.posiciones[id] = { x: Math.round(Math.min(Math.max(x, 0), 1900)), y: Math.round(Math.min(Math.max(y, 0), 1060)) };
    }
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

// cambios: { visible?: {…}, posiciones?: {…} } — solo lo que cambia.
function guardar(cambios) {
  const actual = leer();
  cache = normalizar({
    visible: { ...actual.visible, ...(cambios?.visible ?? {}) },
    posiciones: { ...actual.posiciones, ...(cambios?.posiciones ?? {}) },
  });
  fs.writeFileSync(archivo(), JSON.stringify(cache, null, 2));
  return leer();
}

// Fondo opcional del editor (una captura tuya). Se guarda una copia en la
// carpeta de la app para no depender de dónde estaba el archivo original.
const TIPOS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_FONDO = 15 * 1024 * 1024;
function guardarFondo(origen) {
  const tipo = TIPOS[path.extname(origen).toLowerCase()];
  if (!tipo) throw new Error('Formato no soportado (usa PNG, JPG o WEBP)');
  const datos = fs.readFileSync(origen);
  if (datos.length > MAX_FONDO) throw new Error('La imagen pesa demasiado (máximo 15 MB)');
  fs.writeFileSync(archivoFondo(), datos);
  fs.writeFileSync(`${archivoFondo()}.tipo`, tipo);
  return leerFondo();
}
function leerFondo() {
  try {
    const tipo = fs.readFileSync(`${archivoFondo()}.tipo`, 'utf8');
    return `data:${tipo};base64,${fs.readFileSync(archivoFondo()).toString('base64')}`;
  } catch { return null; }
}
function quitarFondo() {
  for (const f of [archivoFondo(), `${archivoFondo()}.tipo`]) { try { fs.unlinkSync(f); } catch { /* no había */ } }
}

module.exports = { leer, guardar, fabrica, guardarFondo, leerFondo, quitarFondo, POSICIONES_FABRICA };
