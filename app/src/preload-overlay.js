const { contextBridge, ipcRenderer } = require('electron');

// Puente del overlay: solo puede RECIBIR el estado de la partida, si Tab está
// pulsado, el panel de la pantalla de carga, la build (Ctrl + X) y los ajustes.
contextBridge.exposeInMainWorld('overlay', {
  onState: (callback) => ipcRenderer.on('overlay:state', (_e, state) => callback(state)),
  onTab: (callback) => ipcRenderer.on('overlay:tab', (_e, pulsado) => callback(pulsado)),
  onConfig: (callback) => ipcRenderer.on('overlay:config', (_e, config) => callback(config)),
  onCarga: (callback) => ipcRenderer.on('overlay:carga', (_e, datos) => callback(datos)),
  onBuild: (callback) => ipcRenderer.on('overlay:build', (_e, datos) => callback(datos)),
  getConfig: () => ipcRenderer.invoke('overlay-config:get'),
});
