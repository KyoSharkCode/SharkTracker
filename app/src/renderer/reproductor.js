// Reproductor de clips de SharkTracker (v1.0.2). Reemplaza los controles del navegador,
// que no dejaban pasar al clip siguiente ni marcar el favorito desde el video.
// Lo usan la timeline de la partida y el visor de clips sueltos (clips.js).
//
//   const rep = crearReproductor({ alAnterior, alSiguiente, alFavorito });
//   rep.raiz   → el nodo a poner en la página
//   rep.video  → el <video> (para escuchar sus eventos o cambiarle el archivo)
//   rep.fijar({ favorito, hayAnterior, haySiguiente, momento })  → estado de los botones
//   rep.soltar()  → al quitarlo de la página (deja de escuchar el teclado)
//
// Controles: anterior · reproducir/pausa · siguiente · tiempo · favorito · volumen ·
// velocidad (para ver una jugada despacio) · pantalla completa. La barra de avance marca
// el momento de la jugada. Teclado (con la sección de Clips a la vista y sin estar
// escribiendo): Espacio o K, ← → (5 s), Mayús + ← → (clip anterior / siguiente), F, M.
// Los atajos no animan nada: responden al instante.
(() => {
  const ICONOS = {
    play: 'M8 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z',
    pausa: 'M7.6 5h2.8c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6H7.6a.6.6 0 0 1-.6-.6V5.6c0-.3.3-.6.6-.6zM13.6 5h2.8c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6h-2.8a.6.6 0 0 1-.6-.6V5.6c0-.3.3-.6.6-.6z',
    anterior: 'M6.6 5h1.8c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6H6.6a.6.6 0 0 1-.6-.6V5.6c0-.3.3-.6.6-.6zM19 5.7v12.6a.6.6 0 0 1-.9.5l-9-6.3a.6.6 0 0 1 0-1l9-6.3a.6.6 0 0 1 .9.5z',
    siguiente: 'M15.6 5h1.8c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6h-1.8a.6.6 0 0 1-.6-.6V5.6c0-.3.3-.6.6-.6zM5 5.7v12.6c0 .5.5.8.9.5l9-6.3a.6.6 0 0 0 0-1l-9-6.3a.6.6 0 0 0-.9.5z',
    sonido: 'M4.6 9h3l4.4-3.6c.4-.3 1-.1 1 .5v12.2c0 .6-.6.8-1 .5L7.6 15h-3a.6.6 0 0 1-.6-.6V9.6c0-.3.3-.6.6-.6zM15.5 8.6a4.6 4.6 0 0 1 0 6.8l-.9-1a3.2 3.2 0 0 0 0-4.8zM17.7 6.4a7.6 7.6 0 0 1 0 11.2l-1-1a6.2 6.2 0 0 0 0-9.2z',
    mudo: 'M4.6 9h3l4.4-3.6c.4-.3 1-.1 1 .5v12.2c0 .6-.6.8-1 .5L7.6 15h-3a.6.6 0 0 1-.6-.6V9.6c0-.3.3-.6.6-.6zM15.4 9.5l1-1 1.8 1.9 1.9-1.900 1 1-1.900 1.900 1.900 1.900-1 1-1.900-1.900-1.800 1.900-1-1 1.900-1.900z',
    completa: 'M5 5h5v1.800H6.800V10H5zM14 5h5v5h-1.800V6.800H14zM5 14h1.800v3.200H10V19H5zM17.200 14H19v5h-5v-1.800h3.200z',
    estrella: 'M12 3.200l2.600 5.400 5.900.800-4.300 4.100 1 5.900L12 16.600l-5.200 2.800 1-5.900L3.500 9.400l5.900-.800z',
  };
  const VELOCIDADES = [1, 0.5, 0.25];
  const SALTO = 5;          // segundos de ← →
  const ESCONDER_MS = 2400; // sin mover el ratón mientras reproduce, la barra se va

  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined) n.textContent = texto;
    return n;
  };
  function icono(nombre) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONOS[nombre]);
    s.append(p);
    return s;
  }
  const reloj = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  const recordar = (clave, valor) => { try { localStorage.setItem(clave, String(valor)); } catch { /* vale solo ahora */ } };
  const recordado = (clave) => { try { return localStorage.getItem(clave); } catch { return null; } };

  function crearReproductor({ alAnterior = () => {}, alSiguiente = () => {}, alFavorito = () => {} } = {}) {
    const raiz = el('div', 'rep pausado');
    const video = el('video', 'rep-video');
    video.preload = 'auto';
    video.playsInline = true;
    const centro = el('button', 'rep-centro');
    centro.type = 'button';
    centro.setAttribute('aria-label', 'Reproducir');
    centro.append(icono('play'));

    const boton = (nombre, etiqueta, cls = '') => {
      const b = el('button', `rep-btn ${cls}`.trim());
      b.type = 'button';
      b.setAttribute('aria-label', etiqueta);
      b.title = etiqueta;
      b.append(icono(nombre));
      return b;
    };
    const poner = (b, nombre, etiqueta) => { b.replaceChildren(icono(nombre)); b.setAttribute('aria-label', etiqueta); b.title = etiqueta; };

    // Barra de avance: un deslizador de 0 a 1000 con el momento de la jugada marcado.
    const linea = el('div', 'rep-linea');
    const avance = el('input', 'rep-avance');
    avance.type = 'range';
    avance.min = '0'; avance.max = '1000'; avance.step = '1'; avance.value = '0';
    avance.setAttribute('aria-label', 'Avance del clip');
    const marca = el('span', 'rep-marca');
    marca.title = 'Momento de la jugada';
    marca.hidden = true;
    linea.append(avance, marca);

    const anterior = boton('anterior', 'Clip anterior (Mayús + ←)');
    const play = boton('play', 'Reproducir (Espacio)', 'rep-play');
    const siguiente = boton('siguiente', 'Clip siguiente (Mayús + →)');
    const tiempo = el('span', 'rep-tiempo', '0:00 / 0:00');
    const favorito = el('button', 'rep-fav');
    favorito.type = 'button';
    favorito.append(icono('estrella'), el('span', null, 'Favorito'));
    const mudo = boton('sonido', 'Silenciar (M)');
    const volumen = el('input', 'rep-volumen');
    volumen.type = 'range';
    volumen.min = '0'; volumen.max = '100'; volumen.step = '5';
    volumen.setAttribute('aria-label', 'Volumen');
    const velocidad = el('button', 'rep-btn rep-vel', '1×');
    velocidad.type = 'button';
    velocidad.title = 'Velocidad: para ver la jugada despacio';
    velocidad.setAttribute('aria-label', 'Velocidad de reproducción');
    const completa = boton('completa', 'Pantalla completa (doble clic)');

    const fila = el('div', 'rep-fila');
    fila.append(anterior, play, siguiente, tiempo, el('span', 'rep-hueco'), favorito, mudo, volumen, velocidad, completa);
    const barra = el('div', 'rep-barra');
    barra.append(linea, fila);
    raiz.append(video, centro, barra);

    // ── Reproducir y pausar ──
    const alternar = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
    const pintarPlay = () => {
      const pausado = video.paused;
      raiz.classList.toggle('pausado', pausado);
      poner(play, pausado ? 'play' : 'pausa', pausado ? 'Reproducir (Espacio)' : 'Pausar (Espacio)');
      if (pausado) mostrarBarra(); else programarOcultar();
    };
    play.addEventListener('click', alternar);
    centro.addEventListener('click', alternar);
    video.addEventListener('click', alternar);
    video.addEventListener('play', pintarPlay);
    video.addEventListener('pause', pintarPlay);
    video.addEventListener('ended', pintarPlay);

    // ── Avance ──
    let arrastrando = false;
    const pintarAvance = () => {
      const d = video.duration;
      const t = video.currentTime || 0;
      tiempo.textContent = `${reloj(t)} / ${reloj(d)}`;
      if (!arrastrando) avance.value = Number.isFinite(d) && d > 0 ? String(Math.round((t / d) * 1000)) : '0';
      linea.style.setProperty('--p', `${(Number(avance.value) / 10).toFixed(1)}%`);
    };
    const pintarMarca = () => {
      const d = video.duration;
      const ok = Number.isFinite(momento) && Number.isFinite(d) && d > 0 && momento > 0.5 && momento < d - 0.5;
      marca.hidden = !ok;
      if (ok) marca.style.left = `${(momento / d) * 100}%`;
    };
    let momento = null;
    video.addEventListener('timeupdate', pintarAvance);
    video.addEventListener('loadedmetadata', () => { pintarAvance(); pintarMarca(); });
    video.addEventListener('emptied', pintarAvance);
    avance.addEventListener('input', () => {
      arrastrando = true;
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) video.currentTime = (Number(avance.value) / 1000) * d;
      linea.style.setProperty('--p', `${(Number(avance.value) / 10).toFixed(1)}%`);
    });
    avance.addEventListener('change', () => { arrastrando = false; });
    const saltar = (seg) => {
      const d = video.duration;
      if (Number.isFinite(d)) video.currentTime = Math.min(Math.max(0, (video.currentTime || 0) + seg), d);
    };

    // ── Sonido (se recuerda entre clips y entre sesiones) ──
    const pintarSonido = () => {
      const callado = video.muted || video.volume === 0;
      poner(mudo, callado ? 'mudo' : 'sonido', callado ? 'Activar el sonido (M)' : 'Silenciar (M)');
      volumen.value = String(video.muted ? 0 : Math.round(video.volume * 100));
      volumen.style.setProperty('--p', `${volumen.value}%`);
    };
    const vol = Number(recordado('clips.volumen'));
    video.volume = Number.isFinite(vol) && recordado('clips.volumen') !== null ? Math.min(1, Math.max(0, vol)) : 1;
    video.muted = recordado('clips.mudo') === '1';
    const alternarMudo = () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; };
    mudo.addEventListener('click', alternarMudo);
    volumen.addEventListener('input', () => { video.volume = Number(volumen.value) / 100; video.muted = video.volume === 0; });
    video.addEventListener('volumechange', () => { recordar('clips.volumen', video.volume); recordar('clips.mudo', video.muted ? 1 : 0); pintarSonido(); });
    pintarSonido();

    // ── Velocidad: 1× → 0,5× → 0,25× (cada clip nuevo vuelve a 1×) ──
    const ponerVelocidad = (v) => { video.playbackRate = v; velocidad.textContent = `${String(v).replace('.', ',')}×`; velocidad.classList.toggle('lento', v !== 1); };
    velocidad.addEventListener('click', () => ponerVelocidad(VELOCIDADES[(VELOCIDADES.indexOf(video.playbackRate) + 1) % VELOCIDADES.length]));
    video.addEventListener('loadstart', () => ponerVelocidad(1));

    // ── Pantalla completa (del reproductor entero, para que los controles sigan ahí) ──
    const alternarCompleta = () => { if (document.fullscreenElement === raiz) document.exitFullscreen(); else raiz.requestFullscreen?.().catch(() => {}); };
    completa.addEventListener('click', alternarCompleta);
    video.addEventListener('dblclick', alternarCompleta);

    // ── Anterior, siguiente y favorito: los decide quien usa el reproductor ──
    anterior.addEventListener('click', () => alAnterior());
    siguiente.addEventListener('click', () => alSiguiente());
    favorito.addEventListener('click', () => alFavorito());

    // ── La barra se esconde mientras reproduce y no mueves el ratón ──
    let temporizador = null;
    function mostrarBarra() { raiz.classList.remove('quieto'); clearTimeout(temporizador); }
    function programarOcultar() {
      mostrarBarra();
      if (video.paused) return;
      temporizador = setTimeout(() => { if (!video.paused && !barra.matches(':hover') && !barra.contains(document.activeElement)) raiz.classList.add('quieto'); }, ESCONDER_MS);
    }
    raiz.addEventListener('pointermove', programarOcultar);
    raiz.addEventListener('pointerleave', () => { if (!video.paused) programarOcultar(); });
    barra.addEventListener('focusin', mostrarBarra);

    // ── Teclado ──
    function tecla(e) {
      if (!raiz.isConnected || raiz.offsetParent === null || e.ctrlKey || e.altKey || e.metaKey) return;
      const abierto = document.querySelector('dialog[open]');
      if (abierto && !abierto.contains(raiz)) return;       // hay otra ventana encima
      const t = e.target;
      const escribiendo = t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (escribiendo) return;
      const enBoton = t instanceof HTMLElement && t.tagName === 'BUTTON';
      const k = e.key.toLowerCase();
      if ((k === ' ' && !enBoton) || k === 'k') alternar();
      else if (k === 'arrowleft') { if (e.shiftKey) alAnterior(); else saltar(-SALTO); }
      else if (k === 'arrowright') { if (e.shiftKey) alSiguiente(); else saltar(SALTO); }
      else if (k === 'f') alFavorito();
      else if (k === 'm') alternarMudo();
      else return;
      e.preventDefault();
      programarOcultar();
    }
    document.addEventListener('keydown', tecla);

    function fijar({ favorito: fav, hayAnterior, haySiguiente, momento: m } = {}) {
      if (fav !== undefined) {
        favorito.classList.toggle('on', !!fav);
        favorito.setAttribute('aria-pressed', String(!!fav));
        favorito.title = fav ? 'Favorito: no se borra solo ni cuenta en el límite. Clic para quitarlo (F)' : 'Marcar como favorito: no se borra solo ni cuenta en el límite (F)';
        favorito.setAttribute('aria-label', fav ? 'Quitar de favoritos' : 'Marcar como favorito');
      }
      if (hayAnterior !== undefined) anterior.disabled = !hayAnterior;
      if (haySiguiente !== undefined) siguiente.disabled = !haySiguiente;
      if (m !== undefined) { momento = Number.isFinite(m) ? m : null; pintarMarca(); }
    }
    function soltar() {
      document.removeEventListener('keydown', tecla);
      clearTimeout(temporizador);
      if (document.fullscreenElement === raiz) document.exitFullscreen().catch(() => {});
    }
    return { raiz, video, fijar, soltar };
  }

  window.crearReproductor = crearReproductor;
})();
