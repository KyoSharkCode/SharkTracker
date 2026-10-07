// Dibuja el overlay con el estado que calcula game-state.js (llega por IPC cada segundo).
// Estilo de sharktracker.lol; regla de color: tu equipo = azul, enemigo = rojo.
const $ = (id) => document.getElementById(id);

// ── Escalado: el diseño está pensado a 1920×1080 y se ajusta a tu pantalla ──
// (las zonas se anclan al centro y al borde derecho en overlay.css)
// Ajustes → Apariencia → "Tamaño del overlay" multiplica ese escalado.
let escalaExtra = 1;
function escalar() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) * escalaExtra;
  document.documentElement.style.setProperty('--s', String(s));
}
window.addEventListener('resize', escalar);
escalar();

const mmss = (seg) => `${Math.floor(seg / 60)}:${String(Math.max(0, seg) % 60).padStart(2, '0')}`;
const el = (tag, cls, texto) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texto != null) n.textContent = texto;
  return n;
};
const tile = (nombreIcono, claseColor) => {
  const t = el('div', `tile ${claseColor}`);
  t.append(icono(nombreIcono, 18));
  return t;
};

// ── Entrada y salida (una vez, 250 ms; sin bucles) ──
function mostrar(nodo, visible, reiniciar = false) {
  const oculto = nodo.hidden || nodo.classList.contains('saliendo');
  if (visible) {
    if (oculto || reiniciar) {
      clearTimeout(nodo._salida);
      nodo.hidden = false;
      nodo.classList.remove('saliendo', 'entrando');
      void nodo.offsetWidth; // reinicia la animación
      nodo.classList.add('entrando');
    }
  } else if (!oculto) {
    nodo.classList.remove('entrando');
    nodo.classList.add('saliendo');
    nodo._salida = setTimeout(() => { nodo.hidden = true; nodo.classList.remove('saliendo'); }, 250);
  }
}

// ── Retratos de campeones (DDragon) con respaldo de iniciales ──
let versionDD = null;
function ficha(t, equipo) {
  const f = el('div', `ficha ${equipo}`);
  f.title = t.nombre;
  if (versionDD && t.clave) {
    const img = el('img');
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); f.textContent = t.corto; });
    img.src = `https://ddragon.leagueoflegends.com/cdn/${versionDD}/img/champion/${t.clave}.png`;
    f.append(img);
  } else {
    f.textContent = t.corto;
  }
  return f;
}

// ── Barón / Ancestral: tiempo del buff, de quién es y quién lo tiene ──
function pintarBuff(nodo, icon, claseColor, buff) {
  mostrar(nodo, !!buff);
  if (!buff) return;
  const equipo = buff.esMio ? 'aliado' : 'enemigo';
  const firma = `${equipo}|${buff.titulares.map((t) => t.clave || t.corto).join(',')}`;
  if (nodo._firma !== firma) {
    // Solo se reconstruye si cambian el dueño o las fichas (así no se recargan los retratos cada segundo).
    nodo._firma = firma;
    nodo.className = `pill buff es-${equipo}${nodo.classList.contains('entrando') ? ' entrando' : ''}`;
    const info = el('div');
    info.append(el('div', 'tiempo'), el('div', `etiqueta ${equipo}`, buff.esMio ? 'Tu equipo lo tiene' : 'Rival lo tiene'));
    const fichas = el('div', 'fichas');
    for (const t of buff.titulares) fichas.append(ficha(t, equipo));
    nodo.replaceChildren(tile(icon, claseColor), info, fichas);
  }
  nodo.querySelector('.tiempo').textContent = mmss(buff.restante);
}

