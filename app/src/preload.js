const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro: el renderer (la parte web) nunca toca Node directamente,
// solo puede llamar a estas funciones concretas.
contextBridge.exposeInMainWorld('sharkTracker', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  checkLiveGame: () => ipcRenderer.invoke('lcdata:check'),

  // Detección automática de partida
  getGameStatus: () => ipcRenderer.invoke('game:getStatus'),
  onGameStatus: (callback) => ipcRenderer.on('game:status', (_e, status) => callback(status)),

  // Sesión de Discord
  auth: {
    getState: () => ipcRenderer.invoke('auth:getState'),
    signIn: () => ipcRenderer.invoke('auth:signIn'),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
    onChanged: (callback) => ipcRenderer.on('auth:changed', (_e, state) => callback(state)),
    onError: (callback) => ipcRenderer.on('auth:error', (_e, message) => callback(message)),
  },
});
