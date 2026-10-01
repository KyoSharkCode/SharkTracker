// Ventana "Reposicionar elementos": emula la pantalla del juego (1920×1080,
// escalada a la ventana) con las piezas reales del overlay y datos de ejemplo.
// Arrastras cada pieza; al guardar, el overlay se actualiza al instante.
(() => {
  const byId = (id) => document.getElementById(id);
  const PIEZAS = { baron: 'Barón', ancestral: 'Ancestral', rendimiento: 'Tu rendimiento', avisos: 'Avisos', carga: 'Pantalla de carga', build: 'Build (Ctrl + X)', siguiente: 'Siguiente compra' };
  const escenario = byId('escenario');
  const marco = byId('marco');
  const caja = byId('caja');
  const coords = byId('coords');
  const estado = byId('estado');

  // ── Escala: la pantalla de 1920×1080 cabe entera en la ventana ──
  let escala = 1;
  function ajustarEscala() {
    const ancho = caja.clientWidth - 32;
    const alto = caja.clientHeight - 32;
    escala = Math.max(0.1, Math.min(ancho / 1920, alto / 1080));
    marco.style.width = `${1920 * escala}px`;
    marco.style.height = `${1080 * escala}px`;
    escenario.style.transform = `scale(${escala})`;
  }
  window.addEventListener('resize', ajustarEscala);
  ajustarEscala();

  // ── Datos de ejemplo (todas las piezas visibles) ──
  const ficha = (nombre, corto) => ({ nombre, corto, clave: null });
  const EJEMPLO = {
    baron: { tipo: 'baron', restante: 143, equipo: 'blue', esMio: true,
      titulares: [ficha('Ahri', 'AH'), ficha('Lee Sin', 'LS'), ficha('Jinx', 'JI'), ficha('Thresh', 'TH')] },
    ancestral: { tipo: 'ancestral', restante: 98, equipo: 'red', esMio: false,
      titulares: [ficha('Zed', 'ZE'), ficha('Vi', 'VI'), ficha('Kai\'Sa', 'KA')] },
    proximos: [{ clave: 'dragon', nombre: 'Dragón', falta: 79 }, { clave: 'baron', nombre: 'Barón', falta: 84 }],
    toast: { id: 'ejemplo', icono: 'dragon', tipo: 'Fire', titulo: 'Infernal tomado', equipo: 'blue', esMio: true,
      robado: false, puntos: { llenos: 2, total: 4 } },
    oro: [
      { diferencia: 700, aliado: 'Ahri', enemigo: 'Zed' }, { diferencia: -1250, aliado: 'Lee Sin', enemigo: 'Vi' },
      { diferencia: 30, aliado: 'Garen', enemigo: 'Darius' }, { diferencia: 1120, aliado: 'Jinx', enemigo: 'Kai\'Sa' },
      { diferencia: -400, aliado: 'Thresh', enemigo: 'Nautilus' }],
    aliadoIzquierda: true,
    siguiente: {
      componente: { id: 0, nombre: 'Códice diabólico', img: null, coste: 900, falta: 350 },
      objetivo: { id: 0, nombre: 'Morellonomicon', img: null, coste: 2150, falta: 1600 } },
    rendimiento: { division: 'Platino', rol: 'Mid', aviso: null, metricas: [
      { clave: 'oro', etiqueta: 'Oro / min', valor: '412', referencia: '400', arriba: true },
      { clave: 'cs', etiqueta: 'CS / min', valor: '6.8', referencia: '7.1', arriba: false },
      { clave: 'vision', etiqueta: 'Visión / min', valor: '0.74', referencia: '0.70', arriba: true },
      { clave: 'kp', etiqueta: 'Particip. en kills', valor: '48%', referencia: '55%', arriba: false }] },
  };

  const R = (tier, division, lp, victorias, derrotas, racha = false) => ({ cola: 'Solo/Duo', tier, division, lp, victorias, derrotas, racha });
  const EJEMPLO_CARGA = { estado: 'ok', completo: true, cola: 'Clasificatoria Solo/Duo',
    aliados: [
      { nombre: 'Galactic Shark#AYK', campeon: 'Briar', rango: R('GOLD', 'II', 41, 30, 25), main: true, sharktracker: true },
      { nombre: 'Aliado#LAN', campeon: 'Malphite', rango: R('SILVER', 'I', 12, 40, 42), main: false },
      { nombre: 'Aliado#123', campeon: 'Twisted Fate', rango: R('GOLD', 'III', 55, 61, 39, true), main: true },
      { nombre: 'Aliado#777', campeon: 'Jinx', rango: R('GOLD', 'IV', 8, 20, 26), main: null },
      { nombre: 'Aliado#SUP', campeon: 'Janna', rango: null, main: null }],
    rivales: [
      { nombre: 'Rival#1102', campeon: 'Zed', rango: R('GOLD', 'II', 60, 120, 98), main: true },
      { nombre: 'Rival#7788', campeon: 'Lillia', rango: R('GOLD', 'IV', 5, 24, 26), main: false },
      { nombre: 'Rival#3345', campeon: 'Vi', rango: R('SILVER', 'II', 70, 45, 41), main: null },
      { nombre: 'Rival#6620', campeon: 'Ezreal', rango: R('GOLD', 'I', 18, 80, 60, true), main: true },
      { nombre: 'Rival#9081', campeon: 'Morgana', rango: R('SILVER', 'III', 33, 30, 35), main: null }] };

  // ── Posiciones ──
  const posicionDe = (id) => ({ x: Math.round(parseFloat(byId(id).style.left) || byId(id).offsetLeft),
    y: Math.round(parseFloat(byId(id).style.top) || byId(id).offsetTop) });
  function aplicarPosiciones(posiciones) {
    window.__aplicarConfig({ visible: {}, posiciones });
  }

  // Build en partida de ejemplo (en el editor no hay íconos de objetos: solo cuadros).
  const obj = (nombre) => ({ id: 0, nombre, img: null });
  const EJEMPLO_BUILD = { visible: true, datos: { estado: 'ok', campeon: 'Ahri', rol: 'mid',
    resumen: '3,5 de daño físico · 1 tanque · se cura: Soraka',
    pasos: [
      { titulo: 'Inicio', items: [obj('Anillo de Doran'), obj('Poción de vida')] },
      { titulo: 'Core', items: [obj('Ecos de Luden'), obj('Sombrero mortal de Rabadon')] },
      { titulo: 'Botas', items: [obj('Botas de hechicero')] },
      { titulo: '4.º', adaptado: true, items: [obj('Morellonomicon')] },
      { titulo: '5.º', adaptado: true, items: [obj('Reloj de arena de Zhonya')] },
      { titulo: '6.º', items: [obj('Bastón del vacío')] }],
    motivos: [{ nombre: 'Morellonomicon', motivo: 'Soraka se cura mucho' }, { nombre: 'Reloj de arena de Zhonya', motivo: '3,5 rivales hacen daño físico' }] } };

  window.editor.getConfig().then((config) => {
    aplicarPosiciones(config.posiciones);
    window.__pintarEstado(EJEMPLO);
    window.__build(EJEMPLO_BUILD);
  });

  // ── Arrastrar ──
  let elegida = null;
  function elegir(id) {
    if (elegida) byId(elegida).classList.remove('elegida');
    elegida = id;
    if (id) byId(id).classList.add('elegida');
  }
  function mover(id, x, y) {
    const nodo = byId(id);
    const maxX = 1920 - nodo.offsetWidth;
    const maxY = 1080 - nodo.offsetHeight;
    const nx = Math.round(Math.min(Math.max(x, 0), Math.max(maxX, 0)));
    const ny = Math.round(Math.min(Math.max(y, 0), Math.max(maxY, 0)));
    nodo.style.left = `${nx}px`;
    nodo.style.top = `${ny}px`;
    // Etiqueta con la posición, justo encima de la pieza.
    coords.hidden = false;
    coords.textContent = `${PIEZAS[id]} · x ${nx} · y ${ny}`;
    coords.style.left = `${nx * escala}px`;
    coords.style.top = `${Math.max(ny * escala - 24, 0)}px`;
    estado.textContent = 'Cambios sin guardar.';
    estado.className = 'sub';
  }

  for (const id of Object.keys(PIEZAS)) {
    const nodo = byId(id);
    nodo.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      elegir(id);
      const inicio = { px: e.clientX, py: e.clientY, ...posicionDe(id) };
      nodo.setPointerCapture(e.pointerId);
      nodo.classList.add('arrastrando');
      const alMover = (ev) => mover(id, inicio.x + (ev.clientX - inicio.px) / escala, inicio.y + (ev.clientY - inicio.py) / escala);
      const alSoltar = () => {
        nodo.classList.remove('arrastrando');
        nodo.removeEventListener('pointermove', alMover);
        nodo.removeEventListener('pointerup', alSoltar);
        nodo.removeEventListener('pointercancel', alSoltar);
      };
      nodo.addEventListener('pointermove', alMover);
      nodo.addEventListener('pointerup', alSoltar);
      nodo.addEventListener('pointercancel', alSoltar);
    });
  }
  // Clic fuera de las piezas: se deselecciona.
  escenario.addEventListener('pointerdown', (e) => {
    if (!Object.keys(PIEZAS).some((id) => byId(id).contains(e.target))) { elegir(null); coords.hidden = true; }
  });

  // Flechas: 1 px (Shift: 10 px). Esc: cancelar.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { window.editor.cerrar(); return; }
    const paso = e.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
    if (!delta || !elegida) return;
    e.preventDefault();
    const p = posicionDe(elegida);
    mover(elegida, p.x + delta[0], p.y + delta[1]);
  });

  // ── Ver Tab: silueta del marcador + diferencia de oro ──
  let tabVisible = false;
  byId('btn-tab').addEventListener('click', () => {
    tabVisible = !tabVisible;
    byId('btn-tab').classList.toggle('on', tabVisible);
    byId('tab-silueta').hidden = !tabVisible;
    window.__tab(tabVisible);
  });

  // ── Ver pantalla de carga: el panel de carga en lugar de las piezas de la partida ──
  let cargaVisible = false;
  byId('btn-carga').addEventListener('click', () => {
    cargaVisible = !cargaVisible;
    byId('btn-carga').classList.toggle('on', cargaVisible);
    if (cargaVisible && tabVisible) byId('btn-tab').click();
    byId('btn-tab').disabled = cargaVisible;
    window.__pintarEstado(cargaVisible ? {} : EJEMPLO);
    window.__carga(cargaVisible ? EJEMPLO_CARGA : null);
    window.__build(cargaVisible ? null : EJEMPLO_BUILD); // la build es de la partida, no de la carga
    byId('avisos').hidden = cargaVisible; // en la pantalla de carga no hay avisos
    byId('hud').hidden = cargaVisible;
    byId('carga-silueta').hidden = !cargaVisible || !!byId('fondo').src;
    elegir(null);
    coords.hidden = true;
  });

  // ── Captura de fondo (opcional) ──
  function ponerFondo(dataUrl) {
    const img = byId('fondo');
    img.hidden = !dataUrl;
    if (dataUrl) img.src = dataUrl; else img.removeAttribute('src');
    escenario.classList.toggle('con-fondo', !!dataUrl);
    byId('btn-quitar-fondo').hidden = !dataUrl;
  }
  window.editor.getFondo().then(ponerFondo);
  byId('btn-fondo').addEventListener('click', async () => {
    const res = await window.editor.elegirFondo();
    if (res?.error) { estado.textContent = res.error; estado.className = 'sub bad'; return; }
    if (res?.fondo) ponerFondo(res.fondo);
  });
  byId('btn-quitar-fondo').addEventListener('click', async () => {
    await window.editor.quitarFondo();
    ponerFondo(null);
  });

  // ── Guardar / Restablecer / Cancelar ──
  byId('btn-guardar').addEventListener('click', async () => {
    const posiciones = Object.fromEntries(Object.keys(PIEZAS).map((id) => [id, posicionDe(id)]));
    try {
      await window.editor.guardarPosiciones(posiciones);
      window.editor.cerrar();
    } catch (e) {
      estado.textContent = `No se pudo guardar: ${e.message ?? e}`;
      estado.className = 'sub bad';
    }
  });
  byId('btn-restablecer').addEventListener('click', async () => {
    const { posiciones } = await window.editor.fabrica();
    aplicarPosiciones(posiciones);
    coords.hidden = true;
    elegir(null);
    estado.textContent = 'Posiciones de fábrica (pulsa Guardar para aplicarlas).';
    estado.className = 'sub';
  });
  byId('btn-cancelar').addEventListener('click', () => window.editor.cerrar());
})();
