// "Meta": tier list por rol + ficha del campeón elegido (build, runas,
// hechizos, habilidades y counters) + tendencias del parche. Los datos los
// arma el proceso main (meta.js); aquí solo se dibujan.
(() => {
  const byId = (id) => document.getElementById(id);
  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto != null) n.textContent = texto;
    return n;
  };
  const pct = (x, dec = 1) => (x == null ? '—' : `${(x * 100).toFixed(dec).replace('.', ',')}%`);
  const miles = (n) => Number(n ?? 0).toLocaleString('es-ES');
  function haceCuanto(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 60) return min < 1 ? 'hace un momento' : `hace ${min} min`;
    const h = Math.round(min / 60);
    return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
  }

  const ROLES = [['top', 'Top'], ['jungle', 'Jungla'], ['mid', 'Mid'], ['adc', 'ADC'], ['support', 'Support']];
  const NOMBRE_ROL = Object.fromEntries(ROLES);
  // OP.GG: 1 = OP … 5 = débil.
  const TIERS = { 1: ['S+', 't1'], 2: ['S', 't2'], 3: ['A', 't3'], 4: ['B', 't4'], 5: ['C', 't5'] };
  // Fragmentos de runa (no vienen en runesReforged).
  const FRAGMENTOS = {
    5008: 'Fuerza adaptativa', 5005: 'Vel. de ataque', 5007: 'Aceleración de habilidad', 5010: 'Vel. de movimiento',
    5001: 'Vida (por nivel)', 5011: 'Vida', 5013: 'Tenacidad', 5002: 'Armadura', 5003: 'Resist. mágica',
  };

  let datos = null;          // respuesta de meta:tier
  let rol = null;
  let elegido = null;        // champion_id
  let cargadoEn = 0;
  let pedido = 0;            // para ignorar fichas que llegan tarde
  const fichas = new Map();  // `${id}:${rol}` → ficha (en esta sesión)

  const cat = () => datos?.catalogos ?? { campeones: {}, objetos: {}, runas: {}, hechizos: {} };
  const campeon = (id) => cat().campeones[id] ?? { nombre: `#${id}`, img: null };
  const filasRol = () => (datos?.filas ?? []).filter((f) => f.posicion === rol);
  const wrFila = (f) => (f?.partidas ? f.victorias / f.partidas : null);

  // ── Íconos con respaldo de iniciales ──
  function icono(url, cls, respaldo = '?', titulo = '') {
    const caja = el('div', cls);
    if (titulo) caja.title = titulo;
    if (url) {
      const img = el('img');
      img.alt = '';
      img.addEventListener('error', () => { img.remove(); caja.textContent = respaldo; });
      img.src = url;
      caja.append(img);
    } else caja.textContent = respaldo;
    return caja;
  }
  const iconoCampeon = (id, cls = 'mt-cico') => {
    const c = campeon(id);
    return icono(c.img, cls, c.nombre.slice(0, 2).toUpperCase(), c.nombre);
  };
  const iconoObjeto = (id) => {
    const o = cat().objetos[id];
    return icono(o?.img, 'mt-item', '?', o?.nombre ?? `Objeto ${id}`);
  };

  // ── Carga ──
  async function cargar(forzar = false) {
    if (!forzar && datos?.estado === 'ok' && Date.now() - cargadoEn < 10 * 60 * 1000) return;
    byId('meta-sub').textContent = 'Cargando el meta…';
    const r = await window.sharkTracker.meta.tier();
    if (r?.estado !== 'ok') {
      byId('meta-sub').textContent = r?.estado === 'sin_sesion'
        ? 'Inicia sesión para ver el meta.'
        : 'No se pudo cargar el meta de SharkTracker. Prueba en un rato.';
      return;
    }
    datos = r;
    cargadoEn = Date.now();
    if (!rol) rol = r.rol;
    pintarSub();
    pintarRoles();
    pintarTodo();
  }

  function pintarSub() {
    const partes = ['Datos de OP.GG'];
    if (datos.parche) partes.push(`parche ${datos.parche}`);
    partes.push('builds y counters en Esmeralda+');
    if (datos.actualizado) partes.push(`tier list actualizada ${haceCuanto(datos.actualizado)}`);
    byId('meta-sub').textContent = partes.join(' · ');
  }

  function pintarRoles() {
    const caja = byId('meta-roles');
    caja.replaceChildren();
    for (const [clave, nombre] of ROLES) {
      const b = el('button', `qtab${clave === rol ? ' active' : ''}`, nombre);
      b.type = 'button';
      b.addEventListener('click', () => { rol = clave; elegido = null; pintarRoles(); pintarTodo(); });
      caja.append(b);
    }
  }

  function pintarTodo() {
    const filas = filasRol();
    if (!filas.length) {
      byId('meta-tier').replaceChildren(el('div', 'mt-vacio', datos.filas.length
        ? 'Sin datos para este rol.' : 'La tier list todavía no se ha generado en SharkTracker.'));
      byId('meta-tend').replaceChildren();
      byId('meta-ficha').replaceChildren();
      return;
    }
    if (!elegido) {
      // Tu campeón más jugado si se juega en este rol; si no, el primero de la lista.
      elegido = (datos.misCampeones ?? []).find((id) => filas.some((f) => f.champion_id === id && f.role_rate >= 0.15))
        ?? filas[0].champion_id;
    }
    pintarTier(filas);
    pintarTendencias(filas);
    abrir(elegido);
  }

  // ── Tier list ──
  function pintarTier(filas) {
    const lista = el('div', 'mt-lista');
    for (const f of filas) {
      const b = el('button', `mt-fila${f.champion_id === elegido ? ' sel' : ''}${f.is_rip ? ' rip' : ''}`);
      b.type = 'button';
      b.dataset.id = f.champion_id;
      const [letra, clase] = TIERS[f.tier] ?? ['–', 't5'];
      const cambio = f.rank_prev_patch ? f.rank_prev_patch - f.rank : 0;
      const nombre = el('div', 'mt-fnom');
      nombre.append(el('b', null, campeon(f.champion_id).nombre),
        el('span', null, `${pct(wrFila(f))} · ${pct(f.pick_rate, 0)} pick`));
      b.append(el('span', `mt-tier ${clase}`, letra), iconoCampeon(f.champion_id), nombre,
        el('span', `mt-mov ${cambio >= 3 ? 'sube' : cambio <= -3 ? 'baja' : ''}`, cambio >= 3 ? '▲' : cambio <= -3 ? '▼' : ''));
      b.addEventListener('click', () => abrir(f.champion_id));
      lista.append(b);
    }
    byId('meta-tier').replaceChildren(lista);
  }

  // ── Tendencias: quién subió y quién bajó de puesto respecto al parche anterior ──
  function pintarTendencias(filas) {
    const con = filas.filter((f) => f.rank_prev_patch && f.partidas >= 1000)
      .map((f) => ({ ...f, cambio: f.rank_prev_patch - f.rank }));
    const suben = [...con].sort((a, b) => b.cambio - a.cambio).filter((f) => f.cambio > 0).slice(0, 4);
    const bajan = [...con].sort((a, b) => a.cambio - b.cambio).filter((f) => f.cambio < 0).slice(0, 4);
    const caja = byId('meta-tend');
    caja.replaceChildren();
    if (!suben.length && !bajan.length) { caja.append(el('div', 'mt-vacio', 'Sin cambios respecto al parche anterior.')); return; }
    for (const f of [...suben, ...bajan]) {
      const fila = el('button', 'mt-tfila');
      fila.type = 'button';
      fila.append(iconoCampeon(f.champion_id, 'mt-cico sm'), el('span', 'mt-tnom', campeon(f.champion_id).nombre),
        el('span', `mt-tcam ${f.cambio > 0 ? 'sube' : 'baja'}`, `${f.cambio > 0 ? '▲' : '▼'} ${Math.abs(f.cambio)} puestos`));
      fila.title = `Puesto ${f.rank} (antes ${f.rank_prev_patch})`;
      fila.addEventListener('click', () => abrir(f.champion_id));
      caja.append(fila);
    }
  }

  // ── Ficha del campeón ──
  async function abrir(id) {
    elegido = id;
    document.querySelectorAll('#meta-tier .mt-fila').forEach((b) => b.classList.toggle('sel', Number(b.dataset.id) === id));
    const clave = `${id}:${rol}`;
    const n = ++pedido;
    if (fichas.has(clave)) return pintarFicha(id, fichas.get(clave));
    pintarFicha(id, null, 'Cargando build, runas y counters…');
    const r = await window.sharkTracker.meta.campeon(id, rol);
    if (n !== pedido) return; // ya eligieron otro
    if (r?.estado === 'ok') {
      fichas.set(clave, r);
      pintarFicha(id, r);
    } else {
      pintarFicha(id, null, r?.estado === 'opgg_caido'
        ? 'OP.GG no respondió. Prueba de nuevo en un rato.'
        : `No se pudo cargar la ficha de este campeón.${r?.detalle ? ` (${r.detalle})` : r?.estado ? ` (${r.estado})` : ''}`);
    }
  }

  function tarjeta(titulo, dot = '') {
    const c = el('div', 'card mt-card');
    const hd = el('div', 'cardhd');
    hd.append(el('span', `dot ${dot}`), document.createTextNode(titulo));
    c.append(hd);
    return c;
  }
  const detalle = (g) => (g ? `${pct(g.winrate)} WR · ${miles(g.partidas)} partidas` : '');

  function pintarFicha(id, r, mensaje) {
    const caja = byId('meta-ficha');
    caja.replaceChildren();
    const c = campeon(id);
    const fila = filasRol().find((f) => f.champion_id === id);

    // Cabecera + buscador
    const cab = el('div', 'card mt-cab');
    const ident = el('div', 'mt-ident');
    ident.append(el('div', 'mt-cnom', c.nombre));
    const [letra, clase] = TIERS[fila?.tier] ?? [null, null];
    const sub = el('div', 'mt-csub');
    if (letra) sub.append(el('span', `mt-tier ${clase}`, letra));
    sub.append(document.createTextNode([
      NOMBRE_ROL[rol],
      fila ? `${pct(wrFila(fila))} WR` : null,
      fila ? `${pct(fila.pick_rate, 0)} pick` : null,
      fila ? `${pct(fila.ban_rate, 0)} ban` : null,
    ].filter(Boolean).join(' · ')));
    ident.append(sub);
    cab.append(iconoCampeon(id, 'mt-cico lg'), ident, buscador());
    caja.append(cab);

    if (!r) { caja.append(el('div', 'mt-vacio', mensaje)); return; }
    const d = r.datos;
    const nota = el('div', 'mt-nota', `Esmeralda+ · ${miles(d.resumen?.partidas)} partidas${r.vieja ? ' · guardada (OP.GG no respondió)' : ''}`);
    caja.append(nota);

    // Build
    const build = tarjeta('Build', 'dot-pos');
    const orden = el('div', 'mt-build');
    const paso = (titulo, g) => {
      if (!g) return;
      const col = el('div', 'mt-paso');
      const iconos = el('div', 'mt-items');
      g.ids.forEach((it, i) => { if (i) iconos.append(el('span', 'mt-flecha', '›')); iconos.append(iconoObjeto(it)); });
      col.append(el('div', 'mt-pasot', titulo), iconos, el('div', 'mt-pasod', detalle(g)));
      orden.append(col);
    };
    paso('Inicio', d.inicio);
    paso('Core', d.core);
    paso('Botas', d.botas);
    build.append(orden);
    const situ = [['4.º objeto', d.cuarto], ['5.º objeto', d.quinto], ['6.º objeto', d.sexto]].filter(([, l]) => l?.length);
    if (situ.length) {
      build.append(el('div', 'mt-subt', 'Situacionales — según la partida'));
      for (const [titulo, lista] of situ) {
        const f = el('div', 'mt-situ');
        f.append(el('span', 'mt-situt', titulo));
        for (const g of lista.slice(0, 4)) {
          const op = el('div', 'mt-op');
          op.append(iconoObjeto(g.ids[0]), el('span', null, pct(g.winrate)));
          op.title = `${cat().objetos[g.ids[0]]?.nombre ?? ''} · ${detalle(g)}`;
          f.append(op);
        }
        build.append(f);
      }
    }
    caja.append(build);

    // Runas, hechizos y habilidades
    const runas = tarjeta('Runas, hechizos y habilidades', 'dot-carga');
    if (d.runas) {
      const ru = d.runas;
      const fila1 = el('div', 'mt-runas');
      const rama = (estilo, ids, principal) => {
        const b = el('div', 'mt-rama');
        const t = el('div', 'mt-ramat');
        const e = cat().runas[estilo];
        t.append(icono(e?.img, 'mt-rico sm'), document.createTextNode(e?.nombre ?? ''));
        const ic = el('div', 'mt-ricos');
        ids.forEach((rid, i) => ic.append(icono(cat().runas[rid]?.img, `mt-rico${principal && i === 0 ? ' clave' : ''}`, '?', cat().runas[rid]?.nombre ?? '')));
        b.append(t, ic);
        return b;
      };
      fila1.append(rama(ru.principal, ru.runas_principales, true), rama(ru.secundaria, ru.runas_secundarias, false));
      runas.append(fila1);
      const frag = el('div', 'mt-frag');
      for (const f of ru.fragmentos ?? []) frag.append(el('span', 'mt-chip', FRAGMENTOS[f] ?? `#${f}`));
      runas.append(frag, el('div', 'mt-pasod', detalle(ru)));
    }
    const fila2 = el('div', 'mt-hab');
    if (d.hechizos) {
      const h = el('div', 'mt-paso');
      const ic = el('div', 'mt-items');
      for (const sid of d.hechizos.ids) ic.append(icono(cat().hechizos[sid]?.img, 'mt-item', '?', cat().hechizos[sid]?.nombre ?? ''));
      h.append(el('div', 'mt-pasot', 'Hechizos'), ic, el('div', 'mt-pasod', detalle(d.hechizos)));
      fila2.append(h);
    }
    if (d.maximizar) {
      const m = el('div', 'mt-paso');
      const ord = el('div', 'mt-max');
      d.maximizar.orden.forEach((k, i) => { if (i) ord.append(el('span', 'mt-flecha', '›')); ord.append(el('span', 'mt-tecla', k)); });
      m.append(el('div', 'mt-pasot', 'Subir primero'), ord, el('div', 'mt-pasod', detalle(d.maximizar)));
      fila2.append(m);
    }
    runas.append(fila2);
    if (d.habilidades?.orden?.length) {
      const niv = el('div', 'mt-niveles');
      d.habilidades.orden.slice(0, 18).forEach((k, i) => {
        const n = el('div', `mt-nivel k${k}`);
        n.append(el('span', null, String(i + 1)), el('b', null, k));
        niv.append(n);
      });
      runas.append(el('div', 'mt-subt', 'Orden por nivel'), niv);
    }
    caja.append(runas);

    // Counters
    const cnt = tarjeta('Counters', 'dot-discord');
    const base = wrFila(fila) ?? d.resumen?.winrate ?? 0.5;
    const columna = (titulo, lista, cls) => {
      const col = el('div', 'mt-ccol');
      col.append(el('div', `mt-ccolt ${cls}`, titulo));
      if (!lista?.length) col.append(el('div', 'mt-vacio sm', 'Pocas partidas para saberlo.'));
      for (const x of lista ?? []) {
        const f = el('button', 'mt-cfila');
        f.type = 'button';
        const dif = x.winrate != null ? x.winrate - base : null;
        const nom = el('div', 'mt-fnom');
        nom.append(el('b', null, campeon(x.champion_id).nombre), el('span', null, `ganas ${pct(x.winrate)} · ${miles(x.partidas)} partidas`));
        f.append(iconoCampeon(x.champion_id, 'mt-cico sm'), nom,
          el('span', `mt-dif ${dif >= 0 ? 'sube' : 'baja'}`, dif == null ? '' : `${dif >= 0 ? '+' : '−'}${Math.abs(dif * 100).toFixed(1).replace('.', ',')}%`));
        f.title = 'Ver la ficha de este campeón en este rol';
        f.addEventListener('click', () => abrir(x.champion_id));
        col.append(f);
      }
      return col;
    };
    const cols = el('div', 'mt-counters');
    cols.append(columna('Te cuesta contra', d.te_cuesta, 'baja'), columna('Buena elección contra', d.le_ganas, 'sube'));
    cnt.append(cols);
    caja.append(cnt);
  }

  // Buscador: cualquier campeón, en el rol elegido.
  function buscador() {
    const caja = el('div', 'mt-buscar');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Buscar otro campeón…';
    input.setAttribute('list', 'meta-campeones');
    input.setAttribute('aria-label', 'Buscar campeón');
    const lista = el('datalist');
    lista.id = 'meta-campeones';
    const porNombre = new Map();
    for (const [key, c] of Object.entries(cat().campeones).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'))) {
      porNombre.set(c.nombre.toLowerCase(), Number(key));
      const op = el('option');
      op.value = c.nombre;
      lista.append(op);
    }
    input.addEventListener('change', () => {
      const id = porNombre.get(input.value.trim().toLowerCase());
      if (id) abrir(id);
    });
    caja.append(input, lista);
    return caja;
  }

  window.metaPagina = { cargar };
})();
