// Dibuja el overlay con el estado que calcula game-state.js (llega por IPC cada segundo).
const $ = (id) => document.getElementById(id);

// ── Escalado: el diseño está hecho a 1600×900 y se ajusta a tu pantalla ──
function escalar() {
  const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
  $('stage').style.transform = `scale(${s})`;
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

// ── Barón / Ancestral: tiempo del buff, de quién es y quién lo tiene ──
function pintarBuff(nodo, letra, buff) {
  nodo.hidden = !buff;
  if (!buff) return;
  const quien = buff.esMio ? 'mio' : 'rival';
  const info = el('div');
  info.append(el('div', 'ptime', mmss(buff.restante)),
              el('div', `plabel ${quien}`, buff.esMio ? 'Tu equipo lo tiene' : 'Rival lo tiene'));
  const fichas = el('div', 'chiprow');
  for (const t of buff.titulares) {
    const f = el('div', `chip ${quien}`, t.corto);
    f.title = t.nombre;
    fichas.append(f);
  }
  nodo.replaceChildren(el('div', 'pic', letra), info, fichas);
}

// ── Anuncios: rotan cada 4 s si hay varios objetivos próximos ──
const LETRA = { dragon: 'D', ancestral: 'A', larvas: 'V', heraldo: 'H', atakhan: 'K', baron: 'B' };
let anuncioIdx = 0;
let proximos = [];
setInterval(() => { anuncioIdx++; pintarAnuncio(); }, 4000);

function pintarAnuncio() {
  const hay = proximos.length > 0;
  $('anuncio').hidden = !hay;
  $('anuncio-dots').hidden = proximos.length < 2;
  if (!hay) return;
  const i = anuncioIdx % proximos.length;
  const p = proximos[i];
  const nodo = $('anuncio');
  nodo.className = `toppill anuncio c-${p.clave}`;
  nodo.querySelector('.pic').textContent = LETRA[p.clave] ?? '•';
  nodo.querySelector('.titulo').textContent = `${p.nombre} en ${mmss(p.falta)}`;
  const dots = proximos.slice(0, 4).map((_, j) => el('span', j === i ? 'rdot on' : 'rdot'));
  $('anuncio-dots').replaceChildren(...dots);
}

// ── Toast de dragón ──
function pintarToast(toast) {
  $('toast').hidden = !toast;
  $('toast-dots').hidden = !toast || toast.tipo === 'Elder';
  if (!toast) return;
  const nodo = $('toast');
  nodo.className = `toppill toast c-${toast.tipo}`;
  $('toast-dots').className = `dotrow toast-dots c-${toast.tipo}`;
  nodo.querySelector('.pic').textContent = 'D';
  nodo.querySelector('.titulo').textContent = toast.titulo + (toast.robado ? ' (robado)' : '');
  const sub = nodo.querySelector('.sub');
  sub.textContent = toast.equipo ? (toast.esMio ? 'Tu equipo' : 'Equipo rival') : '';
  sub.className = `plabel sub ${toast.esMio ? 'mio' : 'rival'}`;
  const dots = [0, 1, 2, 3].map((j) => el('span', j < toast.dragones ? 'rdot on' : 'rdot'));
  $('toast-dots').replaceChildren(...dots);
}

window.overlay.onState((estado) => {
  pintarBuff($('baron'), 'B', estado.baron);
  pintarBuff($('ancestral'), 'A', estado.ancestral);
  proximos = estado.proximos ?? [];
  pintarAnuncio();
  pintarToast(estado.toast);
});
