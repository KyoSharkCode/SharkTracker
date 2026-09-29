const { contextBridge, ipcRenderer } = require('electron');

// Puente del overlay: solo puede RECIBIR el estado de la partida para dibujarlo.
contextBridge.exposeInMainWorld('overlay', {
  onState: (callback) => ipcRenderer.on('overlay:state', (_e, state) => callback(state)),
});
