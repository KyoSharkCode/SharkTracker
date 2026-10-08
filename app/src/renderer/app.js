const $ = (id) => document.getElementById(id);

// --- Controles de ventana ---
$('btn-min').addEventListener('click', () => window.sharkTracker.minimize());
$('btn-max').addEventListener('click', () => window.sharkTracker.maximize());
$('btn-close').addEventListener('click', () => window.sharkTracker.close());

// --- Navegación entre páginas ---
const navItems = document.querySelectorAll('.navitem:not(.disabled)');
function goTo(page) {
  navItems.forEach((n) => {
    n.classList.toggle('active', n.dataset.page === page);
    if (n.dataset.page === page) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  moverIndicadores();
}

// Indicadores deslizantes: el resaltado del menú lateral y el subrayado de las
// pestañas de Ajustes se mueven al elegido (solo transform: no recalcula el layout).
// La primera vez (o al cambiar de tamaño) se colocan sin animar.
const indicadores = [
  { caja: document.querySelector('.sidebar'), item: '.navitem.active', clase: 'nav-indicador',
    poner: (ind, it) => { ind.style.transform = `translateY(${it.offsetTop}px)`; ind.style.height = `${it.offsetHeight}px`; } },
  { caja: document.querySelector('.stabs'), item: '.stab.active', clase: 'stab-indicador',
    poner: (ind, it) => { ind.style.transform = `translateX(${it.offsetLeft}px) scaleX(${it.offsetWidth})`; } },
].filter((x) => x.caja);
for (const x of indicadores) {
  x.ind = document.createElement('span');
  x.ind.className = x.clase;
  x.ind.setAttribute('aria-hidden', 'true');
  x.caja.prepend(x.ind);
  x.caja.classList.add('con-indicador');
  // Al hacerse visible (tras iniciar sesión) o cambiar de tamaño: colocar sin animar.
  new ResizeObserver(() => { x.caja.classList.remove('listo'); moverIndicadores(); requestAnimationFrame(() => x.caja.classList.add('listo')); }).observe(x.caja);
}
function moverIndicadores() {
  for (const x of indicadores) {
    const it = x.caja.querySelector(x.item);
    if (it && it.offsetWidth) x.poner(x.ind, it);
  }
}
navItems.forEach((item) => item.addEventListener('click', () => {
  goTo(item.dataset.page);
  if (item.dataset.page === 'perfil') window.miPerfil.cargar(); // se refresca si pasaron 2+ min
  if (item.dataset.page === 'meta') window.metaPagina.cargar();  // se refresca si pasaron 10+ min
  if (item.dataset.page === 'envivo') window.enVivo.cargar();
  if (item.dataset.page === 'clips') window.galeriaClips.cargar();
}));

// --- Sesión de Discord ---
// Ícono de invocador de LoL sin depender del número de parche.
const profileIconUrl = (id) => `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

function setLoginStatus(text, isError = false) {
  const el = $('login-status');
  el.hidden = !text;
  el.textContent = text ?? '';
  el.classList.toggle('bad', isError);
}

function setDiscordButton(busy) {
  $('btn-discord').disabled = busy;
  $('btn-discord-text').textContent = busy ? 'Esperando a Discord…' : 'Continuar con Discord';
}

function renderAuth(state) {
  const loggedIn = !!state?.loggedIn;
  $('login').hidden = loggedIn;
  $('app-body').hidden = !loggedIn;
  $('discord-chip').hidden = !loggedIn;
  if (!loggedIn) return;

  setDiscordButton(false);
  setLoginStatus(null);
  window.miPerfil.cargar();
  window.enVivo.iniciar(); // escucha al cliente de LoL (una sola vez)

  // Barra de título
  const { discord, player } = state;
  $('discord-chip-name').textContent = discord.name;
  if (discord.avatar) $('discord-chip-avatar').src = discord.avatar;

  // Ajustes → Cuentas conectadas
  if (discord.avatar) $('acct-discord-avatar').src = discord.avatar;
  $('acct-discord-name').textContent = discord.username && discord.username !== discord.name
    ? `${discord.name} · @${discord.username}` : discord.name;

  const lolIcon = $('acct-lol-icon');
  const lolBadge = $('acct-lol-badge');
  lolIcon.textContent = '';
  if (player) {
    $('acct-lol-name').textContent = player.riot_game_name;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = ` #${player.riot_tag_line}`;
    $('acct-lol-name').appendChild(tag);
    $('acct-lol-sub').textContent = 'Cuenta de League of Legends · LAN · vinculada en SharkTracker';
    if (player.icon_id) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = profileIconUrl(player.icon_id);
      img.onerror = () => { img.remove(); lolIcon.textContent = player.riot_game_name.slice(0, 2).toUpperCase(); };
      lolIcon.appendChild(img);
    } else {
      lolIcon.textContent = player.riot_game_name.slice(0, 2).toUpperCase();
    }
    lolBadge.classList.remove('off');
    lolBadge.lastChild.textContent = 'Vinculada';
  } else {
    $('acct-lol-name').textContent = 'League of Legends';
    $('acct-lol-sub').textContent = 'Todavía no vinculaste tu cuenta de LoL: hazlo en la web de SharkTracker.';
    lolIcon.textContent = 'LoL';
    lolBadge.classList.add('off');
    lolBadge.lastChild.textContent = 'Sin vincular';
  }
}

