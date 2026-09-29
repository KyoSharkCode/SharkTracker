const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const cfg = require('./config');
const auth = require('./auth');
const { crearEstadoPartida } = require('./game-state');
const ajustesOverlay = require('./overlay-config');

// La Live Client Data API de League usa un certificado autofirmado local,
// así que hay que decirle a Node que no lo rechace (127.0.0.1:2999, nunca sale de tu PC).
const liveClientAgent = new https.Agent({ rejectUnauthorized: false });

let mainWindow;
let pendingDeepLink = null; // enlace que llegó antes de que la ventana estuviera lista

// Nombre e identificador de la app en Windows (barra de tareas, notificaciones).
app.setName('SharkTracker');
if (process.platform === 'win32') app.setAppUserModelId('lol.sharktracker.app');

// ── Enlace sharktracker:// (vuelta del login de Discord) ──
// Windows abre el enlace lanzando OTRA copia de la app. Con el candado de
// instancia única, esa segunda copia se cierra y le pasa el enlace a la que
// ya está abierta (evento 'second-instance').
if (process.defaultApp) {
  // Modo desarrollo (npm start): hay que decirle a Windows cómo relanzar "electron ."
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(cfg.PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(cfg.PROTOCOL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = findDeepLink(argv);
    if (link) handleDeepLink(link);
    focusWindow();
  });
  // macOS entrega el enlace con este evento.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    createWindow();
    auth.onChange(() => sendAuthState());
    // En Windows, si la app estaba cerrada, el enlace llega en los argumentos.
    const link = findDeepLink(process.argv);
    if (link) handleDeepLink(link);
    startGameWatcher();
  });
}

function findDeepLink(argv) {
  return (argv ?? []).find((arg) => typeof arg === 'string' && arg.startsWith(`${cfg.PROTOCOL}://`)) ?? null;
}

async function handleDeepLink(url) {
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingDeepLink = url;
    return;
  }
  if (!url.startsWith(cfg.AUTH_REDIRECT)) return;
  try {
    await auth.handleCallback(url);
    await sendAuthState();
  } catch (e) {
    mainWindow.webContents.send('auth:error', e.message ?? String(e));
  }
  focusWindow();
}

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    frame: false, // dibujamos nuestra propia barra de título, como en el mockup
    title: 'SharkTracker',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#05070c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Al cerrar la ventana principal se cierra también el overlay (si no, la app seguiría viva).
  mainWindow.on('closed', () => {
    mainWindow = null;
    overlayWindow?.destroy();
    overlayWindow = null;
    editorWindow?.destroy();
    editorWindow = null;
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      handleDeepLink(link);
    }
  });
}

// --- Controles de la barra de título propia (–  □  ×) ---
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// --- Sesión de Discord ---
async function sendAuthState() {
  if (!mainWindow) return;
  try {
    mainWindow.webContents.send('auth:changed', await auth.getState());
  } catch (e) {
    mainWindow.webContents.send('auth:error', e.message ?? String(e));
  }
}
ipcMain.handle('auth:getState', () => auth.getState());
ipcMain.handle('auth:signIn', async () => {
  try {
    await auth.signIn();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message ?? String(e) };
  }
});
ipcMain.handle('auth:signOut', async () => {
  await auth.signOut();
  return auth.getState();
});

// --- Live Client Data API ---
// Pide una ruta de la API local de League. Si no hay partida, el puerto 2999
// no responde: eso es lo normal fuera de partida, no un error.
function liveClientGet(route, timeout = 1500) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://127.0.0.1:2999/liveclientdata/${route}`,
      { agent: liveClientAgent, timeout },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ inGame: res.statusCode === 200, data: JSON.parse(body) });
          } catch (e) {
            resolve({ inGame: false, error: 'Respuesta inesperada del cliente de LoL' });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ inGame: false, error: 'Sin respuesta — ¿está el cliente de LoL abierto y en partida?' });
    });
    req.on('error', () => {
      resolve({ inGame: false, error: 'No hay partida activa (o el cliente de LoL está cerrado)' });
    });
  });
}

// ¿Hay una partida en curso ahora mismo? (botón "Comprobar ahora")
ipcMain.handle('lcdata:check', () => liveClientGet('allgamedata'));

