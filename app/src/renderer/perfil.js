// "Mi Perfil": dibuja lo que arma el proceso main (perfil.js) con tus datos de
// SharkTracker. Si SharkTracker no responde, muestra tu identidad y tu último
// rango guardados + el aviso de "sin conexión" (como en el mockup).
(() => {
  const byId = (id) => document.getElementById(id);
  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto != null) n.textContent = texto;
    return n;
  };
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const iniciales = (nombre = '') => nombre.replace(/['’.]/g, '').split(/\s+/).filter(Boolean)
    .map((p, _i, a) => (a.length > 1 ? p[0] : p.slice(0, 2))).join('').slice(0, 2).toUpperCase() || '?';
  const miles = (n) => Number(n ?? 0).toLocaleString('es-ES');
  function haceCuanto(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return `hace ${d} día${d === 1 ? '' : 's'}`;
  }

  let perfil = null;       // último perfil bueno (de SharkTracker o de la copia local)
  let pestana = 'solo';
  let cargando = false;
  let cargadoEn = 0;

  // ── Imágenes con respaldo de iniciales ──
  function imagen(url, cls, respaldo) {
    const caja = el('div', cls);
    if (url) {
      const img = el('img');
      img.alt = '';
      img.addEventListener('error', () => { img.remove(); caja.textContent = respaldo; });
      img.src = url;
      caja.append(img);
    } else {
      caja.textContent = respaldo;
    }
    return caja;
  }
  const urlCampeon = (p, clave) => (p.iconos?.version && clave
    ? `https://ddragon.leagueoflegends.com/cdn/${p.iconos.version}/img/champion/${clave}.png` : null);
  const nombreCampeon = (p, clave) => p.iconos?.campeones?.[clave] ?? clave ?? '?';

  // ── Cabecera ──
  function pintarCabecera(p, conectado) {
    const cab = byId('perfil-cab');
    cab.classList.toggle('offline', !conectado);
    const j = p.jugador;
    const ident = el('div', 'profid');
    const nombre = el('div', 'profname', j.nombre);
    nombre.append(el('span', 'proftagline', ` #${j.tag}`));
    ident.append(nombre, el('div', 'proftag', ['LAN', j.rol ? `rol principal: ${j.rol}` : null].filter(Boolean).join(' · ')));

    const badges = el('div', 'rankbadges');
    for (const [cola, r] of [['SoloQ', p.solo], ['Flex', p.flex]]) {
      if (!r && cola === 'Flex') continue;
      const b = el('div', 'rankbadge');
      b.append(el('div', 'ranktier', r ? r.texto : 'Sin clasificar'));
      const partidas = r ? r.victorias + r.derrotas : 0;
      const detalle = r ? `${r.lp} LP · ${cola}${partidas ? ` · ${Math.round((r.victorias / partidas) * 100)}% WR` : ''}` : cola;
      b.append(el('div', 'ranklp', conectado ? detalle : `${detalle} · guardado ${haceCuanto(p.actualizado)}`));
      badges.append(b);
    }

    const estado = el('span', conectado ? 'detectag' : 'syncedtag');
    estado.append(el('span', 'pd'), document.createTextNode(conectado ? 'Conectado a SharkTracker' : 'Sin conexión con SharkTracker'));
    const actualizar = el('button', 'refreshbtn', cargando ? 'Actualizando…' : 'Actualizar');
    actualizar.type = 'button';
    actualizar.disabled = cargando;
    actualizar.addEventListener('click', () => cargar(true));

    cab.replaceChildren(imagen(j.icono, 'avatar', iniciales(j.nombre)), ident, badges, estado, actualizar);
    cab.hidden = false;
  }

  // Pestañas de cola: las comparten el radar y el historial (cambiar una cambia las dos).
  function pestanas(p) {
    const tabs = el('div', 'qtabs');
    for (const t of p.historial) {
      const b = el('button', `qtab${t.clave === pestana ? ' active' : ''}${t.partidas.length ? '' : ' vacia'}`, t.nombre);
      b.type = 'button';
      b.addEventListener('click', () => { pestana = t.clave; pintar(); });
      tabs.append(b);
    }
    return tabs;
  }

  // ── Radar: tus promedios (últimas 20 de la cola elegida) vs la división de arriba ──
  function pintarRadar(p) {
    const card = el('div', 'card card-radar');
    // Copias viejas (antes de las pestañas) solo traían SoloQ.
    const cola = p.rendimiento?.[pestana] ?? { nombre: 'SoloQ', grieta: true, resumen: p.resumen, radar: p.radar };
    card.append(el('div', 'cardhd', `Rendimiento — últimas ${cola.resumen?.partidas ?? 0} ${cola.nombre}`));
    if (p.rendimiento) card.append(pestanas(p));
    if (!cola.radar) {
      card.append(el('div', 'vacio', `Sin partidas de ${cola.nombre} en los últimos 30 días.`));
      return card;
    }
    p = { ...p, resumen: cola.resumen, radar: cola.radar };
    const cx = 110, cy = 100, R = 72;
    const puntos = (esc) => esc.map((e, i) => {
      const ang = -Math.PI / 2 + i * (Math.PI / 2);
      return `${cx + Math.cos(ang) * R * e},${cy + Math.sin(ang) * R * e}`;
    }).join(' ');
    const svg = svgEl('svg', { width: 220, height: 200, viewBox: '0 0 220 200', class: 'radar' });
    for (const f of [1, 2 / 3, 1 / 3]) svg.append(svgEl('polygon', { points: puntos([f, f, f, f]), class: 'radar-malla' }));
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI / 2 + i * (Math.PI / 2);
      svg.append(svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(ang) * R, y2: cy + Math.sin(ang) * R, class: 'radar-eje' }));
    }
    if (p.radar.hayRef) svg.append(svgEl('polygon', { points: puntos([2 / 3, 2 / 3, 2 / 3, 2 / 3]), class: 'radar-ref' }));
    svg.append(svgEl('polygon', { points: puntos(p.radar.ejes.map((e) => Math.max(e.escala, 0.04))), class: 'radar-tuyo' }));
    const pos = [[cx, 12, 'middle'], [206, cy + 3, 'end'], [cx, 196, 'middle'], [14, cy + 3, 'start']];
    p.radar.ejes.forEach((e, i) => {
      const t = svgEl('text', { x: pos[i][0], y: pos[i][1], 'text-anchor': pos[i][2], class: 'radar-txt' });
      t.textContent = e.nombre;
      svg.append(t);
    });

    const leyenda = el('div', 'radar-leyenda');
    const fila = (cls, texto) => { const f = el('div', 'ley'); f.append(el('span', `ley-mark ${cls}`), el('span', null, texto)); return f; };
    leyenda.append(fila('tu', 'Tú'));
    if (p.radar.hayRef) leyenda.append(fila('ref', `Prom. ${p.referencia} (${p.jugador.rol ?? 'tu rol'})`));
    else leyenda.append(el('div', 'ley-nota', cola.grieta ? 'Sin referencia de la división de arriba todavía' : 'Sin comparación en este modo (los promedios son de la Grieta)'));
    const tabla = el('div', 'radar-tabla');
    for (const e of p.radar.ejes) {
      const r = el('div', 'rt-fila');
      const v = el('span', `rt-valor ${e.arriba === true ? 'arriba' : e.arriba === false ? 'abajo' : ''}`, e.valor);
      r.append(el('span', 'rt-nombre', e.nombre), v, el('span', 'rt-ref', e.referencia ? `vs ${e.referencia}` : ''));
      tabla.append(r);
    }
    const extra = el('div', 'ley-nota', `KDA ${p.resumen.kda.toFixed(2)} · ${Math.round(p.resumen.danoMin)} daño/min · ${Math.round(p.resumen.winrate * 100)}% WR`);
    leyenda.append(tabla, extra);
    const cuerpo = el('div', 'radar-cuerpo');
    cuerpo.append(svg, leyenda);
    card.append(cuerpo);
    return card;
  }

  // ── Etiquetas ──
  function pintarEtiquetas(p) {
    const card = el('div', 'card card-tags');
    card.append(el('div', 'cardhd', 'Etiquetas activas ahora'));
    const fila = el('div', 'ptagrow');
    for (const t of p.etiquetas) {
      const tag = el('span', `ptag ${t.tipo}`);
      tag.append(el('span', 'pic', t.icono), document.createTextNode(t.texto + ' '), el('span', 'ptag-det', t.detalle));
      fila.append(tag);
    }
    if (!p.etiquetas.length) fila.append(el('span', 'vacio', 'Ninguna por ahora: juega unas SoloQ más.'));
    card.append(fila, el('div', 'ley-nota', 'Según tus últimas 30 SoloQ: rachas, tilt, lado del mapa y campeones.'));
    return card;
  }

  // ── Maestrías ──
  // Podio: #1 al centro (más alto, borde dorado), #2 y #3 a los lados. Cada carta
  // con el arte de carga del campeón (DDragon), nivel, puntos y barra vs el #1.
  function pintarMaestrias(p) {
    const card = el('div', 'card card-maestria');
    card.append(el('div', 'cardhd', 'Top 3 maestrías'));
    if (!p.maestrias.length) {
      card.append(el('div', 'vacio', 'Sin maestrías guardadas todavía.'));
      return card;
    }
    const maxPuntos = Math.max(...p.maestrias.map((m) => m.puntos), 1);
    const podio = el('div', 'podio');
    const orden = [p.maestrias[1], p.maestrias[0], p.maestrias[2]].filter(Boolean);
    for (const m of orden) {
      const puesto = p.maestrias.indexOf(m) + 1;
      const nombre = nombreCampeon(p, m.campeon);
      const carta = el('div', `pcarta puesto-${puesto}`);
      carta.append(imagen(`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${m.campeon}_0.jpg`, 'pcarta-arte', iniciales(nombre)));
      const info = el('div', 'pcarta-info');
      const barra = el('div', 'pcarta-barra');
      const relleno = el('span');
      relleno.style.width = `${Math.round((m.puntos / maxPuntos) * 100)}%`;
      barra.append(relleno);
      carta.append(el('div', 'pcarta-puesto', `#${puesto}`));
      info.append(el('div', 'pcarta-nivel', `M${m.nivel}`),
        el('div', 'pcarta-nombre', nombre), el('div', 'pcarta-pts', `${miles(m.puntos)} pts`), barra);
      carta.append(info);
      podio.append(carta);
    }
    card.append(podio);
    return card;
  }

  // ── Historial de elo (SoloQ, últimos 30 días) ──
  function pintarElo(p) {
    const card = el('div', 'card card-elo');
    card.append(el('div', 'cardhd', 'Historial de elo — SoloQ, últimos 30 días'));
    if (!p.elo) {
      card.append(el('div', 'vacio', 'Todavía no hay suficientes cambios de rango para la gráfica.'));
      return card;
    }
    const svg = svgEl('svg', { width: '100%', height: 76, viewBox: '0 0 1000 100', preserveAspectRatio: 'none', class: 'elo' });
    const pts = p.elo.puntos.map((q) => `${(q.x * 1000).toFixed(1)},${(q.y * 88 + 6).toFixed(1)}`);
    svg.append(svgEl('polygon', { points: `${pts.join(' ')} 1000,100 0,100`, class: 'elo-relleno' }));
    svg.append(svgEl('polyline', { points: pts.join(' '), class: 'elo-linea' }));
    const pie = el('div', 'elo-pie');
    const subida = p.elo.subida;
    pie.append(el('span', null, p.elo.inicio),
      el('span', `elo-fin ${subida >= 0 ? 'arriba' : 'abajo'}`, `${p.elo.fin} (ahora · ${subida >= 0 ? '+' : ''}${subida} pts)`));
    card.append(svg, pie);
    return card;
  }

  // ── Historial de partidas por cola ──
  function pintarHistorial(p) {
    const card = el('div', 'card card-hist');
    card.append(el('div', 'cardhd', 'Historial de partidas — últimas 10 por cola (30 días)'));
    card.append(pestanas(p));
    const actual = p.historial.find((t) => t.clave === pestana) ?? p.historial[0];
    if (!actual.partidas.length) card.append(el('div', 'vacio', `Sin partidas de ${actual.nombre} en los últimos 30 días.`));
    for (const m of actual.partidas) {
      const estado = m.remake ? 'remake' : m.win ? 'win' : 'loss';
      const fila = el('div', `mrow ${estado}`);
      fila.append(el('div', 'mres', m.remake ? 'REMAKE' : m.win ? 'VICT.' : 'DERR.'));
      const champ = el('div', 'mchampwrap');
      champ.append(imagen(urlCampeon(p, m.campeon), 'mchamp', iniciales(nombreCampeon(p, m.campeon))));
      const runa = p.iconos?.runas?.[m.runa];
      if (runa) champ.append(imagen(runa.img, 'mrune', ''));
      const hechizos = el('div', 'mspells');
      for (const h of m.hechizos.slice(0, 2)) hechizos.append(imagen(p.iconos?.hechizos?.[h]?.img, 'mspell', ''));
      fila.append(champ, hechizos);
      const quien = el('div', 'mwho');
      quien.append(el('div', 'mchampname', nombreCampeon(p, m.campeon)), el('div', 'mkda', `${m.kills} / ${m.deaths} / ${m.assists}`));
      fila.append(quien);
      const minutos = Math.round(m.duracion / 60);
      fila.append(el('span', 'mmeta', m.remake ? `${minutos} min · anulada` : `${m.cs} CS · ${minutos} min`));
      if (m.lp !== null && !m.remake) fila.append(el('span', `mtag ${m.lp >= 0 ? 'lp-sube' : 'lp-baja'}`, `${m.lp >= 0 ? '+' : ''}${m.lp} LP`));
      if (m.egida) fila.append(el('span', 'mtag egida', '✦ Égida de Valor'));
      if (m.remake) fila.append(el('span', 'mtag nocuenta', 'No cuenta'));
      fila.append(el('span', 'mtime', haceCuanto(m.terminada)));
      card.append(fila);
    }
    return card;
  }

  // ── Estados: sin cuenta / sin conexión ──
  function pintarMensaje(titulo, texto, conBoton) {
    const card = el('div', 'card card-offline');
    const caja = el('div', 'emptywrap');
    caja.append(el('div', 'errtitle', titulo), el('div', 'errtxt', texto));
    if (conBoton) {
      const b = el('button', 'checkbtn', 'Reintentar conexión');
      b.type = 'button';
      b.addEventListener('click', () => cargar(true));
      caja.append(b, el('div', 'cachednote', 'El overlay en partida sigue funcionando con normalidad: solo depende de tu cliente de League of Legends. (Los rangos de la pantalla de carga sí necesitan SharkTracker.)'));
    }
    card.append(caja);
    return card;
  }

  let ultimo = null; // última respuesta del main
  function pintar() {
    const cuerpo = byId('perfil-cuerpo');
    const sub = byId('perfil-sub');
    const r = ultimo;
    if (!r) return;
    if (r.estado === 'sin_cuenta') {
      byId('perfil-cab').hidden = true;
      sub.textContent = 'Todavía no vinculaste tu cuenta de LoL';
      cuerpo.replaceChildren(pintarMensaje('Vincula tu cuenta de League of Legends', 'Entra en la web de SharkTracker, inicia sesión con Discord y vincula tu Riot ID. Después vuelve aquí y pulsa Actualizar.', false));
      return;
    }
    const conectado = r.estado === 'ok';
    const datos = conectado ? r : r.cache;
    if (!datos) {
      byId('perfil-cab').hidden = true;
      sub.textContent = cargando ? 'Cargando tu perfil…' : 'Sin conexión con SharkTracker';
      cuerpo.replaceChildren(cargando ? el('div', 'vacio', 'Cargando…')
        : pintarMensaje('Error de conexión — no es tu culpa', 'Este tiburón perdió su rumbo 🦈 No pudimos conectar con SharkTracker para traer tu perfil. En cuanto vuelva la conexión, se actualiza solo.', true));
      return;
    }
    perfil = datos;
    pintarCabecera(datos, conectado);
    if (!conectado) {
      sub.textContent = 'Mostrando la última información guardada en tu dispositivo';
      cuerpo.replaceChildren(pintarMensaje('Error de conexión — no es tu culpa',
        'Este tiburón perdió su rumbo 🦈 No pudimos conectar con SharkTracker para traer tu historial, gráfica de elo, etiquetas y maestrías actualizadas. Tu identidad y tu último rango guardado siguen visibles arriba.', true));
      return;
    }
    sub.textContent = `Tu cuenta vinculada en SharkTracker · actualizado ${haceCuanto(datos.actualizado)}`;
    const fila = el('div', 'perfil-fila');
    fila.append(pintarRadar(datos), pintarEtiquetas(datos), pintarMaestrias(datos));
    cuerpo.replaceChildren(fila, pintarElo(datos), pintarHistorial(datos));
  }

  async function cargar(forzar = false) {
    if (cargando) return;
    if (!forzar && Date.now() - cargadoEn < 2 * 60 * 1000 && ultimo?.estado === 'ok') return;
    cargando = true;
    if (!ultimo) {
      // Mientras llega, lo último guardado (si hay) para no mostrar la página vacía.
      const cache = await window.sharkTracker.perfil.cache().catch(() => null);
      ultimo = cache ? { estado: 'ok', ...cache } : null;
    }
    pintar();
    try {
      ultimo = await window.sharkTracker.perfil.get();
    } catch (e) {
      ultimo = { estado: 'sin_conexion', cache: perfil };
    }
    cargando = false;
    cargadoEn = Date.now();
    pintar();
  }

  // Se carga al iniciar sesión y al volver a la pestaña Mi Perfil (si pasaron 2+ min).
  window.miPerfil = { cargar, limpiar: () => { ultimo = null; perfil = null; cargadoEn = 0; } };
})();
