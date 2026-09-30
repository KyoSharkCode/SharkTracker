// Conexión con el cliente de League (LCU): la API local que el cliente abre en
// tu PC (127.0.0.1, puerto y contraseña distintos cada vez que se abre).
// Corre en el proceso main.
//
// - Mira cada pocos segundos si el cliente está abierto y en qué fase está
//   (sala, cola, selección de campeones, partida…).
// - En selección de campeones lee la sesión cada segundo y avisa a la app
//   SOLO cuando algo cambió (quién eligió, baneos, tiempo…).
// - Acciones que decide el usuario con un botón: crear la página de runas,
//   el set de objetos y poner los hechizos. Nunca se hace nada solo.
//
// Privacidad: en ranked el cliente oculta los nombres de los aliados; aquí se
// respeta (solo se pasa el nombre si el cliente lo marca como visible).

const https = require('https');
const fs = require('fs');
const { execFile } = require('child_process');

// El cliente usa un certificado autofirmado local (nunca sale de tu PC).
const agente = new https.Agent({ rejectUnauthorized: false });

const POS = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support' };
const PREFIJO = 'SharkTracker';
const DESTELLO = 4;

let conexion = null;       // { port, token }
let ultimo = null;         // último estado enviado (JSON) para avisar solo si cambia
let estadoActual = { conectado: false };
let cola = null;           // queueId de la selección actual
let aviso = () => {};
let timer = null;

