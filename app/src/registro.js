// Registro de errores de la app (v1.0): lo que falla en cualquier parte (proceso main,
// ventanas, overlay) queda en userData/registro-app.txt, para poder ver qué pasó cuando
// alguien del grupo avisa de un problema. Ajustes → Cuenta → Diagnóstico lo abre.
// (Los clips tienen su propio registro.txt, más detallado.)
// Sin Electron: se prueba en Node con una carpeta temporal.

const fs = require('fs');
const path = require('path');

const TOPE_BYTES = 512 * 1024;   // al pasar de esto, se queda la mitad más nueva
const REPETIDO_MS = 60 * 1000;   // el mismo error seguido no se repite: se cuenta

// dir: carpeta, o una función que la da (en main.js se pide tarde, cuando la app ya tiene su nombre).
function crearRegistro({ dir, archivo = 'registro-app.txt', reloj = () => Date.now() }) {
  const carpeta = typeof dir === 'function' ? dir : () => dir;
  const ruta = () => path.join(carpeta(), archivo);
  let ultimo = null; // { texto, hora, veces }

  const fecha = (ms) => new Date(ms).toLocaleString('es');

  function escribir(linea) {
    try {
      fs.mkdirSync(carpeta(), { recursive: true });
      fs.appendFileSync(ruta(), `${linea}\n`);
      const tam = fs.statSync(ruta()).size;
      if (tam > TOPE_BYTES) {
        const txt = fs.readFileSync(ruta(), 'utf8');
        const resto = txt.slice(txt.length - Math.floor(TOPE_BYTES / 2));
        fs.writeFileSync(ruta(), resto.slice(resto.indexOf('\n') + 1));
      }
    } catch { /* sin disco: no hay dónde anotarlo */ }
  }

  // Si el último error se repitió, se anota cuántas veces antes de seguir.
  function cerrarRepetido() {
    if (ultimo?.veces > 1) escribir(`[${fecha(reloj())}] (el error anterior se repitió ${ultimo.veces - 1} ${ultimo.veces === 2 ? 'vez' : 'veces'} más)`);
  }

  // origen: de dónde viene ("main", "ventana", "overlay", "clips"…). error: texto o Error.
  function anotar(origen, error, detalle) {
    const msg = error instanceof Error ? (error.stack || error.message) : String(error ?? '');
    const texto = `[${origen}] ${msg}${detalle ? ` · ${detalle}` : ''}`.trim();
    // "Es el mismo error" = mismo origen y misma primera línea (la pila cambia de una vez a otra).
    const clave = `${origen}|${(error instanceof Error ? error.message : msg).split('\n')[0]}|${detalle ?? ''}`;
    const ahora = reloj();
    if (ultimo && ultimo.clave === clave && ahora - ultimo.hora < REPETIDO_MS) {
      ultimo.veces++;
      ultimo.hora = ahora;
      return;
    }
    cerrarRepetido();
    ultimo = { clave, hora: ahora, veces: 1 };
    escribir(`[${fecha(ahora)}] ${texto}`);
  }

  // Línea informativa (arranque, versión): no cuenta como error.
  function info(texto) {
    cerrarRepetido();
    ultimo = null;
    escribir(`[${fecha(reloj())}] ${texto}`);
  }

  function leer() {
    try { return fs.readFileSync(ruta(), 'utf8'); } catch { return ''; }
  }

  return { anotar, info, leer, ruta };
}

module.exports = { crearRegistro, TOPE_BYTES, REPETIDO_MS };
