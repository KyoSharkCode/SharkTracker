// Clips (C1): FFmpeg, búfer en anillo durante la partida y Ctrl + F8 para guardar.
// La parte que graba y pega los trozos está en clips-motor.js (sin Electron).
//
// - FFmpeg NO viene en el instalador (pesa ~200 MB): se descarga una sola vez al
//   activar los clips en Ajustes → Clips, a userData/clips/ffmpeg (build LGPL
//   "shared" de BtbN, la misma familia que usó la prueba C0).
// - El búfer vive en userData/clips/bufer (~150 MB como mucho) y se borra al
//   terminar cada partida.
// - Los clips se guardan en Videos\SharkTracker.
// - Todo lo que pasa queda en userData/clips/registro.txt (codificador elegido,
//   RAM de FFmpeg cada minuto, clips guardados y errores) para revisar el consumo.

const { app, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { crearMotorClips } = require('./clips-motor');

const URL_FFMPEG = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip';

const dir = () => path.join(app.getPath('userData'), 'clips');
const dirFfmpeg = () => path.join(dir(), 'ffmpeg');
const rutaFfmpeg = () => path.join(dirFfmpeg(), 'ffmpeg.exe');
const carpetaClips = () => path.join(app.getPath('videos'), 'SharkTracker');

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

// ── Partida ──
let vigilancia = null;
function vigilarRam(pid) {
  clearInterval(vigilancia);
  vigilancia = setInterval(() => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, salida) => {
      const kb = !err && (salida ?? '').match(/"([\d.,\s]+)\s*K"\s*$/m);
      if (kb) log(`FFmpeg en uso: ${Math.round(Number(kb[1].replace(/[^\d]/g, '')) / 1024)} MB de RAM`);
    });
  }, 60000);
}

// Empieza el búfer al empezar la partida (si los clips están activos y listos).
async function iniciarPartida(ajustes) {
  if (!ajustes?.activo || process.platform !== 'win32' || !hayFfmpeg() || motor.grabando()) return false;
  let c = await motor.detectarCodificador();
  if (!c) return false;
  let ok = await motor.iniciar({ codificador: c, calidad: ajustes.calidad });
  if (!ok) {
    // El que funcionaba ya no arranca (drivers nuevos, otra pantalla): se vuelve a detectar una vez.
    c = await motor.detectarCodificador({ forzar: true });
    ok = !!c && await motor.iniciar({ codificador: c, calidad: ajustes.calidad });
  }
  if (ok) vigilarRam(motor.estado()?.pid);
  return ok;
}

async function detenerPartida() {
  clearInterval(vigilancia);
  vigilancia = null;
  if (!motor.grabando()) return;
  await motor.detener();
  log('Búfer detenido (terminó la partida).');
  try { fs.rmSync(path.join(dir(), 'bufer'), { recursive: true, force: true }); } catch { /* lo borra el próximo inicio */ }
}

// "2026-10-08 21-14-05 Lee Sin.mp4"
function nombreClip(campeon) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const limpio = String(campeon ?? '').replace(/[\\/:*?"<>|]/g, '').trim();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}${limpio ? ` ${limpio}` : ''}.mp4`;
}

// Ctrl + F8: guarda los `antes` s previos y los `despues` s siguientes.
function guardarAhora(ajustes, campeon) {
  return motor.guardar({ antes: ajustes.antes, despues: ajustes.despues, destino: path.join(carpetaClips(), nombreClip(campeon)) });
}

function estado() {
  let deteccion = null;
  try { deteccion = JSON.parse(fs.readFileSync(path.join(dir(), 'codificador.json'), 'utf8')); } catch { /* sin detectar */ }
  return {
    windows: process.platform === 'win32',
    ffmpeg: hayFfmpeg(),
    codificador: deteccion ? (require('./clips-motor').CODIFICADORES.find((c) => c.id === deteccion.id)?.nombre ?? null) : null,
    grabando: motor.grabando(),
    carpeta: carpetaClips(),
  };
}

function abrirCarpeta() {
  fs.mkdirSync(carpetaClips(), { recursive: true });
  return shell.openPath(carpetaClips());
}

module.exports = { preparar, iniciarPartida, detenerPartida, guardarAhora, estado, abrirCarpeta, grabando: () => motor.grabando(), log };
