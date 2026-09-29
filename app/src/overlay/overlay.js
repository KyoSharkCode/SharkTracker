// Dibuja el overlay con el estado que calcula game-state.js (llega por IPC cada segundo).
// Estilo de sharktracker.lol; regla de color: tu equipo = azul, enemigo = rojo.
const $ = (id) => document.getElementById(id);

// ── Escalado: el diseño está pensado a 1920×1080 y se ajusta a tu pantalla ──
// (las zonas se anclan al centro y al borde derecho en overlay.css)
function escalar() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
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
    // La flecha sale del lado que va por delante ("1550 >" = gana la columna izquierda,
    // "< 1180" = gana la derecha). El color dice quién: azul tu equipo, rojo el rival.
    const ganaIzquierda = aliadoIzquierda ? d > 0 : d < 0;
    const texto = n < 50 ? '≈' : ganaIzquierda ? `${n} >` : `< ${n}`;
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

window.overlay.onTab((pulsado) => { tab = pulsado; pintarOro(); });

// ── Ajustes → Overlay: qué piezas se ven y dónde van ──
// Posiciones en coordenadas de 1920×1080 (esquina superior izquierda de cada pieza).
let config = { visible: {} };
const ver = (pieza) => config.visible?.[pieza] !== false;
function aplicarConfig(nueva) {
  if (!nueva) return;
  config = nueva;
  for (const [id, pos] of Object.entries(config.posiciones ?? {})) {
    const nodo = $(id);
    if (!nodo) continue;
    nodo.style.left = `${pos.x}px`;
    nodo.style.top = `${pos.y}px`;
  }
  if (ultimoEstado) pintarEstado(ultimoEstado);
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
}

window.overlay.onState(pintarEstado);
window.overlay.onConfig?.(aplicarConfig);
window.overlay.getConfig?.().then(aplicarConfig);
