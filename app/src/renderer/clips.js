// Sección Clips (C3): la galería de tus clips, agrupados por partida.
// Miniatura, duración y estrella de favorito en cada uno; al abrirlo, el visor con
// el video, renombrar, mostrar en la carpeta y borrar (a la papelera de Windows).
// Dentro de una partida, sus clips se ven uno tras otro en una timeline.
// Los archivos los sirve el proceso main con sharkclip://video/… y sharkclip://mini/…
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined) n.textContent = texto;
    return n;
  };
  const svg = (d) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };
  const url = (tipo, archivo) => `sharkclip://${tipo}/${encodeURIComponent(archivo)}`;
  const GB = 1024 ** 3;
  const tamano = (b) => (!b ? '0 MB' : b >= GB ? `${(b / GB).toLocaleString('es', { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);
  const duracion = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
  const hora = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  function dia(t) {
    const d = new Date(t);
    const hoy = new Date();
    const ayer = new Date(Date.now() - 864e5);
    if (d.toDateString() === hoy.toDateString()) return 'Hoy';
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' });
  }
  // Lo que se lee del clip: el nombre que le pusiste, o la jugada.
  const base = (c) => c.archivo.split('/').pop().replace(/\.mp4$/i, '');
  function nombre(c) {
    if (c.renombrado) return base(c);
    if (c.titulo && c.titulo !== 'Clip') return c.titulo;
    if (c.manual) return 'Clip (Ctrl + F8)';
    return base(c);
  }

  let datos = null;
  let filtro = 'todos';
  let abierta = null; // carpeta de partida abierta (clave del grupo) o null = todas las partidas
  // Dentro de una partida: 'timeline' (de fábrica) o 'lista' (cuadrícula). Se recuerda.
  let vista = 'timeline';
  try { if (localStorage.getItem('clips.vista') === 'lista') vista = 'lista'; } catch { /* sin almacenamiento */ }

  // ── Barra superior: espacio usado y filtro ──
  function pintarEspacio() {
    const lleno = datos.limite ? datos.usado / datos.limite : 0;
    $('gal-uso').textContent = `${tamano(datos.usado)} de ${tamano(datos.limite)}`;
    $('gal-fav').textContent = datos.favoritos ? `+ ${tamano(datos.favoritos)} en favoritos (no cuentan)` : '';
    const m = $('gal-medidor');
    m.querySelector('i').style.width = `${Math.min(100, lleno * 100)}%`;
    m.classList.toggle('lleno', lleno > 0.9);
    m.setAttribute('aria-valuenow', String(Math.round(lleno * 100)));
    const aviso = $('gal-aviso');
    aviso.hidden = !datos.pocoDisco;
    if (datos.pocoDisco) aviso.textContent = `Te quedan ${tamano(datos.libre)} libres en el disco de los clips. Borra clips que no quieras o baja el límite en Ajustes › Clips.`;
  }
  $('gal-filtro').querySelectorAll('.segmento').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    $('gal-filtro').querySelectorAll('.segmento').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-checked', String(x === b));
    });
    pintarLista();
  }));
  // Con una partida abierta, "Abrir carpeta" abre la suya.
  $('gal-carpeta').addEventListener('click', () => window.sharkTracker.clips.abrirCarpeta(grupoAbierto()?.carpeta ?? undefined));

  // ── Partidas (carpetas) ──
  // Cada partida es una carpeta en Videos › SharkTracker ("Briar 2026-10-08"). Los clips
  // sueltos de antes se agrupan por partida (si se sabe) o por día.
  function grupos(clips) {
    const mapa = new Map();
    for (const c of clips) {
      const clave = c.carpeta ? `c:${c.carpeta}` : c.partida ? `p:${c.partida}` : `d:${new Date(c.creado).toDateString()}`;
      if (!mapa.has(clave)) mapa.set(clave, { clave, carpeta: c.carpeta, inicio: Infinity, campeon: null, clips: [], tamano: 0, favoritos: 0, porDia: !c.carpeta && !c.partida });
      const g = mapa.get(clave);
      g.clips.push(c);
      g.inicio = Math.min(g.inicio, c.partida ?? c.creado);
      g.campeon ??= c.campeon;
      g.tamano += c.tamano;
      if (c.favorito) g.favoritos++;
    }
    for (const g of mapa.values()) {
      // Sin índice, el nombre sale de la carpeta ("Briar 2026-10-08 (2)" → "Briar").
      g.titulo = g.porDia ? 'Otros clips' : g.campeon || (g.carpeta ?? '').replace(/ \d{4}-\d{2}-\d{2}( \(\d+\))?$/, '') || 'Partida';
    }
    return [...mapa.values()].sort((a, b) => b.inicio - a.inicio);
  }
  const grupoAbierto = () => (abierta && datos ? grupos(datos.clips).find((g) => g.clave === abierta) ?? null : null);
  const cuantos = (n) => `${n} ${n === 1 ? 'clip' : 'clips'}`;
  const subGrupo = (g) => `${dia(g.inicio)}${g.porDia ? '' : `, ${hora(g.inicio)}`} · ${cuantos(g.clips.length)} · ${tamano(g.tamano)}`;

  function portada(g) {
    // La del primer favorito, si hay; si no, la del clip más reciente con miniatura.
    const c = g.clips.find((x) => x.favorito && x.mini) ?? g.clips.find((x) => x.mini);
    const caja = el('span', 'gal-portada');
    if (c) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = url('mini', c.archivo);
      caja.append(img);
    } else {
      const ph = el('span', 'sin-mini');
      ph.append(svg('M3 7h6l2 2h10v10H3z'));
      caja.append(ph);
    }
    return caja;
  }

  function tarjetaCarpeta(g) {
    const b = el('button', 'gal-carpeta');
    b.type = 'button';
    b.setAttribute('aria-label', `Abrir ${g.titulo}, ${dia(g.inicio)}: ${cuantos(g.clips.length)}`);
    const pila = el('span', 'gal-pila');
    pila.append(portada(g), el('span', 'gal-cuantos', cuantos(g.clips.length)));
    if (g.favoritos) pila.append(el('span', 'gal-favs', `★ ${g.favoritos}`));
    const info = el('span', 'gal-info');
    info.append(el('span', 'gal-tit', g.titulo),
      el('span', 'gal-sub', `${dia(g.inicio)}${g.porDia ? '' : `, ${hora(g.inicio)}`} · ${tamano(g.tamano)}`));
    b.append(pila, info);
    b.addEventListener('click', () => { abierta = g.clave; pintarLista(); document.querySelector('.main').scrollTop = 0; });
    return b;
  }

  // ── Clip: tarjeta con vista previa al pasar el mouse ──
  let previa = null; // { video, timer } de la tarjeta bajo el mouse
  function quitarPrevia() {
    if (!previa) return;
    clearTimeout(previa.timer);
    if (previa.video) {
      previa.video.pause();
      previa.video.removeAttribute('src');
      previa.video.load(); // suelta el archivo
      previa.video.remove();
    }
    previa = null;
  }
  function empezarPrevia(c, mini) {
    quitarPrevia();
    const p = { video: null, timer: null };
    previa = p;
    // Un instante de espera: pasar el mouse de largo no abre ningún video.
    p.timer = setTimeout(() => {
      const v = el('video', 'gal-previa');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      const desde = Math.max(0, (c.momento ?? 2) - 1);
      v.addEventListener('loadedmetadata', () => { v.currentTime = desde; v.play().catch(() => {}); }, { once: true });
      v.addEventListener('playing', () => v.classList.add('on'), { once: true });
      // Repite unos 8 s alrededor de la jugada.
      v.addEventListener('timeupdate', () => { if (v.currentTime > desde + 8) v.currentTime = desde; });
      v.src = url('video', c.archivo);
      mini.append(v);
      p.video = v;
    }, 350);
  }

  function tarjeta(c, conCarpeta = false) {
    const card = el('div', 'gal-clip');
    const mini = el('button', 'gal-mini');
    mini.type = 'button';
    mini.setAttribute('aria-label', `Ver ${nombre(c)}`);
    if (c.mini) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = url('mini', c.archivo);
      mini.append(img);
    } else {
      const ph = el('span', 'sin-mini');
      ph.append(svg('M4 6h16v12H4zM10 9.5v5l4-2.5z'));
      mini.append(ph);
    }
    const play = el('span', 'gal-play');
    play.append(svg('M8 5v14l11-7z'));
    mini.append(play);
    if (c.segundos) mini.append(el('span', 'gal-dur', duracion(c.segundos)));
    mini.addEventListener('click', () => { quitarPrevia(); abrir(c); });
    card.addEventListener('mouseenter', () => empezarPrevia(c, mini));
    card.addEventListener('mouseleave', quitarPrevia);
    const estrella = el('button', `gal-estrella${c.favorito ? ' on' : ''}`, c.favorito ? '★' : '☆');
    estrella.type = 'button';
    estrella.setAttribute('aria-pressed', String(c.favorito));
    estrella.setAttribute('aria-label', c.favorito ? 'Quitar de favoritos' : 'Marcar como favorito');
    estrella.title = c.favorito ? 'Favorito: no se borra solo' : 'Favorito: no se borra solo ni cuenta en el límite';
    estrella.addEventListener('click', () => alternarFavorito(c));
    const info = el('div', 'gal-info');
    const tit = el('div', 'gal-tit', nombre(c));
    tit.title = nombre(c);
    const sub = conCarpeta && c.carpeta ? `${c.campeon ?? c.carpeta} · ${dia(c.creado)}, ${hora(c.creado)}` : `${hora(c.creado)} · ${tamano(c.tamano)}`;
    info.append(tit, el('div', 'gal-sub', sub));
    card.append(mini, estrella, info);
    return card;
  }

  function vacio() {
    const caja = el('div', 'emptywrap gal-vacio');
    if (filtro === 'favoritos' && datos?.clips.length) {
      caja.append(el('div', 'errtitle', 'Sin favoritos'), el('div', 'errtxt', 'Marca con ★ los clips que quieras guardar para siempre: no cuentan en el límite y no se borran solos.'));
      return caja;
    }
    caja.append(el('div', 'errtitle', 'Todavía no hay clips'),
      el('div', 'errtxt', 'Activa los clips en Ajustes › Clips. En partida se guardan solas tus kills, objetivos y ultis que terminan en algo, y con Ctrl + F8 guardas lo que quieras.'));
    const ir = el('button', 'checkbtn', 'Ir a Ajustes › Clips');
    ir.type = 'button';
    ir.addEventListener('click', () => {
      document.querySelector('.navitem[data-page="ajustes"]')?.click();
      document.querySelector('.stab[data-stab="clips"]')?.click();
    });
    caja.append(ir);
    return caja;
  }

  function pintarLista() {
    quitarPrevia();
    // La timeline solo vive dentro de una partida (y con esa vista elegida).
    const ga = grupoAbierto();
    if (filtro === 'favoritos' || !ga || vista !== 'timeline' || !conTimeline(ga)) quitarTimeline();
    const lista = $('gal-lista');
    const todos = datos?.clips ?? [];
    // Favoritos: todos juntos, de cualquier partida.
    if (filtro === 'favoritos') {
      const favs = todos.filter((c) => c.favorito);
      if (!favs.length) { lista.replaceChildren(vacio()); return; }
      const grid = el('div', 'gal-grid');
      grid.append(...favs.map((c) => tarjeta(c, true)));
      lista.replaceChildren(grid);
      return;
    }
    if (!todos.length) { lista.replaceChildren(vacio()); return; }
    // Dentro de una partida: sus clips en la timeline (de fábrica) o en cuadrícula.
    const g = grupoAbierto();
    if (g) {
      const verTimeline = vista === 'timeline' && conTimeline(g);
      if (verTimeline && tl?.clave === g.clave && lista.contains(tl.raiz)) {
        // Ya está a la vista: se actualiza sin cortar el video.
        lista.querySelector('.gal-grupo-sub').textContent = subGrupo(g);
        tl.actualizar(g);
        return;
      }
      quitarTimeline();
      const cab = el('div', 'gal-cab-carpeta');
      const volver = el('button', 'btn-sec gal-volver', '‹ Partidas');
      volver.type = 'button';
      volver.addEventListener('click', () => { abierta = null; pintarLista(); });
      const tit = el('div', 'gal-cab-tit');
      tit.append(el('h2', 'gal-grupo-tit', g.titulo), el('span', 'gal-grupo-sub', subGrupo(g)));
      const modos = el('div', 'segmentos gal-vista');
      modos.setAttribute('role', 'radiogroup');
      modos.setAttribute('aria-label', 'Cómo ver los clips');
      for (const [v, texto] of [['timeline', 'Timeline'], ['lista', 'Ver como lista']]) {
        const b = el('button', `segmento${vista === v ? ' on' : ''}`, texto);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(vista === v));
        b.addEventListener('click', () => {
          if (vista === v) return;
          vista = v;
          try { localStorage.setItem('clips.vista', v); } catch { /* sin almacenamiento: vale solo ahora */ }
          pintarLista();
        });
        modos.append(b);
      }
      // Partidas de antes de la v0.9.7 (sin el minuto de cada clip): solo cuadrícula.
      cab.append(volver, tit, ...(conTimeline(g) ? [modos] : []));
      if (verTimeline) {
        tl = crearTimeline(g);
        lista.replaceChildren(cab, tl.raiz);
        return;
      }
      const grid = el('div', 'gal-grid');
      grid.append(...g.clips.map((c) => tarjeta(c)));
      lista.replaceChildren(cab, grid);
      return;
    }
    abierta = null;
    const grid = el('div', 'gal-grid gal-carpetas');
    grid.append(...grupos(todos).map(tarjetaCarpeta));
    lista.replaceChildren(grid);
  }

  async function cargar() {
    datos = await window.sharkTracker.clips.galeria();
    pintarEspacio();
    pintarLista();
  }

  async function alternarFavorito(c) {
    await window.sharkTracker.clips.favorito(c.archivo, !c.favorito);
    await cargar();
    if (visor.open && ctlVisor.clip()?.archivo === c.archivo) ctlVisor.pintar(datos.clips.find((x) => x.archivo === c.archivo) ?? c);
  }

  // ── Controles de un clip: nombre, renombrar, favorito, mostrar y borrar ──
  // Los usan el visor (ventana encima) y la timeline de la partida. `video()` es el
  // reproductor que tiene el archivo abierto: Windows no deja renombrar ni borrar un
  // archivo que el video tiene abierto, así que se suelta antes y se vuelve a poner.
  // `alCambiar(clip)`: después de renombrar (el clip con su nombre nuevo) o de borrar (null).
  function crearControles({ idTitulo, video, alCambiar }) {
    let clip = null;
    let borrarTimer = null;
    const nombreCaja = el('div', 'visor-nombre-caja');
    const titulo = el('div', 'visor-titulo');
    if (idTitulo) titulo.id = idTitulo;
    const form = el('form', 'visor-renombrar');
    form.hidden = true;
    const input = el('input');
    input.type = 'text';
    input.maxLength = 120;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Nombre del clip');
    const guardar = el('button', 'checkbtn', 'Guardar');
    guardar.type = 'submit';
    const cancelar = el('button', 'btn-sec', 'Cancelar');
    cancelar.type = 'button';
    form.append(input, guardar, cancelar);
    const sub = el('div', 'swsub');
    nombreCaja.append(titulo, form, sub);

    const acciones = el('div', 'visor-acciones');
    const fav = el('button', 'btn-sec');
    fav.type = 'button';
    const btnRenombrar = el('button', 'btn-sec', 'Renombrar');
    btnRenombrar.type = 'button';
    const mostrar = el('button', 'btn-sec', 'Mostrar en la carpeta');
    mostrar.type = 'button';
    const borrar = el('button', 'btn-sec btn-peligro', 'Borrar');
    borrar.type = 'button';
    acciones.append(fav, btnRenombrar, mostrar, el('span', 'visor-sep'), borrar);
    const errorTxt = el('div', 'swsub bad');
    errorTxt.hidden = true;

    const error = (texto) => { errorTxt.textContent = texto; errorTxt.hidden = !texto; };
    const soltar = () => {
      const v = video();
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
    function cerrarRenombrar() { form.hidden = true; titulo.hidden = false; }
    function reiniciarBorrar() {
      clearTimeout(borrarTimer);
      borrar.classList.remove('confirmar');
      borrar.textContent = 'Borrar';
    }
    function pintar(c) {
      clip = c;
      titulo.textContent = nombre(c);
      titulo.title = c.archivo;
      sub.textContent = [`${dia(c.creado)}, ${hora(c.creado)}`, c.campeon, c.segundos ? duracion(c.segundos) : null, tamano(c.tamano)].filter(Boolean).join(' · ');
      fav.textContent = c.favorito ? '★ Favorito' : '☆ Favorito';
      fav.classList.toggle('on', c.favorito);
      fav.setAttribute('aria-pressed', String(c.favorito));
    }
    // Clip nuevo en pantalla: sin formularios abiertos ni errores viejos.
    function mostrarClip(c) {
      pintar(c);
      cerrarRenombrar();
      reiniciarBorrar();
      error('');
    }

    fav.addEventListener('click', async () => {
      if (!clip) return;
      await window.sharkTracker.clips.favorito(clip.archivo, !clip.favorito);
      await cargar();
      const c = datos.clips.find((x) => x.archivo === clip?.archivo);
      if (c) pintar(c);
    });
    mostrar.addEventListener('click', () => clip && window.sharkTracker.clips.mostrar(clip.archivo));
    btnRenombrar.addEventListener('click', () => {
      if (!clip) return;
      titulo.hidden = true;
      form.hidden = false;
      input.value = clip.renombrado || clip.manual ? base(clip) : nombre(clip);
      input.focus();
      input.select();
    });
    cancelar.addEventListener('click', cerrarRenombrar);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!clip) return;
      const v = video();
      const t = v.currentTime;
      soltar();
      const r = await window.sharkTracker.clips.renombrar(clip.archivo, input.value);
      if (!r.ok) {
        error(r.motivo === 'existe' ? 'Ya hay un clip con ese nombre.' : r.motivo === 'nombre' ? 'Escribe un nombre.' : 'No se pudo renombrar (¿está abierto en otro programa?).');
      } else {
        error('');
        cerrarRenombrar();
      }
      await cargar();
      const c = datos.clips.find((x) => x.archivo === (r.ok ? r.archivo : clip.archivo));
      if (c) {
        pintar(c);
        v.src = url('video', c.archivo);
        v.currentTime = t;
        alCambiar(c);
      }
    });
    // Borrar: dos clics (el primero pide confirmar).
    borrar.addEventListener('click', async () => {
      if (!clip) return;
      if (!borrar.classList.contains('confirmar')) {
        borrar.classList.add('confirmar');
        borrar.textContent = '¿Borrar? Va a la papelera';
        borrarTimer = setTimeout(reiniciarBorrar, 4000);
        return;
      }
      const archivo = clip.archivo;
      soltar();
      const ok = await window.sharkTracker.clips.borrar(archivo);
      if (!ok) { error('No se pudo borrar (¿está abierto en otro programa?).'); video().src = url('video', archivo); reiniciarBorrar(); return; }
      clip = null;
      reiniciarBorrar();
      alCambiar(null);
    });

    return { nombreCaja, acciones, errorTxt, mostrarClip, pintar, reiniciarBorrar, clip: () => clip };
  }

  // ── Visor (clips sueltos: favoritos y la vista de lista) ──
  const visor = $('gal-visor');
  const videoVisor = $('visor-video');
  const ctlVisor = crearControles({
    idTitulo: 'visor-titulo',
    video: () => videoVisor,
    alCambiar: async (c) => { if (!c) { visor.close(); await cargar(); } },
  });
  $('visor-nombre').append(ctlVisor.nombreCaja);
  $('visor-pie').append(ctlVisor.acciones, ctlVisor.errorTxt);
  function abrir(c) {
    ctlVisor.mostrarClip(c);
    videoVisor.src = url('video', c.archivo);
    visor.showModal();
    videoVisor.play().catch(() => {});
  }
  visor.addEventListener('close', () => {
    videoVisor.pause();
    videoVisor.removeAttribute('src');
    videoVisor.load(); // suelta el archivo
    ctlVisor.reiniciarBorrar();
  });
  $('visor-cerrar').addEventListener('click', () => visor.close());
  // Clic en el fondo oscuro: cerrar.
  visor.addEventListener('click', (e) => { if (e.target === visor) visor.close(); });

  // ── Timeline de la partida ──
  // Los clips de la partida en un solo reproductor y, debajo, el eje de minutos de la
  // partida con los íconos de cada jugada en su minuto (solo clips desde la v0.9.7, que
  // guardan el minuto; las partidas de antes se ven en cuadrícula). Al terminar un clip,
  // abajo a la izquierda del video sale "Siguiente clip en 5…": si no lo cancelas, pasa al siguiente.
  const CUENTA = 5;
  // Íconos Abisal (siluetas 24×24): los de la web y el overlay, más muerte, asistencia, ulti
  // y robo (tablero "SharkTracker · Íconos de la timeline de clips" en Figma).
  const ICONOS = {
    muerte: 'M12 2C6.9 2 3.5 5.4 3.5 10.1c0 2.6 1.1 4.6 2.9 5.9v2.4c0 .9.7 1.6 1.6 1.6h.6v1.4c0 .3.2.6.6.6h1.1c.3 0 .6-.3.6-.6V20h1.2v1.4c0 .3.3.6.6.6h1.1c.4 0 .6-.3.6-.6V20h.6c.9 0 1.6-.7 1.6-1.6V16c1.8-1.3 2.9-3.3 2.9-5.9C20.5 5.4 17.1 2 12 2zM8.6 9.2c1.4 0 2.4 1 2.4 2.3 0 1.1-.8 1.7-2 1.7-1.5 0-2.6-.8-2.6-2 0-1.2 1-2 2.2-2zm6.8 0c1.2 0 2.2.8 2.2 2 0 1.2-1.1 2-2.6 2-1.2 0-2-.6-2-1.7 0-1.3 1-2.3 2.4-2.3zM12 14.2l1.3 2.3h-2.6z',
    asistencia: 'M1 8.5l3.8-2.2 2.7 1.1 2.6-1.3c.9-.5 2-.4 2.8.2l.6.4.6-.4c.8-.6 1.9-.7 2.8-.2l2.6 1.3 2.7-1.1 1.8 1.1v1.5l-1.3.7-1.6 3.8-6.7 6.1c-.6.5-1.5.5-2.1-.1l-.2-.2-.4.3c-.6.4-1.4.3-1.9-.2l-.3-.3-.6.2c-.7.2-1.4-.1-1.8-.7l-.2-.4-.6-.1c-.8-.1-1.4-.8-1.4-1.6v-.4L3.9 12.6 1 11zM12 8.6l-2.8 2.8c-.5.5-.5 1.2 0 1.7.5.5 1.2.5 1.7 0l2-2 4.4 4.2 1-1-1.6-1.6.9-2.2-1.9-.9c-.8-.4-1.7-.3-2.3.3l-.4.3z',
    ulti: 'M10 1.5l1.9 6.6L18.5 10l-6.6 1.9L10 18.5l-1.9-6.6L1.5 10l6.6-1.9zM18.5 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z',
    robo: 'M6.2 2.5c1.4 3.6 1.2 7.5-.6 11.3L3.4 18c3.6-2.7 5.8-6.5 6-10.8zM12 3c1.2 4.2.7 8.6-1.5 12.4L8.7 20c3.7-3.1 5.8-7.6 5.8-12.6zM17.8 4.5c.9 3.8.2 7.8-2 11.1l-1.6 3.9c3.5-2.7 5.5-6.9 5.5-11.4z',
    kill: 'M4.2 2.8l8.6 8.6-1.4 1.4-8.6-8.6V2.8zM19.8 2.8v1.4l-6 6-1.4-1.4 6-6zM6.7 14.1l3.2 3.2-1.8 1.8 1.3 1.3-1.4 1.4-1.3-1.3-2.2 2.2-1.4-1.4 2.2-2.2-1.3-1.3 1.4-1.4 1.3 1.3zM17.3 14.1l-3.2 3.2 1.8 1.8-1.3 1.3 1.4 1.4 1.3-1.3 2.2 2.2 1.4-1.4-2.2-2.2 1.3-1.3-1.4-1.4-1.3 1.3zM13.3 12.5l1.4 1.4-2 2-1.4-1.4z',
    dragon: 'M10.4 22.8C7.2 22.1 4.7 20.4 3.1 18.0C2.4 16.9 1.9 16.0 1.9 15.7C1.9 15.2 3.1 13.2 4.0 12.1C4.7 11.2 4.7 11.1 4.0 10.7C3.5 10.4 3.5 10.2 3.9 9.9C4.4 9.5 5.7 8.9 6.5 8.7C7.6 8.5 7.5 8.2 5.5 7.0C3.6 5.7 2.4 4.0 2.0 1.9C1.8 0.9 2.0 0.9 2.8 1.9C4.0 3.5 5.4 4.5 6.8 4.9C7.9 5.2 9.0 5.7 9.8 6.2C10.5 6.6 10.7 6.7 10.7 6.5C10.7 6.5 10.7 6.2 10.6 5.8C10.4 4.5 10.5 4.4 11.7 5.5C12.7 6.5 13.1 6.8 14.9 7.7C16.3 8.5 16.5 8.6 17.0 9.7C17.6 10.8 18.4 11.5 20.0 11.9C21.5 12.3 22.1 13.3 22.0 15.3C21.9 16.2 21.8 16.4 21.2 16.4C20.9 16.4 20.7 16.5 20.2 16.8C19.2 17.5 19.2 17.5 18.6 16.9C17.8 16.1 16.1 15.8 13.9 16.1C12.0 16.5 10.5 15.8 9.7 14.3C9.3 13.6 9.2 13.6 9.2 14.4C9.3 15.4 10.1 16.4 11.2 16.9C11.9 17.2 12.0 17.3 11.9 17.5C11.7 19.4 11.8 20.1 12.6 21.5C13.4 23.0 12.9 23.3 10.4 22.8ZM15.6 11.1C15.6 10.7 14.3 9.8 13.5 9.8C12.9 9.7 13.1 10.6 13.8 11.1C14.3 11.4 15.6 11.4 15.6 11.1Z',
    ancestral: 'M2.5 15c1.3-4.3 5-7.1 9.6-7.4l1.9-3.1.8 3.2 3.1-2-.8 3.6c2.2 1 3.7 2.8 3.9 4.9l-3.2.4-2.6 1.8h-3l-2.2 2.6-.6-2.5-3.4 3.4.4-3.9zM15.6 10.9a1 1 0 1 0 0 .01zM4 3.5l1.6 2.6L7.2 2.8l1.2 3.4 1.8-2.9.3 3.3H4.9z',
    baron: 'M3.5 22.9C3.0 22.6 2.5 20.9 2.2 18.6C1.8 14.6 2.6 11.7 4.7 8.8C5.4 7.9 5.5 7.9 6.4 8.5C7.8 9.5 9.0 9.6 10.0 8.9C11.2 8.0 11.4 6.4 10.4 5.2C10.1 4.8 10.2 4.7 11.0 4.5C11.4 4.4 11.6 4.3 11.7 4.2C11.9 4.0 11.5 2.7 10.9 1.9C10.0 0.7 12.2 1.6 13.7 3.1C14.7 4.1 14.7 4.1 15.5 4.1C19.6 4.4 22.9 7.5 21.6 10.0C21.3 10.6 21.1 10.6 20.9 9.9C20.7 9.1 19.9 8.8 19.7 9.5C19.5 10.1 19.3 10.5 19.1 10.5C19.1 10.5 18.9 10.3 18.8 10.1C18.2 9.3 18.0 9.3 17.0 9.9C15.9 10.6 15.3 11.6 15.5 12.2C16.2 14.3 17.5 15.1 18.5 14.0C18.7 13.7 18.9 13.8 18.9 14.2C18.9 15.2 19.2 15.3 19.9 14.6C20.5 14.1 20.5 14.1 20.6 14.7C20.9 15.9 19.8 17.2 18.4 17.2C17.8 17.2 17.3 17.1 16.1 16.5C15.4 16.2 14.7 16.0 14.2 15.8C12.2 15.5 11.6 15.0 11.1 13.2C11.0 13.1 11.0 13.1 10.8 13.2C10.4 13.8 10.8 15.0 11.6 15.9C12.2 16.5 12.2 16.5 12.0 17.0C11.2 18.4 11.6 19.6 13.2 21.3C14.0 22.2 14.1 22.5 13.8 22.8C13.6 23.0 4.0 23.1 3.5 22.9ZM8.0 8.5C5.5 7.6 3.8 5.2 3.8 2.7C3.8 1.2 4.1 0.7 4.6 1.7C5.0 2.7 5.1 2.9 5.7 3.5C6.3 4.1 7.0 4.5 8.4 5.0C9.8 5.5 10.3 6.1 10.2 7.2C10.0 8.1 8.9 8.8 8.0 8.5ZM15.6 8.4C16.5 8.1 16.5 7.9 15.5 7.3C14.5 6.6 13.9 6.7 13.9 7.5C13.9 8.2 14.7 8.6 15.6 8.4Z',
    heraldo: 'M10.0 22.7C9.0 22.2 8.9 21.8 9.7 21.6C14.1 20.2 14.3 13.4 10.1 12.0C7.2 11.0 4.5 13.8 5.8 16.4C6.4 17.5 8.0 18.0 8.8 17.2C9.2 16.8 9.2 16.5 8.8 16.7C6.3 17.3 5.4 14.1 7.8 13.0C9.5 12.2 11.7 13.6 12.1 15.8C12.8 20.1 8.2 22.4 4.7 19.6C4.2 19.3 4.0 19.2 3.5 19.1C2.5 19.1 2.3 19.0 2.1 18.8C1.8 18.5 1.8 18.4 2.5 17.9L3.0 17.3L2.8 16.3C2.3 14.4 2.5 12.5 3.3 10.6C3.6 9.8 3.6 9.8 3.4 9.5C2.5 8.2 2.2 7.4 2.2 6.2C2.1 5.1 2.3 5.1 3.1 5.8C4.4 7.0 5.6 7.4 6.4 6.7C7.1 6.2 8.1 5.7 9.1 5.4C10.0 5.1 10.0 5.1 10.1 4.2C10.5 2.8 11.6 1.0 12.2 1.1C12.4 1.1 12.5 1.2 12.5 2.2C12.6 4.0 13.0 4.9 13.8 5.1C16.4 5.8 17.1 6.3 16.7 6.9C15.0 9.1 17.6 12.3 20.1 11.0C20.6 10.7 20.7 10.8 21.0 11.7C21.3 12.9 21.4 14.2 21.3 15.3C21.1 16.3 21.1 16.3 21.4 16.8C22.1 17.8 22.0 17.8 16.7 20.2C16.2 20.4 15.1 21.0 14.3 21.5C11.6 23.1 11.1 23.3 10.0 22.7ZM17.8 16.3C19.5 15.4 19.0 12.9 17.1 12.9C16.1 12.9 15.4 13.5 15.3 14.5C15.2 15.8 16.6 16.8 17.8 16.3ZM18.5 10.4C17.6 10.1 17.0 9.4 17.0 8.5C17.0 7.7 17.2 7.4 18.2 6.6C19.9 5.2 20.6 3.9 20.6 1.9C20.6 0.1 21.7 1.9 22.0 4.2C22.4 7.3 20.3 11.0 18.5 10.4Z',
    larvas: 'M12.1 18.8C11.8 18.5 11.4 17.8 11.2 17.1C11.1 16.9 11.0 16.9 10.4 17.0C9.5 17.0 9.3 17.2 9.2 17.8C9.0 18.9 8.1 18.9 7.1 17.8C6.7 17.3 6.3 17.4 5.4 18.1C3.4 19.7 1.5 18.9 1.1 16.3C0.9 14.8 1.4 12.9 2.4 11.8C2.9 11.3 3.0 11.3 3.2 12.1C3.5 13.3 4.5 14.8 5.0 14.7C5.4 14.6 5.3 14.4 5.0 13.7C2.7 10.1 5.1 5.6 9.3 5.6C10.8 5.6 10.8 5.6 10.1 6.5C9.2 7.7 8.8 9.0 8.8 10.5C8.8 12.0 9.4 12.0 9.6 10.5C10.6 3.2 20.7 2.8 22.3 10.0C23.2 14.6 19.7 18.5 15.0 18.0C13.8 17.9 13.7 17.9 13.4 18.5C13.2 19.2 12.7 19.3 12.1 18.8ZM21.6 17.4C21.2 17.2 21.2 17.0 21.5 16.6C21.7 16.4 22.0 16.0 22.2 15.7C22.7 14.9 22.9 15.1 22.9 16.3C22.9 17.4 22.4 17.8 21.6 17.4ZM17.8 13.6C19.2 13.2 18.6 10.8 17.1 10.4C15.2 9.9 14.6 12.3 16.3 13.3C17.0 13.7 17.3 13.8 17.8 13.6Z',
    atakhan: 'M3 2.5c2 1.2 3.3 3 3.8 5h10.4c.5-2 1.8-3.8 3.8-5l-.9 7.6c-.3 5.9-3.7 10.3-8.1 11.4-4.4-1.1-7.8-5.5-8.1-11.4zM7.6 11.2l3.2 1.4-.4 1.6-3.3-.9zM16.4 11.2l-3.2 1.4.4 1.6 3.3-.9zM9.8 17h4.4l-2.2 2z',
    torre: 'M5.4 22.8C4.9 22.3 5.3 21.9 6.2 21.9C7.0 21.9 6.9 22.1 7.4 19.0C8.0 15.5 8.0 15.5 8.2 15.5C8.4 15.4 9.3 15.4 10.3 15.4C12.4 15.3 13.0 15.2 13.0 14.8C13.0 14.5 12.7 14.4 10.3 14.4C7.8 14.4 8.0 14.5 6.8 13.3L6.1 12.6L6.1 10.9C6.1 8.9 6.1 8.9 7.2 8.7C8.1 8.6 8.2 8.6 8.3 9.5C8.3 10.5 8.4 10.5 9.4 10.5C10.4 10.5 10.5 10.4 10.6 9.8C10.8 9.2 10.9 9.1 12.1 9.1C13.1 9.2 13.1 9.2 13.2 9.7C13.5 10.5 13.5 10.5 14.5 10.5C15.6 10.5 15.6 10.5 15.7 9.5C15.7 8.6 15.8 8.6 16.7 8.7C17.8 8.9 17.8 8.8 17.8 10.9L17.8 12.7L16.9 13.6C15.6 14.7 15.7 14.0 16.6 19.4C17.1 22.1 17.0 21.9 17.7 21.9C18.6 21.9 19.0 22.3 18.5 22.8C18.2 23.1 5.8 23.1 5.4 22.8ZM10.0 8.8C9.8 8.6 9.3 5.7 9.4 5.6C9.5 5.5 10.1 5.8 11.0 6.4C11.8 6.9 11.9 8.3 11.1 8.4C10.9 8.5 10.6 8.6 10.5 8.7C10.2 8.9 10.0 9.0 10.0 8.8ZM13.5 8.7C13.4 8.6 13.1 8.5 12.9 8.4C12.4 8.3 12.3 8.3 12.3 7.5C12.3 6.7 12.3 6.8 13.5 6.0C14.8 5.3 14.7 5.2 14.3 7.3C14.1 8.1 14.0 8.8 14.0 8.9C14.0 9.0 13.7 8.9 13.5 8.7ZM10.7 5.4C10.0 5.0 9.5 4.6 9.5 4.6C9.5 4.3 11.8 1.1 12.0 1.1C12.2 1.1 14.4 4.2 14.4 4.5C14.4 4.7 12.3 6.1 12.0 6.1C11.9 6.1 11.3 5.8 10.7 5.4Z',
    inhibidor: 'M5.7 22.8C5.3 22.4 5.4 22.3 6.9 20.3C7.9 18.9 8.2 18.8 9.3 18.8C9.9 18.9 9.9 18.9 10.2 19.6C11.2 21.6 12.8 21.7 13.7 19.7C14.2 18.9 14.2 18.9 15.0 18.9C16.0 18.9 16.0 18.9 17.4 20.7C19.3 23.2 19.7 23.0 12.0 23.0C6.0 23.0 5.9 23.0 5.7 22.8ZM12.5 16.2C12.5 12.8 12.5 12.8 12.7 12.6C13.0 12.4 16.3 10.1 16.6 9.9C17.1 9.7 16.9 10.0 14.3 16.0C13.8 17.2 13.2 18.5 13.0 18.8C12.5 20.1 12.5 20.0 12.5 16.2ZM11.2 19.2C11.1 19.1 10.7 18.2 10.3 17.3C7.0 9.9 7.0 9.7 7.4 9.8C7.5 9.9 11.0 12.4 11.3 12.6C11.5 12.8 11.5 12.8 11.5 16.2C11.5 19.5 11.5 19.8 11.2 19.2ZM11.0 11.2C10.6 10.9 9.5 10.2 8.7 9.6C6.8 8.3 6.9 8.4 7.8 7.1C12.1 0.5 11.9 0.8 12.2 1.0C12.4 1.1 16.9 8.1 16.9 8.3C16.9 8.4 16.4 8.8 15.5 9.5C14.7 10.0 13.7 10.8 13.2 11.1C12.0 11.9 12.0 11.9 11.0 11.2Z',
    clip: 'M3 6h11a2 2 0 0 1 2 2v1.6l4.6-2.9A.9.9 0 0 1 22 7.5v9a.9.9 0 0 1-1.4.8L16 14.4V16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6.5 10.2a1.3 1.3 0 1 0 0 .01z',
  };
  const MULTI = { 'Doble kill': 2, 'Triple kill': 3, 'Cuádruple kill': 4, Pentakill: 5 };
  const ICONO_DE = { Kill: 'kill', Asistencia: 'asistencia', Muerte: 'muerte', Dragón: 'dragon', dragón: 'dragon', Ancestral: 'ancestral',
    Barón: 'baron', Heraldo: 'heraldo', Larvas: 'larvas', Atakhan: 'atakhan', Torre: 'torre', Inhibidor: 'inhibidor', Ulti: 'ulti', Clip: 'clip' };
  // Mismo orden que el nombre del clip (clips-eventos.js): lo más vistoso primero.
  const PRIORIDAD = ['Pentakill', 'Cuádruple kill', 'Triple kill', 'Robo de Barón', 'Robo de Ancestral', 'Robo de dragón',
    'Barón', 'Ancestral', 'Atakhan', 'Doble kill', 'Robo de Heraldo', 'Heraldo', 'Dragón', 'Larvas', 'Kill', 'Inhibidor',
    'Asistencia', 'Torre', 'Ulti', 'Muerte', 'Clip'];
  const conTimeline = (g) => g.clips.length > 0 && g.clips.every((c) => c.juego && Number.isFinite(c.juego.inicio));
  const reloj = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // Íconos de un clip (hasta 3): [{ k, n (multikill), robo }].
  function iconosDe(c) {
    let et = [...new Set(c.etiquetas?.length ? c.etiquetas : [c.manual ? 'Clip' : 'Kill'])];
    if (et.some((e) => MULTI[e])) et = et.filter((e) => e !== 'Kill');
    if (et.length > 1) et = et.filter((e) => e !== 'Clip');
    et.sort((x, y) => ((PRIORIDAD.indexOf(x) + 1) || 99) - ((PRIORIDAD.indexOf(y) + 1) || 99));
    const vistos = new Set();
    const lista = [];
    for (const e of et) {
      const base = e.replace(/^Robo de /, '');
      const k = MULTI[e] ? 'kill' : ICONO_DE[base] ?? 'clip';
      if (vistos.has(k)) continue;
      vistos.add(k);
      lista.push({ k, n: MULTI[e] ?? 0, robo: e.startsWith('Robo de ') });
    }
    return lista.slice(0, 3);
  }
  const svgIcono = (k) => {
    const s = svg(ICONOS[k] ?? ICONOS.clip);
    s.querySelector('path').setAttribute('fill-rule', 'evenodd');
    return s;
  };

  let tl = null; // timeline a la vista: { clave, raiz, video, clips, i, actualizar(g), soltar() }

  function crearTimeline(g) {
    const raiz = el('div', 'tl');
    const escena = el('div', 'tl-escena');
    const video = el('video', 'tl-video');
    video.controls = true;
    video.preload = 'auto';
    video.playsInline = true;
    const sig = el('div', 'tl-siguiente');
    sig.hidden = true;
    sig.setAttribute('role', 'status');
    const sigTxt = el('span', 'tl-sig-txt');
    const sigYa = el('button', 'tl-sig-btn', 'Ver ahora');
    sigYa.type = 'button';
    const sigNo = el('button', 'tl-sig-btn tl-sig-no', 'Cancelar');
    sigNo.type = 'button';
    sig.append(sigTxt, sigYa, sigNo);
    escena.append(video, sig);

    const ctl = crearControles({
      video: () => video,
      alCambiar: async (c) => {
        if (c) { t.clips[t.i] = c; pintarPista(); return; }
        // Borrado: se queda en el mismo lugar de la pista (el siguiente, o el anterior si era el último).
        await cargar();
      },
    });
    const cab = el('div', 'tl-cab');
    const contador = el('span', 'tl-contador');
    cab.append(ctl.nombreCaja, contador);
    const pista = el('div', 'tl-pista');
    pista.setAttribute('role', 'group');
    pista.setAttribute('aria-label', 'Jugadas de la partida, por minuto');
    raiz.append(escena, cab, pista, ctl.acciones, ctl.errorTxt);

    const t = { clave: g.clave, raiz, video, clips: [], i: 0, cuenta: null };

    function pararCuenta() {
      clearInterval(t.cuenta);
      t.cuenta = null;
      sig.hidden = true;
    }
    function ir(i, reproducir = true) {
      pararCuenta();
      t.i = Math.max(0, Math.min(t.clips.length - 1, i));
      const c = t.clips[t.i];
      ctl.mostrarClip(c);
      if (c.mini) video.poster = url('mini', c.archivo); else video.removeAttribute('poster');
      video.src = url('video', c.archivo);
      if (reproducir) video.play().catch(() => {});
      pintarPista();
    }
    // Eje: de 0 al final de la partida (o al último clip). Posición en px dentro de la pista.
    const MARGEN_X = 18;
    const ICONO = 22;
    let duracionEje = 60;
    const posX = (seg) => MARGEN_X + (seg / duracionEje) * Math.max(1, pista.clientWidth - MARGEN_X * 2);
    function pintarPista() {
      contador.textContent = `Clip ${t.i + 1} de ${t.clips.length}`;
      duracionEje = Math.max(60, t.clips[0]?.duracionPartida ?? 0, ...t.clips.map((c) => c.juego.inicio + (c.segundos ?? 0)));
      // Carriles: si dos clips quedan pegados, el segundo sube un carril (hasta 3).
      const fin = [];
      const filas = t.clips.map((c) => {
        const iconos = iconosDe(c);
        const x = posX(c.juego.jugada ?? c.juego.inicio) - ICONO / 2;
        const ancho = iconos.length * ICONO + (iconos.length - 1) * 2;
        let carril = fin.findIndex((f) => x >= f + 6);
        if (carril < 0) carril = fin.length < 3 ? fin.length : fin.indexOf(Math.min(...fin));
        fin[carril] = x + ancho;
        return { c, iconos, x, carril };
      });
      const carriles = Math.max(1, fin.length);
      const ejeY = 14 + carriles * 30;
      pista.style.height = `${ejeY + 30}px`;
      const nodos = [];
      // Marcas: una por minuto, con número cada 5.
      const linea = el('div', 'tl-eje');
      linea.style.top = `${ejeY}px`;
      nodos.push(linea);
      for (let m = 0; m * 60 <= duracionEje; m++) {
        const marca = el('i', `tl-marca${m % 5 ? '' : ' grande'}`);
        marca.style.left = `${posX(m * 60)}px`;
        marca.style.top = `${ejeY}px`;
        nodos.push(marca);
        if (m % 5 === 0) {
          const n = el('span', 'tl-min', `${m}m`);
          n.style.left = `${posX(m * 60)}px`;
          n.style.top = `${ejeY + 10}px`;
          nodos.push(n);
        }
      }
      filas.forEach(({ c, iconos, x, carril }, i) => {
        // Tramo que cubre el clip, sobre el eje.
        const tramo = el('i', `tl-tramo${i === t.i ? ' on' : ''}`);
        tramo.style.left = `${posX(c.juego.inicio)}px`;
        tramo.style.width = `${Math.max(4, posX(c.juego.inicio + (c.segundos ?? 0)) - posX(c.juego.inicio))}px`;
        tramo.style.top = `${ejeY - 5}px`;
        nodos.push(tramo);
        const b = el('button', `tl-jugada${i === t.i ? ' on' : ''}`);
        b.type = 'button';
        b.style.left = `${x}px`;
        b.style.top = `${ejeY - 12 - (carril + 1) * 30 + 4}px`;
        const cuando = reloj(c.juego.jugada ?? c.juego.inicio);
        b.title = `${nombre(c)} · ${cuando}`;
        b.setAttribute('aria-label', `${i + 1}. ${nombre(c)}, minuto ${cuando}${c.favorito ? ', favorito' : ''}`);
        if (i === t.i) b.setAttribute('aria-current', 'true');
        for (const ic of iconos) {
          const caja = el('span', 'tl-icono');
          caja.append(svgIcono(ic.k));
          if (ic.n) caja.append(el('span', 'tl-num', String(ic.n)));
          if (ic.robo) { const r = el('span', 'tl-robo'); r.append(svgIcono('robo')); caja.append(r); }
          b.append(caja);
        }
        if (c.favorito) b.append(el('span', 'tl-fav', '★'));
        b.addEventListener('click', () => ir(i));
        nodos.push(b);
      });
      nodos.push(cabezal);
      pista.replaceChildren(...nodos);
      cabezal.style.top = `${ejeY - 16}px`;
      moverCabezal();
    }
    // Línea que avanza con el video, en el minuto de la partida que se está viendo.
    const cabezal = el('i', 'tl-cabezal');
    function moverCabezal() {
      const c = t.clips[t.i];
      if (!c) return;
      cabezal.style.left = `${posX(c.juego.inicio + (video.currentTime || 0))}px`;
    }
    video.addEventListener('timeupdate', moverCabezal);
    // El ancho de la pista cambia con la ventana: se vuelven a colocar los íconos.
    let anchoAntes = 0;
    const observador = new ResizeObserver(() => {
      if (pista.clientWidth && pista.clientWidth !== anchoAntes) { anchoAntes = pista.clientWidth; pintarPista(); }
    });
    observador.observe(pista);
    video.addEventListener('ended', () => {
      if (t.i >= t.clips.length - 1) return;
      let quedan = CUENTA;
      sigTxt.textContent = `Siguiente clip en ${quedan}`;
      sig.hidden = false;
      t.cuenta = setInterval(() => {
        quedan--;
        if (quedan <= 0) { ir(t.i + 1); return; }
        sigTxt.textContent = `Siguiente clip en ${quedan}`;
      }, 1000);
    });
    // Si vuelves a darle al play o te mueves por el video, la cuenta se cancela.
    video.addEventListener('play', pararCuenta);
    video.addEventListener('seeking', pararCuenta);
    sigYa.addEventListener('click', () => ir(t.i + 1));
    sigNo.addEventListener('click', pararCuenta);

    // Datos nuevos (miniaturas, favorito, clip renombrado o borrado): la pista se repinta y
    // el video sigue donde iba si su clip sigue ahí.
    t.actualizar = (grupo) => {
      const antes = t.clips[t.i]?.archivo;
      t.clips = [...grupo.clips].sort((a, b) => a.juego.inicio - b.juego.inicio);
      const j = t.clips.findIndex((c) => c.archivo === antes);
      if (j >= 0) {
        t.i = j;
        ctl.pintar(t.clips[j]);
        pintarPista();
      } else {
        ir(Math.min(t.i, t.clips.length - 1), false);
      }
    };
    t.soltar = () => {
      observador.disconnect();
      pararCuenta();
      video.pause();
      video.removeAttribute('src');
      video.load(); // suelta el archivo
    };
    t.clips = [...g.clips].sort((a, b) => a.juego.inicio - b.juego.inicio);
    ir(0, false);
    return t;
  }

  function quitarTimeline() {
    if (!tl) return;
    tl.soltar();
    tl = null;
  }
  // Al ir a otra sección, el video de la timeline se pausa.
  document.querySelectorAll('.navitem').forEach((n) => n.addEventListener('click', () => {
    if (n.dataset.page !== 'clips' && tl) { tl.video.pause(); }
  }));

  // Clip nuevo o miniaturas listas: se refresca si la sección está a la vista.
  const visible = () => $('page-clips').classList.contains('active');
  window.sharkTracker.clips.onGuardado((r) => { if (r.ok && visible()) cargar(); });
  window.sharkTracker.clips.onCambio(() => { if (visible()) cargar(); });

  window.galeriaClips = { cargar };
})();
