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

  // Versión y actualizaciones automáticas
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    estadoActualizacion: () => ipcRenderer.invoke('update:estado'),
    onActualizacion: (callback) => ipcRenderer.on('update:estado', (_e, estado) => callback(estado)),
    instalarActualizacion: () => ipcRenderer.send('update:instalar'),
  },

  // Mi Perfil
  perfil: {
    get: () => ipcRenderer.invoke('perfil:get'),
    cache: () => ipcRenderer.invoke('perfil:cache'),
  },

  // Meta
  meta: {
    tier: () => ipcRenderer.invoke('meta:tier'),
    campeon: (championId, posicion) => ipcRenderer.invoke('meta:campeon', championId, posicion),
  },

  // En Vivo (selección de campeones)
  envivo: {
    estado: () => ipcRenderer.invoke('envivo:estado'),
    onEstado: (callback) => ipcRenderer.on('envivo:estado', (_e, estado) => callback(estado)),
    amigos: () => ipcRenderer.invoke('envivo:amigos'),
    importarRunas: (datos) => ipcRenderer.invoke('envivo:runas', datos),
    importarBuild: (datos) => ipcRenderer.invoke('envivo:build', datos),
    ponerHechizos: (ids) => ipcRenderer.invoke('envivo:hechizos', ids),
  },

  // Ajustes → Overlay
  overlayConfig: {
    get: () => ipcRenderer.invoke('overlay-config:get'),
    set: (cambios) => ipcRenderer.invoke('overlay-config:set', cambios),
    onChanged: (callback) => ipcRenderer.on('overlay:config', (_e, config) => callback(config)),
    abrirEditor: () => ipcRenderer.send('editor:abrir'),
  },

  // Sesión de Discord
  auth: {
    getState: () => ipcRenderer.invoke('auth:getState'),
    signIn: () => ipcRenderer.invoke('auth:signIn'),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
    onChanged: (callback) => ipcRenderer.on('auth:changed', (_e, state) => callback(state)),
    onError: (callback) => ipcRenderer.on('auth:error', (_e, message) => callback(message)),
  },
});
