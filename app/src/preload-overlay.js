const { contextBridge, ipcRenderer } = require('electron');

// Puente del overlay: solo puede RECIBIR el estado de la partida (y si Tab está pulsado).
contextBridge.exposeInMainWorld('overlay', {
  onState: (callback) => ipcRenderer.on('overlay:state', (_e, state) => callback(state)),
  onTab: (callback) => ipcRenderer.on('overlay:tab', (_e, pulsado) => callback(pulsado)),
});
