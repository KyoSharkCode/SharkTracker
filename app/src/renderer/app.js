// --- Controles de ventana ---
document.getElementById('btn-min').addEventListener('click', () => window.tuTracker.minimize());
document.getElementById('btn-max').addEventListener('click', () => window.tuTracker.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.tuTracker.close());

// --- Navegación entre páginas ---
const navItems = document.querySelectorAll('.navitem:not(.disabled)');
navItems.forEach((item) => {
  item.addEventListener('click', () => {
    navItems.forEach((n) => n.classList.remove('active'));
    item.classList.add('active');

    const target = item.dataset.page;
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById('page-' + target).classList.add('active');
  });
});

// --- Panel de prueba: Live Client Data API ---
const statusEl = document.getElementById('live-status');
const jsonEl = document.getElementById('live-json');
const checkBtn = document.getElementById('btn-check');

async function checkLiveGame() {
  checkBtn.disabled = true;
  statusEl.textContent = 'Comprobando…';
  statusEl.className = 'livestatus';
  jsonEl.hidden = true;

  const result = await window.tuTracker.checkLiveGame();

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
