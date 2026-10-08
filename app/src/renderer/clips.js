// Sección Clips (C3): la galería de tus clips, agrupados por partida.
// Miniatura, duración y estrella de favorito en cada uno; al abrirlo, el visor con
// el video, renombrar, mostrar en la carpeta y borrar (a la papelera de Windows).
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
  let actual = null; // clip abierto en el visor

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
    // Dentro de una partida: sus clips.
    const g = grupoAbierto();
    if (g) {
      const cab = el('div', 'gal-cab-carpeta');
      const volver = el('button', 'btn-sec gal-volver', '‹ Partidas');
      volver.type = 'button';
      volver.addEventListener('click', () => { abierta = null; pintarLista(); });
      const tit = el('div', 'gal-cab-tit');
      tit.append(el('h2', 'gal-grupo-tit', g.titulo),
        el('span', 'gal-grupo-sub', `${dia(g.inicio)}${g.porDia ? '' : `, ${hora(g.inicio)}`} · ${cuantos(g.clips.length)} · ${tamano(g.tamano)}`));
      cab.append(volver, tit);
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
    if (actual?.archivo === c.archivo) pintarVisor(datos.clips.find((x) => x.archivo === c.archivo) ?? actual);
  }

  // ── Visor ──
  const visor = $('gal-visor');
  const video = $('visor-video');
  let borrarTimer = null;
  function soltarVideo() {
    // Windows no deja renombrar ni borrar un archivo que el video tiene abierto.
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  function pintarVisor(c) {
    actual = c;
    $('visor-titulo').textContent = nombre(c);
    $('visor-titulo').title = c.archivo;
    $('visor-sub').textContent = [`${dia(c.creado)}, ${hora(c.creado)}`, c.campeon, c.segundos ? duracion(c.segundos) : null, tamano(c.tamano)].filter(Boolean).join(' · ');
    const fav = $('visor-fav');
    fav.textContent = c.favorito ? '★ Favorito' : '☆ Favorito';
    fav.classList.toggle('on', c.favorito);
    fav.setAttribute('aria-pressed', String(c.favorito));
  }
  function abrir(c) {
    pintarVisor(c);
    cerrarRenombrar();
    reiniciarBorrar();
    $('visor-error').hidden = true;
    video.src = url('video', c.archivo);
    visor.showModal();
    video.play().catch(() => {});
  }
  visor.addEventListener('close', () => { soltarVideo(); actual = null; reiniciarBorrar(); });
  $('visor-cerrar').addEventListener('click', () => visor.close());
  // Clic en el fondo oscuro: cerrar.
  visor.addEventListener('click', (e) => { if (e.target === visor) visor.close(); });
  $('visor-fav').addEventListener('click', () => actual && alternarFavorito(actual));
  $('visor-mostrar').addEventListener('click', () => actual && window.sharkTracker.clips.mostrar(actual.archivo));

  function error(texto) {
    $('visor-error').textContent = texto;
    $('visor-error').hidden = !texto;
  }

  // Renombrar
  function cerrarRenombrar() {
    $('visor-renombrar').hidden = true;
    $('visor-titulo').hidden = false;
  }
  $('visor-btn-renombrar').addEventListener('click', () => {
    if (!actual) return;
    $('visor-titulo').hidden = true;
    $('visor-renombrar').hidden = false;
    $('visor-input').value = actual.renombrado || actual.manual ? base(actual) : nombre(actual);
    $('visor-input').focus();
    $('visor-input').select();
  });
  $('visor-renombrar-cancelar').addEventListener('click', cerrarRenombrar);
  $('visor-renombrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!actual) return;
    const t = video.currentTime;
    soltarVideo();
    const r = await window.sharkTracker.clips.renombrar(actual.archivo, $('visor-input').value);
    if (!r.ok) {
      error(r.motivo === 'existe' ? 'Ya hay un clip con ese nombre.' : r.motivo === 'nombre' ? 'Escribe un nombre.' : 'No se pudo renombrar (¿está abierto en otro programa?).');
    } else {
      error('');
      cerrarRenombrar();
    }
    await cargar();
    const c = datos.clips.find((x) => x.archivo === (r.ok ? r.archivo : actual.archivo));
    if (c) {
      pintarVisor(c);
      video.src = url('video', c.archivo);
      video.currentTime = t;
    }
  });

  // Borrar: dos clics (el primero pide confirmar).
  function reiniciarBorrar() {
    clearTimeout(borrarTimer);
    const b = $('visor-borrar');
    b.classList.remove('confirmar');
    b.textContent = 'Borrar';
  }
  $('visor-borrar').addEventListener('click', async () => {
    const b = $('visor-borrar');
    if (!actual) return;
    if (!b.classList.contains('confirmar')) {
      b.classList.add('confirmar');
      b.textContent = '¿Borrar? Va a la papelera';
      borrarTimer = setTimeout(reiniciarBorrar, 4000);
      return;
    }
    const archivo = actual.archivo;
    soltarVideo();
    const ok = await window.sharkTracker.clips.borrar(archivo);
    if (!ok) { error('No se pudo borrar (¿está abierto en otro programa?).'); video.src = url('video', archivo); reiniciarBorrar(); return; }
    visor.close();
    await cargar();
  });

  // Clip nuevo o miniaturas listas: se refresca si la sección está a la vista.
  const visible = () => $('page-clips').classList.contains('active');
  window.sharkTracker.clips.onGuardado((r) => { if (r.ok && visible()) cargar(); });
  window.sharkTracker.clips.onCambio(() => { if (visible()) cargar(); });

  window.galeriaClips = { cargar };
})();
