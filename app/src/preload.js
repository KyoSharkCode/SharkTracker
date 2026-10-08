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
    buscarActualizacion: () => ipcRenderer.invoke('update:buscar'),
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
    adaptar: (ficha, miCampeon, rivales) => ipcRenderer.invoke('meta:adaptar', ficha, miCampeon, rivales),
    matchup: (championId, posicion, rivalId) => ipcRenderer.invoke('meta:matchup', championId, posicion, rivalId),
  },

  // En Vivo (selección de campeones)
  envivo: {
    estado: () => ipcRenderer.invoke('envivo:estado'),
    onEstado: (callback) => ipcRenderer.on('envivo:estado', (_e, estado) => callback(estado)),
    amigos: () => ipcRenderer.invoke('envivo:amigos'),
    importarRunas: (datos) => ipcRenderer.invoke('envivo:runas', datos),
    importarBuild: (datos) => ipcRenderer.invoke('envivo:build', datos),
    ponerHechizos: (ids) => ipcRenderer.invoke('envivo:hechizos', ids),
    // Partida en curso: panel de carga + build (para verla en la app, p. ej. en otro monitor).
    partida: () => ipcRenderer.invoke('partida:datos'),
    onPartida: (callback) => ipcRenderer.on('partida:datos', (_e, datos) => callback(datos)),
  },

  // Ajustes → Overlay
  overlayConfig: {
    get: () => ipcRenderer.invoke('overlay-config:get'),
    set: (cambios) => ipcRenderer.invoke('overlay-config:set', cambios),
    onChanged: (callback) => ipcRenderer.on('overlay:config', (_e, config) => callback(config)),
    abrirEditor: () => ipcRenderer.send('editor:abrir'),
  },

  // Ajustes → Apariencia y Notificaciones (userData/ajustes.json)
  ajustes: {
    get: () => ipcRenderer.invoke('ajustes:get'),
    set: (cambios) => ipcRenderer.invoke('ajustes:set', cambios),
    onChanged: (callback) => ipcRenderer.on('ajustes:changed', (_e, ajustes) => callback(ajustes)),
    probarAviso: () => ipcRenderer.invoke('ajustes:probarAviso'),
  },

  // Clips (sección Clips y Ajustes → Clips): FFmpeg, codificador, audio, galería y carpeta.
  // Ctrl + F8 y las jugadas automáticas viven en el proceso main. Los videos y
  // miniaturas se ven con sharkclip://video/<archivo> y sharkclip://mini/<archivo>.
  clips: {
    estado: () => ipcRenderer.invoke('clips:estado'),
    preparar: () => ipcRenderer.invoke('clips:preparar'),
    abrirCarpeta: (carpeta) => ipcRenderer.invoke('clips:abrirCarpeta', carpeta), // sin nada: Videos › SharkTracker
    dispositivos: () => ipcRenderer.invoke('clips:dispositivos'),
    probarAudio: () => ipcRenderer.invoke('clips:probarAudio'),
    galeria: () => ipcRenderer.invoke('clips:galeria'),
    favorito: (archivo, valor) => ipcRenderer.invoke('clips:favorito', archivo, valor),
    renombrar: (archivo, nombre) => ipcRenderer.invoke('clips:renombrar', archivo, nombre),
    borrar: (archivo) => ipcRenderer.invoke('clips:borrar', archivo),
    mostrar: (archivo) => ipcRenderer.invoke('clips:mostrar', archivo),
    onProgreso: (callback) => ipcRenderer.on('clips:progreso', (_e, p) => callback(p)),
    onGuardado: (callback) => ipcRenderer.on('clips:guardado', (_e, r) => callback(r)),
    onCambio: (callback) => ipcRenderer.on('clips:cambio', () => callback()),
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
