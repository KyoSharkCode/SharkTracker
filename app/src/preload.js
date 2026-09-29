const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro: el renderer (la parte web) nunca toca Node directamente,
// solo puede llamar a estas funciones concretas.
contextBridge.exposeInMainWorld('tuTracker', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  checkLiveGame: () => ipcRenderer.invoke('lcdata:check')
});