// ── Encontrar el cliente ──
// 1) Línea de comandos de LeagueClientUx.exe (sirve instale donde instale).
// 2) El archivo "lockfile" en la carpeta por defecto.
function lineaDeComandos() {
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
    { windowsHide: true, timeout: 6000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}
async function buscarCliente() {
  const linea = await lineaDeComandos();
  const port = linea.match(/--app-port=(\d+)/)?.[1];
  const token = linea.match(/--remoting-auth-token=([\w-]+)/)?.[1];
  if (port && token) return { port, token };
  for (const f of ['C:\\Riot Games\\League of Legends\\lockfile', '/Applications/League of Legends.app/Contents/LoL/lockfile']) {
    try {
      const [, , p, t] = fs.readFileSync(f, 'utf8').split(':');
      if (p && t) return { port: p, token: t };
    } catch { /* no está ahí */ }
  }
  return null;
}

// ── Pedir algo al cliente ── → { status, data } (status 0 = el cliente no respondió)
function pedir(metodo, ruta, cuerpo) {
  return new Promise((resolve) => {
    if (!conexion) return resolve({ status: 0 });
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = https.request({
      host: '127.0.0.1', port: conexion.port, path: ruta, method: metodo, agent: agente, timeout: 4000,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`riot:${conexion.token}`).toString('base64'),
        Accept: 'application/json',
        ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch { data = body; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// ── Sesión de selección → lo que dibuja la app ──
function normalizar(s) {
  const miCelda = s.localPlayerCellId;
  const acciones = (s.actions ?? []).flat();
  const celdas = (equipo) => new Set((equipo ?? []).map((p) => p.cellId));
  const nuestras = celdas(s.myTeam);
  const suyas = celdas(s.theirTeam);
  const bansDe = (lado, lista) => ((lista ?? []).filter((id) => id > 0).length
    ? lista.filter((id) => id > 0)
    : acciones.filter((a) => a.type === 'ban' && a.completed && a.championId > 0 && lado.has(a.actorCellId)).map((a) => a.championId));

  const yo = (s.myTeam ?? []).find((p) => p.cellId === miCelda) ?? {};
  const miPick = acciones.find((a) => a.actorCellId === miCelda && a.type === 'pick');
  const visible = (p) => (p.nameVisibilityType ? p.nameVisibilityType === 'VISIBLE' : !!p.gameName);

  return {
    conectado: true,
    fase: 'ChampSelect',
    cola,
    etapa: s.timer?.phase ?? null,                 // PLANNING / BAN_PICK / FINALIZATION
    segundos: Math.max(0, Math.round((s.timer?.adjustedTimeLeftInPhase ?? 0) / 1000)),
    yo: {
      campeon: yo.championId || null,
      intencion: yo.championPickIntent || null,
      rol: POS[yo.assignedPosition] ?? null,
      bloqueado: miPick ? !!miPick.completed : !!yo.championId,
      hechizos: [yo.spell1Id ?? null, yo.spell2Id ?? null],
    },
    aliados: (s.myTeam ?? []).filter((p) => p.cellId !== miCelda).map((p) => ({
      campeon: p.championId || null,
      intencion: p.championPickIntent || null,
      rol: POS[p.assignedPosition] ?? null,
      nombre: visible(p) && p.gameName ? `${p.gameName}#${p.tagLine ?? ''}` : null,
    })),
    rivales: (s.theirTeam ?? []).map((p) => ({ campeon: p.championId || null, rol: POS[p.assignedPosition] ?? null })),
    bans: { nuestros: bansDe(nuestras, s.bans?.myTeamBans), suyos: bansDe(suyas, s.bans?.theirTeamBans) },
  };
}

function emitir(estado) {
  estadoActual = estado;
  const json = JSON.stringify(estado);
  if (json === ultimo) return;
  ultimo = json;
  aviso(estado);
}

async function vuelta() {
  let espera = 5000;
  try {
    if (!conexion) conexion = await buscarCliente();
    if (!conexion) {
      emitir({ conectado: false });
    } else {
      const fase = await pedir('GET', '/lol-gameflow/v1/gameflow-phase');
      if (fase.status === 0) {
        conexion = null; // se cerró el cliente
        emitir({ conectado: false });
      } else if (fase.data !== 'ChampSelect') {
        cola = null;
        emitir({ conectado: true, fase: typeof fase.data === 'string' ? fase.data : 'None' });
        espera = 3000;
      } else {
        if (cola == null) {
          const sesion = await pedir('GET', '/lol-gameflow/v1/session');
          cola = sesion.data?.gameData?.queue?.id ?? 0;
        }
        const s = await pedir('GET', '/lol-champ-select/v1/session');
        if (s.status === 200 && s.data) emitir(normalizar(s.data));
        espera = 1000;
      }
    }
  } catch (e) {
    console.error('[lcu]', e);
  }
  timer = setTimeout(vuelta, espera);
}

function iniciar(callback) {
  aviso = callback;
  if (!timer) vuelta();
}

// ── Acciones (siempre con un botón del usuario) ──

// Página de runas "SharkTracker · Campeón": borra la anterior de SharkTracker (tus páginas no se tocan).
async function importarRunas({ nombre, principal, secundaria, runas }) {
  if (!conexion) return { ok: false, error: 'El cliente de LoL no está abierto.' };
  const paginas = await pedir('GET', '/lol-perks/v1/pages');
  for (const p of Array.isArray(paginas.data) ? paginas.data : []) {
    if (String(p.name ?? '').startsWith(PREFIJO) && p.isDeletable !== false) await pedir('DELETE', `/lol-perks/v1/pages/${p.id}`);
  }
  const r = await pedir('POST', '/lol-perks/v1/pages', {
    name: `${PREFIJO} · ${nombre}`.slice(0, 25), primaryStyleId: principal, subStyleId: secundaria,
    selectedPerkIds: runas, current: true,
  });
  if (r.status >= 200 && r.status < 300) return { ok: true };
  const msg = String(r.data?.message ?? '');
  return { ok: false, error: /max|limit|full/i.test(msg)
    ? 'No hay espacio para otra página de runas: borra una en el cliente y vuelve a intentarlo.'
    : `El cliente no aceptó la página (${r.status || 'sin respuesta'}).` };
}

// Set de objetos "SharkTracker · Campeón" (se ve en la tienda del juego). Reemplaza el anterior de SharkTracker.
async function importarBuild({ championId, titulo, bloques }) {
  if (!conexion) return { ok: false, error: 'El cliente de LoL no está abierto.' };
  const inv = await pedir('GET', '/lol-summoner/v1/current-summoner');
  const summonerId = inv.data?.summonerId;
  if (!summonerId) return { ok: false, error: 'No se encontró tu invocador en el cliente.' };
  const actual = await pedir('GET', `/lol-item-sets/v1/item-sets/${summonerId}/sets`);
  const datos = actual.data && typeof actual.data === 'object' ? actual.data : {};
  const sets = (datos.itemSets ?? []).filter((s) => !String(s.title ?? '').startsWith(PREFIJO));
  sets.unshift({
    title: `${PREFIJO} · ${titulo}`, type: 'custom', map: 'any', mode: 'any', sortrank: 0, startedFrom: 'blank',
    associatedChampions: [championId], associatedMaps: [11], preferredItemSlots: [],
    uid: `sharktracker-${championId}-${Date.now()}`,
    blocks: bloques.filter((b) => b.items.length).map((b) => ({
      type: b.titulo, hideIfSummonerSpell: '', showIfSummonerSpell: '',
      items: b.items.map((id) => ({ id: String(id), count: 1 })),
    })),
  });
  const r = await pedir('PUT', `/lol-item-sets/v1/item-sets/${summonerId}/sets`, { ...datos, itemSets: sets, timestamp: Date.now() });
  return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: `El cliente no aceptó el set (${r.status || 'sin respuesta'}).` };
}

// Hechizos recomendados. Si ya llevas Destello en una tecla (D o F), se queda en esa tecla.
async function ponerHechizos(recomendados) {
  if (!conexion) return { ok: false, error: 'El cliente de LoL no está abierto.' };
  const [actual1, actual2] = estadoActual?.yo?.hechizos ?? [];
  let [a, b] = recomendados;
  if (recomendados.includes(DESTELLO)) {
    const otro = recomendados.find((x) => x !== DESTELLO);
    if (actual2 === DESTELLO) [a, b] = [otro, DESTELLO];
    else if (actual1 === DESTELLO) [a, b] = [DESTELLO, otro];
  }
  const r = await pedir('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id: a, spell2Id: b });
  return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: `El cliente no aceptó los hechizos (${r.status || 'sin respuesta'}).` };
}

module.exports = { iniciar, estado: () => estadoActual, importarRunas, importarBuild, ponerHechizos, normalizar };