$('btn-discord').addEventListener('click', async () => {
  setDiscordButton(true);
  setLoginStatus('Se abrió Discord en tu navegador. Autoriza el acceso y vuelve aquí: la app se abrirá sola.');
  const res = await window.sharkTracker.auth.signIn();
  if (!res.ok) {
    setDiscordButton(false);
    setLoginStatus(`No se pudo abrir el inicio de sesión: ${res.error}`, true);
  }
});

$('btn-signout').addEventListener('click', async () => {
  window.miPerfil.limpiar();
  renderAuth(await window.sharkTracker.auth.signOut());
  goTo('perfil');
});

$('discord-chip').addEventListener('click', () => goTo('ajustes'));

window.sharkTracker.auth.onChanged(renderAuth);
window.sharkTracker.auth.onError((message) => {
  setDiscordButton(false);
  setLoginStatus(message, true);
});

// Estado inicial: ¿ya había una sesión guardada?
window.sharkTracker.auth.getState()
  .then(renderAuth)
  .catch(() => renderAuth({ loggedIn: false }));

// --- Detección automática del cliente de LoL ---
function renderGameStatus({ inGame }) {
  $('game-chip').classList.toggle('ingame', inGame);
  const texto = inGame ? 'En partida' : 'Sin partida';
  const t = $('game-chip-text');
  if (t.textContent === texto) return;
  t.textContent = texto;
  // Cambio de estado: el texto entra con un fundido corto (se reinicia la animación).
  t.classList.remove('cambia'); void t.offsetWidth; t.classList.add('cambia');
}
window.sharkTracker.onGameStatus(renderGameStatus);
window.sharkTracker.getGameStatus().then(renderGameStatus);

// --- Panel de prueba: Live Client Data API ---
const statusEl = $('live-status');
const jsonEl = $('live-json');
const checkBtn = $('btn-check');

async function checkLiveGame() {
  checkBtn.disabled = true;
  statusEl.textContent = 'Comprobando…';
  statusEl.className = 'livestatus';
  jsonEl.hidden = true;

  const result = await window.sharkTracker.checkLiveGame();

  if (result.inGame) {
    statusEl.textContent = '✓ Conectado: hay una partida en curso y la app puede leer sus datos.';
    statusEl.className = 'livestatus ok';
    jsonEl.hidden = false;
    // Solo mostramos un resumen, el objeto completo es enorme
    const g = result.data;
    jsonEl.textContent = JSON.stringify(
      {
        gameTime: g.gameData?.gameTime,
        activePlayer: g.activePlayer?.summonerName,
        jugadores: g.allPlayers?.map((p) => p.summonerName),
        // Eventos de la partida (para comprobar los nombres que usa Riot)
        eventos: g.events?.Events?.map((e) => `${Math.floor(e.EventTime / 60)}:${String(Math.floor(e.EventTime % 60)).padStart(2, '0')} ${e.EventName}${e.DragonType ? ' (' + e.DragonType + ')' : ''}${e.KillerName ? ' · ' + e.KillerName : ''}`)
      },
      null,
      2
    );
  } else {
    statusEl.textContent = result.error || 'No hay partida activa ahora mismo.';
    statusEl.className = 'livestatus bad';
  }

  checkBtn.disabled = false;
}

