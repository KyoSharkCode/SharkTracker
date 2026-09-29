const { contextBridge, ipcRenderer } = require('electron');

// Puente del overlay: solo puede RECIBIR el estado de la partida, si Tab está
// pulsado y los ajustes (qué piezas se ven y dónde van).
contextBridge.exposeInMainWorld('overlay', {
  onState: (callback) => ipcRenderer.on('overlay:state', (_e, state) => callback(state)),
  onTab: (callback) => ipcRenderer.on('overlay:tab', (_e, pulsado) => callback(pulsado)),
  onConfig: (callback) => ipcRenderer.on('overlay:config', (_e, config) => callback(config)),
  getConfig: () => ipcRenderer.invoke('overlay-config:get'),
});
