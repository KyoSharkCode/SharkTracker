const { contextBridge, ipcRenderer } = require('electron');

// Puente de la ventana "Reposicionar elementos": leer/guardar posiciones,
// elegir o quitar la captura de fondo y cerrar la ventana.
contextBridge.exposeInMainWorld('editor', {
  getConfig: () => ipcRenderer.invoke('overlay-config:get'),
  guardarPosiciones: (posiciones) => ipcRenderer.invoke('overlay-config:set', { posiciones }),
  fabrica: () => ipcRenderer.invoke('overlay-config:fabrica'),
  getFondo: () => ipcRenderer.invoke('editor:getFondo'),
  elegirFondo: () => ipcRenderer.invoke('editor:elegirFondo'),
  quitarFondo: () => ipcRenderer.invoke('editor:quitarFondo'),
  cerrar: () => ipcRenderer.send('editor:cerrar'),
});