checkBtn.addEventListener('click', checkLiveGame);

// --- Ajustes: pestañas (Cuenta / Overlay / Apariencia / Notificaciones / Clips) ---
document.querySelectorAll('.stab:not(.disabled)').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.stab').forEach((t) => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.subpage').forEach((p) => p.classList.toggle('active', p.id === 'stab-' + tab.dataset.stab));
  moverIndicadores();
}));

// --- Ajustes → Overlay: interruptores (se guardan en este PC y se aplican al instante) ---
const interruptores = document.querySelectorAll('.sw[data-pieza]');
function renderOverlayConfig(config) {
  interruptores.forEach((sw) => {
    const on = config?.visible?.[sw.dataset.pieza] !== false;
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
  });
}
interruptores.forEach((sw) => sw.addEventListener('click', async () => {
  const on = !sw.classList.contains('on');
  renderOverlayConfig(await window.sharkTracker.overlayConfig.set({ visible: { [sw.dataset.pieza]: on } }));
}));
window.sharkTracker.overlayConfig.onChanged(renderOverlayConfig);
window.sharkTracker.overlayConfig.get().then(renderOverlayConfig);
$('btn-reposicionar').addEventListener('click', () => window.sharkTracker.overlayConfig.abrirEditor());

// --- Ajustes → Apariencia: tamaño y opacidad del overlay (viven en los ajustes del overlay) ---
const ESCALAS = [[0.8, '80 %'], [0.9, '90 %'], [1, '100 %'], [1.1, '110 %'], [1.2, '120 %']];
const escalaEl = $('ov-escala');
for (const [valor, texto] of ESCALAS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segmento';
  b.dataset.escala = String(valor);
  b.setAttribute('role', 'radio');
  b.textContent = texto;
  b.addEventListener('click', async () => renderApariencia(await window.sharkTracker.overlayConfig.set({ apariencia: { escala: valor } })));
  escalaEl.append(b);
}
const opacidadEl = $('ov-opacidad');
function renderApariencia(config) {
  const ap = config?.apariencia ?? { escala: 1, opacidad: 0.8 };
  escalaEl.querySelectorAll('.segmento').forEach((b) => {
    const on = Number(b.dataset.escala) === ap.escala;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  if (document.activeElement !== opacidadEl) opacidadEl.value = String(Math.round(ap.opacidad * 100));
  $('ov-opacidad-v').textContent = `${Math.round(ap.opacidad * 100)} %`;
}
opacidadEl.addEventListener('input', () => { $('ov-opacidad-v').textContent = `${opacidadEl.value} %`; });
opacidadEl.addEventListener('change', async () => {
  renderApariencia(await window.sharkTracker.overlayConfig.set({ apariencia: { opacidad: Number(opacidadEl.value) / 100 } }));
});
window.sharkTracker.overlayConfig.onChanged(renderApariencia);
window.sharkTracker.overlayConfig.get().then(renderApariencia);

// --- Ajustes → Apariencia (acento, ventana) y Notificaciones: userData/ajustes.json ---
const ACENTOS = [['turquesa', 'Turquesa', '#3DFFD2'], ['lila', 'Lila', '#A98BFF'], ['dorado', 'Dorado', '#FFB547'], ['azul', 'Azul', '#5AA9FF'], ['rojo', 'Rojo', '#FF8FA6']];
const acentosEl = $('acentos');
for (const [clave, nombre, color] of ACENTOS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'acento';
  b.dataset.acento = clave;
  b.setAttribute('role', 'radio');
  b.style.setProperty('--c', color);
  b.innerHTML = '<span class="acento-muestra"></span>';
  b.append(document.createTextNode(nombre));
  b.addEventListener('click', async () => renderAjustes(await window.sharkTracker.ajustes.set({ acento: clave })));
  acentosEl.append(b);
}
const swVentana = document.querySelectorAll('.sw[data-ventana]');
const swAvisos = document.querySelectorAll('.sw[data-aviso]');
function marcar(sw, on) {
  sw.classList.toggle('on', on);
  sw.setAttribute('aria-checked', String(on));
}
function renderAjustes(aj) {
  if (!aj) return;
  // El acento se aplica a toda la ventana con la variable --acento (style.css).
  const color = ACENTOS.find(([c]) => c === aj.acento)?.[2] ?? '#3DFFD2';
  document.documentElement.style.setProperty('--acento', color);
  acentosEl.querySelectorAll('.acento').forEach((b) => {
    const on = b.dataset.acento === aj.acento;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  swVentana.forEach((sw) => marcar(sw, !!aj.ventana?.[sw.dataset.ventana]));
  swAvisos.forEach((sw) => marcar(sw, aj.avisos?.[sw.dataset.aviso] !== false));
}
swVentana.forEach((sw) => sw.addEventListener('click', async () => {
  renderAjustes(await window.sharkTracker.ajustes.set({ ventana: { [sw.dataset.ventana]: !sw.classList.contains('on') } }));
}));
swAvisos.forEach((sw) => sw.addEventListener('click', async () => {
  renderAjustes(await window.sharkTracker.ajustes.set({ avisos: { [sw.dataset.aviso]: !sw.classList.contains('on') } }));
}));
window.sharkTracker.ajustes.onChanged(renderAjustes);
window.sharkTracker.ajustes.get().then(renderAjustes);
$('btn-probar-aviso').addEventListener('click', async () => {
  const ok = await window.sharkTracker.ajustes.probarAviso();
  $('probar-aviso-txt').textContent = ok ? 'Enviado: mira la esquina de la pantalla.' : 'Windows no deja mostrar avisos (revisa Configuración → Notificaciones).';
});

// --- Versión (sale de package.json) y actualizaciones automáticas ---
window.sharkTracker.app.version().then((v) => {
  $('app-version').textContent = `v${v}`;
  $('acerca-version').textContent = v;
});
function renderActualizacion(e) {
  const txt = $('acerca-update');
  const textos = {
    desarrollo: 'Modo desarrollo (npm start): las actualizaciones solo funcionan en la app instalada.',
    buscando: 'Buscando actualizaciones…',
    al_dia: 'Estás al día ✓ (se revisa sola cada 4 h)',
    descargando: `Descargando la versión ${e.version ?? 'nueva'}… ${e.porcentaje ?? 0}%`,
    lista: `La versión ${e.version} está lista: se instala al cerrar la app, o ahora mismo:`,
    error: 'No se pudo buscar actualizaciones (sin conexión). Se vuelve a intentar más tarde.',
  };
  txt.textContent = textos[e?.estado] ?? '';
  txt.className = `accsub${e?.estado === 'al_dia' ? ' ok' : e?.estado === 'lista' ? ' nueva' : ''}`;
  $('btn-actualizar').hidden = e?.estado !== 'lista';
  // "Buscar actualizaciones": cuando está al día o falló (en desarrollo no hay actualizaciones).
  $('btn-buscar-update').hidden = !['al_dia', 'error'].includes(e?.estado);
  // Barra de título: aviso visible cuando la versión nueva ya está descargada.
  $('update-chip').hidden = e?.estado !== 'lista';
  $('update-chip-text').textContent = e?.estado === 'lista' ? `v${e.version} lista · Reiniciar` : '';
}
window.sharkTracker.app.onActualizacion(renderActualizacion);
window.sharkTracker.app.estadoActualizacion().then(renderActualizacion);
$('btn-actualizar').addEventListener('click', () => window.sharkTracker.app.instalarActualizacion());
$('btn-buscar-update').addEventListener('click', async () => {
  // El resultado llega por onActualizacion (buscando → al día / descargando / error).
  renderActualizacion({ estado: 'buscando' });
  await window.sharkTracker.app.buscarActualizacion();
});
$('update-chip').addEventListener('click', () => window.sharkTracker.app.instalarActualizacion());

// --- Ajustes → Clips: activar (descarga FFmpeg y prueba el codificador la primera vez),
// calidad, duración, jugadas automáticas, audio y espacio. Ctrl + F8, la tecla de la R
// y las jugadas los escucha el proceso main en partida.
const swClips = $('sw-clips');
const swClipsOverlay = $('sw-clips-overlay');
const calidadClipsEl = $('clips-calidad');
const limiteClipsEl = $('clips-limite');
const guardarClips = async (cambios) => renderClips(await window.sharkTracker.ajustes.set({ clips: cambios }));
function segmento(caja, valor, texto, alElegir) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segmento';
  b.dataset.valor = String(valor);
  b.setAttribute('role', 'radio');
  b.textContent = texto;
  b.addEventListener('click', alElegir);
  caja.append(b);
}
function marcarSegmentos(caja, valor) {
  caja.querySelectorAll('.segmento').forEach((b) => {
    const on = b.dataset.valor === String(valor);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}
for (const [valor, texto] of [['alta', 'Alta'], ['ligera', 'Ligera']]) segmento(calidadClipsEl, valor, texto, () => guardarClips({ calidad: valor }));
for (const gb of [5, 10, 20, 50]) segmento(limiteClipsEl, gb, `${gb} GB`, () => guardarClips({ limiteGB: gb }).then(pintarUsoClips));

// Duración: el número se ve al mover; se guarda al soltar.
for (const k of ['antes', 'despues']) {
  const r = $(`clips-${k}`);
  r.addEventListener('input', () => { $(`clips-${k}-v`).textContent = `${r.value} s`; });
  r.addEventListener('change', () => guardarClips({ [k]: Number(r.value) }));
}

// Jugadas automáticas
document.querySelectorAll('[data-evento]').forEach((b) => b.addEventListener('click', () => {
  guardarClips({ eventos: { [b.dataset.evento]: !b.classList.contains('on') } });
}));
const teclaUlti = $('clips-tecla');
for (const t of [...'QWERTYUIOPASDFGHJKLZXCVBNM1234567890']) {
  const o = document.createElement('option');
  o.value = t;
  o.textContent = t;
  teclaUlti.append(o);
}
teclaUlti.addEventListener('change', () => guardarClips({ teclaUlti: teclaUlti.value }));
$('sw-clips-aviso').addEventListener('click', () => guardarClips({ avisoAuto: !$('sw-clips-aviso').classList.contains('on') }));

// Audio: cada fuente con su interruptor, volumen y (micrófono / PC) dispositivo.
const fuentesAudio = document.querySelectorAll('.fuente');
fuentesAudio.forEach((caja) => {
  const f = caja.dataset.fuente;
  const sw = caja.querySelector('.sw');
  const vol = caja.querySelector('input[type=range]');
  const out = caja.querySelector('output');
  sw.addEventListener('click', () => guardarClips({ audio: { [f]: { activo: !sw.classList.contains('on') } } }));
  vol.addEventListener('input', () => { out.textContent = `${vol.value} %`; });
  vol.addEventListener('change', () => guardarClips({ audio: { [f]: { volumen: Number(vol.value) } } }));
  caja.querySelector('select')?.addEventListener('change', (e) => guardarClips({ audio: { [f]: { dispositivo: e.target.value } } }));
});
// Probar audio: qué llega de cada fuente encendida (lo dice el propio ayudante).
const NOMBRE_FUENTE = { juego: 'Juego', discord: 'Discord', mic: 'Micrófono', pc: 'Todo el PC' };
const TEXTO_PRUEBA = {
  ok: (r) => `se oye ✓ (${r.db} dB)`,
  silencio: () => 'llega, pero en silencio: ¿estaba sonando algo?',
  nada: () => 'no llega sonido. Si usas Wave Link o Voicemeeter, prueba con "Juego" y "Discord" en lugar de "Todo el PC", o elige otro dispositivo',
  'sin-capturar': (r) => (r.fuente === 'juego' ? 'abre una partida (o la práctica) para probarlo'
    : r.fuente === 'discord' ? 'Discord no está abierto' : `no se pudo abrir${r.detalle ? `: ${r.detalle.replace(/^[^:]+:\s*/, '')}` : ''}`),
};
$('btn-probar-audio').addEventListener('click', async () => {
  const b = $('btn-probar-audio');
  const lista = $('audio-prueba');
  b.disabled = true;
  b.textContent = 'Probando…';
  const r = await window.sharkTracker.clips.probarAudio();
  b.disabled = false;
  b.textContent = 'Probar audio';
  lista.hidden = false;
  if (!r.ok) {
    const li = document.createElement('li');
    li.className = 'mal';
    li.textContent = r.motivo === 'sin-fuentes' ? 'Enciende al menos una fuente de audio.'
      : r.motivo === 'sin-ayudante' ? 'Falta el ayudante de audio (sharkaudio.exe): reinstala la app.' : 'El ayudante de audio no respondió.';
    lista.replaceChildren(li);
    return;
  }
  lista.replaceChildren(...r.fuentes.map((f) => {
    const li = document.createElement('li');
    li.className = f.estado === 'ok' ? 'bien' : 'mal';
    const b2 = document.createElement('b');
    b2.textContent = `${NOMBRE_FUENTE[f.fuente]}: `;
    li.append(b2, document.createTextNode(TEXTO_PRUEBA[f.estado](f)));
    return li;
  }));
});
$('sw-audio-separadas').addEventListener('click', () => guardarClips({ audio: { separadas: !$('sw-audio-separadas').classList.contains('on') } }));
// Micrófonos y salidas: se piden al ayudante de audio una vez (al abrir la pestaña).
let dispositivosAudio = null;
async function cargarDispositivos() {
  if (dispositivosAudio) return;
  dispositivosAudio = await window.sharkTracker.clips.dispositivos();
  renderClips(await window.sharkTracker.ajustes.get());
}
function llenarSelector(sel, lista, elegido) {
  const opciones = [{ id: '', nombre: 'El de Windows' }, ...(lista ?? [])];
  if (elegido && !opciones.some((o) => o.id === elegido)) opciones.push({ id: elegido, nombre: 'Desconectado' });
  const firma = JSON.stringify(opciones);
  if (sel._firma !== firma) {
    sel._firma = firma;
    sel.replaceChildren(...opciones.map((o) => {
      const op = document.createElement('option');
      op.value = o.id;
      op.textContent = o.defecto ? `${o.nombre} (el de Windows)` : o.nombre;
      return op;
    }));
  }
  sel.value = elegido ?? '';
}
document.querySelector('.stab[data-stab="clips"]')?.addEventListener('click', () => { cargarDispositivos(); pintarUsoClips(); });

const GB = 1024 ** 3;
const gbTxt = (b) => `${(b / GB).toLocaleString('es', { maximumFractionDigits: 1, minimumFractionDigits: b && b < 10 * GB ? 1 : 0 })} GB`;
async function pintarUsoClips() {
  const g = await window.sharkTracker.clips.galeria();
  $('clips-uso').textContent = `Usas ${gbTxt(g.usado)} de ${gbTxt(g.limite)}${g.favoritos ? ` · favoritos: ${gbTxt(g.favoritos)}` : ''}`;
}

let estadoClips = null;
let preparandoClips = false;
async function renderClips(aj) {
  const c = aj?.clips;
  if (!c) return;
  estadoClips = await window.sharkTracker.clips.estado();
  marcar(swClips, c.activo);
  marcar(swClipsOverlay, c.overlayEnClip);
  marcarSegmentos(calidadClipsEl, c.calidad);
  marcarSegmentos(limiteClipsEl, c.limiteGB);
  for (const k of ['antes', 'despues']) {
    $(`clips-${k}`).value = c[k];
    $(`clips-${k}-v`).textContent = `${c[k]} s`;
  }
  document.querySelectorAll('[data-evento]').forEach((b) => marcar(b, c.eventos[b.dataset.evento]));
  teclaUlti.value = c.teclaUlti;
  marcar($('sw-clips-aviso'), c.avisoAuto);
  fuentesAudio.forEach((caja) => {
    const f = caja.dataset.fuente;
    const a = c.audio[f];
    // "Todo el PC" ya incluye el juego y Discord: esos dos quedan en pausa.
    const anulada = c.audio.pc.activo && (f === 'juego' || f === 'discord');
    caja.classList.toggle('on', a.activo && !anulada);
    caja.classList.toggle('anulada', anulada);
    const sw = caja.querySelector('.sw');
    marcar(sw, a.activo && !anulada);
    sw.disabled = anulada || !estadoClips.audio;
    caja.querySelector('input[type=range]').value = a.volumen;
    caja.querySelector('output').textContent = `${a.volumen} %`;
    const sel = caja.querySelector('select');
    if (sel) llenarSelector(sel, f === 'mic' ? dispositivosAudio?.entradas : dispositivosAudio?.salidas, a.dispositivo);
  });
  marcar($('sw-audio-separadas'), c.audio.separadas);
  $('sw-audio-separadas').disabled = !estadoClips.audio;
  $('audio-estado').textContent = !estadoClips.windows ? 'El audio solo funciona en Windows.'
    : !estadoClips.audio ? 'Falta el ayudante de audio (sharkaudio.exe): reinstala la app. Los clips van sin sonido.'
    : estadoClips.grabando ? `Grabando: ${estadoClips.pistas.length ? estadoClips.pistas.join(' · ') : 'sin sonido'}`
    : 'El sonido de tus clips. Cada fuente con su volumen.';
  if (preparandoClips) return;
  swClips.disabled = !estadoClips.windows;
  $('clips-estado').textContent = !estadoClips.windows ? 'Solo funciona en Windows.'
    : !c.activo ? 'Apagado: no se graba nada.'
    : estadoClips.grabando ? `Grabando el búfer · ${estadoClips.codificador ?? ''}`
    : `Activo: empieza a grabar al empezar la partida${estadoClips.codificador ? ` · ${estadoClips.codificador}` : ''}`;
}
const TEXTO_PASO = { descargando: 'Descargando FFmpeg', descomprimiendo: 'Descomprimiendo…', probando: 'Probando la tarjeta gráfica…' };
window.sharkTracker.clips.onProgreso((p) => {
  $('clips-progreso').hidden = false;
  $('clips-barra').style.width = p.paso === 'descargando' ? `${Math.round((p.avance ?? 0) * 100)}%` : '100%';
  $('clips-progreso-txt').textContent = p.paso === 'descargando' ? `${TEXTO_PASO.descargando} · ${Math.round((p.avance ?? 0) * 100)} %` : TEXTO_PASO[p.paso] ?? '';
});
swClips.addEventListener('click', async () => {
  if (preparandoClips) return;
  const activar = !swClips.classList.contains('on');
  if (activar && (!estadoClips?.ffmpeg || !estadoClips?.codificador)) {
    preparandoClips = true;
    swClips.disabled = true;
    $('clips-estado').textContent = 'Preparando la grabación…';
    const r = await window.sharkTracker.clips.preparar();
    preparandoClips = false;
    swClips.disabled = false;
    $('clips-progreso').hidden = true;
    if (!r.ok) {
      $('clips-estado').textContent = r.motivo === 'sin-codificador'
        ? 'Tu tarjeta gráfica no pudo grabar (ver registro.txt en la carpeta de datos de la app).'
        : 'No se pudo descargar FFmpeg. Revisa tu conexión y vuelve a intentar.';
      return;
    }
  }
  guardarClips({ activo: activar });
});
swClipsOverlay.addEventListener('click', () => guardarClips({ overlayEnClip: !swClipsOverlay.classList.contains('on') }));
$('btn-clips-carpeta').addEventListener('click', () => window.sharkTracker.clips.abrirCarpeta());
window.sharkTracker.clips.onGuardado((r) => {
  const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  $('clips-ultimo').textContent = r.ok ? `Último clip: ${r.titulo && r.titulo !== 'Clip' ? `${r.titulo}, ` : ''}${r.segundos} s, a las ${hora}` : 'El último clip no se pudo guardar.';
});
window.sharkTracker.ajustes.onChanged(renderClips);
window.sharkTracker.ajustes.get().then(renderClips);
