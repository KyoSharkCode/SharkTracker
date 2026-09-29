const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

// La Live Client Data API de League usa un certificado autofirmado local,
// así que hay que decirle a Node que no lo rechace (127.0.0.1:2999, nunca sale de tu PC).
const liveClientAgent = new https.Agent({ rejectUnauthorized: false });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    frame: false, // dibujamos nuestra propia barra de título, como en el mockup
    backgroundColor: '#05070c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// --- Controles de la barra de título propia (–  □  ×) ---
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// --- Live Client Data API: ¿hay una partida en curso ahora mismo? ---
ipcMain.handle('lcdata:check', () => {
  return new Promise((resolve) => {
    const req = https.get(
      'https://127.0.0.1:2999/liveclientdata/allgamedata',
      { agent: liveClientAgent, timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ inGame: true, data: JSON.parse(body) });
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
      // Esto es lo normal cuando NO estás en partida: el puerto 2999 no responde.
      resolve({ inGame: false, error: 'No hay partida activa (o el cliente de LoL está cerrado)' });
    });
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
