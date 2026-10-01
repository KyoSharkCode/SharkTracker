// El código del overlay espera window.overlay (en el juego lo da preload-overlay.js).
// Aquí lo imitamos para poder mandarle datos de ejemplo desde editor.js.
window.overlay = {
  onState: (cb) => { window.__pintarEstado = cb; },
  onTab: (cb) => { window.__tab = cb; },
  onConfig: (cb) => { window.__aplicarConfig = cb; },
  onCarga: (cb) => { window.__carga = cb; },
  onBuild: (cb) => { window.__build = cb; },
};
