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
  const base = (c) => c.archivo.replace(/\.mp4$/i, '');
  function nombre(c) {
    if (c.renombrado) return base(c);
    if (c.titulo && c.titulo !== 'Clip') return c.titulo;
    if (c.manual) return 'Clip (Ctrl + F8)';
    return base(c);
  }

  let datos = null;
  let filtro = 'todos';
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
  $('gal-carpeta').addEventListener('click', () => window.sharkTracker.clips.abrirCarpeta());

  // ── Lista por partida ──
  function grupos(clips) {
    const mapa = new Map();
    for (const c of clips) {
      // Clips de antes de la galería (o pegados a mano): por día.
      const clave = c.partida ? `p${c.partida}` : `d${new Date(c.creado).toDateString()}`;
      if (!mapa.has(clave)) mapa.set(clave, { clave, inicio: c.partida ?? c.creado, campeon: null, clips: [], porDia: !c.partida });
      const g = mapa.get(clave);
      g.clips.push(c);
      g.campeon ??= c.campeon;
    }
    return [...mapa.values()].sort((a, b) => b.inicio - a.inicio);
  }

  function tarjeta(c) {
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
    mini.addEventListener('click', () => abrir(c));
    const estrella = el('button', `gal-estrella${c.favorito ? ' on' : ''}`, c.favorito ? '★' : '☆');
    estrella.type = 'button';
    estrella.setAttribute('aria-pressed', String(c.favorito));
    estrella.setAttribute('aria-label', c.favorito ? 'Quitar de favoritos' : 'Marcar como favorito');
    estrella.title = c.favorito ? 'Favorito: no se borra solo' : 'Favorito: no se borra solo ni cuenta en el límite';
    estrella.addEventListener('click', () => alternarFavorito(c));
    const info = el('div', 'gal-info');
    const tit = el('div', 'gal-tit', nombre(c));
    tit.title = nombre(c);
    info.append(tit, el('div', 'gal-sub', `${hora(c.creado)} · ${tamano(c.tamano)}`));
    card.append(mini, estrella, info);
    return card;
  }

  function pintarLista() {
    const lista = $('gal-lista');
    const clips = (datos?.clips ?? []).filter((c) => filtro === 'todos' || c.favorito);
    if (!clips.length) {
      const caja = el('div', 'emptywrap gal-vacio');
      if (filtro === 'favoritos' && datos?.clips.length) {
        caja.append(el('div', 'errtitle', 'Sin favoritos'), el('div', 'errtxt', 'Marca con ★ los clips que quieras guardar para siempre: no cuentan en el límite y no se borran solos.'));
      } else {
        caja.append(el('div', 'errtitle', 'Todavía no hay clips'),
          el('div', 'errtxt', 'Activa los clips en Ajustes › Clips. En partida se guardan solas tus kills, objetivos y ultis que terminan en algo, y con Ctrl + F8 guardas lo que quieras.'));
        const ir = el('button', 'checkbtn', 'Ir a Ajustes › Clips');
        ir.type = 'button';
        ir.addEventListener('click', () => {
          document.querySelector('.navitem[data-page="ajustes"]')?.click();
          document.querySelector('.stab[data-stab="clips"]')?.click();
        });
        caja.append(ir);
      }
      lista.replaceChildren(caja);
      return;
    }
    lista.replaceChildren(...grupos(clips).map((g) => {
      const sec = el('section', 'gal-grupo');
      const cab = el('div', 'gal-grupo-cab');
      const titulo = g.porDia ? `${dia(g.inicio)} · otros clips` : `${dia(g.inicio)}, ${hora(g.inicio)}${g.campeon ? ` · ${g.campeon}` : ''}`;
      cab.append(el('h2', 'gal-grupo-tit', titulo), el('span', 'gal-grupo-sub', `${g.clips.length} ${g.clips.length === 1 ? 'clip' : 'clips'}`));
      const grid = el('div', 'gal-grid');
      grid.append(...g.clips.map(tarjeta));
      sec.append(cab, grid);
      return sec;
    }));
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
