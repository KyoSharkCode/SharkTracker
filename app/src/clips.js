// Clips: FFmpeg, búfer en anillo durante la partida, clips automáticos y Ctrl + F8,
// audio y la galería de la app.
// - La parte que graba y pega los trozos está en clips-motor.js (sin Electron).
// - Qué jugadas hacen clip: clips-eventos.js; cuándo guardarlas: clips-agenda.js.
//
// - FFmpeg NO viene en el instalador (pesa ~200 MB): se descarga una sola vez al
//   activar los clips en Ajustes → Clips, a userData/clips/ffmpeg (build LGPL
//   "shared" de BtbN, la misma familia que usó la prueba C0).
// - El audio lo captura sharkaudio.exe (app/nativo), que sí viene en el instalador.
// - El búfer vive en userData/clips/bufer (~300 MB como mucho) y se borra al
//   terminar cada partida.
// - Los clips se guardan en Videos\SharkTracker. Lo que la galería sabe de cada uno
//   (partida, campeón, jugada, favorito) va en userData/clips/indice.json, y sus
//   miniaturas en userData/clips/miniaturas.
// - Todo lo que pasa queda en userData/clips/registro.txt (codificador elegido,
//   RAM de FFmpeg cada minuto, clips guardados y errores) para revisar el consumo.

const { app, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { Readable } = require('stream');
const { crearMotorClips, CODIFICADORES } = require('./clips-motor');
const { crearAgenda } = require('./clips-agenda');
const { titulo: tituloJugada } = require('./clips-eventos');

const URL_FFMPEG = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip';
const GB = 1024 ** 3;
const AVISO_DISCO = 15 * GB; // menos libre que esto: aviso en la galería

const dir = () => path.join(app.getPath('userData'), 'clips');
const dirFfmpeg = () => path.join(dir(), 'ffmpeg');
const rutaFfmpeg = () => path.join(dirFfmpeg(), 'ffmpeg.exe');
const dirMinis = () => path.join(dir(), 'miniaturas');
const archivoIndice = () => path.join(dir(), 'indice.json');
const carpetaClips = () => path.join(app.getPath('videos'), 'SharkTracker');

// sharkaudio.exe: en la app instalada va en resources/; probando desde el código, en app/nativo.
function rutaAyudante() {
  const candidatos = [
    path.join(process.resourcesPath ?? '', 'sharkaudio.exe'),
    path.join(__dirname, '..', 'nativo', 'sharkaudio.exe'),
  ];
  return candidatos.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) ?? null;
}

// ── Registro (userData/clips/registro.txt, máx. ~200 KB) ──
function log(texto) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const archivo = path.join(dir(), 'registro.txt');
    try { if (fs.statSync(archivo).size > 200 * 1024) fs.renameSync(archivo, archivo + '.anterior'); } catch { /* no existe */ }
    fs.appendFileSync(archivo, `[${new Date().toLocaleString('es')}] ${texto}\n`);
  } catch { /* sin disco: no pasa nada */ }
}

const motor = crearMotorClips({ dir: dir(), ffmpeg: rutaFfmpeg, log });

// ── FFmpeg: descargar una vez ──
const hayFfmpeg = () => fs.existsSync(rutaFfmpeg());

function descargar(url, destino, onProgreso, saltos = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SharkTracker' }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && saltos < 5) {
        res.resume();
        resolve(descargar(new URL(res.headers.location, url).toString(), destino, onProgreso, saltos + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = Number(res.headers['content-length']) || 0;
      let bajado = 0;
      const archivo = fs.createWriteStream(destino);
      res.on('data', (c) => { bajado += c.length; if (total) onProgreso?.(bajado / total); });
      res.pipe(archivo);
      archivo.on('finish', () => archivo.close(() => resolve()));
      archivo.on('error', reject);
      res.on('error', reject);
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('Tiempo de espera agotado')); });
  });
}