// ── Avisos (anuncio de próximo objetivo y toast de lo que acaba de pasar) ──
function pintarAviso(nodo, { icon, claseColor, titulo, urgente, sub, subClase, puntos, alma }) {
  nodo.className = `pill aviso ${claseColor}${alma ? ' alma' : ''}${nodo.classList.contains('entrando') ? ' entrando' : ''}${nodo.classList.contains('saliendo') ? ' saliendo' : ''}`;
  const texto = el('div');
  texto.append(el('div', `titulo${urgente ? ' urgente' : ''}`, titulo), el('div', `etiqueta ${subClase ?? ''}`, sub));
  if (puntos) {
    const fila = el('div', 'puntos');
    for (let i = 0; i < puntos.total; i++) fila.append(el('span', i < puntos.llenos ? 'punto on' : 'punto'));
    texto.append(fila);
  }
  nodo.replaceChildren(tile(icon, claseColor), texto);
}

// Anuncios: rotan cada 4 s si hay varios (el cambio de contenido no se anima).
const ICONO_OBJ = { dragon: 'dragon', ancestral: 'elder', larvas: 'grubs', heraldo: 'herald', baron: 'baron', inhib: 'inhibitor' };
let anuncioIdx = 0;
let proximos = [];
setInterval(() => { anuncioIdx++; pintarAnuncio(); }, 4000);

function pintarAnuncio() {
  const nodo = $('anuncio');
  mostrar(nodo, proximos.length > 0);
  if (!proximos.length) return;
  const i = anuncioIdx % proximos.length;
  const p = proximos[i];
  const claseColor = p.clave === 'inhib' ? (p.esMio ? 'c-aliado' : 'c-enemigo') : `c-${p.clave}`;
  pintarAviso(nodo, {
    icon: ICONO_OBJ[p.clave] ?? 'dragon',
    claseColor,
    titulo: `${p.nombre} en ${mmss(p.falta)}`,
    urgente: p.falta <= 10,
    sub: p.detalle ?? 'Próximo objetivo',
    puntos: proximos.length > 1 ? { llenos: 0, total: 0 } : null,
  });
  if (proximos.length > 1) {
    // Puntitos de rotación: el activo se marca.
    const fila = el('div', 'puntos');
    proximos.slice(0, 4).forEach((_, j) => fila.append(el('span', j === i ? 'punto on' : 'punto')));
    nodo.querySelector('.puntos').replaceWith(fila);
  }
}

let ultimoToast = null;
function pintarToast(toast) {
  const nodo = $('toast');
  const nuevo = !!toast && toast.id !== ultimoToast;
  mostrar(nodo, !!toast, nuevo && !nodo.hidden);
  if (!toast) { ultimoToast = null; return; }
  ultimoToast = toast.id;
  const equipo = toast.esMio ? 'aliado' : 'enemigo';
  const esEstructura = toast.tipo === 'estructura';
  pintarAviso(nodo, {
    icon: toast.icono,
    claseColor: esEstructura ? `c-${equipo}` : `c-${toast.tipo}`,
    titulo: toast.titulo + (toast.robado ? ' (robado)' : ''),
    sub: esEstructura ? toast.detalle : (toast.equipo ? (toast.esMio ? 'Tu equipo' : 'Equipo rival') : ''),
    subClase: equipo,
    puntos: toast.puntos,
    alma: toast.tipo === 'alma',
  });
}

// ── Diferencia de oro: solo mientras Tab está pulsado ──
// Filas en la altura de cada fila del marcador del juego a 1920×1080.
const FILAS_Y = [352, 428, 501, 577, 653];
let tab = false;
let oro = [];
let aliadoIzquierda = true;   // lado azul a la izquierda del Tab, rojo a la derecha
function pintarOro() {
  const nodo = $('oro');
  mostrar(nodo, tab && oro.length > 0);
  if (!tab || !oro.length) return;
  const filas = oro.slice(0, 5).map((f, i) => {
    const d = f.diferencia;
    const n = Math.abs(Math.round(d));
    // La flecha APUNTA al jugador que tiene más oro ("◀ 425" = el de la izquierda,
    // "425 ▶" = el de la derecha). El color dice de quién es: azul tu equipo, rojo el rival.
    const ganaIzquierda = aliadoIzquierda ? d > 0 : d < 0;
    const texto = n < 50 ? '≈' : ganaIzquierda ? `◀ ${n}` : `${n} ▶`;
    const fila = el('div', `oro-fila ${n < 50 ? 'igual' : d > 0 ? 'aliado' : 'enemigo'}`, texto);
    fila.style.top = `${FILAS_Y[i]}px`;
    fila.title = `${f.aliado} vs ${f.enemigo}`;
    return fila;
  });
  nodo.replaceChildren(...filas);
}

