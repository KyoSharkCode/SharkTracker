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
    if (filtro === 'favoritos' || !grupoAbierto() || vista !== 'timeline') quitarTimeline();
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
      if (vista === 'timeline' && tl?.clave === g.clave && lista.contains(tl.raiz)) {
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
      cab.append(volver, tit, modos);
      if (vista === 'timeline') {
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
  // Los clips de la partida, del primero al último, en un solo reproductor con una pista
  // debajo (un bloque por clip, ancho según lo que dura). Al terminar un clip, abajo a la
  // izquierda del video sale "Siguiente clip en 5…": si no lo cancelas, pasa al siguiente.
  const CUENTA = 5;
  // Color del bloque según la jugada principal (la primera del título es la más vistosa).
  function tipoJugada(c) {
    if (c.manual || !c.titulo || c.titulo === 'Clip') return 'manual';
    const t = c.titulo.split(' + ')[0];
    if (/Muerte/.test(t)) return 'muerte';
    if (/Barón|Dragón|dragón|Ancestral|Heraldo|Larvas|Atakhan/.test(t)) return 'objetivo';
    if (/Torre|Inhibidor/.test(t)) return 'estructura';
    return 'kill';
  }

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
    pista.setAttribute('role', 'list');
    pista.setAttribute('aria-label', 'Clips de la partida');
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
    function pintarPista() {
      contador.textContent = `Clip ${t.i + 1} de ${t.clips.length}`;
      pista.replaceChildren(...t.clips.map((c, i) => {
        const b = el('button', `tl-bloque tl-${tipoJugada(c)}${i === t.i ? ' on' : ''}`);
        b.type = 'button';
        b.setAttribute('role', 'listitem');
        b.style.flexGrow = String(Math.max(10, c.segundos ?? 40));
        b.title = `${nombre(c)} · ${hora(c.creado)}${c.segundos ? ` · ${duracion(c.segundos)}` : ''}`;
        b.setAttribute('aria-label', `${i + 1}. ${b.title}`);
        if (i === t.i) b.setAttribute('aria-current', 'true');
        const relleno = el('i', 'tl-relleno');
        if (i < t.i) relleno.style.width = '100%';
        b.append(relleno, el('span', 'tl-etq', `${c.favorito ? '★ ' : ''}${nombre(c)}`));
        b.addEventListener('click', () => ir(i));
        return b;
      }));
    }
    video.addEventListener('timeupdate', () => {
      const r = pista.querySelector('.tl-bloque.on .tl-relleno');
      if (r && video.duration) r.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
    });
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
      t.clips = [...grupo.clips].sort((a, b) => a.creado - b.creado);
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
      pararCuenta();
      video.pause();
      video.removeAttribute('src');
      video.load(); // suelta el archivo
    };
    t.clips = [...g.clips].sort((a, b) => a.creado - b.creado);
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
