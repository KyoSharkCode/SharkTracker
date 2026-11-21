// Coach de macro por voz (experimental) en la app: une el cerebro (coach-cerebro.js,
// qué pasa en tu partida y cuándo vale la pena hablar) con la Edge Function `coach`
// de Supabase (que guarda la key de Claude y redacta el consejo) y con la voz.
//
// La key de Claude NUNCA está en la app: la app manda un resumen de tu partida a la
// Edge Function con tu sesión de Discord, como hace la pantalla de carga.
//
// Costes: cada respuesta trae los tokens y el coste estimado; aquí se suman por
// partida y se guardan (userData/coach.json, últimas 20) para verlos en Ajustes → Coach.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { resumir, crearCoach, ROLES_COACH } = require('./coach-cerebro');

const ESPERA_MS = 13000;    // una respuesta más lenta que esto ya no sirve (el coach ahora razona antes de hablar)
const CADUCA_MS = 16000;    // desde que pasó algo hasta que se dice, como mucho
const HISTORIAL = 20;       // partidas guardadas
const ERRORES_SEGUIDOS = 3; // con 3 fallos seguidos se deja de intentar en esta partida
// Respuestas de la Edge Function que apagan el coach hasta la próxima partida.
const BLOQUEOS = ['sin_sesion', 'sin_cuenta', 'sin_key', 'limite_dia', 'limite_mes'];

const archivo = () => path.join(app.getPath('userData'), 'coach.json');
function leerHistorial() {
  try { const d = JSON.parse(fs.readFileSync(archivo(), 'utf8')); return Array.isArray(d?.partidas) ? d.partidas : []; } catch { return []; }
}
function guardarHistorial(partidas) {
  try { fs.writeFileSync(archivo(), JSON.stringify({ partidas: partidas.slice(0, HISTORIAL) }, null, 2)); } catch { /* sin disco: no se guarda */ }
}

const conLimite = (promesa, ms) => Promise.race([
  promesa,
  new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('El coach tardó demasiado en responder')), ms)),
]);

// Llama a la Edge Function con tu sesión. Sin sesión no se llama.
function crearPedir(auth) {
  return async (cuerpo) => {
    const { data: { session } } = await auth.client().auth.getSession();
    if (!session) return { estado: 'sin_sesion' };
    const { data, error } = await auth.client().functions.invoke('coach', { body: cuerpo });
    if (error) throw error;
    return data;
  };
}

// dependencias: pedir(cuerpo) → respuesta de la Edge Function; hablar(texto) → lo dice en voz
// alta; ajustes() → ajustes de la app; avisar(estado) → la ventana se entera de los cambios.
// ahora/leer/guardar se pueden reemplazar en las pruebas.
function crearSesion({ pedir, hablar, ajustes, avisar = () => {}, ahora = Date.now, leer = leerHistorial, guardar = guardarHistorial }) {
  let partida = null;

  const publico = () => ({
    partida: partida ? {
      campeon: partida.campeon, rol: partida.rol, bloqueo: partida.bloqueo,
      consejos: partida.consejos, llamadas: partida.llamadas, tokens: partida.tokens, usd: partida.usd,
    } : null,
    historial: leer(),
    roles: ROLES_COACH,
  });

  function iniciarPartida() {
    const c = ajustes().coach;
    partida = {
      id: `${ahora()}`, fecha: new Date(ahora()).toISOString(), campeon: '', rol: null,
      coach: crearCoach({ intervalo: c.intervalo, tope: c.tope }),
      ocupado: false, bloqueo: null, errores: 0,
      consejos: [], llamadas: 0, tokens: { entrada: 0, salida: 0 }, usd: 0,
    };
    avisar(publico());
  }

  function terminarPartida() {
    if (!partida) return;
    // Solo se guarda si el coach llegó a consultar algo (si estaba apagado, no hay nada que contar).
    if (partida.llamadas > 0) {
      const { fecha, campeon, rol, consejos, llamadas, tokens, usd } = partida;
      guardar([{ fecha, campeon, rol, consejos, llamadas, tokens, usd: Math.round(usd * 1e5) / 1e5 }, ...leer()]);
    }
    partida = null;
    avisar(publico());
  }

  // Cada segundo, con lo que leyó el overlay. extras: { rol, siguiente }.
  function tick(datos, estado, extras = {}) {
    if (!partida) return;
    const c = ajustes().coach;
    // Solo en la Grieta del Invocador (los consejos de objetivos y roles no valen en ARAM, Arena o URF).
    const esGrieta = (datos?.gameData?.mapNumber ?? 11) === 11 && (datos?.gameData?.gameMode ?? 'CLASSIC') === 'CLASSIC';
    const r = esGrieta ? resumir(datos, estado, extras) : null;
    if (r) { partida.campeon = r.campeon; partida.rol = r.rol; }
    const activo = !!r && c.activo && !c.silenciado && !partida.bloqueo && ROLES_COACH.includes(r.rol);
    // Observar, siempre (también mientras se espera una respuesta): bitácora y qué estás haciendo.
    partida.coach.observar(r, datos, activo);
    if (!activo || partida.ocupado) return;
    const situacion = partida.coach.siguiente(r, datos, ahora());
    if (situacion) consultar(situacion, { ...r, actividad: partida.coach.actividad(r) });
  }

  // Atajo "dame tu lectura ahora": sale en la siguiente lectura de la partida.
  // Devuelve false si no hay partida o el coach no puede responder.
  function pedirLectura() {
    const c = ajustes().coach;
    if (!partida || !c.activo || c.silenciado || partida.bloqueo) return false;
    partida.coach.pedir();
    return true;
  }

  async function consultar(situacion, r) {
    const p = partida;
    p.ocupado = true;
    p.llamadas++;
    const t0 = ahora();
    try {
      const res = await conLimite(pedir({
        accion: 'consejo', partida: p.id, situacion, estado: r, bitacora: p.coach.bitacora(),
      }), ESPERA_MS);
      if (partida !== p) return; // la partida terminó mientras tanto
      if (res?.uso) {
        p.tokens.entrada += Number(res.uso.entrada) || 0;
        p.tokens.salida += Number(res.uso.salida) || 0;
        p.usd += Number(res.uso.usd) || 0;
      }
      if (res?.estado !== 'ok') {
        if (BLOQUEOS.includes(res?.estado)) p.bloqueo = res.estado;
        else throw new Error(`El coach respondió "${res?.estado ?? 'nada'}"`);
        return;
      }
      p.errores = 0;
      const tarde = ahora() - t0 > CADUCA_MS;
      if (res.hablar && res.texto && !tarde && !ajustes().coach.silenciado) {
        p.coach.hablado(situacion, res.texto, ahora(), r.minuto);
        p.consejos.push({ minuto: r.minuto, tipo: situacion.tipo, texto: res.texto, ms: ahora() - t0 });
        hablar(res.texto);
      }
    } catch (e) {
      if (partida !== p) return;
      if (++p.errores >= ERRORES_SEGUIDOS) p.bloqueo = 'error';
      console.error('[coach]', e?.message ?? e);
    } finally {
      p.ocupado = false;
      if (partida === p) avisar(publico());
    }
  }

  // Gasto del mes (tuyo y de todo el grupo) y límites: lo lleva la Edge Function.
  async function uso() {
    try { return await conLimite(pedir({ accion: 'uso' }), ESPERA_MS); } catch { return { estado: 'error' }; }
  }

  return { iniciarPartida, terminarPartida, tick, pedirLectura, estado: publico, uso };
}

module.exports = { crearSesion, crearPedir, BLOQUEOS };