// ── Tu rendimiento: tus números vs la división de arriba (siempre a la vista) ──
// Azul ▲ = vas por encima de la referencia; rojo ▼ = por debajo.
let rendimiento = null;
function pintarRendimiento() {
  const nodo = $('rendimiento');
  mostrar(nodo, !!rendimiento);
  if (!rendimiento) return;
  const r = rendimiento;
  const cab = el('div', 'rend-cab');
  const vs = r.aviso ?? `vs ${r.division}${r.rol ? ' · ' + r.rol : ''}`;
  cab.append(el('div', 'etiqueta', 'Tu rendimiento'), el('div', 'vs', vs));
  const filas = r.metricas.map((m) => {
    const fila = el('div', 'rend-fila');
    const texto = el('div');
    texto.append(el('div', 'nombre', m.etiqueta));
    if (m.referencia != null) texto.append(el('div', 'ref', `vs. ${m.referencia} prom. ${r.division}`));
    const estado = m.arriba === true ? 'arriba' : m.arriba === false ? 'abajo' : '';
    const valor = el('div', `valor ${estado}`, m.valor);
    if (estado) valor.append(el('span', 'flecha', m.arriba ? '▲' : '▼'));
    fila.append(texto, valor);
    return fila;
  });
  nodo.replaceChildren(cab, ...filas);
}

