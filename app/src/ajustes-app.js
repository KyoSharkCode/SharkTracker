// Ajustes de la app (Ajustes → Apariencia, Notificaciones y Clips).
// Se guardan en la carpeta de datos de la app (userData/ajustes.json), solo en
// este PC. Lo del overlay (piezas, posiciones, tamaño y transparencia) vive
// aparte, en overlay-config.js.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Colores de acento del mockup (Ajustes → Apariencia). Turquesa = el de SharkTracker.
const ACENTOS = {
  turquesa: '#3DFFD2',
  lila: '#A98BFF',
  dorado: '#FFB547',
  azul: '#5AA9FF',
  rojo: '#FF8FA6',
};

// Avisos de Windows (Ajustes → Notificaciones), los del mockup.
const AVISOS = ['dientes', 'misiones', 'semana', 'retos'];

// Clips (Ajustes → Clips). Todo apagado de fábrica: sin activarlo no se graba nada.
const CALIDADES = ['alta', 'ligera'];

function fabrica() {
  return {
    acento: 'turquesa',
    ventana: {
      siempreEncima: false, // la ventana de la app por encima de las demás
      bandeja: false,       // al cerrar, se queda en la bandeja (así siguen llegando los avisos)
      alIniciar: false,     // abrir SharkTracker al iniciar Windows
    },
    avisos: Object.fromEntries(AVISOS.map((a) => [a, true])),
    clips: {
      activo: false,         // grabar el búfer durante la partida (Ctrl + F8 guarda)
      calidad: 'alta',       // alta = 60 fps · ligera = 30 fps y menos peso
      antes: 20,             // segundos antes de pulsar Ctrl + F8
      despues: 15,           // segundos después
      overlayEnClip: false,  // false = el overlay de SharkTracker no sale en los clips
    },
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
  const c = datos?.clips ?? {};
  if (typeof c.activo === 'boolean') base.clips.activo = c.activo;
  if (CALIDADES.includes(c.calidad)) base.clips.calidad = c.calidad;
  for (const k of ['antes', 'despues']) {
    if (Number.isFinite(c[k])) base.clips[k] = Math.min(30, Math.max(10, Math.round(c[k])));
  }
  if (typeof c.overlayEnClip === 'boolean') base.clips.overlayEnClip = c.overlayEnClip;
  return base;
}

let cache = null;
function leer() {
  if (!cache) {
    try { cache = normalizar(JSON.parse(fs.readFileSync(archivo(), 'utf8'))); } catch { cache = fabrica(); }
  }
  return structuredClone(cache);
}

// Guarda solo lo que cambia: { acento }, { ventana: { bandeja: true } }, { avisos: { retos: false } } o { clips: { activo: true } }.
function guardar(cambios) {
  const actual = leer();
  cache = normalizar({
    acento: cambios?.acento ?? actual.acento,
    ventana: { ...actual.ventana, ...(cambios?.ventana ?? {}) },
    avisos: { ...actual.avisos, ...(cambios?.avisos ?? {}) },
    clips: { ...actual.clips, ...(cambios?.clips ?? {}) },
  });
  try { fs.writeFileSync(archivo(), JSON.stringify(cache, null, 2)); } catch { /* sin disco: queda en memoria */ }
  return structuredClone(cache);
}

module.exports = { leer, guardar, fabrica, normalizar, ACENTOS, AVISOS, CALIDADES };
