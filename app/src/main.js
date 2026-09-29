const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const cfg = require('./config');
const auth = require('./auth');

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
function startGameWatcher() {
  const tick = async () => {
    const { inGame } = await liveClientGet('gamestats', 1200);
    if (inGame !== lastInGame) {
      lastInGame = inGame;
      mainWindow?.webContents.send('game:status', { inGame });
    }
  };
  tick();
  setInterval(tick, 5000);
}
ipcMain.handle('game:getStatus', () => ({ inGame: !!lastInGame }));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
