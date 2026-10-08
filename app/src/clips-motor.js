// Motor de clips: búfer en anillo + guardar los últimos segundos.
// Sin Electron (se prueba en Node con una fuente de prueba de FFmpeg).
//
// Cómo funciona:
// - Durante la partida, FFmpeg captura la pantalla por la GPU (ddagrab) y la
//   comprime por hardware. El video se guarda en trozos de 2 s que se pisan en
//   anillo (TROZOS_ANILLO trozos = 140 s), así el disco nunca crece.
// - FFmpeg anota cada trozo terminado en una lista (csv: archivo, inicio, fin).
// - Guardar = elegir los trozos cerrados hasta `fin` (la hora del archivo dice
//   cuándo se cerró cada uno) que cubren los segundos pedidos y pegarlos sin
//   recodificar (-c copy): tarda ~1 s. Cuándo guardar lo decide clips-agenda.js.
// - Audio (C1b): el ayudante nativo (sharkaudio.exe, ver app/nativo) captura el
//   juego, Discord, el micrófono o todo el PC, lo mezcla y lo manda como PCM por
//   su salida; la app lo pasa a la entrada de FFmpeg, que lo comprime en AAC
//   dentro de los mismos trozos. Si el audio falla, se graba solo el video.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SEGUNDOS_TROZO = 2;
const TROZOS_ANILLO = 70; // 140 s: alcanza para un clip de 2 min (jugadas encadenadas) y el trozo en curso
const BITRATE = { alta: ['-b:v', '15M', '-maxrate', '25M', '-bufsize', '30M'], ligera: ['-b:v', '6M', '-maxrate', '10M', '-bufsize', '12M'] };
const FPS = { alta: 60, ligera: 30 };
const AUDIO_HZ = 48000;
const RETRASO_AYUDANTE_MS = 50; // sharkaudio.exe manda el audio con este retraso fijo (RETRASO_MS)

// Codificadores por hardware, en orden de preferencia. Primero los que no sacan
// la imagen de la GPU (consumen casi nada); la copia a memoria va al final porque
// en laptops híbridas (pantalla en la Intel, juego en la NVIDIA) cuesta FPS y RAM
// (prueba C0 en la laptop de Ostia). En esas laptops gana QuickSync sin copia.
const CODIFICADORES = [
  { id: 'nvenc', nombre: 'NVIDIA NVENC (directo en la GPU)', vf: [], c: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr'] },
  { id: 'amf', nombre: 'AMD AMF (directo en la GPU)', vf: [], c: ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'balanced', '-rc', 'vbr_peak'] },
  { id: 'qsv', nombre: 'Intel QuickSync (sin copia)', vf: ['-vf', 'hwmap=derive_device=qsv,format=qsv'], c: ['-c:v', 'h264_qsv', '-preset', 'faster'] },
  { id: 'nvenc-copia', nombre: 'NVIDIA NVENC (con copia a memoria)', vf: ['-vf', 'hwdownload,format=bgra'], c: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr'] },
  { id: 'amf-copia', nombre: 'AMD AMF (con copia a memoria)', vf: ['-vf', 'hwdownload,format=bgra'], c: ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'balanced', '-rc', 'vbr_peak'] },
];

// Entrada de video: la pantalla principal por Desktop Duplication. En las pruebas
// (Linux) se cambia por una fuente sintética con `entrada`. `extra`: filtro que va
// pegado a la captura (la marca de hora real, cuando hay audio).
const entradaPantalla = (fps, extra = '') => ['-f', 'lavfi', '-i', `ddagrab=output_idx=0:framerate=${fps}${extra}`];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Marca de tiempo = hora real desde `origen` (µs), la misma para video y audio: así
// quedan alineados aunque el ayudante y la captura de pantalla no arranquen en el
// mismo milisegundo (el audio que llegó antes de tiempo se descarta). Con la hora
// completa no se puede: el formato de los trozos (MPEG-TS) da la vuelta a las 26 h.
const relojVideo = (origen) => `,setpts=(RTCTIME-${origen})/(TB*1000000)`;

