// "En Vivo": selección de campeones en tiempo real (datos del cliente de LoL
// vía el proceso main + tier list y fichas de Meta).
//
// - Antes de fijar: picks recomendados (tus campeones, meta del rol y los que
//   le ganan a tu rival de línea) y bans recomendados.
// - Al fijar: runas, hechizos y build de tu campeón, con botones para
//   importarlos al cliente. SIEMPRE decide el usuario: nada se importa solo.
// - "Contra este equipo": la build adaptada a los rivales que ya fijaron
//   (reglas en src/build-adaptada.js), con su propio botón de importar.
// - Aliados y rivales. En ranked no se muestran los nombres ocultos.
(() => {
  const byId = (id) => document.getElementById(id);
  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto != null) n.textContent = texto;
    return n;
  };
  const pct = (x, dec = 1) => (x == null ? '—' : `${(x * 100).toFixed(dec).replace('.', ',')}%`);
  const api = () => window.sharkTracker.envivo;

  const ROL_ES = { top: 'Top', jungle: 'Jungla', mid: 'Mid', adc: 'ADC', support: 'Support' };
  const TIERS = { 1: ['S+', 't1'], 2: ['S', 't2'], 3: ['A', 't3'], 4: ['B', 't4'], 5: ['C', 't5'] };
  const COLAS = {
    420: 'SoloQ', 440: 'Flex', 400: 'Normal (reclutamiento)', 430: 'Normal', 490: 'Partida Rápida',
    450: 'ARAM', 2400: 'ARAM', 700: 'Clash', 1700: 'Arena', 1710: 'Arena', 1720: 'Arena', 1750: 'Arena', 900: 'URF', 1900: 'URF', 0: 'Personalizada',
  };
  const TIER_ES = {
    IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
    DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Retador',
  };
  const SIN_ROLES = new Set([450, 2400, 1700, 1710, 1720, 1750, 900, 1900]);
  const FASES = {
    None: 'en el cliente', Lobby: 'en la sala', Matchmaking: 'buscando partida', ReadyCheck: 'partida encontrada',
    GameStart: 'cargando la partida', InProgress: 'en partida', WaitingForStats: 'fin de partida',
    PreEndOfGame: 'fin de partida', EndOfGame: 'fin de partida', Reconnect: 'reconectando',
  };
  const FRAGMENTOS = {
    5008: 'Fuerza adaptativa', 5005: 'Vel. de ataque', 5007: 'Aceleración de habilidad', 5010: 'Vel. de movimiento',
    5001: 'Vida (por nivel)', 5011: 'Vida', 5013: 'Tenacidad', 5002: 'Armadura', 5003: 'Resist. mágica',
  };

  let estado = { conectado: false };
  let clave = '';              // estado sin el reloj: si no cambia, solo se actualiza el tiempo
  let reloj = { segundos: 0, desde: 0 };
  let meta = null;             // respuesta de meta:tier (tier list + catálogos + tus campeones)
  let metaEn = 0;
  let amigos = new Map();      // riotId en minúsculas → rango
  const fichas = new Map();    // `${id}:${rol}` → ficha | 'cargando' | 'error'
  const adaptadas = new Map(); // `${id}:${rol}:${rivales}` → build adaptada | 'cargando'
  let avisos = {};             // resultado de los botones (runas / hechizos / build)
  let campeonAvisos = null;

  const cat = () => meta?.catalogos ?? { campeones: {}, objetos: {}, runas: {}, hechizos: {} };
  const campeon = (id) => cat().campeones[id] ?? { nombre: id ? `#${id}` : '?', img: null };
  const filas = () => meta?.filas ?? [];
  const fila = (id, rol) => filas().find((f) => f.champion_id === id && f.posicion === rol);
  const wr = (f) => (f?.partidas ? f.victorias / f.partidas : null);

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
    if (!id) return el('div', `${cls} ev-vacio`, '?');
    const c = campeon(id);
    return icono(c.img, cls, c.nombre.slice(0, 2).toUpperCase(), c.nombre);
  };
  const iconoObjeto = (id) => icono(cat().objetos[id]?.img, 'mt-item', '?', cat().objetos[id]?.nombre ?? `Objeto ${id}`);
  function tarjeta(titulo, dot = '') {
    const c = el('div', 'card mt-card');
    const hd = el('div', 'cardhd');
    hd.append(el('span', `dot ${dot}`), document.createTextNode(titulo));
    c.append(hd);
    return c;
  }

  // ── Datos de Meta (tier list y fichas) ──
  async function cargarMeta() {
    if (meta && Date.now() - metaEn < 10 * 60 * 1000) return;
    const r = await window.sharkTracker.meta.tier();
    if (r?.estado === 'ok') { meta = r; metaEn = Date.now(); }
  }
  function ficha(id, rol) {
    if (!id || !rol) return null;
    const k = `${id}:${rol}`;
    const f = fichas.get(k);
    if (f === undefined) {
      fichas.set(k, 'cargando');
      window.sharkTracker.meta.campeon(id, rol).then((r) => {
        fichas.set(k, r?.estado === 'ok' ? r.datos : 'error');
        pintar(true);
      });
      return null;
    }
    return typeof f === 'object' ? f : null;
  }

  // Build adaptada a los rivales que ya fijaron (se recalcula cuando fija otro).
  function adaptada(id, rol, f) {
    const rivales = (estado.rivales ?? []).map((r) => r.campeon).filter(Boolean);
    if (!f || !rivales.length) return null;
    const k = `${id}:${rol}:${[...rivales].sort().join(',')}`;
    const a = adaptadas.get(k);
    if (a === undefined) {
      adaptadas.set(k, 'cargando');
      window.sharkTracker.meta.adaptar(f, id, rivales).then((r) => { adaptadas.set(k, r ?? 'error'); pintar(true); });
      return null;
    }
    return typeof a === 'object' ? a : null;
  }

  // ── Roles ──
  const miRol = () => estado.yo?.rol ?? meta?.rol ?? null;
  const sinRoles = () => SIN_ROLES.has(estado.cola);
  // Rol estimado de cada rival (el cliente no lo dice): el rol donde más se juega cada campeón.
  function rolesRivales() {
    const libres = new Set(Object.keys(ROL_ES));
    const res = new Map();
    const conCampeon = (estado.rivales ?? []).filter((r) => r.campeon);
    for (const r of conCampeon) if (r.rol) { res.set(r.campeon, r.rol); libres.delete(r.rol); }
    const opciones = [];
    for (const r of conCampeon.filter((x) => !x.rol)) {
      for (const f of filas().filter((x) => x.champion_id === r.campeon)) opciones.push([f.role_rate ?? 0, r.campeon, f.posicion]);
    }
    opciones.sort((a, b) => b[0] - a[0]);
    for (const [, id, pos] of opciones) if (!res.has(id) && libres.has(pos)) { res.set(id, pos); libres.delete(pos); }
    return res;
  }
  const rivalDeLinea = () => {
    const rol = miRol();
    for (const [id, pos] of rolesRivales()) if (pos === rol) return id;
    return null;
  };
  const ocupados = () => new Set([
    ...(estado.bans?.nuestros ?? []), ...(estado.bans?.suyos ?? []),
    ...(estado.aliados ?? []).map((a) => a.campeon), ...(estado.rivales ?? []).map((r) => r.campeon),
  ].filter(Boolean));

  // ── Pintar ──
  function chipCampeon(id, detalle, destacado = false) {
    const c = el('div', `ev-chip${destacado ? ' dest' : ''}`);
    c.append(iconoCampeon(id, 'mt-cico sm'), el('span', 'ev-chipn', campeon(id).nombre), el('span', 'ev-chipd', detalle));
    return c;
  }
  function columna(titulo, hijos, vacio) {
    const col = el('div', 'ev-col');
    col.append(el('div', 'ev-colt', titulo));
    if (hijos.length) col.append(...hijos); else col.append(el('div', 'mt-vacio sm', vacio));
    return col;
  }

  function cardPicks(rol) {
    const c = tarjeta('Picks recomendados');
    const fuera = ocupados();
    const tuyos = (meta?.misCampeones ?? [])
      .filter((id) => !fuera.has(id) && (fila(id, rol)?.role_rate ?? 0) >= 0.15)
      .slice(0, 3)
      .map((id, i) => { const f = fila(id, rol); return chipCampeon(id, `${TIERS[f?.tier]?.[0] ?? '–'} · ${pct(wr(f))}`, i === 0); });
    const delMeta = filas().filter((f) => f.posicion === rol && !fuera.has(f.champion_id)).slice(0, 3)
      .map((f) => chipCampeon(f.champion_id, `${TIERS[f.tier]?.[0] ?? '–'} · ${pct(wr(f))}`));
    const grid = el('div', 'ev-cols');
    grid.append(columna('Tus campeones', tuyos, `Ninguno de tus más jugados se juega de ${ROL_ES[rol]}.`),
      columna(`Meta · ${ROL_ES[rol]}`, delMeta, 'Sin datos de Meta todavía.'));
    const rival = rivalDeLinea();
    if (rival) {
      const fr = ficha(rival, rol);
      const lista = (fr?.te_cuesta ?? []).filter((x) => !fuera.has(x.champion_id)).slice(0, 3)
        .map((x) => chipCampeon(x.champion_id, `le gana ${pct(1 - x.winrate)}`));
      grid.append(columna(`Le ganan a ${campeon(rival).nombre}`, lista, fr ? 'Pocas partidas para saberlo.' : 'Cargando…'));
    }
    c.append(grid);
    return c;
  }

  function cardBans(rol) {
    const c = tarjeta('Bans recomendados', 'dot-err');
    const fuera = ocupados();
    const ref = estado.yo?.campeon || estado.yo?.intencion
      || (meta?.misCampeones ?? []).find((id) => (fila(id, rol)?.role_rate ?? 0) >= 0.15) || null;
    const grid = el('div', 'ev-cols');
    if (ref) {
      const f = ficha(ref, rol);
      const base = wr(fila(ref, rol)) ?? 0.5;
      const lista = (f?.te_cuesta ?? []).filter((x) => !fuera.has(x.champion_id)).slice(0, 3)
        .map((x) => chipCampeon(x.champion_id, `${((x.winrate - base) * 100).toFixed(1).replace('.', ',')}% vs ti`));
      grid.append(columna(`Le cuestan a tu ${campeon(ref).nombre}`, lista, f ? 'Pocas partidas para saberlo.' : 'Cargando…'));
    }
    // No sugerir banear tu propio campeón (el que tienes en mente o tus más jugados).
    const vistos = new Set([ref, ...(meta?.misCampeones ?? [])].filter(Boolean));
    const baneados = [...filas()].sort((a, b) => (b.ban_rate ?? 0) - (a.ban_rate ?? 0))
      .filter((f) => !fuera.has(f.champion_id) && !vistos.has(f.champion_id) && vistos.add(f.champion_id))
      .slice(0, 3).map((f) => chipCampeon(f.champion_id, `${pct(f.ban_rate, 0)} ban`));
    grid.append(columna('Más baneados', baneados, 'Sin datos de Meta todavía.'));
    c.append(grid);
    return c;
  }

  function aviso(tipo) {
    const a = avisos[tipo];
    if (!a) return null;
    return el('div', `ev-aviso ${a.ok ? 'ok' : 'mal'}`, a.texto);
  }
  function boton(texto, tipo, accion) {
    const b = el('button', 'ev-btn', avisos[tipo]?.cargando ? 'Importando…' : texto);
    b.type = 'button';
    b.disabled = !!avisos[tipo]?.cargando;
    b.addEventListener('click', async () => {
      avisos[tipo] = { cargando: true };
      pintar(true);
      const r = await accion();
      const texto = r?.reemplazada ? `✓ Página de runas creada en lugar de "${r.reemplazada}" (no había hueco).` : TEXTO_OK[tipo];
      avisos[tipo] = r?.ok ? { ok: true, texto } : { ok: false, texto: r?.error ?? 'No se pudo.' };
      pintar(true);
    });
    return b;
  }
  const TEXTO_OK = {
    runas: '✓ Página de runas creada y seleccionada en el cliente.',
    hechizos: '✓ Hechizos puestos (tu Destello se queda en su tecla).',
    build: '✓ Set de objetos creado: lo verás en la tienda del juego.',
    buildAdaptada: '✓ Set adaptado creado: arriba del todo verás "Contra este equipo".',
  };

  function cardRunas(id, rol, f) {
    const c = tarjeta('Runas y hechizos', 'dot-carga');
    if (!f) { c.append(el('div', 'mt-vacio', 'Cargando runas…')); return c; }
    const ru = f.runas;
    if (ru) {
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
      const frag = el('div', 'mt-frag');
      for (const x of ru.fragmentos ?? []) frag.append(el('span', 'mt-chip', FRAGMENTOS[x] ?? `#${x}`));
      c.append(fila1, frag, el('div', 'mt-pasod', `${pct(ru.winrate)} WR · Esmeralda+`));
      const acc = el('div', 'ev-acciones');
      acc.append(boton('Importar runas', 'runas', () => api().importarRunas({
        nombre: campeon(id).nombre, principal: ru.principal, secundaria: ru.secundaria,
        runas: [...ru.runas_principales, ...ru.runas_secundarias, ...(ru.fragmentos ?? [])],
      })));
      c.append(acc);
      const a = aviso('runas'); if (a) c.append(a);
    }
    if (f.hechizos) {
      const h = el('div', 'ev-hech');
      const ic = el('div', 'mt-items');
      for (const sid of f.hechizos.ids) ic.append(icono(cat().hechizos[sid]?.img, 'mt-item', '?', cat().hechizos[sid]?.nombre ?? ''));
      h.append(ic, el('span', 'mt-pasod', `${f.hechizos.ids.map((s) => cat().hechizos[s]?.nombre ?? s).join(' + ')} · ${pct(f.hechizos.winrate)} WR`));
      h.append(boton('Poner hechizos', 'hechizos', () => api().ponerHechizos(f.hechizos.ids)));
      c.append(h);
      const a = aviso('hechizos'); if (a) c.append(a);
    }
    return c;
  }

  function cardBuild(id, rol, f) {
    const c = tarjeta('Build recomendada', 'dot-pos');
    if (!f) { c.append(el('div', 'mt-vacio', 'Cargando build…')); return c; }
    const orden = el('div', 'mt-build');
    const paso = (titulo, g) => {
      if (!g) return;
      const col = el('div', 'mt-paso');
      const iconos = el('div', 'mt-items');
      g.ids.forEach((it, i) => { if (i) iconos.append(el('span', 'mt-flecha', '›')); iconos.append(iconoObjeto(it)); });
      col.append(el('div', 'mt-pasot', titulo), iconos, el('div', 'mt-pasod', `${pct(g.winrate)} WR`));
      orden.append(col);
    };
    paso('Inicio', f.inicio); paso('Core', f.core); paso('Botas', f.botas);
    c.append(orden);
    const a = adaptada(id, rol, f);
    const estrella = new Set(a?.estrella ?? []);
    const situ = [['4.º', f.cuarto], ['5.º', f.quinto], ['6.º', f.sexto]].filter(([, l]) => l?.length);
    if (situ.length) {
      c.append(el('div', 'mt-subt', 'Situacionales — según la partida'));
      for (const [t, lista] of situ) {
        const fl = el('div', 'mt-situ');
        fl.append(el('span', 'mt-situt', `${t} objeto`));
        for (const g of lista.slice(0, 3)) {
          const op = el('div', 'mt-op');
          const encaja = estrella.has(Number(g.ids[0]));
          if (encaja) { op.classList.add('ev-estrella'); op.title = 'Encaja con este equipo rival'; }
          op.append(iconoObjeto(g.ids[0]), el('span', null, `${encaja ? '⭐ ' : ''}${pct(g.winrate)}`));
          fl.append(op);
        }
        c.append(fl);
      }
    }
    // ── Contra este equipo ──
    const rivalesFijados = (estado.rivales ?? []).filter((r) => r.campeon).length;
    const cambios = a ? [...a.sugerencias.map((s) => ({ item: s.item, titulo: s.titulo, motivo: s.motivo, deOpgg: s.deOpgg })),
      ...(a.botas ? [{ item: a.botas.item, titulo: 'Botas', motivo: a.botas.motivo, deOpgg: false }] : [])] : [];
    c.append(el('div', 'mt-subt', 'Contra este equipo'));
    if (!rivalesFijados) c.append(el('div', 'mt-pasod', 'Aparece cuando los rivales fijen su campeón.'));
    else if (!a) c.append(el('div', 'mt-pasod', 'Analizando a los rivales…'));
    else {
      if (a.resumen) c.append(el('div', 'ev-adapt-res', `${a.resumen}${rivalesFijados < 5 ? ` (${rivalesFijados} de 5 rivales)` : ''}`));
      if (!cambios.length) c.append(el('div', 'mt-pasod', 'La build de OP.GG ya encaja con este equipo.'));
      for (const x of cambios) {
        const fl = el('div', 'ev-adapt');
        const txt = el('div');
        txt.append(el('div', 'ev-adapt-t', `${x.titulo}: ${cat().objetos[x.item]?.nombre ?? x.item}`),
          el('div', 'mt-pasod', `${x.motivo}${x.deOpgg ? ' · de los situacionales de OP.GG' : ''}`));
        fl.append(iconoObjeto(x.item), txt);
        c.append(fl);
      }
    }

    const bloquesBase = [
      { titulo: 'Inicio', items: f.inicio?.ids ?? [] },
      { titulo: 'Core', items: f.core?.ids ?? [] },
      { titulo: 'Botas', items: f.botas?.ids ?? [] },
      { titulo: '4.º objeto (elige uno)', items: (f.cuarto ?? []).map((g) => g.ids[0]) },
      { titulo: '5.º objeto (elige uno)', items: (f.quinto ?? []).map((g) => g.ids[0]) },
      { titulo: '6.º objeto (elige uno)', items: (f.sexto ?? []).map((g) => g.ids[0]) },
    ];
    const titulo = `${campeon(id).nombre} ${ROL_ES[rol] ?? ''}`.trim();
    const acc = el('div', 'ev-acciones');
    acc.append(boton('Importar build', 'build', () => api().importarBuild({ championId: id, titulo, bloques: bloquesBase })));
    if (cambios.length) {
      acc.append(boton('Importar build adaptada', 'buildAdaptada', () => api().importarBuild({
        championId: id,
        titulo: `${titulo} (adaptada)`,
        bloques: [{ titulo: 'Contra este equipo', items: cambios.map((x) => x.item) }, ...bloquesBase],
      })));
    }
    c.append(acc);
    for (const t of ['build', 'buildAdaptada']) { const av = aviso(t); if (av) c.append(av); }
    return c;
  }

  function filaJugador(id, arriba, abajo, extra) {
    const f = el('div', 'ev-fila');
    const t = el('div', 'mt-fnom');
    t.append(el('b', null, arriba), el('span', null, abajo));
    f.append(iconoCampeon(id, 'mt-cico'), t);
    if (extra) f.append(extra);
    return f;
  }
  function bansTira(lista) {
    const t = el('div', 'ev-bans');
    for (const id of lista ?? []) t.append(iconoCampeon(id, 'mt-cico sm ev-ban'));
    if (!(lista ?? []).length) t.append(el('span', 'mt-pasod', 'Sin baneos todavía'));
    return t;
  }

  function cardAliados() {
    const c = tarjeta('Tu equipo');
    c.append(el('div', 'ev-colt', 'Baneos'), bansTira(estado.bans?.nuestros));
    for (const a of estado.aliados ?? []) {
      const id = a.campeon || a.intencion;
      const nombreCamp = a.campeon ? campeon(a.campeon).nombre : a.intencion ? `pensando en ${campeon(a.intencion).nombre}` : 'Eligiendo…';
      const amigo = a.nombre ? amigos.get(a.nombre.toLowerCase()) : undefined;
      // Solo se muestra el nombre si el cliente lo deja ver (en ranked suele estar oculto).
      const quien = a.nombre ? a.nombre.split('#')[0] : 'Aliado';
      const detalle = [a.rol ? ROL_ES[a.rol] : null, amigo?.rango ? `${TIER_ES[amigo.rango.tier] ?? amigo.rango.tier} ${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(amigo.rango.tier) ? '' : amigo.rango.division ?? ''}`.trim() : null].filter(Boolean).join(' · ');
      const extra = amigo !== undefined ? el('span', 'ev-tag', 'SharkTracker') : null;
      const f = filaJugador(id, nombreCamp, [quien, detalle].filter(Boolean).join(' · '), extra);
      if (!a.campeon) f.classList.add('pend');
      c.append(f);
    }
    return c;
  }

  function cardRivales(miF) {
    const c = tarjeta('Rivales', 'dot-err');
    c.append(el('div', 'ev-colt', 'Baneos'), bansTira(estado.bans?.suyos));
    const roles = rolesRivales();
    const rival = rivalDeLinea();
    const conCampeon = (estado.rivales ?? []).filter((r) => r.campeon);
    for (const r of conCampeon) {
      const pos = roles.get(r.campeon);
      let extra = null;
      if (r.campeon === rival && miF) {
        const base = wr(fila(estado.yo.campeon, miRol())) ?? miF.resumen?.winrate ?? 0.5;
        const m = [...(miF.te_cuesta ?? []), ...(miF.le_ganas ?? [])].find((x) => x.champion_id === r.campeon);
        if (m) {
          const dif = m.winrate - base;
          extra = el('span', `mt-dif ${dif >= 0 ? 'sube' : 'baja'}`, `${dif >= 0 ? '+' : '−'}${Math.abs(dif * 100).toFixed(1).replace('.', ',')}% vs ti`);
        }
      }
      const f = filaJugador(r.campeon, campeon(r.campeon).nombre,
        pos ? `${ROL_ES[pos]}${r.campeon === rival ? ' · tu rival directo' : r.rol ? '' : ' (estimado)'}` : 'Rol sin saber', extra);
      if (r.campeon === rival) f.classList.add('rival');
      c.append(f);
    }
    const faltan = (estado.rivales ?? []).length - conCampeon.length;
    if (faltan > 0) {
      const p = el('div', 'ev-pend');
      for (let i = 0; i < faltan; i++) p.append(el('span', 'ev-pendic', '?'));
      p.append(el('span', 'mt-pasod', 'Aparecen al fijar su campeón.'));
      c.append(p);
    }
    return c;
  }

  function actualizarReloj() {
    const n = byId('ev-reloj');
    if (!n) return;
    const s = Math.max(0, reloj.segundos - Math.floor((Date.now() - reloj.desde) / 1000));
    n.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} restantes`;
  }

  // ── Partida en curso (para verla en la app, p. ej. en otro monitor) ──
  // Lo de la pantalla de carga (aliados y rivales) + tu build con lo ya comprado, hasta que
  // termina la partida. Los datos llegan del proceso main (los mismos del overlay).
  let partida = { carga: null, build: null, misObjetos: [], siguiente: null };
  const hayPartida = () => !!(partida.carga?.aliados?.length || partida.build);
  function textoRango(j) {
    if (j.pendiente) return 'Rango pendiente…';
    if (!j.rango) return 'Sin clasificar';
    const r = j.rango;
    const sinDivision = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(r.tier);
    return `${TIER_ES[r.tier] ?? r.tier}${sinDivision ? '' : ' ' + r.division} · ${r.lp} LP${r.cola === 'Flex' ? ' (Flex)' : ''}`;
  }
  function cardEquipo(titulo, dot, lista) {
    const c = tarjeta(titulo, dot);
    const v = partida.carga?.ddVersion;
    for (const j of lista ?? []) {
      const f = el('div', 'ev-fila');
      f.append(icono(v && j.clave ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${j.clave}.png` : null, 'mt-cico', (j.campeon ?? '?').slice(0, 2).toUpperCase(), j.campeon));
      const t = el('div', 'mt-fnom');
      t.append(el('b', null, j.nombre), el('span', null, `${j.campeon} · ${textoRango(j)}`));
      const tags = [];
      if (j.main === true) tags.push(['main', 'Main']);
      if (j.main === false) tags.push(['fuera', 'Fuera de su main']);
      if (j.rango?.racha) tags.push(['main', 'En racha']);
      if (j.sharktracker) tags.push(['st', 'SharkTracker']);
      if (tags.length) {
        const fila = el('div', 'ev-tags');
        for (const [cls, txt] of tags) fila.append(el('span', `ev-tag ${cls}`, txt));
        t.append(fila);
      }
      f.append(t);
      const n = (j.rango?.victorias ?? 0) + (j.rango?.derrotas ?? 0);
      if (n) f.append(el('span', 'ev-wr', `${Math.round(j.rango.victorias / n * 100)}% · ${n}`));
      c.append(f);
    }
    if (!lista?.length) c.append(el('div', 'mt-vacio', 'Cargando…'));
    return c;
  }
  function cardBuildPartida() {
    const d = partida.build;
    const c = tarjeta(d?.estado === 'ok' ? `Tu build · ${d.campeon}` : 'Tu build', 'dot-pos');
    if (!d || d.estado !== 'ok') {
      const AVISO = { sin_modo: 'En este modo no hay build de Meta (solo en la Grieta).', sin_sesion: 'Inicia sesión para ver tu build.', error: 'No se pudo cargar tu build: reintentando…' };
      c.append(el('div', 'mt-vacio', d ? AVISO[d.estado] ?? AVISO.error : 'Preparando tu build…'));
      return c;
    }
    if (d.resumen) c.append(el('div', 'ev-adapt-res', `Rivales: ${d.resumen}`));
    const tengo = new Set((partida.misObjetos ?? []).map(Number));
    const orden = el('div', 'mt-build');
    for (const p of d.pasos) {
      const col = el('div', 'mt-paso');
      const iconos = el('div', 'mt-items');
      p.items.forEach((o, i) => {
        if (i) iconos.append(el('span', 'mt-flecha', '›'));
        const ic = icono(o.img, `mt-item${tengo.has(Number(o.id)) && p.titulo !== 'Inicio' ? ' ev-comprado' : ''}`, '?', o.nombre);
        iconos.append(ic);
      });
      col.append(el('div', 'mt-pasot', `${p.titulo}${p.adaptado ? ' ⭐' : ''}`), iconos);
      orden.append(col);
    }
    c.append(orden);
    const s = partida.siguiente;
    if (s) {
      const linea = s.componente
        ? `Siguiente: ${s.componente.nombre} (${s.componente.falta ? `faltan ${s.componente.falta}` : '¡ya puedes!'}) → ${s.objetivo.nombre}`
        : `Siguiente: ${s.objetivo.nombre} (${s.objetivo.falta ? `faltan ${s.objetivo.falta}` : '¡ya puedes!'})`;
      c.append(el('div', 'ev-sig', linea));
    }
    for (const m of d.motivos ?? []) c.append(el('div', 'mt-pasod', `⭐ ${m.nombre} — ${m.motivo}`));
    return c;
  }
  function pintarPartida(caja, sub) {
    sub.textContent = `Partida en curso${partida.carga?.cola ? ` · ${partida.carga.cola}` : ''}`;
    const arriba = el('div', 'ev-grid');
    arriba.append(cardBuildPartida());
    const abajo = el('div', 'ev-grid');
    abajo.append(cardEquipo('Tu equipo', 'dot-pos', partida.carga?.aliados), cardEquipo('Rivales', 'dot-err', partida.carga?.rivales));
    caja.append(arriba, abajo);
  }

  function pintar(forzar = false) {
    const k = JSON.stringify({ ...estado, segundos: undefined });
    if (!forzar && k === clave) { actualizarReloj(); return; }
    clave = k;
    const sub = byId('envivo-sub');
    const caja = byId('envivo-cuerpo');
    caja.replaceChildren();
    const nav = document.querySelector('.navitem[data-page="envivo"]');
    nav?.classList.toggle('live', estado.fase === 'ChampSelect' || hayPartida());

    if (!estado.conectado && hayPartida()) { pintarPartida(caja, sub); return; }
    if (!estado.conectado) {
      sub.textContent = 'Abre el cliente de League of Legends: En Vivo se activa sola al entrar a selección de campeones.';
      return;
    }
    if (estado.fase !== 'ChampSelect' && hayPartida()) { pintarPartida(caja, sub); return; }
    if (estado.fase !== 'ChampSelect') {
      sub.textContent = `Cliente conectado · ${FASES[estado.fase] ?? 'en el cliente'}. Se activa sola al entrar a selección de campeones.`;
      return;
    }
    sub.textContent = 'Selección de campeones en curso';

    // Cambió tu campeón: los avisos de los botones ya no aplican.
    if (estado.yo?.campeon !== campeonAvisos) { avisos = {}; campeonAvisos = estado.yo?.campeon; }

    const rol = sinRoles() ? null : miRol();
    const chips = el('div', 'ev-estado');
    const vivo = el('span', 'ev-st live');
    vivo.append(el('span', 'pd'), document.createTextNode('Selección en curso'));
    chips.append(vivo, el('span', 'ev-st', COLAS[estado.cola] ?? 'Partida'));
    if (rol) chips.append(el('span', 'ev-st', `Tu rol: ${ROL_ES[rol]}${estado.yo?.rol ? '' : ' (el de tu perfil)'}`));
    if (estado.yo?.bloqueado && estado.yo.campeon) {
      const ch = el('span', 'ev-st champ');
      ch.append(iconoCampeon(estado.yo.campeon, 'ev-stic'), document.createTextNode(campeon(estado.yo.campeon).nombre));
      chips.append(ch);
    }
    const rl = el('span', 'ev-st gold');
    rl.id = 'ev-reloj';
    chips.append(rl);
    caja.append(chips);
    actualizarReloj();

    const arriba = el('div', 'ev-grid');
    let miF = null;
    if (!rol) {
      const t = tarjeta('Recomendaciones');
      t.append(el('div', 'mt-vacio', `En ${COLAS[estado.cola] ?? 'este modo'} no hay roles: las recomendaciones de Meta son de la Grieta (ranked).`));
      arriba.append(t);
    } else if (estado.yo?.bloqueado && estado.yo.campeon) {
      miF = ficha(estado.yo.campeon, rol);
      arriba.append(cardRunas(estado.yo.campeon, rol, miF), cardBuild(estado.yo.campeon, rol, miF));
    } else {
      arriba.append(cardPicks(rol), cardBans(rol));
    }
    const abajo = el('div', 'ev-grid');
    abajo.append(cardAliados(), cardRivales(miF));
    caja.append(arriba, abajo);
  }

  let fueSeleccion = false;
  async function recibir(e) {
    const entra = e?.fase === 'ChampSelect' && !fueSeleccion;
    fueSeleccion = e?.fase === 'ChampSelect';
    estado = e ?? { conectado: false };
    if (typeof estado.segundos === 'number') reloj = { segundos: estado.segundos, desde: Date.now() };
    if (entra) {
      await cargarMeta();
      // La app salta sola a En Vivo al entrar a selección.
      document.querySelector('.navitem[data-page="envivo"]')?.click();
    }
    pintar();
  }

  let iniciado = false;
  async function iniciar() {
    if (iniciado) return;
    iniciado = true;
    api().onEstado(recibir);
    api().onPartida((datos) => {
      const empieza = !hayPartida() && !!datos?.carga?.aliados?.length;
      partida = datos ?? partida;
      // Al empezar la carga de una partida, la app salta sola a En Vivo (como en la selección).
      if (empieza) document.querySelector('.navitem[data-page="envivo"]')?.click();
      pintar(true);
    });
    api().partida().then((d) => { if (d) { partida = d; pintar(true); } });
    api().amigos().then((lista) => { amigos = new Map((lista ?? []).map((a) => [a.riotId, a.rango])); pintar(true); });
    await cargarMeta();
    recibir(await api().estado());
    setInterval(actualizarReloj, 1000);
  }

  window.enVivo = { iniciar, cargar: () => { cargarMeta().then(() => pintar(true)); } };
})();
