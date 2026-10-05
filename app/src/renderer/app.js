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
  $('game-chip-text').textContent = inGame ? 'En partida' : 'Sin partida';
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

// --- Ajustes: pestañas (Cuenta / Overlay / Apariencia / Notificaciones) ---
document.querySelectorAll('.stab:not(.disabled)').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.stab').forEach((t) => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.subpage').forEach((p) => p.classList.toggle('active', p.id === 'stab-' + tab.dataset.stab));
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
const ACENTOS = [['turquesa', 'Turquesa', '#00e5c7'], ['lila', 'Lila', '#c19bf2'], ['dorado', 'Dorado', '#e8c766'], ['azul', 'Azul', '#7db3f0'], ['rojo', 'Rojo', '#ea8a8a']];
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
  const color = ACENTOS.find(([c]) => c === aj.acento)?.[2] ?? '#00e5c7';
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