// Descomprime con PowerShell (viene con Windows) y deja solo lo necesario:
// ffmpeg.exe y sus DLL (sin ffplay ni ffprobe).
function descomprimir(zip, destino) {
  return new Promise((resolve, reject) => {
    const cmd = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destino.replace(/'/g, "''")}' -Force`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 180000 },
      (err) => (err ? reject(err) : resolve()));
  });
}

let preparando = null;
// Deja FFmpeg listo y el codificador detectado. onProgreso({ paso, avance }).
function preparar(onProgreso) {
  if (preparando) return preparando;
  preparando = (async () => {
    try {
      if (!hayFfmpeg()) {
        fs.mkdirSync(dir(), { recursive: true });
        const zip = path.join(dir(), 'ffmpeg.zip');
        const temp = path.join(dir(), 'ffmpeg-temp');
        onProgreso?.({ paso: 'descargando', avance: 0 });
        log('Descargando FFmpeg…');
        await descargar(URL_FFMPEG, zip, (a) => onProgreso?.({ paso: 'descargando', avance: a }));
        onProgreso?.({ paso: 'descomprimiendo' });
        fs.rmSync(temp, { recursive: true, force: true });
        await descomprimir(zip, temp);
        const raiz = fs.readdirSync(temp).map((d) => path.join(temp, d)).find((d) => fs.existsSync(path.join(d, 'bin', 'ffmpeg.exe')));
        if (!raiz) throw new Error('El paquete de FFmpeg no trae ffmpeg.exe');
        fs.rmSync(dirFfmpeg(), { recursive: true, force: true });
        fs.renameSync(path.join(raiz, 'bin'), dirFfmpeg());
        for (const sobra of ['ffplay.exe', 'ffprobe.exe']) fs.rmSync(path.join(dirFfmpeg(), sobra), { force: true });
        fs.rmSync(temp, { recursive: true, force: true });
        fs.rmSync(zip, { force: true });
        log('FFmpeg listo.');
      }
      onProgreso?.({ paso: 'probando' });
      const c = await motor.detectarCodificador();
      return c ? { ok: true, codificador: c.nombre } : { ok: false, motivo: 'sin-codificador' };
    } catch (e) {
      log(`No se pudo preparar FFmpeg: ${e.message}`);
      return { ok: false, motivo: 'descarga', error: e.message };
    } finally {
      preparando = null;
    }
  })();
  return preparando;
}

// ── Audio: qué le pedimos al ayudante ──
// Cada fuente va como "tipo:volumen:valor" (programa = nombres de .exe separados por coma).
const PROGRAMAS = {
  juego: 'League of Legends.exe',
  discord: 'Discord.exe,DiscordPTB.exe,DiscordCanary.exe',
};
const NOMBRE_PISTA = { juego: 'Juego', discord: 'Discord', mic: 'Micrófono', pc: 'PC' };
// Fuentes encendidas, en orden. "Todo el PC" ya incluye el juego y Discord: no se suman dos veces.
function fuentesAudio(a) {
  const elegidas = a?.pc?.activo ? ['pc', 'mic'] : ['juego', 'discord', 'mic'];
  return elegidas.filter((f) => a?.[f]?.activo).map((f) => {
    const valor = f === 'mic' || f === 'pc' ? (a[f].dispositivo || 'defecto') : PROGRAMAS[f];
    return { f, arg: `${f === 'juego' || f === 'discord' ? 'programa' : f}:${a[f].volumen}:${valor}` };
  });
}
function planAudio(a) {
  if (!a) return null;
  const exe = rutaAyudante();
  if (!exe) { log('Sin sharkaudio.exe: los clips van sin sonido.'); return null; }
  const fuentes = fuentesAudio(a);
  if (!fuentes.length) return null;
  const separadas = !!a.separadas && fuentes.length > 1;
  return {
    comando: [exe, 'capturar', ...fuentes.flatMap((x) => ['--fuente', x.arg]), ...(separadas ? ['--separadas'] : [])],
    pistas: ['Mezcla', ...(separadas ? fuentes.map((x) => NOMBRE_PISTA[x.f]) : [])],
  };
}

// "Probar audio" (Ajustes → Clips → Audio): abre el ayudante con las fuentes de ahora
// unos segundos y devuelve qué llegó de cada una, según su propio informe de niveles:
// [{ fuente: 'juego', estado: 'ok' | 'silencio' | 'nada' | 'sin-capturar', db, detalle }].
function probarAudio(a) {
  const exe = rutaAyudante();
  const fuentes = fuentesAudio(a);
  if (!exe || process.platform !== 'win32') return Promise.resolve({ ok: false, motivo: 'sin-ayudante', fuentes: [] });
  if (!fuentes.length) return Promise.resolve({ ok: false, motivo: 'sin-fuentes', fuentes: [] });
  return new Promise((resolve) => {
    const ay = spawn(exe, ['capturar', ...fuentes.flatMap((x) => ['--fuente', x.arg]), '--niveles', '4'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    ay.stdout.resume(); // el sonido en sí no hace falta: solo el informe
    const avisos = [];
    let resto = '';
    let listo = false;
    const terminar = (resultado) => {
      if (listo) return;
      listo = true;
      clearTimeout(limite);
      try { ay.kill(); } catch { /* ya cerrado */ }
      for (const l of avisos) log(`Probar audio · ${l}`);
      resolve(resultado);
    };
    const limite = setTimeout(() => terminar({ ok: false, motivo: 'sin-respuesta', fuentes: [], avisos }), 9000);
    ay.on('error', (e) => terminar({ ok: false, motivo: 'sin-ayudante', error: e.message, fuentes: [], avisos }));
    ay.stderr.on('data', (d) => {
      const lineas = (resto + d).split(/\r?\n/);
      resto = lineas.pop();
      for (const l of lineas.map((x) => x.trim()).filter(Boolean)) {
        avisos.push(l);
        const m = /^Niveles \(\d+ s\): (.*)$/.exec(l);
        if (!m) continue;
        // "League of Legends -18 dB · Micrófono silencio": en el orden de las fuentes.
        const partes = m[1].split(' · ');
        terminar({ ok: true, avisos: avisos.filter((x) => !x.startsWith('Niveles')), fuentes: fuentes.map((x, i) => {
          const p = partes[i] ?? '';
          const db = /(-?\d+) dB$/.exec(p);
          const estado = db ? 'ok' : /silencio$/.test(p) ? 'silencio' : /no llega nada$/.test(p) ? 'nada' : 'sin-capturar';
          const detalle = avisos.find((av) => av.startsWith(`${p.split(' ')[0]}`) && !av.startsWith('Niveles')) ?? null;
          return { fuente: x.f, estado, db: db ? Number(db[1]) : null, detalle };
        }) });
      }
    });
  });
}

// Micrófonos y salidas de sonido para Ajustes → Clips → Audio.
function dispositivos() {
  const exe = rutaAyudante();
  if (!exe || process.platform !== 'win32') return Promise.resolve({ ok: false, entradas: [], salidas: [] });
  return new Promise((resolve) => {
    execFile(exe, ['dispositivos'], { windowsHide: true, timeout: 8000 }, (err, salida) => {
      try { resolve({ ok: !err, ...JSON.parse(salida) }); } catch { resolve({ ok: false, entradas: [], salidas: [] }); }
    });
  });
}

// ── Índice de clips (para la galería) ──
let indice = null;
function leerIndice() {
  if (!indice) {
    try { indice = JSON.parse(fs.readFileSync(archivoIndice(), 'utf8')); } catch { indice = {}; }
    if (typeof indice.archivos !== 'object' || !indice.archivos) indice = { archivos: {} };
  }
  return indice;
}
function guardarIndice() {
  try { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(archivoIndice(), JSON.stringify(indice, null, 1)); } catch { /* sin disco */ }
}
// Un clip se nombra relativo a la carpeta de clips: "archivo.mp4" (sueltos, de antes de la
// v0.9.4) o "Carpeta de la partida/archivo.mp4" (un nivel). Viene de la ventana, así que
// nada de "..", unidades ni separadores raros.
const parteValida = (p) => !!p && !p.startsWith('.') && !/[\\/:*?"<>|\u0000-\u001f]/.test(p);
function nombreSeguro(nombre) {
  const s = String(nombre ?? '');
  const partes = s.split('/');
  return partes.length <= 2 && partes.every(parteValida) && /\.mp4$/i.test(partes[partes.length - 1]) ? s : null;
}
const rutaClip = (rel) => path.join(carpetaClips(), ...rel.split('/'));
const rutaMini = (rel) => path.join(dirMinis(), ...rel.replace(/\.mp4$/i, '.jpg').split('/'));
const carpetaDe = (rel) => (rel.includes('/') ? rel.split('/')[0] : null);
const limpiarNombre = (t) => String(t ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();

// Carpeta de una partida: "Briar 2026-10-08" (y "(2)", "(3)"… si ese día ya hubo otra con él).
function nombreCarpetaPartida(campeon, cuando, ocupada) {
  const d = new Date(cuando);
  const p = (n) => String(n).padStart(2, '0');
  const base = `${limpiarNombre(campeon) || 'Partida'} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  let nombre = base;
  for (let k = 2; ocupada(nombre); k++) nombre = `${base} (${k})`;
  return nombre;
}

// Si al borrar o mover un clip su carpeta de partida queda vacía, se quita (y la de miniaturas).
function quitarCarpetaVacia(rel) {
  const c = carpetaDe(rel);
  if (!c) return;
  for (const d of [path.join(carpetaClips(), c), path.join(dirMinis(), c)]) {
    try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch { /* no existe o no está vacía */ }
  }
}

// ── Partida ──
let vigilancia = null;
function vigilarRam(pid) {
  clearInterval(vigilancia);
  vigilancia = setInterval(() => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, salida) => {
      // Última columna: "123,456 K" (inglés), "123.456 KB" (español), "123 456 Ko" (francés)…
      const kb = !err && (salida ?? '').match(/"([\d.,\s]+)\s*[A-Za-z]+"\s*$/m);
      if (kb) log(`FFmpeg en uso: ${Math.round(Number(kb[1].replace(/[^\d]/g, '')) / 1024)} MB de RAM`);
    });
  }, 60000);
}

