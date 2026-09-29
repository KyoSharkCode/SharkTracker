const $ = (id) => document.getElementById(id);

// --- Controles de ventana ---
$('btn-min').addEventListener('click', () => window.sharkTracker.minimize());
$('btn-max').addEventListener('click', () => window.sharkTracker.maximize());
$('btn-close').addEventListener('click', () => window.sharkTracker.close());

// --- Navegación entre páginas ---
const navItems = document.querySelectorAll('.navitem:not(.disabled)');
function goTo(page) {
  navItems.forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
}
navItems.forEach((item) => item.addEventListener('click', () => goTo(item.dataset.page)));

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
    statusEl.textContent = '✓ Conectado — hay una partida en curso y la app puede leer sus datos.';
    statusEl.className = 'livestatus ok';
    jsonEl.hidden = false;
    // Solo mostramos un resumen, el objeto completo es enorme
    const g = result.data;
    jsonEl.textContent = JSON.stringify(
      {
        gameTime: g.gameData?.gameTime,
        activePlayer: g.activePlayer?.summonerName,
        jugadores: g.allPlayers?.map((p) => p.summonerName)
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
