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
      img.loading = 'lazy'; img.decoding = 'async';
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
  // Punto del chip de Discord (barra de título) = estado de conexión con SharkTracker.
  function marcarConexion(conectado) {
    const chip = byId('discord-chip');
    if (!chip) return;
    chip.classList.toggle('offline', !conectado);
    chip.title = conectado ? 'Conectado a SharkTracker · ver tu cuenta' : 'Sin conexión: mostrando datos guardados';
  }

  function pintarCabecera(p, conectado) {
    const cab = byId('perfil-cab');
    cab.classList.toggle('offline', !conectado);
    const j = p.jugador;
    const ident = el('div', 'profid');
    const nombre = el('div', 'profname', j.nombre);
    nombre.append(el('span', 'proftagline', ` #${j.tag}`));
    ident.append(nombre, el('div', 'proftag', ['LAN', j.rol ? `rol principal: ${j.rol}` : null].filter(Boolean).join(' · ')));
    // v0.7: las etiquetas van en fila debajo del nombre (antes, tarjeta aparte).
    if (conectado && p.etiquetas?.length) ident.append(filaEtiquetas(p));

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

    // v0.9 (Abisal): sin etiqueta «Conectado a SharkTracker»; el estado lo muestra el
    // punto del chip de Discord (marcarConexion). Sin conexión, el botón invita a reintentar.
    const actualizar = el('button', 'refreshbtn', cargando ? 'Actualizando…' : conectado ? 'Actualizar' : 'Reintentar conexión');
    actualizar.type = 'button';
    actualizar.disabled = cargando;
    actualizar.addEventListener('click', () => cargar(true));

    cab.replaceChildren(imagen(j.icono, 'avatar', iniciales(j.nombre)), ident, badges, actualizar);
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
    card.append(el('div', 'cardhd', `Rendimiento · últimas ${cola.resumen?.partidas ?? 0} ${cola.nombre}`));
    if (p.rendimiento) card.append(pestanas(p));
    if (!cola.radar) {
      card.append(el('div', 'vacio', `Sin partidas de ${cola.nombre} en los últimos 30 días.`));
      return card;
    }
    p = { ...p, resumen: cola.resumen, radar: cola.radar };
    const cx = 130, cy = 120, R = 90;   // v0.7: radar más grande
    const puntos = (esc) => esc.map((e, i) => {
      const ang = -Math.PI / 2 + i * (Math.PI / 2);
      return `${cx + Math.cos(ang) * R * e},${cy + Math.sin(ang) * R * e}`;
    }).join(' ');
    const svg = svgEl('svg', { width: 260, height: 240, viewBox: '0 0 260 240', class: 'radar' });
    for (const f of [1, 2 / 3, 1 / 3]) svg.append(svgEl('polygon', { points: puntos([f, f, f, f]), class: 'radar-malla' }));
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI / 2 + i * (Math.PI / 2);
      svg.append(svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(ang) * R, y2: cy + Math.sin(ang) * R, class: 'radar-eje' }));
    }
    if (p.radar.hayRef) svg.append(svgEl('polygon', { points: puntos([2 / 3, 2 / 3, 2 / 3, 2 / 3]), class: 'radar-ref' }));
    svg.append(svgEl('polygon', { points: puntos(p.radar.ejes.map((e) => Math.max(e.escala, 0.04))), class: 'radar-tuyo' }));
    const pos = [[cx, 18, 'middle'], [252, cy + 4, 'end'], [cx, 234, 'middle'], [8, cy + 4, 'start']];
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

  // ── Etiquetas: fila de píldoras bajo el nombre (según tus últimas 30 SoloQ) ──
  // Íconos de racha del set Abisal (assets/iconos/frenesi.svg y congelado.svg de la web).
  const ICONO_RACHA = {
    fuego: 'M8.3 22.9C7.7 22.7 7.7 22.5 8.3 21.0C9.2 18.8 10.4 17.1 11.9 15.7C12.8 15.0 12.9 15.2 12.1 16.1C10.7 17.7 9.6 19.7 9.0 22.1C8.9 22.7 8.7 23.0 8.6 23.0C8.6 23.0 8.4 22.9 8.3 22.9ZM6.1 22.0C4.7 21.0 3.5 19.0 3.2 17.3C3.2 16.5 3.3 16.4 3.7 16.9C4.1 17.3 4.2 17.3 4.0 16.6C3.4 14.2 4.1 11.5 5.8 9.4C6.3 8.8 6.4 8.8 6.3 10.1C6.2 12.2 7.6 13.4 8.9 12.2C9.6 11.6 9.7 10.6 9.2 9.2C8.2 6.2 9.2 3.2 11.7 1.5C12.4 1.0 12.5 1.0 12.3 1.8C11.6 3.8 12.1 5.5 13.8 7.4C14.7 8.3 15.2 9.1 15.5 9.8C15.9 11.0 16.6 10.3 16.7 8.5C16.8 7.4 17.0 6.9 17.6 6.4C18.2 5.9 18.2 5.9 18.3 7.3C18.3 8.7 18.3 8.8 19.4 11.2C21.1 14.6 21.2 16.7 20.0 19.1C18.3 22.5 16.3 22.8 15.6 19.7C15.4 18.8 15.2 18.6 14.8 18.6C14.4 18.6 14.4 18.4 14.9 18.0C15.3 17.7 15.3 17.7 15.4 16.4C15.4 15.7 15.6 14.7 15.7 14.2C16.1 12.7 16.1 12.7 14.8 13.1C12.4 14.0 10.1 16.0 8.4 18.9C7.8 19.8 7.6 20.3 7.1 21.8C6.9 22.4 6.8 22.4 6.1 22.0Z',
    hielo: 'M11.8 22.5C11.8 22.3 11.3 20.4 10.9 18.2C9.9 13.7 9.9 13.9 9.7 13.9C9.6 13.9 9.6 13.8 9.1 17.1C8.7 19.5 8.7 19.8 8.5 19.7C8.5 19.6 8.1 17.9 7.7 15.8C6.8 11.0 7.0 11.5 5.9 9.6C4.7 7.8 4.7 7.9 5.5 7.4C6.3 6.9 6.3 6.8 5.8 6.4C5.1 6.0 4.8 5.4 5.1 5.2C5.3 5.1 6.0 5.1 6.4 5.3C6.9 5.6 7.0 5.6 7.0 4.8C7.1 3.8 7.1 3.7 7.7 4.0C8.2 4.2 8.2 4.2 8.4 5.2C8.5 6.2 8.7 6.3 10.4 7.2C11.0 7.5 11.0 7.4 11.0 6.1C11.0 4.9 11.0 4.8 10.1 4.0C9.4 3.5 9.4 3.5 9.4 3.0C9.5 2.4 9.6 2.4 10.4 2.8C11.2 3.2 11.3 3.1 11.4 2.4C11.4 1.9 11.8 1.2 12.0 1.2C12.2 1.2 12.6 1.9 12.6 2.4C12.7 3.1 12.8 3.2 13.6 2.8C14.4 2.4 14.5 2.4 14.6 3.0C14.6 3.5 14.6 3.5 13.9 4.1C13.1 4.7 13.0 5.0 13.0 5.7C13.1 6.4 13.2 6.4 13.5 5.8C13.8 5.2 14.5 4.6 14.7 4.7C14.9 4.9 14.9 5.6 14.7 6.4C14.4 7.4 14.6 7.5 15.2 6.5C15.5 6.1 15.5 5.8 15.8 4.5C15.8 4.2 15.9 4.2 16.3 4.0C16.9 3.7 17.0 3.9 17.0 4.8C17.0 5.6 17.0 5.6 17.8 5.3C18.4 5.1 19.1 5.1 19.1 5.3C19.1 5.6 18.7 6.1 18.2 6.4C17.7 6.8 17.7 6.9 18.4 7.3C19.1 7.8 19.1 7.9 18.5 8.6C17.7 9.5 17.7 9.6 16.8 13.8C16.4 16.0 16.0 17.9 16.0 18.0C15.8 18.4 15.8 18.2 15.3 15.9C14.8 13.6 14.8 13.6 14.5 13.8C14.2 14.0 14.0 14.6 13.2 18.4C12.1 23.2 12.1 23.4 11.8 22.5ZM13.0 15.0C13.4 13.5 13.5 13.3 13.9 13.1C14.1 13.0 14.3 12.7 14.4 12.5C14.7 12.0 14.8 11.9 15.1 12.2C15.4 12.5 15.4 12.3 15.1 11.3C14.8 10.1 14.7 10.1 14.2 11.3C13.9 12.2 13.8 12.3 13.3 12.6C12.7 12.9 12.8 12.8 12.6 15.0C12.4 17.1 12.6 17.1 13.0 15.0ZM7.7 9.2C7.7 8.6 7.8 8.5 8.8 8.5C9.6 8.5 9.6 8.4 8.9 8.0C8.2 7.6 8.1 7.6 7.2 8.0C6.4 8.4 6.4 8.4 7.1 9.1C7.8 9.8 7.8 9.8 7.7 9.2Z',
  };
  function iconoEtiqueta(icono) {
    if (!ICONO_RACHA[icono]) return el('span', 'pic', icono);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'pic pic-svg'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONO_RACHA[icono]); path.setAttribute('fill', 'currentColor'); path.setAttribute('fill-rule', 'evenodd');
    svg.append(path);
    return svg;
  }

  function filaEtiquetas(p) {
    const fila = el('div', 'ptagrow');
    fila.title = 'Según tus últimas 30 SoloQ: rachas, tilt, lado del mapa y campeones.';
    for (const t of p.etiquetas) {
      const tag = el('span', `ptag ${t.tipo}`);
      tag.append(iconoEtiqueta(t.icono), document.createTextNode(t.texto + ' '), el('span', 'ptag-det', t.detalle));
      fila.append(tag);
    }
    return fila;
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

  // ── Más jugados (últimos 30 días, todas las colas) ──
  // Una fila por campeón: ícono, nombre y partidas.
  function pintarMasJugados(p) {
    const card = el('div', 'card card-masjugados');
    card.append(el('div', 'cardhd', 'Más jugados · 30 días'));
    const lista = p.masJugados ?? [];
    if (!lista.length) {
      card.append(el('div', 'vacio', 'Sin partidas en los últimos 30 días.'));
      return card;
    }
    const filas = el('div', 'mj-lista');
    for (const c of lista) {
      const nombre = nombreCampeon(p, c.campeon);
      const fila = el('div', 'mj-fila');
      const info = el('div', 'mj-info');
      info.append(el('div', 'mj-nombre', nombre), el('div', 'mj-sub', `${c.partidas} ${c.partidas === 1 ? 'partida' : 'partidas'}`));
      fila.append(imagen(urlCampeon(p, c.campeon), 'mj-icono', iniciales(nombre)), info);
      fila.title = `${nombre}: ${c.partidas} ${c.partidas === 1 ? 'partida' : 'partidas'}, ${Math.round((c.victorias / c.partidas) * 100)} % de victorias`;
      filas.append(fila);
    }
    card.append(filas);
    return card;
  }

  // ── Historial de elo (SoloQ, últimos 30 días) ──
  function pintarElo(p) {
    const card = el('div', 'card card-elo');
    card.append(el('div', 'cardhd', 'Historial de elo · SoloQ, últimos 30 días'));
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
    card.append(el('div', 'cardhd', 'Historial de partidas · últimas 10 por cola (30 días)'));
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

  // Cargando: siluetas grises en lugar de un "Cargando…" suelto (v0.7).
  function esqueleto() {
    const caja = el('div', 'esq-perfil');
    caja.append(el('div', 'esqueleto esq-cab'));
    const fila = el('div', 'perfil-fila');
    fila.append(el('div', 'esqueleto esq-card'), el('div', 'esqueleto esq-card'));
    caja.append(fila, el('div', 'esqueleto esq-hist'));
    return caja;
  }

  // Cuando el contenido real reemplaza a la silueta de carga, entra con un fundido de 300 ms.
  let observandoCuerpo = false;
  function vigilarCuerpo(cuerpo) {
    if (observandoCuerpo) return;
    observandoCuerpo = true;
    new MutationObserver((cambios) => {
      const veniaDeCarga = cambios.some((c) => [...c.removedNodes].some((n) => n.classList?.contains('esq-perfil')));
      if (!veniaDeCarga || cuerpo.querySelector('.esq-perfil')) return;
      cuerpo.classList.remove('sk-entra'); void cuerpo.offsetWidth; cuerpo.classList.add('sk-entra');
    }).observe(cuerpo, { childList: true });
  }

  let ultimo = null; // última respuesta del main
  function pintar() {
    const cuerpo = byId('perfil-cuerpo');
    vigilarCuerpo(cuerpo);
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
    if (!cargando || conectado) marcarConexion(conectado);
    const datos = conectado ? r : r.cache;
    if (!datos) {
      byId('perfil-cab').hidden = true;
      sub.textContent = cargando ? 'Cargando tu perfil…' : 'Sin conexión con SharkTracker';
      cuerpo.replaceChildren(cargando ? esqueleto()
        : pintarMensaje('Error de conexión: no es tu culpa', 'Este tiburón perdió su rumbo. No pudimos conectar con SharkTracker para traer tu perfil. En cuanto vuelva la conexión, se actualiza solo.', true));
      return;
    }
    perfil = datos;
    pintarCabecera(datos, conectado);
    if (!conectado) {
      sub.textContent = 'Mostrando la última información guardada en tu dispositivo';
      cuerpo.replaceChildren(pintarMensaje('Error de conexión: no es tu culpa',
        'Este tiburón perdió su rumbo. No pudimos conectar con SharkTracker para traer tu historial, gráfica de elo, etiquetas y maestrías actualizadas. Tu identidad y tu último rango guardado siguen visibles arriba.', true));
      return;
    }
    sub.textContent = `Tu cuenta vinculada en SharkTracker · Sonar · ${haceCuanto(datos.actualizado)}`;
    const fila = el('div', 'perfil-fila');
    fila.append(pintarRadar(datos), pintarMaestrias(datos), pintarMasJugados(datos));
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