let partida = null;   // { id, campeon } de la partida en curso
let agenda = null;
let alGuardarClip = null; // main.js: aviso en el overlay y en la ventana
function alGuardado(fn) { alGuardarClip = fn; }

// "2026-10-08 21-14-05 Lee Sin - Triple kill.mp4"
function nombreClip(campeon, titulo) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const extra = [limpiarNombre(campeon), titulo && titulo !== 'Clip' ? limpiarNombre(titulo) : ''].filter(Boolean);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}${extra.length ? ` ${extra.join(' - ')}` : ''}.mp4`;
}

// Empieza el búfer al empezar la partida (si los clips están activos y listos).
async function iniciarPartida(ajustes) {
  if (!ajustes?.activo || process.platform !== 'win32' || !hayFfmpeg() || motor.grabando()) return false;
  let c = await motor.detectarCodificador();
  if (!c) return false;
  const audio = planAudio(ajustes.audio);
  let ok = await motor.iniciar({ codificador: c, calidad: ajustes.calidad, audio });
  if (!ok) {
    // El que funcionaba ya no arranca (drivers nuevos, otra pantalla): se vuelve a detectar una vez.
    c = await motor.detectarCodificador({ forzar: true });
    ok = !!c && await motor.iniciar({ codificador: c, calidad: ajustes.calidad, audio });
  }
  if (!ok) return false;
  vigilarRam(motor.estado()?.pid);
  partida = { id: Date.now(), campeon: null, carpeta: null };
  agenda = crearAgenda({ alGuardar: (j) => guardarJugada(j, ajustes) });
  return true;
}

async function detenerPartida() {
  clearInterval(vigilancia);
  vigilancia = null;
  const a = agenda;
  agenda = null;
  if (a) await a.vaciar(); // Ctrl + F8 o una jugada justo al final: se guardan con lo que haya
  if (!motor.grabando()) { partida = null; return; }
  await motor.detener();
  partida = null;
  log('Búfer detenido (terminó la partida).');
  try { fs.rmSync(path.join(dir(), 'bufer'), { recursive: true, force: true }); } catch { /* lo borra el próximo inicio */ }
}

function ponerCampeon(campeon) { if (partida && campeon) partida.campeon = campeon; }

// Una jugada (automática) o Ctrl + F8 (manual). Devuelve 'nueva', 'unida' o null si no se graba.
function marcar(jugada, ajustes) {
  if (!agenda || !motor.grabando()) return null;
  return agenda.marcar(jugada, ajustes);
}

async function guardarJugada({ segundos, fin, etiquetas, manual }, ajustes) {
  const titulo = tituloJugada(etiquetas.filter((e) => e !== 'Clip'));
  const campeon = partida?.campeon;
  // Cada partida, su carpeta (se elige con el primer clip, cuando ya se sabe el campeón).
  if (partida && !partida.carpeta) {
    partida.carpeta = nombreCarpetaPartida(campeon, partida.id, (n) => fs.existsSync(path.join(carpetaClips(), n)));
  }
  const archivo = `${partida?.carpeta ? `${partida.carpeta}/` : ''}${nombreClip(campeon, titulo)}`;
  const r = await motor.guardar({ segundos, fin, destino: rutaClip(archivo) });
  if (r.ok) {
    // Momento de la jugada dentro del clip (después de los segundos de "antes"): miniatura y vista previa.
    const momento = Math.max(0, Math.min(ajustes.antes, r.segundos - 1));
    leerIndice().archivos[archivo] = {
      partida: partida?.id ?? Date.now(), campeon: campeon ?? null, titulo, manual: !!manual,
      creado: Date.now(), segundos: r.segundos, momento, favorito: false,
    };
    guardarIndice();
    motor.miniatura(r.archivo, rutaMini(archivo), momento).catch(() => {});
    aplicarLimite(ajustes.limiteGB);
  }
  alGuardarClip?.({ ...r, titulo, manual: !!manual });
  return r;
}

// ── Galería ──
// Los .mp4 sueltos en Videos › SharkTracker y los de cada carpeta de partida (un nivel).
function nombresEnDisco() {
  let entradas = [];
  try { entradas = fs.readdirSync(carpetaClips(), { withFileTypes: true }); } catch { return []; }
  const lista = [];
  for (const e of entradas) {
    if (!parteValida(e.name)) continue;
    if (e.isFile() && /\.mp4$/i.test(e.name)) lista.push(e.name);
    else if (e.isDirectory()) {
      try {
        for (const n of fs.readdirSync(path.join(carpetaClips(), e.name))) {
          if (/\.mp4$/i.test(n) && parteValida(n)) lista.push(`${e.name}/${n}`);
        }
      } catch { /* sin permiso */ }
    }
  }
  return lista;
}

function clipsEnDisco() {
  const idx = leerIndice().archivos;
  return nombresEnDisco().map((archivo) => {
    let st;
    try { st = fs.statSync(rutaClip(archivo)); } catch { return null; }
    const i = idx[archivo] ?? {};
    return {
      archivo,
      carpeta: carpetaDe(archivo),
      momento: i.momento ?? null,
      titulo: i.titulo ?? null,
      renombrado: !!i.renombrado, // el nombre lo puso la persona: se muestra el del archivo
      campeon: i.campeon ?? null,
      partida: i.partida ?? null,
      manual: !!i.manual,
      favorito: !!i.favorito,
      segundos: i.segundos ?? null,
      creado: i.creado ?? st.mtimeMs,
      tamano: st.size,
      mini: fs.existsSync(rutaMini(archivo)),
    };
  }).filter(Boolean).sort((a, b) => b.creado - a.creado);
}

// Límite de espacio: se borran los clips normales más viejos (los favoritos no cuentan).
function aplicarLimite(limiteGB = 10) {
  const normales = clipsEnDisco().filter((c) => !c.favorito).sort((a, b) => a.creado - b.creado);
  let usado = normales.reduce((s, c) => s + c.tamano, 0);
  const limite = limiteGB * GB;
  for (const c of normales) {
    if (usado <= limite) break;
    try {
      fs.rmSync(rutaClip(c.archivo));
      fs.rmSync(rutaMini(c.archivo), { force: true });
      delete leerIndice().archivos[c.archivo];
      quitarCarpetaVacia(c.archivo);
      usado -= c.tamano;
      log(`Límite de ${limiteGB} GB: se borró ${c.archivo}`);
    } catch { /* en uso: se intenta la próxima vez */ }
  }
  guardarIndice();
}

function espacioLibre() {
  try {
    fs.mkdirSync(carpetaClips(), { recursive: true });
    const s = fs.statfsSync(carpetaClips());
    return s.bavail * s.bsize;
  } catch { return null; }
}

// Miniaturas que faltan (clips de antes o pegados a mano en la carpeta): de a una.
let haciendoMinis = false;
async function completarMiniaturas(alTerminar) {
  if (haciendoMinis || !hayFfmpeg()) return;
  haciendoMinis = true;
  try {
    let hizo = false;
    for (const c of clipsEnDisco().filter((x) => !x.mini).slice(0, 30)) {
      const en = Math.min(leerIndice().archivos[c.archivo] ? 20 : 2, Math.max(0, (c.segundos ?? 4) - 1));
      if (await motor.miniatura(rutaClip(c.archivo), rutaMini(c.archivo), c.momento ?? en)) hizo = true;
    }
    if (hizo) alTerminar?.();
  } finally { haciendoMinis = false; }
}

// Clips sueltos de la v0.9.3 (antes de las carpetas): los que se sabe de qué partida son
// se mueven a la carpeta de esa partida, una vez.
let migrado = false;
function migrarSueltos() {
  if (migrado) return;
  migrado = true;
  const idx = leerIndice().archivos;
  const carpetas = new Map(); // partida → carpeta
  let cambio = false;
  for (const archivo of nombresEnDisco().filter((n) => !n.includes('/'))) {
    const i = idx[archivo];
    if (!i?.partida) continue;
    let c = carpetas.get(i.partida);
    if (!c) {
      c = nombreCarpetaPartida(i.campeon, i.partida, (n) => fs.existsSync(path.join(carpetaClips(), n)) || [...carpetas.values()].includes(n));
      carpetas.set(i.partida, c);
    }
    const nuevo = `${c}/${archivo}`;
    try {
      fs.mkdirSync(path.join(carpetaClips(), c), { recursive: true });
      fs.renameSync(rutaClip(archivo), rutaClip(nuevo));
      try { fs.mkdirSync(path.dirname(rutaMini(nuevo)), { recursive: true }); fs.renameSync(rutaMini(archivo), rutaMini(nuevo)); } catch { /* sin miniatura */ }
      idx[nuevo] = i;
      delete idx[archivo];
      cambio = true;
    } catch (e) { log(`No se pudo mover ${archivo} a su carpeta: ${e.message}`); }
  }
  if (cambio) { guardarIndice(); log(`Clips sueltos ordenados en ${carpetas.size} carpeta(s) de partida.`); }
}

function galeria(ajustes) {
  migrarSueltos();
  const clips = clipsEnDisco();
  const usado = clips.filter((c) => !c.favorito).reduce((s, c) => s + c.tamano, 0);
  const favoritos = clips.filter((c) => c.favorito).reduce((s, c) => s + c.tamano, 0);
  const libre = espacioLibre();
  return {
    clips, usado, favoritos, limite: (ajustes?.limiteGB ?? 10) * GB, libre,
    pocoDisco: libre !== null && libre < AVISO_DISCO, carpeta: carpetaClips(),
  };
}

function favorito(archivo, valor) {
  const n = nombreSeguro(archivo);
  if (!n) return false;
  const idx = leerIndice().archivos;
  idx[n] = { ...(idx[n] ?? { creado: Date.now() }), favorito: !!valor };
  guardarIndice();
  return true;
}

function renombrar(archivo, nuevoNombre) {
  const n = nombreSeguro(archivo);
  const limpio = String(nuevoNombre ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\.mp4$/i, '').trim().slice(0, 120);
  if (!n || !limpio) return { ok: false, motivo: 'nombre' };
  const c = carpetaDe(n);
  const nuevo = `${c ? `${c}/` : ''}${limpio}.mp4`;
  if (nuevo === n) return { ok: true, archivo: n };
  const destino = rutaClip(nuevo);
  if (fs.existsSync(destino)) return { ok: false, motivo: 'existe' };
  try {
    fs.renameSync(rutaClip(n), destino);
    try { fs.renameSync(rutaMini(n), rutaMini(nuevo)); } catch { /* sin miniatura */ }
    const idx = leerIndice().archivos;
    idx[nuevo] = { ...(idx[n] ?? { creado: Date.now() }), renombrado: true };
    delete idx[n];
    guardarIndice();
    return { ok: true, archivo: nuevo };
  } catch (e) {
    return { ok: false, motivo: 'en-uso', error: e.message };
  }
}

// Borrar desde la galería: a la papelera de Windows (se puede recuperar).
async function borrar(archivo) {
  const n = nombreSeguro(archivo);
  if (!n) return false;
  try {
    await shell.trashItem(rutaClip(n));
    fs.rmSync(rutaMini(n), { force: true });
    delete leerIndice().archivos[n];
    guardarIndice();
    quitarCarpetaVacia(n);
    return true;
  } catch { return false; }
}

function mostrarEnCarpeta(archivo) {
  const n = nombreSeguro(archivo);
  if (n) shell.showItemInFolder(rutaClip(n));
}

// Protocolo sharkclip:// para la ventana: sharkclip://video/<archivo> y
// sharkclip://mini/<archivo>. Solo sirve archivos de la carpeta de clips y sus
// miniaturas; el video admite pedir por partes (para adelantar y retroceder).
async function servir(request) {
  const url = new URL(request.url);
  const archivo = nombreSeguro(decodeURIComponent(url.pathname.replace(/^\//, '')));
  if (!archivo) return new Response('', { status: 404 });
  const ruta = url.hostname === 'video' ? rutaClip(archivo)
    : url.hostname === 'mini' ? rutaMini(archivo) : null;
  let st;
  try { st = ruta && fs.statSync(ruta); } catch { st = null; }
  if (!st) return new Response('', { status: 404 });
  const tipo = url.hostname === 'video' ? 'video/mp4' : 'image/jpeg';
  const rango = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  if (!rango) {
    return new Response(Readable.toWeb(fs.createReadStream(ruta)), {
      status: 200, headers: { 'Content-Type': tipo, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' },
    });
  }
  let inicio = rango[1] ? Number(rango[1]) : Math.max(0, st.size - Number(rango[2]));
  let fin = rango[1] && rango[2] ? Number(rango[2]) : st.size - 1;
  fin = Math.min(fin, st.size - 1);
  if (inicio > fin || inicio >= st.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
  inicio = Math.max(0, inicio);
  return new Response(Readable.toWeb(fs.createReadStream(ruta, { start: inicio, end: fin })), {
    status: 206,
    headers: { 'Content-Type': tipo, 'Content-Length': String(fin - inicio + 1), 'Content-Range': `bytes ${inicio}-${fin}/${st.size}`, 'Accept-Ranges': 'bytes' },
  });
}

function estado() {
  let deteccion = null;
  try { deteccion = JSON.parse(fs.readFileSync(path.join(dir(), 'codificador.json'), 'utf8')); } catch { /* sin detectar */ }
  return {
    windows: process.platform === 'win32',
    ffmpeg: hayFfmpeg(),
    audio: !!rutaAyudante(),
    codificador: deteccion ? (CODIFICADORES.find((c) => c.id === deteccion.id)?.nombre ?? null) : null,
    grabando: motor.grabando(),
    pistas: motor.estado()?.pistas ?? [],
    carpeta: carpetaClips(),
  };
}

// Abre Videos › SharkTracker, o la carpeta de una partida.
function abrirCarpeta(carpeta) {
  fs.mkdirSync(carpetaClips(), { recursive: true });
  const sub = carpeta && parteValida(carpeta) ? path.join(carpetaClips(), carpeta) : null;
  return shell.openPath(sub && fs.existsSync(sub) ? sub : carpetaClips());
}

module.exports = {
  preparar, iniciarPartida, detenerPartida, ponerCampeon, marcar, alGuardado, estado, abrirCarpeta,
  dispositivos, planAudio, probarAudio, galeria, completarMiniaturas, favorito, renombrar, borrar, mostrarEnCarpeta, servir, aplicarLimite,
  grabando: () => motor.grabando(), log,
};
