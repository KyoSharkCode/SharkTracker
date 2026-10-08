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
// Eventos que guardan un clip solos (C2), cada uno con su interruptor.
const EVENTOS_CLIP = ['kill', 'asistencia', 'muerte', 'objetivo', 'estructura', 'ulti', 'cadaUlti'];
// Límite de espacio de los clips (los favoritos no cuentan).
const LIMITES_GB = [5, 10, 20, 50];
// Audio (C1b): fuentes que puede grabar el ayudante.
const FUENTES_AUDIO = ['juego', 'discord', 'musica', 'mic', 'pc'];
const TECLA_ULTI = /^[A-Z0-9]$/;

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
      // Clips automáticos: solo si participaste (autor, asistencia o víctima).
      eventos: { kill: true, asistencia: true, muerte: true, objetivo: true, estructura: true, ulti: true, cadaUlti: false },
      teclaUlti: 'R',        // por si cambiaste la tecla de la R en el juego
      avisoAuto: true,       // aviso pequeño en el overlay al guardar un clip automático
      limiteGB: 10,          // espacio para clips normales (se borran los más viejos)
      audio: {
        juego: { activo: true, volumen: 100 },                      // solo el sonido de League
        discord: { activo: false, volumen: 100 },                   // voces del grupo (avísales)
        musica: { activo: false, volumen: 60 },                     // Spotify (más bajo: de fondo)
        mic: { activo: false, volumen: 100, dispositivo: '' },      // '' = el de Windows
        pc: { activo: false, volumen: 100, dispositivo: '' },       // todo lo que suena (en lugar de juego y Discord)
        separadas: false,    // cada fuente en su pista, además de la mezcla
      },
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
  for (const e of EVENTOS_CLIP) {
    if (typeof c.eventos?.[e] === 'boolean') base.clips.eventos[e] = c.eventos[e];
  }
  if (typeof c.teclaUlti === 'string' && TECLA_ULTI.test(c.teclaUlti.toUpperCase())) base.clips.teclaUlti = c.teclaUlti.toUpperCase();
  if (typeof c.avisoAuto === 'boolean') base.clips.avisoAuto = c.avisoAuto;
  if (LIMITES_GB.includes(c.limiteGB)) base.clips.limiteGB = c.limiteGB;
  for (const f of FUENTES_AUDIO) {
    const o = c.audio?.[f];
    if (typeof o?.activo === 'boolean') base.clips.audio[f].activo = o.activo;
    if (Number.isFinite(o?.volumen)) base.clips.audio[f].volumen = Math.min(200, Math.max(0, Math.round(o.volumen)));
    if ('dispositivo' in base.clips.audio[f] && typeof o?.dispositivo === 'string' && o.dispositivo.length < 300) base.clips.audio[f].dispositivo = o.dispositivo;
  }
  if (typeof c.audio?.separadas === 'boolean') base.clips.audio.separadas = c.audio.separadas;
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
    clips: {
      ...actual.clips,
      ...(cambios?.clips ?? {}),
      eventos: { ...actual.clips.eventos, ...(cambios?.clips?.eventos ?? {}) },
      audio: Object.fromEntries(Object.entries(actual.clips.audio).map(([k, v]) => {
        const nuevo = cambios?.clips?.audio?.[k];
        return [k, typeof v === 'object' ? { ...v, ...(nuevo ?? {}) } : (nuevo ?? v)];
      })),
    },
  });
  try { fs.writeFileSync(archivo(), JSON.stringify(cache, null, 2)); } catch { /* sin disco: queda en memoria */ }
  return structuredClone(cache);
}

module.exports = { leer, guardar, fabrica, normalizar, ACENTOS, AVISOS, CALIDADES, EVENTOS_CLIP, LIMITES_GB, FUENTES_AUDIO };