// Argumentos de FFmpeg para el audio que llega por la entrada estándar.
// pistas: nombres de las pistas; la primera es la mezcla. Con una sola, solo la mezcla.
function argsAudio(pistas, origen) {
  const canales = pistas.length * 2;
  const entrada = ['-f', 'f32le', '-ar', String(AUDIO_HZ), '-ac', String(canales), '-i', 'pipe:0'];
  const comp = ['-c:a', 'aac', '-b:a', '160k', '-ar', String(AUDIO_HZ)];
  // Cada bloque llega entero: su inicio es la hora de llegada menos lo que dura (y menos
  // el retraso fijo del ayudante). aresample=async: rellena huecos y recorta lo que se
  // solapa (el audio sigue al reloj).
  const retraso = Math.round((RETRASO_AYUDANTE_MS / 1000) * AUDIO_HZ);
  const reloj = `asetpts=(RTCTIME-${origen})/(TB*1000000)-NB_SAMPLES-${retraso},aresample=async=1000`;
  // El video conserva su hora de captura (sin forzar un ritmo fijo, que lo iría estirando).
  const video = ['-fps_mode', 'passthrough'];
  if (pistas.length === 1) return { entrada, salida: [...video, '-map', '0:v', '-map', '1:a', '-af', reloj, ...comp] };
  const partes = pistas.map((_, i) => `[s${i}]pan=stereo|c0=c${i * 2}|c1=c${i * 2 + 1}[p${i}]`);
  const grafo = `[1:a]${reloj},asplit=${pistas.length}${pistas.map((_, i) => `[s${i}]`).join('')};${partes.join(';')}`;
  return { entrada, salida: [...video, '-filter_complex', grafo, '-map', '0:v', ...pistas.flatMap((_, i) => ['-map', `[p${i}]`]), ...comp] };
}

