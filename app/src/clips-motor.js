// Motor de clips (C1): búfer en anillo + guardar los últimos segundos.
// Sin Electron (se prueba en Node con una fuente de prueba de FFmpeg).
//
// Cómo funciona:
// - Durante la partida, FFmpeg captura la pantalla por la GPU (ddagrab) y la
//   comprime por hardware. El video se guarda en trozos de 2 s que se pisan en
//   anillo (TROZOS_ANILLO trozos = 80 s), así el disco nunca crece.
// - FFmpeg anota cada trozo terminado en una lista (csv: archivo, inicio, fin).
// - Guardar = esperar los segundos de "después", elegir los trozos que cubren
//   antes + después y pegarlos sin recodificar (-c copy): tarda ~1 s.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SEGUNDOS_TROZO = 2;
const TROZOS_ANILLO = 40; // 80 s: alcanza para 30 s antes + 30 s después y el trozo en curso
const BITRATE = { alta: ['-b:v', '15M', '-maxrate', '25M', '-bufsize', '30M'], ligera: ['-b:v', '6M', '-maxrate', '10M', '-bufsize', '12M'] };
const FPS = { alta: 60, ligera: 30 };

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
// (Linux) se cambia por una fuente sintética con `entrada`.
const entradaPantalla = (fps) => ['-f', 'lavfi', '-i', `ddagrab=output_idx=0:framerate=${fps}`];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function crearMotorClips({ dir, ffmpeg, log = () => {}, entrada = entradaPantalla, codificadores = CODIFICADORES, anillo = TROZOS_ANILLO }) {
  const dirBufer = path.join(dir, 'bufer');
  const lista = path.join(dirBufer, 'lista.csv');
  let proceso = null;
  let actual = null; // { codificador, calidad, desde }
  let guardando = null;

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

  // Empieza a grabar el búfer en anillo. Devuelve false si FFmpeg no arrancó.
  async function iniciar({ codificador, calidad = 'alta' }) {
    await detener();
    fs.rmSync(dirBufer, { recursive: true, force: true });
    fs.mkdirSync(dirBufer, { recursive: true });
    const fps = FPS[calidad] ?? 60;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', ...entrada(fps), ...codificador.vf, ...codificador.c,
      ...(BITRATE[calidad] ?? BITRATE.alta), '-g', String(fps * SEGUNDOS_TROZO),
      '-f', 'segment', '-segment_time', String(SEGUNDOS_TROZO), '-segment_wrap', String(anillo),
      '-reset_timestamps', '1', '-segment_format', 'mpegts',
      '-segment_list', lista, '-segment_list_type', 'csv', '-segment_list_size', String(anillo),
      path.join(dirBufer, 'trozo%03d.ts')];
    const p = spawn(ffmpeg(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let errores = '';
    p.stderr.on('data', (d) => { errores = (errores + d).slice(-2000); });
    p.on('error', (e) => { errores += e.message; });
    proceso = p;
    actual = { codificador, calidad, desde: Date.now(), pid: p.pid };
    // Prioridad baja: el juego siempre va primero.
    try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sin permiso: sigue igual */ }
    await dormir(2500);
    if (p.exitCode !== null || p.killed) {
      log(`FFmpeg se cerró al empezar (${codificador.nombre}): ${errores.trim().split('\n').pop() ?? ''}`);
      proceso = null;
      actual = null;
      return false;
    }
    p.on('exit', (code) => {
      if (proceso === p) {
        log(`FFmpeg se cerró solo (código ${code}): ${errores.trim().split('\n').pop() ?? ''}`);
        proceso = null;
        actual = null;
      }
    });
    log(`Grabando búfer: ${codificador.nombre}, calidad ${calidad} (${fps} fps), pid ${p.pid}`);
    return true;
  }

  // Detiene FFmpeg con "q" (cierra bien el trozo en curso); si no responde, lo mata.
  // Si hay un clip guardándose (Ctrl + F8 justo al final de la partida), primero
  // lo deja terminar: así esos segundos "después" también se graban.
  async function detener() {
    if (guardando) await guardando.catch(() => {});
    const p = proceso;
    proceso = null;
    actual = null;
    if (!p || p.exitCode !== null) return;
    try { p.stdin.write('q'); } catch { /* ya cerrado */ }
    const fin = Date.now() + 4000;
    while (p.exitCode === null && Date.now() < fin) await dormir(100);
    if (p.exitCode === null) { try { p.kill(); } catch { /* nada */ } }
  }

  // Trozos terminados, del más viejo al más nuevo, con su duración real.
  // Con el anillo lleno, el trozo más viejo de la lista es el mismo archivo que
  // FFmpeg está reescribiendo ahora: nunca se usa (solo los últimos anillo − 1).
  function trozosTerminados() {
    let filas = [];
    try { filas = fs.readFileSync(lista, 'utf8').trim().split(/\r?\n/).filter(Boolean); } catch { return []; }
    return filas.slice(-(anillo - 1)).map((f) => {
      const [archivo, inicio, fin] = f.split(',');
      return { archivo: path.join(dirBufer, archivo), dur: Math.max(0, Number(fin) - Number(inicio)) || SEGUNDOS_TROZO };
    }).filter((t) => fs.existsSync(t.archivo));
  }

  // Guarda un clip: espera `despues` s y pega los trozos que cubren antes + después.
  // `destino`: ruta del .mp4. Un solo guardado a la vez (el atajo pulsado dos veces
  // seguidas no hace dos clips iguales).
  async function guardar({ antes = 20, despues = 15, destino }) {
    if (!proceso) return { ok: false, motivo: 'sin-grabar' };
    if (guardando) return { ok: false, motivo: 'ocupado' };
    guardando = (async () => {
      await dormir(despues * 1000 + (SEGUNDOS_TROZO + 0.5) * 1000); // que se cierre el último trozo
      const trozos = trozosTerminados();
      if (!trozos.length) return { ok: false, motivo: 'sin-trozos' };
      const elegidos = [];
      let total = 0;
      for (let i = trozos.length - 1; i >= 0 && total < antes + despues; i--) {
        elegidos.unshift(trozos[i]);
        total += trozos[i].dur;
      }
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      const listaConcat = path.join(dir, 'concat.txt');
      fs.writeFileSync(listaConcat, elegidos.map((t) => `file '${t.archivo.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      const t0 = Date.now();
      const r = await correr(['-f', 'concat', '-safe', '0', '-i', listaConcat, '-c', 'copy', '-movflags', '+faststart', destino], 30000);
      const ok = r.ok && fs.existsSync(destino) && fs.statSync(destino).size > 0;
      if (ok) log(`Clip guardado: ${path.basename(destino)} (${total.toFixed(0)} s, ${(fs.statSync(destino).size / 1048576).toFixed(1)} MB) en ${((Date.now() - t0) / 1000).toFixed(2)} s`);
      else log(`No se pudo guardar el clip: ${r.error}`);
      return ok ? { ok: true, archivo: destino, segundos: Math.round(total) } : { ok: false, motivo: 'ffmpeg', error: r.error };
    })();
    try { return await guardando; } finally { guardando = null; }
  }

  return {
    detectarCodificador,
    iniciar,
    detener,
    guardar,
    grabando: () => !!proceso,
    estado: () => (actual ? { ...actual, codificador: actual.codificador.nombre } : null),
    trozosTerminados,
  };
}

module.exports = { crearMotorClips, CODIFICADORES, SEGUNDOS_TROZO, TROZOS_ANILLO };