// Detección automática: cada 5 s se mira si hay partida y se avisa a la
// interfaz SOLO cuando cambia (entra o sale de partida).
let lastInGame = null;
let partidaTerminada = false; // acabó una partida y el juego sigue abierto: no es pantalla de carga
function startGameWatcher() {
  const tick = async () => {
    const { inGame } = await liveClientGet('gamestats', 1200);
    if (inGame !== lastInGame) {
      if (lastInGame === true && !inGame) partidaTerminada = true;
      lastInGame = inGame;
      mainWindow?.webContents.send('game:status', { inGame });
      if (inGame) { detenerCarga(); startOverlay(); } else stopOverlay();
    }
    // Pantalla de carga: el juego ya está abierto pero la API todavía no da datos.
    if (!inGame) {
      const abierto = await juegoAbierto();
      if (!abierto) {
        partidaTerminada = false;
        if (cargaActiva) detenerCarga();
      } else if (!partidaTerminada && !cargaActiva) {
        iniciarCarga();
      }
    }
  };
  tick();
  setInterval(tick, 5000);
}

// ¿Está abierto el juego? (el proceso de la partida, no el cliente de LoL).
// Se abre justo al empezar la pantalla de carga.
function juegoAbierto() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq League of Legends.exe', '/NH', '/FO', 'CSV'],
      { windowsHide: true, timeout: 3000 },
      (err, salida) => resolve(!err && /League of Legends\.exe/i.test(salida ?? '')));
  });
}

// ── Pantalla de carga ──
// Mientras carga la partida se pide el panel a la Edge Function pantalla-carga.
// Si llega incompleto (Riot ocupado, algún rango pendiente) se vuelve a pedir
// cada 15 s hasta completarlo o hasta que empiece la partida.
let cargaActiva = false;
let cargaTimer = null;
let cargaInicio = 0;
let ultimaCarga = null;
const CARGA_REINTENTO_MS = 15000;
const CARGA_MAX_MS = 5 * 60 * 1000;

function enviarCarga(datos) {
  ultimaCarga = datos ? { ...datos, ddVersion } : null;
  overlayWindow?.webContents.send('overlay:carga', ultimaCarga);
}
function iniciarCarga() {
  cargaActiva = true;
  cargaInicio = Date.now();
  cargarVersionDD();
  if (!overlayWindow) createOverlayWindow();
  overlayWindow.showInactive();
  enviarCarga({ estado: 'buscando' });
  pedirCarga();
}
async function pedirCarga() {
  clearTimeout(cargaTimer);
  if (!cargaActiva) return;
  let res;
  try {
    res = await auth.getPantallaCarga();
  } catch (e) {
    res = { estado: 'error' };
  }
  if (!cargaActiva) return; // empezó la partida mientras tanto
  // Si ya teníamos jugadores y esta vez Riot estaba ocupado, se mantiene lo que había.
  if (res?.estado !== 'ok' && ultimaCarga?.aliados) res = { ...ultimaCarga, estado: res?.estado ?? 'error' };
  enviarCarga(res);
  const terminado = (res?.estado === 'ok' && res.completo) || ['sin_sesion', 'sin_cuenta'].includes(res?.estado);
  if (!terminado && Date.now() - cargaInicio < CARGA_MAX_MS) {
    cargaTimer = setTimeout(pedirCarga, res?.estado === 'esperando' ? 5000 : CARGA_REINTENTO_MS);
  }
}
function detenerCarga() {
  cargaActiva = false;
  clearTimeout(cargaTimer);
  enviarCarga(null);
  if (!lastInGame) overlayWindow?.hide();
}

// ── Overlay en partida ──
// Ventana transparente del tamaño de la pantalla, siempre encima del juego y
// sin recibir clics (pasan al juego). League tiene que estar en modo
// "Sin bordes": en pantalla completa exclusiva Windows no deja dibujar encima.
let overlayWindow = null;
let overlayTimer = null;
let estadoPartida = null;

function createOverlayWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  overlayWindow = new BrowserWindow({
    ...bounds,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,     // nunca le quita el foco al juego
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  // Toda la pantalla, incluida la zona de la barra de tareas (el juego la tapa en "Sin bordes").
  overlayWindow.setBounds(bounds);
  overlayWindow.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  // Si el panel de carga se pidió antes de que el overlay terminara de abrir, se reenvía.
  overlayWindow.webContents.on('did-finish-load', () => {
    if (ultimaCarga) overlayWindow?.webContents.send('overlay:carga', ultimaCarga);
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

// Versión actual de Data Dragon (para los retratos de campeones del overlay).
// Se pide una vez por sesión de la app.
let ddVersion = null;
function cargarVersionDD() {
  if (ddVersion) return;
  https.get('https://ddragon.leagueoflegends.com/api/versions.json', { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => { try { ddVersion = JSON.parse(body)[0] ?? null; } catch { /* sin retratos: se usan iniciales */ } });
  }).on('error', () => { /* sin retratos: se usan iniciales */ });
}

// ── Tecla Tab (diferencia de oro) ──
// uiohook-napi "escucha" el teclado sin quitarle la tecla al juego (como el
// pulsar-para-hablar de Discord). Solo se enciende durante la partida y solo
// se mira la tecla Tab: el resto de teclas se ignoran y no se guardan.
let hook = null;
let tabPulsado = false;
function iniciarTab() {
  try {
    if (!hook) {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      const avisar = (pulsado) => {
        if (pulsado === tabPulsado) return;
        tabPulsado = pulsado;
        overlayWindow?.webContents.send('overlay:tab', pulsado);
      };
      uIOhook.on('keydown', (e) => { if (e.keycode === UiohookKey.Tab) avisar(true); });
      uIOhook.on('keyup', (e) => { if (e.keycode === UiohookKey.Tab) avisar(false); });
      hook = uIOhook;
    }
    hook.start();
  } catch (e) {
    console.error('No se pudo activar la detección de Tab (la diferencia de oro no se mostrará):', e);
    hook = null;
  }
}
function detenerTab() {
  try { hook?.stop(); } catch { /* ya estaba detenido */ }
  tabPulsado = false;
}

function startOverlay() {
  cargarVersionDD();
  if (!overlayWindow) createOverlayWindow();
  iniciarTab();
  estadoPartida = crearEstadoPartida();
  // "Tu rendimiento": promedios de la división de arriba (una vez por partida).
  const partida = estadoPartida;
  auth.getReferencia()
    .then((ref) => partida.setReferencia(ref))
    .catch((e) => console.error('No se pudieron cargar las referencias de rendimiento:', e));
  overlayWindow.showInactive();
  clearInterval(overlayTimer);
  // Cada segundo: leer la partida, calcular qué mostrar y mandárselo al overlay.
  overlayTimer = setInterval(async () => {
    const res = await liveClientGet('allgamedata');
    if (!res.inGame || !overlayWindow) return;
    overlayWindow.webContents.send('overlay:state', { ...estadoPartida.actualizar(res.data), ddVersion });
  }, 1000);
}

function stopOverlay() {
  detenerTab();
  clearInterval(overlayTimer);
  overlayTimer = null;
  estadoPartida = null;
  if (!cargaActiva) overlayWindow?.hide();
}
ipcMain.handle('game:getStatus', () => ({ inGame: !!lastInGame }));

// ── Ajustes → Overlay (qué piezas se ven y dónde van) ──
// Al guardar se avisa a todas las ventanas: el overlay se actualiza al instante,
// aunque estés en partida.
function avisarConfig(config) {
  overlayWindow?.webContents.send('overlay:config', config);
  mainWindow?.webContents.send('overlay:config', config);
}
ipcMain.handle('overlay-config:get', () => ajustesOverlay.leer());
ipcMain.handle('overlay-config:set', (_e, cambios) => {
  const config = ajustesOverlay.guardar(cambios);
  avisarConfig(config);
  return config;
});
ipcMain.handle('overlay-config:fabrica', () => ajustesOverlay.fabrica());

// ── Ventana "Reposicionar elementos" ──
// Emula la pantalla del juego para acomodar las piezas sin abrir una partida.
let editorWindow = null;
ipcMain.on('editor:abrir', () => {
  if (editorWindow) { editorWindow.focus(); return; }
  editorWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'SharkTracker — Reposicionar elementos',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#05070c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-editor.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  editorWindow.loadFile(path.join(__dirname, 'editor', 'index.html'));
  editorWindow.on('closed', () => { editorWindow = null; });
});
ipcMain.on('editor:cerrar', () => editorWindow?.close());
ipcMain.handle('editor:getFondo', () => ajustesOverlay.leerFondo());
ipcMain.handle('editor:elegirFondo', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(editorWindow, {
    title: 'Elige una captura de tu partida',
    properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (canceled || !filePaths[0]) return { cancelado: true };
  try {
    return { fondo: ajustesOverlay.guardarFondo(filePaths[0]) };
  } catch (e) {
    return { error: e.message ?? String(e) };
  }
});
ipcMain.handle('editor:quitarFondo', () => { ajustesOverlay.quitarFondo(); return null; });

app.on('will-quit', detenerTab);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
