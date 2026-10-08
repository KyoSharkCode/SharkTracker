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
const { execFile } = require('child_process');
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
function planAudio(a) {
  if (!a) return null;
  const exe = rutaAyudante();
  if (!exe) { log('Sin sharkaudio.exe: los clips van sin sonido.'); return null; }
  // "Todo el PC" ya incluye el juego y Discord: no se suman dos veces.
  const elegidas = a.pc?.activo ? ['pc', 'mic'] : ['juego', 'discord', 'mic'];
  const fuentes = elegidas.filter((f) => a[f]?.activo).map((f) => {
    const valor = f === 'mic' || f === 'pc' ? (a[f].dispositivo || 'defecto') : PROGRAMAS[f];
    return { f, arg: `${f === 'juego' || f === 'discord' ? 'programa' : f}:${a[f].volumen}:${valor}` };
  });
  if (!fuentes.length) return null;
  const separadas = !!a.separadas && fuentes.length > 1;
  return {
    comando: [exe, 'capturar', ...fuentes.flatMap((x) => ['--fuente', x.arg]), ...(separadas ? ['--separadas'] : [])],
    pistas: ['Mezcla', ...(separadas ? fuentes.map((x) => NOMBRE_PISTA[x.f]) : [])],
  };
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
// Solo nombres de archivo de la carpeta de clips (nada de rutas: viene de la ventana).
function nombreSeguro(nombre) {
  const base = path.basename(String(nombre ?? ''));
  return base === nombre && /\.mp4$/i.test(base) && !base.startsWith('.') && !/[\\/:]/.test(base) ? base : null;
}
const rutaMini = (archivo) => path.join(dirMinis(), archivo.replace(/\.mp4$/i, '.jpg'));

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
  const limpio = (t) => String(t ?? '').replace(/[\\/:*?"<>|]/g, '').trim();
  const extra = [limpio(campeon), titulo && titulo !== 'Clip' ? limpio(titulo) : ''].filter(Boolean);
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
  partida = { id: Date.now(), campeon: null };
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
  const archivo = nombreClip(campeon, titulo);
  const r = await motor.guardar({ segundos, fin, destino: path.join(carpetaClips(), archivo) });
  if (r.ok) {
    leerIndice().archivos[archivo] = {
      partida: partida?.id ?? Date.now(), campeon: campeon ?? null, titulo, manual: !!manual,
      creado: Date.now(), segundos: r.segundos, favorito: false,
    };
    guardarIndice();
    // Miniatura en el momento de la jugada (después de los segundos de "antes").
    motor.miniatura(r.archivo, rutaMini(archivo), Math.min(ajustes.antes, r.segundos - 1)).catch(() => {});
    aplicarLimite(ajustes.limiteGB);
  }
  alGuardarClip?.({ ...r, titulo, manual: !!manual });
  return r;
}

// ── Galería ──
function clipsEnDisco() {
  let nombres = [];
  try { nombres = fs.readdirSync(carpetaClips()).filter((n) => /\.mp4$/i.test(n)); } catch { return []; }
  const idx = leerIndice().archivos;
  return nombres.map((archivo) => {
    let st;
    try { st = fs.statSync(path.join(carpetaClips(), archivo)); } catch { return null; }
    const i = idx[archivo] ?? {};
    return {
      archivo,
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
      fs.rmSync(path.join(carpetaClips(), c.archivo));
      fs.rmSync(rutaMini(c.archivo), { force: true });
      delete leerIndice().archivos[c.archivo];
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
      if (await motor.miniatura(path.join(carpetaClips(), c.archivo), rutaMini(c.archivo), en)) hizo = true;
    }
    if (hizo) alTerminar?.();
  } finally { haciendoMinis = false; }
}

function galeria(ajustes) {
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
  const nuevo = `${limpio}.mp4`;
  if (nuevo === n) return { ok: true, archivo: n };
  const destino = path.join(carpetaClips(), nuevo);
  if (fs.existsSync(destino)) return { ok: false, motivo: 'existe' };
  try {
    fs.renameSync(path.join(carpetaClips(), n), destino);
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
    await shell.trashItem(path.join(carpetaClips(), n));
    fs.rmSync(rutaMini(n), { force: true });
    delete leerIndice().archivos[n];
    guardarIndice();
    return true;
  } catch { return false; }
}

function mostrarEnCarpeta(archivo) {
  const n = nombreSeguro(archivo);
  if (n) shell.showItemInFolder(path.join(carpetaClips(), n));
}

// Protocolo sharkclip:// para la ventana: sharkclip://video/<archivo> y
// sharkclip://mini/<archivo>. Solo sirve archivos de la carpeta de clips y sus
// miniaturas; el video admite pedir por partes (para adelantar y retroceder).
async function servir(request) {
  const url = new URL(request.url);
  const archivo = nombreSeguro(decodeURIComponent(url.pathname.replace(/^\//, '')));
  if (!archivo) return new Response('', { status: 404 });
  const ruta = url.hostname === 'video' ? path.join(carpetaClips(), archivo)
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

function abrirCarpeta() {
  fs.mkdirSync(carpetaClips(), { recursive: true });
  return shell.openPath(carpetaClips());
}

module.exports = {
  preparar, iniciarPartida, detenerPartida, ponerCampeon, marcar, alGuardado, estado, abrirCarpeta,
  dispositivos, planAudio, galeria, completarMiniaturas, favorito, renombrar, borrar, mostrarEnCarpeta, servir, aplicarLimite,
  grabando: () => motor.grabando(), log,
};
