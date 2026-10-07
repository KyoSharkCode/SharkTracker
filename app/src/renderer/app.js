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
    al_dia: 'Estás al día ✓',
    descargando: `Descargando la versión ${e.version ?? 'nueva'}… ${e.porcentaje ?? 0}%`,
    lista: `La versión ${e.version} está lista: se instala al cerrar la app, o ahora mismo:`,
    error: 'No se pudo buscar actualizaciones (sin conexión). Se vuelve a intentar más tarde.',
  };
  txt.textContent = textos[e?.estado] ?? '';
  txt.className = `accsub${e?.estado === 'al_dia' ? ' ok' : e?.estado === 'lista' ? ' nueva' : ''}`;
  $('btn-actualizar').hidden = e?.estado !== 'lista';
  // Barra de título: aviso visible cuando la versión nueva ya está descargada.
  $('update-chip').hidden = e?.estado !== 'lista';
  $('update-chip-text').textContent = e?.estado === 'lista' ? `v${e.version} lista · Reiniciar` : '';
}
window.sharkTracker.app.onActualizacion(renderActualizacion);
window.sharkTracker.app.estadoActualizacion().then(renderActualizacion);
$('btn-actualizar').addEventListener('click', () => window.sharkTracker.app.instalarActualizacion());
$('update-chip').addEventListener('click', () => window.sharkTracker.app.instalarActualizacion());

// --- Ajustes → Clips (C1): activar (descarga FFmpeg y prueba el codificador la primera vez),
// calidad, overlay en el clip y carpeta. Ctrl + F8 lo escucha el proceso main en partida.
const swClips = $('sw-clips');
const swClipsOverlay = $('sw-clips-overlay');
const calidadClipsEl = $('clips-calidad');
for (const [valor, texto] of [['alta', 'Alta'], ['ligera', 'Ligera']]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segmento';
  b.dataset.calidad = valor;
  b.setAttribute('role', 'radio');
  b.textContent = texto;
  b.addEventListener('click', async () => renderClips(await window.sharkTracker.ajustes.set({ clips: { calidad: valor } })));
  calidadClipsEl.append(b);
}
let estadoClips = null;
let preparandoClips = false;
async function renderClips(aj) {
  const c = aj?.clips;
  if (!c) return;
  estadoClips = await window.sharkTracker.clips.estado();
  marcar(swClips, c.activo);
  marcar(swClipsOverlay, c.overlayEnClip);
  calidadClipsEl.querySelectorAll('.segmento').forEach((b) => {
    const on = b.dataset.calidad === c.calidad;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('clips-duracion').textContent = `${c.antes} s antes de pulsar Ctrl + F8 y ${c.despues} s después`;
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
  renderClips(await window.sharkTracker.ajustes.set({ clips: { activo: activar } }));
});
swClipsOverlay.addEventListener('click', async () => {
  renderClips(await window.sharkTracker.ajustes.set({ clips: { overlayEnClip: !swClipsOverlay.classList.contains('on') } }));
});
$('btn-clips-carpeta').addEventListener('click', () => window.sharkTracker.clips.abrirCarpeta());
window.sharkTracker.clips.onGuardado((r) => {
  $('clips-ultimo').textContent = r.ok ? `Último clip: ${r.segundos} s, guardado a las ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'El último clip no se pudo guardar.';
});
window.sharkTracker.ajustes.onChanged(renderClips);
window.sharkTracker.ajustes.get().then(renderClips);