// ── Pantalla de carga: los 10 jugadores con rango, winrate y etiquetas ──
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Retador',
};
const AVISO_CARGA = {
  buscando: 'Buscando la partida en Riot…',
  sin_partida: 'Riot todavía no publica la partida: reintentando…',
  esperando: 'Un amigo de SharkTracker ya está pidiendo los datos…',
  riot_ocupado: 'Riot está ocupado: reintentando en unos segundos…',
  error: 'No se pudieron cargar los datos: reintentando…',
  sin_sesion: 'Inicia sesión en la app de SharkTracker para ver los rangos.',
  sin_cuenta: 'Vincula tu cuenta de LoL en la web de SharkTracker para ver los rangos.',
};
let carga = null;
function textoRango(j) {
  if (j.pendiente) return 'Rango pendiente…';
  if (!j.rango) return 'Sin clasificar';
  const r = j.rango;
  const sinDivision = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(r.tier);
  return `${TIER_ES[r.tier] ?? r.tier}${sinDivision ? '' : ' ' + r.division} · ${r.lp} LP${r.cola === 'Flex' ? ' (Flex)' : ''}`;
}
function filaCarga(j, equipo, verRango, verWinrate) {
  const fila = el('div', 'carga-fila');
  const quien = el('div', 'carga-quien');
  quien.append(el('div', 'carga-nombre', j.nombre));
  if (verRango) quien.append(el('div', `carga-rango${j.pendiente ? ' pendiente' : ''}`, `${j.campeon} · ${textoRango(j)}`));
  else quien.append(el('div', 'carga-rango', j.campeon));
  if (ver('cargaEtiquetas')) {
    const tags = [];
    if (j.main === true) tags.push(['main', 'Main del campeón']);
    if (j.main === false) tags.push(['fuera', 'Fuera de su main']);
    if (j.rango?.racha) tags.push(['racha', 'Frenesí']);
    if (j.sharktracker) tags.push(['st', 'SharkTracker']);
    if (tags.length) {
      const fila2 = el('div', 'carga-tags');
      for (const [cls, texto] of tags) fila2.append(el('span', `carga-tag ${cls}`, texto));
      quien.append(fila2);
    }
  }
  fila.append(ficha({ nombre: j.campeon, corto: iniciales(j.campeon), clave: j.clave }, equipo), quien);
  const partidas = (j.rango?.victorias ?? 0) + (j.rango?.derrotas ?? 0);
  if (verWinrate && partidas > 0) {
    const wr = el('div', 'carga-wr');
    wr.append(el('div', 'pct', `${Math.round((j.rango.victorias / partidas) * 100)}%`), el('div', 'part', `${partidas} part.`));
    fila.append(wr);
  }
  return fila;
}
const iniciales = (nombre = '') => nombre.replace(/['’.]/g, '').split(/\s+/).filter(Boolean)
  .map((p, _i, a) => (a.length > 1 ? p[0] : p.slice(0, 2))).join('').slice(0, 2).toUpperCase() || '?';
function pintarCarga() {
  const nodo = $('carga');
  mostrar(nodo, !!carga);
  if (!carga) return;
  if (carga.ddVersion) versionDD = carga.ddVersion;
  // Oculto con Ctrl + X: solo queda una pastilla chiquita que recuerda el atajo.
  const oculto = !ver('carga');
  nodo.classList.toggle('mini', oculto);
  if (oculto) {
    const cab = el('div', 'carga-cab');
    cab.append(el('div', 'carga-marca', 'SHARKTRACKER'), el('div', 'carga-atajo', 'Ctrl + X: rangos'));
    nodo.replaceChildren(cab);
    return;
  }
  const cab = el('div', 'carga-cab');
  const der = el('div', 'carga-der');
  der.append(el('div', 'carga-cola', carga.cola ?? ''), el('div', 'carga-atajo', 'Ctrl + X ocultar'));
  cab.append(el('div', 'carga-marca', 'SHARKTRACKER'), der);
  const partes = [cab];
  const aviso = carga.estado !== 'ok' ? AVISO_CARGA[carga.estado] : null;
  if (aviso) partes.push(el('div', 'carga-aviso', aviso));
  const bloque = (titulo, cls, lista, verRango, verWinrate) => {
    if (!lista?.length) return;
    partes.push(el('div', `carga-lado ${cls}`, titulo));
    const cont = el('div', 'carga-lista');
    for (const j of lista) cont.append(filaCarga(j, cls, verRango, verWinrate));
    partes.push(cont);
  };
  bloque('Tu equipo', 'aliado', carga.aliados, ver('cargaRangoAliados'), ver('cargaWinrateAliados'));
  bloque('Rivales', 'enemigo', carga.rivales, ver('cargaRangoRivales'), ver('cargaWinrateRivales'));
  nodo.replaceChildren(...partes);
}

// ── Build en partida (Ctrl + X): la build completa en orden, arriba a la izquierda ──
// Lo ya comprado se marca con ✓; lo adaptado a los rivales lleva ★ y su motivo abajo.
const AVISO_BUILD = {
  sin_modo: 'En este modo no hay build de Meta (solo en la Grieta).',
  sin_sesion: 'Inicia sesión en la app de SharkTracker para ver tu build.',
  error: 'No se pudo cargar tu build: reintentando…',
};
const ROL_BUILD = { top: 'Top', jungle: 'Jungla', mid: 'Mid', adc: 'ADC', support: 'Support' };
let build = { datos: null, visible: false };
let misObjetos = new Set();
let pistaHasta = 0;
let pistaTimer = null;
function iconoItem(o, comprado) {
  const c = el('div', `build-item${comprado ? ' comprado' : ''}`);
  c.title = o.nombre ?? '';
  if (o.img) {
    const img = el('img');
    img.alt = '';
    img.addEventListener('error', () => img.remove());
    img.src = o.img;
    c.append(img);
  }
  if (comprado) c.append(el('span', 'build-check', '✓'));
  return c;
}
function pintarBuild() {
  const nodo = $('build');
  const d = build.datos;
  const activo = ver('build');
  mostrar(nodo, activo && build.visible);
  // Pista "Ctrl + X: tu build" unos segundos cuando la build está lista y oculta.
  const pista = $('build-pista');
  pista.style.left = nodo.style.left;
  pista.style.top = nodo.style.top;
  mostrar(pista, activo && !build.visible && d?.estado === 'ok' && Date.now() < pistaHasta);
  if (!activo || !build.visible) return;
  const cab = el('div', 'carga-cab');
  const izq = el('div');
  izq.append(el('div', 'carga-marca', 'SHARKTRACKER · BUILD'));
  if (d?.estado === 'ok') izq.append(el('div', 'build-quien', `${d.campeon}${d.rol ? ' · ' + (ROL_BUILD[d.rol] ?? d.rol) : ''}`));
  cab.append(izq, el('div', 'carga-atajo', 'Ctrl + X ocultar'));
  const partes = [cab];
  if (!d || d.estado !== 'ok') {
    partes.push(el('div', 'carga-aviso', d ? AVISO_BUILD[d.estado] ?? AVISO_BUILD.error : 'Preparando tu build…'));
    nodo.replaceChildren(...partes);
    return;
  }
  if (d.resumen) partes.push(el('div', 'build-resumen', `Rivales: ${d.resumen}`));
  const inicio = d.pasos.find((p) => p.titulo === 'Inicio');
  if (inicio?.items.length) {
    const fila = el('div', 'build-inicio');
    fila.append(el('span', 'build-paso', 'Inicio'));
    for (const o of inicio.items) fila.append(iconoItem(o, false));
    partes.push(fila);
  }
  // Orden completo, numerado: core, botas y 4.º–6.º.
  const orden = el('div', 'build-orden');
  let n = 0;
  for (const p of d.pasos.filter((x) => x.titulo !== 'Inicio')) {
    for (const o of p.items) {
      n++;
      const celda = el('div', `build-celda${p.adaptado ? ' adaptado' : ''}`);
      celda.append(el('div', 'build-num', p.adaptado ? `${n} ★` : String(n)), iconoItem(o, misObjetos.has(Number(o.id))));
      celda.append(el('div', 'build-nombre', o.nombre));
      orden.append(celda);
    }
  }
  partes.push(orden);
  if (d.motivos?.length) {
    const lista = el('div', 'build-motivos');
    for (const m of d.motivos) {
      const fila = el('div', 'build-motivo');
      fila.append(el('span', 'build-mnombre', `★ ${m.nombre}`), el('span', null, ` — ${m.motivo}`));
      lista.append(fila);
    }
    partes.push(lista);
  }
  nodo.replaceChildren(...partes);
}
function pintarPista() {
  const nodo = $('build-pista');
  nodo.replaceChildren(el('span', 'carga-marca', 'SHARKTRACKER'), el('span', 'carga-atajo', 'Ctrl + X: tu build'));
}
window.overlay.onBuild?.((nuevo) => {
  const antes = build.datos?.estado;
  build = nuevo ?? { datos: null, visible: false };
  if (build.datos?.estado === 'ok' && antes !== 'ok') {
    pistaHasta = Date.now() + 12000;
    pintarPista();
    clearTimeout(pistaTimer);
    pistaTimer = setTimeout(pintarBuild, 12100);
  }
  pintarBuild();
});

// ── Siguiente compra (abajo a la derecha, a la izquierda del minimapa) ──
// El objeto de tu build que toca y, si aún no te alcanza, el componente que conviene comprar.
let siguiente = null;
function filaCompra(o, etiqueta) {
  const fila = el('div', 'sig-fila');
  fila.append(iconoItem(o, false));
  const txt = el('div', 'sig-txt');
  txt.append(el('div', 'sig-etq', etiqueta), el('div', 'sig-nombre', o.nombre));
  const oro = el('div', `sig-oro${o.falta ? '' : ' listo'}`, o.falta ? `faltan ${o.falta}` : '¡ya puedes!');
  fila.append(txt, oro);
  return fila;
}
function pintarSiguiente() {
  const nodo = $('siguiente');
  mostrar(nodo, !!siguiente);
  if (!siguiente) return;
  const firma = JSON.stringify(siguiente);
  if (nodo._firma === firma) return;
  nodo._firma = firma;
  const partes = [];
  if (siguiente.componente) partes.push(filaCompra(siguiente.componente, 'Siguiente'));
  partes.push(filaCompra(siguiente.objetivo, siguiente.componente ? 'Para' : 'Siguiente objeto'));
  nodo.replaceChildren(...partes);
}

window.overlay.onTab((pulsado) => { tab = pulsado; pintarOro(); });
window.overlay.onCarga?.((datos) => { carga = datos; pintarCarga(); });

// ── Ajustes → Overlay: qué piezas se ven y dónde van ──
// Posiciones en coordenadas de 1920×1080 (esquina superior izquierda de cada pieza).
let config = { visible: {} };
const ver = (pieza) => config.visible?.[pieza] !== false;
function aplicarConfig(nueva) {
  if (!nueva) return;
  config = nueva;
  // Apariencia: tamaño y transparencia de los paneles (0.8 = la de siempre).
  escalaExtra = Number(config.apariencia?.escala) || 1;
  escalar();
  document.documentElement.style.setProperty('--op', String(config.apariencia?.opacidad ?? 0.8));
  for (const [id, pos] of Object.entries(config.posiciones ?? {})) {
    const nodo = $(id);
    if (!nodo) continue;
    nodo.style.left = `${pos.x}px`;
    nodo.style.top = `${pos.y}px`;
  }
  if (ultimoEstado) pintarEstado(ultimoEstado);
  if (carga) pintarCarga();
  pintarBuild();
}

let ultimoEstado = null;
function pintarEstado(estado) {
  ultimoEstado = estado;
  if (estado.ddVersion) versionDD = estado.ddVersion;
  pintarBuff($('baron'), 'baron', 'c-baron', ver('buffs') ? estado.baron : null);
  pintarBuff($('ancestral'), 'elder', 'c-ancestral', ver('buffs') ? estado.ancestral : null);
  proximos = ver('anuncios') ? (estado.proximos ?? []) : [];
  pintarAnuncio();
  pintarToast(ver('toasts') ? estado.toast : null);
  oro = ver('oro') ? (estado.oro ?? []) : [];
  aliadoIzquierda = estado.aliadoIzquierda !== false;
  pintarOro();
  rendimiento = ver('rendimiento') ? (estado.rendimiento ?? null) : null;
  pintarRendimiento();
  siguiente = ver('siguiente') ? (estado.siguiente ?? null) : null;
  pintarSiguiente();
  // Objetos comprados: solo se redibuja la build si cambian.
  const objetos = (estado.misObjetos ?? []).map(Number);
  const firma = objetos.slice().sort().join(',');
  if (firma !== misObjetos._firma) {
    misObjetos = new Set(objetos);
    misObjetos._firma = firma;
    if (build.visible) pintarBuild();
  }
}

// ── Clips (Ctrl + F8): aviso corto en la columna de avisos ──
// "Guardando clip…" mientras se graban los segundos de después; "Clip guardado" 3 s.
const TEXTO_CLIP = {
  guardando: (d) => ['Guardando clip…', `${d.segundos} s más y listo`],
  guardado: (d) => ['Clip guardado', `${d.segundos} s · Videos › SharkTracker`],
  error: () => ['No se pudo guardar', 'Revisa Ajustes › Clips'],
  apagado: () => ['Clips apagados', 'Actívalos en Ajustes › Clips'],
};
let clipTimer = null;
function pintarClip(d) {
  const nodo = $('clip');
  const texto = TEXTO_CLIP[d?.estado];
  clearTimeout(clipTimer);
  if (!texto) { mostrar(nodo, false); return; }
  const [titulo, sub] = texto(d);
  pintarAviso(nodo, { icon: 'clip', claseColor: `c-clip${d.estado === 'error' ? ' error' : ''}`, titulo, sub });
  mostrar(nodo, true, d.estado !== 'guardando');
  if (d.estado !== 'guardando') clipTimer = setTimeout(() => mostrar(nodo, false), 3000);
}
window.overlay.onClip?.(pintarClip);

window.overlay.onState(pintarEstado);
window.overlay.onConfig?.(aplicarConfig);
window.overlay.getConfig?.().then(aplicarConfig);