function crearMotorClips({ dir, ffmpeg, log = () => {}, entrada = entradaPantalla, codificadores = CODIFICADORES, anillo = TROZOS_ANILLO }) {
  const dirBufer = path.join(dir, 'bufer');
  const lista = path.join(dirBufer, 'lista.csv');
  let proceso = null;
  let ayudante = null;
  let actual = null; // { codificador, calidad, desde, pid, pistas }
  let cola = Promise.resolve(); // guardados, de a uno
  let enCola = 0;

  const correr = (args, ms) => new Promise((resolve) => {
    execFile(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: ms },
      (err, _out, errTxt) => resolve({ ok: !err, error: (errTxt || err?.message || '').trim().split('\n').pop() }));
  });

  // Prueba 2 s de grabación con cada codificador y se queda con el primero que funciona.
  // El resultado se guarda: no se repite en cada partida.
  async function detectarCodificador({ forzar = false } = {}) {
    const archivo = path.join(dir, 'codificador.json');
    if (!forzar) {
      try {
        const g = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        const c = codificadores.find((x) => x.id === g.id);
        if (c) return c;
      } catch { /* todavía no se detectó */ }
    }
    fs.mkdirSync(dir, { recursive: true });
    const prueba = path.join(dir, 'prueba.mp4');
    const intentos = [];
    for (const c of codificadores) {
      try { fs.rmSync(prueba, { force: true }); } catch { /* nada */ }
      const r = await correr([...entrada(30), '-t', '2', ...c.vf, ...c.c, ...BITRATE.ligera, prueba], 20000);
      const ok = r.ok && fs.existsSync(prueba) && fs.statSync(prueba).size > 10 * 1024;
      intentos.push(`${ok ? 'OK   ' : 'FALLA'} ${c.nombre}${ok ? '' : `  (${r.error})`}`);
      if (ok) {
        fs.rmSync(prueba, { force: true });
        fs.writeFileSync(archivo, JSON.stringify({ id: c.id, fecha: new Date().toISOString(), intentos }, null, 2));
        log(`Codificador: ${c.nombre}\n  ${intentos.join('\n  ')}`);
        return c;
      }
    }
    log(`Ningún codificador por hardware funcionó:\n  ${intentos.join('\n  ')}`);
    return null;
  }

  // Arranca FFmpeg (y el ayudante de audio, si hay). Devuelve el proceso o null.
  async function arrancar({ codificador, calidad, audio }) {
    fs.rmSync(dirBufer, { recursive: true, force: true });
    fs.mkdirSync(dirBufer, { recursive: true });
    const fps = FPS[calidad] ?? 60;
    const origen = Date.now() * 1000;
    const a = audio ? argsAudio(audio.pistas, origen) : null;
    const args = ['-hide_banner', '-loglevel', 'error', '-y',
      ...entrada(fps, a ? relojVideo(origen) : ''), ...(a ? a.entrada : []),
      ...codificador.vf, ...codificador.c, ...(BITRATE[calidad] ?? BITRATE.alta), '-g', String(fps * SEGUNDOS_TROZO),
      ...(a ? a.salida : []),
      // Sin reiniciar las marcas de tiempo en cada trozo: así se pegan tal cual (ver guardar).
      '-f', 'segment', '-segment_time', String(SEGUNDOS_TROZO), '-segment_wrap', String(anillo),
      '-segment_format', 'mpegts',
      '-segment_list', lista, '-segment_list_type', 'csv', '-segment_list_size', String(anillo),
      path.join(dirBufer, 'trozo%03d.ts')];
    let ay = null;
    let erroresAy = '';
    if (audio) {
      ay = spawn(audio.comando[0], audio.comando.slice(1), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      ay.stderr.on('data', (d) => { erroresAy = (erroresAy + d).slice(-2000); });
      ay.on('error', (e) => { erroresAy += e.message; });
    }
    const p = spawn(ffmpeg(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let errores = '';
    p.stderr.on('data', (d) => { errores = (errores + d).slice(-2000); });
    p.on('error', (e) => { errores += e.message; });
    p.stdin.on('error', () => { /* FFmpeg se cerró: lo avisa 'exit' */ });
    if (ay) {
      ay.stdout.pipe(p.stdin);
      ay.on('exit', (code) => { if (ayudante === ay) log(`El ayudante de audio se cerró (código ${code}): ${erroresAy.trim().split('\n').pop() ?? ''}`); });
    }
    // Prioridad baja: el juego siempre va primero.
    for (const x of [p, ay]) { try { if (x?.pid) os.setPriority(x.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sin permiso: sigue igual */ } }
    await dormir(2500);
    const audioCayo = ay && (ay.exitCode !== null || ay.killed);
    if (p.exitCode !== null || p.killed || audioCayo) {
      const quien = audioCayo ? `ayudante de audio: ${erroresAy.trim().split('\n').pop() ?? ''}` : errores.trim().split('\n').pop() ?? '';
      log(`La grabación no arrancó (${codificador.nombre}${audio ? ', con audio' : ''}): ${quien}`);
      for (const x of [ay, p]) { try { x?.kill(); } catch { /* nada */ } }
      return null;
    }
    return { p, ay, fps, getErrores: () => errores };
  }

  // Empieza a grabar el búfer en anillo. Devuelve false si FFmpeg no arrancó.
  // audio: { comando: [exe, ...args], pistas: ['Mezcla', 'Juego', …] } o null (sin sonido).
  // Si con audio no arranca, se intenta una vez sin audio (mejor un clip mudo que ninguno).
  async function iniciar({ codificador, calidad = 'alta', audio = null }) {
    await detener();
    let r = await arrancar({ codificador, calidad, audio });
    let conAudio = !!audio;
    if (!r && audio) {
      conAudio = false;
      r = await arrancar({ codificador, calidad, audio: null });
    }
    if (!r) return false;
    const { p, ay, fps } = r;
    proceso = p;
    ayudante = ay;
    actual = { codificador, calidad, desde: Date.now(), pid: p.pid, pidAudio: ay?.pid ?? null, pistas: conAudio ? audio.pistas : [] };
    p.on('exit', (code) => {
      if (proceso === p) {
        log(`FFmpeg se cerró solo (código ${code}): ${r.getErrores().trim().split('\n').pop() ?? ''}`);
        proceso = null;
        actual = null;
        try { ayudante?.kill(); } catch { /* nada */ }
        ayudante = null;
      }
    });
    log(`Grabando búfer: ${codificador.nombre}, calidad ${calidad} (${fps} fps), ${conAudio ? `audio: ${audio.pistas.join(' / ')}` : 'sin audio'}, pid ${p.pid}`);
    return true;
  }

  // Detiene la grabación. Si hay clips guardándose (Ctrl + F8 justo al final de la
  // partida), primero los deja terminar. Sin audio, FFmpeg se cierra con "q" (cierra
  // bien el trozo en curso); con audio se corta (el búfer se borra igual al terminar).
  async function detener() {
    await cola;
    const p = proceso;
    const ay = ayudante;
    proceso = null;
    ayudante = null;
    actual = null;
    if (ay && ay.exitCode === null) { try { ay.kill(); } catch { /* nada */ } }
    if (!p || p.exitCode !== null) return;
    if (!ay) { try { p.stdin.write('q'); } catch { /* ya cerrado */ } }
    const fin = Date.now() + (ay ? 1500 : 4000);
    while (p.exitCode === null && Date.now() < fin) await dormir(100);
    if (p.exitCode === null) { try { p.kill(); } catch { /* nada */ } }
  }

  // Trozos terminados, del más viejo al más nuevo, con su duración real y la hora
  // en que se cerraron. Con el anillo lleno, el trozo más viejo de la lista es el
  // mismo archivo que FFmpeg está reescribiendo ahora: nunca se usa (solo los
  // últimos anillo − 1).
  function trozosTerminados() {
    let filas = [];
    try { filas = fs.readFileSync(lista, 'utf8').trim().split(/\r?\n/).filter(Boolean); } catch { return []; }
    return filas.slice(-(anillo - 1)).map((f) => {
      const [archivo, inicio, fin] = f.split(',');
      const ruta = path.join(dirBufer, archivo);
      let cerrado = 0;
      try { cerrado = fs.statSync(ruta).mtimeMs; } catch { return null; }
      return { archivo: ruta, dur: Math.max(0, Number(fin) - Number(inicio)) || SEGUNDOS_TROZO, cerrado };
    }).filter(Boolean);
  }

  // Guarda un clip de `segundos` que termina en `fin` (ms; de fábrica, ahora).
  // Los guardados van de a uno, en cola.
  function guardar({ segundos, fin = Date.now(), destino }) {
    if (!proceso) return Promise.resolve({ ok: false, motivo: 'sin-grabar' });
    const pistas = actual?.pistas ?? [];
    enCola++;
    const tarea = cola.then(async () => {
      // Trozos cerrados hasta `fin` (+ medio trozo: el que contiene `fin` también vale).
      const trozos = trozosTerminados().filter((t) => t.cerrado <= fin + (SEGUNDOS_TROZO * 1000) / 2);
      if (!trozos.length) return { ok: false, motivo: 'sin-trozos' };
      const elegidos = [];
      let total = 0;
      for (let i = trozos.length - 1; i >= 0 && total < segundos; i--) {
        elegidos.unshift(trozos[i]);
        total += trozos[i].dur;
      }
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      // Los trozos .ts se pegan byte a byte (protocolo concat:), con sus marcas de tiempo
      // continuas: video y audio quedan exactamente como se grabaron. (El concat por
      // lista recoloca cada trozo según su duración y el audio se iba corriendo.)
      const entradaConcat = `concat:${elegidos.map((t) => t.archivo).join('|')}`;
      // Con audio: el AAC de los trozos .ts necesita otro envoltorio para ir en .mp4, y
      // cada pista lleva su nombre (Mezcla, Juego, Discord…) para los editores de video.
      const audioArgs = pistas.length
        ? ['-map', '0', '-bsf:a', 'aac_adtstoasc', ...pistas.flatMap((n, i) => [`-metadata:s:a:${i}`, `title=${n}`, `-metadata:s:a:${i}`, `handler_name=${n}`])] : [];
      const t0 = Date.now();
      const r = await correr(['-i', entradaConcat, '-c', 'copy', ...audioArgs, '-movflags', '+faststart', destino], 30000);
      const ok = r.ok && fs.existsSync(destino) && fs.statSync(destino).size > 0;
      if (ok) log(`Clip guardado: ${path.basename(destino)} (${total.toFixed(0)} s, ${(fs.statSync(destino).size / 1048576).toFixed(1)} MB) en ${((Date.now() - t0) / 1000).toFixed(2)} s`);
      else log(`No se pudo guardar el clip: ${r.error}`);
      return ok ? { ok: true, archivo: destino, segundos: Math.round(total) } : { ok: false, motivo: 'ffmpeg', error: r.error };
    }).finally(() => { enCola--; });
    cola = tarea.catch(() => {});
    return tarea;
  }

  // Foto de un clip para la galería (`en`: segundos desde el inicio).
  function miniatura(video, destino, en = 0) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    return correr(['-ss', String(Math.max(0, en)), '-i', video, '-frames:v', '1', '-vf', 'scale=384:-2', '-q:v', '4', destino], 20000)
      .then((r) => r.ok && fs.existsSync(destino));
  }

  return {
    detectarCodificador,
    iniciar,
    detener,
    guardar,
    miniatura,
    grabando: () => !!proceso,
    guardando: () => enCola > 0,
    estado: () => (actual ? { ...actual, codificador: actual.codificador.nombre } : null),
    trozosTerminados,
  };
}

module.exports = { crearMotorClips, argsAudio, relojVideo, CODIFICADORES, SEGUNDOS_TROZO, TROZOS_ANILLO, AUDIO_HZ };
