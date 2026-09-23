// ============================================================
// Fase 5 — Historial de rangos por split + Mejor partida del mes.
//
//   renderRankHistory(el, { supabase, playerId })   → perfil
//   renderBestMatch(el,  { supabase, playerId })    → perfil
//   renderMatchOfMonth(el, { supabase })            → index (la del grupo)
//
// Cada función devuelve { reload } para refrescar con Realtime.
// ============================================================
import { loadCatalogs, champImg, champName, splashUrl, rankText, emblemUrl, roleLabel, esc, iconOr1, ICON_ONERROR } from './lol-data.js';

const CSS = `
.rh-card{background:var(--panel,rgba(10,22,34,.7)); border:1px solid var(--border,#16324a); border-radius:var(--radius,16px); overflow:hidden;}
.rh-head{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:14px 18px; border-bottom:1px solid var(--border,#16324a);}
.rh-head h3{margin:0; font-family:Rajdhani,sans-serif; font-size:15px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;}
.rh-tabs{margin-left:auto; display:flex; gap:4px; flex-wrap:wrap;}
.rh-tabs button{background:transparent; border:1px solid var(--border,#16324a); color:var(--text-dim,#9db3c4); border-radius:99px; padding:4px 11px; font:700 11.5px Inter,sans-serif; cursor:pointer;}
.rh-tabs button:hover{color:#fff; border-color:var(--accent,#00e5c7);}
.rh-tabs button.on{background:rgba(0,229,199,.12); border-color:var(--accent,#00e5c7); color:#fff;}
.rh-empty{padding:26px 18px; text-align:center; color:var(--text-faint,#6d8ba3); font-size:13px; font-weight:600;}
.rh-foot{padding:10px 18px 14px; font-size:11.5px; color:var(--text-faint,#6d8ba3); line-height:1.45;}

/* Historial de rangos */
.rh-row{display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; align-items:center; padding:12px 18px; border-bottom:1px solid rgba(22,50,74,.6);}
.rh-split{grid-column:1 / -1;}
.rh-row:last-of-type{border-bottom:none;}
.rh-row.now{background:linear-gradient(90deg, rgba(0,229,199,.07), transparent 70%);}
.rh-split b{display:flex; align-items:center; gap:7px; font-size:13.5px; color:#fff;}
.rh-split small{display:block; font-size:11px; color:var(--text-faint,#6d8ba3); font-weight:600; margin-top:2px;}
.rh-now{font-size:9.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--accent,#00e5c7); border:1px solid rgba(0,229,199,.45); border-radius:99px; padding:1px 7px;}
.rh-rank{display:flex; align-items:center; gap:8px; min-width:0;}
.rh-rank img{width:34px; height:34px; object-fit:contain; flex-shrink:0;}
.rh-rank .lbl{display:block; font-size:9.5px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--text-faint,#6d8ba3);}
.rh-rank .v{display:block; font-size:13px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.rh-rank .v i{font-style:normal; color:var(--accent,#00e5c7); font-weight:700;}
.rh-rank.peak .v{color:var(--gold,#facc15);}
.rh-rank .none{font-size:12px; color:var(--text-faint,#6d8ba3); font-weight:600;}

/* Mejor partida */
.bm-body{position:relative; display:block; text-decoration:none; color:inherit; padding:18px; min-height:170px;}
.bm-bg{position:absolute; inset:0; background-size:cover; background-position:center 20%; opacity:.28; transition:opacity .2s;}
.bm-bg::after{content:''; position:absolute; inset:0; background:linear-gradient(90deg, rgba(6,14,23,.96) 30%, rgba(6,14,23,.6));}
a.bm-body:hover .bm-bg{opacity:.4;}
.bm-in{position:relative; display:flex; gap:16px; align-items:center;}
.bm-champ{width:72px; height:72px; border-radius:14px; overflow:hidden; border:2px solid var(--gold,#facc15); flex-shrink:0; background:#0a1622; box-shadow:0 0 18px rgba(250,204,21,.25);}
.bm-champ img{width:100%; height:100%; object-fit:cover; display:block;}
.bm-main{flex:1; min-width:0;}
.bm-main .nm{font-size:17px; font-weight:800; display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.bm-res{font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:99px; text-transform:uppercase; letter-spacing:.06em;}
.bm-res.w{background:rgba(34,197,94,.16); color:#4ade80;} .bm-res.l{background:rgba(255,95,61,.16); color:#ff8a6b;}
.bm-kda{font-family:Rajdhani,sans-serif; font-size:26px; font-weight:800; letter-spacing:.02em; margin-top:2px;}
.bm-kda span{color:var(--text-faint,#6d8ba3); font-weight:600;} .bm-kda .d{color:#ff8a6b;}
.bm-sub{font-size:12px; color:var(--text-dim,#9db3c4); font-weight:600; margin-top:2px;}
.bm-score{flex-shrink:0; width:74px; height:74px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:conic-gradient(var(--gold,#facc15) calc(var(--p) * 1%), rgba(22,50,74,.9) 0); position:relative;}
.bm-score::before{content:''; position:absolute; inset:6px; border-radius:50%; background:#07121d;}
.bm-score b{position:relative; font-family:Rajdhani,sans-serif; font-size:24px; font-weight:800; line-height:1; color:var(--gold,#facc15);}
.bm-score small{position:relative; font-size:9px; font-weight:800; letter-spacing:.08em; color:var(--text-faint,#6d8ba3);}
.bm-stats{position:relative; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:14px;}
.bm-stats div{background:rgba(13,26,38,.75); border:1px solid rgba(22,50,74,.8); border-radius:10px; padding:7px 10px;}
.bm-stats span{display:block; font-size:9.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--text-faint,#6d8ba3);}
.bm-stats b{font-size:14px; font-weight:800;}
.bm-go{position:relative; display:inline-block; margin-top:12px; font-size:12.5px; font-weight:800; color:var(--accent,#00e5c7);}

/* Partida del mes (index) */
.mm-card{position:relative; overflow:hidden; display:flex; align-items:center; gap:16px; text-decoration:none; color:inherit; background:var(--panel,rgba(10,22,34,.7));
  border:1px solid rgba(250,204,21,.4); box-shadow:0 0 24px rgba(250,204,21,.1); border-radius:var(--radius,16px); padding:26px 22px 18px; margin-bottom:28px; transition:border-color .15s, box-shadow .15s;}
a.mm-card:hover{border-color:var(--gold,#facc15); box-shadow:0 0 30px rgba(250,204,21,.2);}
.mm-bg{position:absolute; inset:0; background-size:cover; background-position:center 20%; opacity:.22;}
.mm-bg::after{content:''; position:absolute; inset:0; background:linear-gradient(90deg, rgba(6,14,23,.97) 35%, rgba(6,14,23,.55));}
.mm-badge{position:absolute; top:0; left:0; z-index:1; background:var(--gold,#facc15); color:#000; font-size:10px; font-weight:800; padding:4px 12px; border-bottom-right-radius:8px; text-transform:uppercase; letter-spacing:.08em;}
.mm-card > *:not(.mm-bg):not(.mm-badge){position:relative;}
.mm-av{width:52px; height:52px; border-radius:12px; overflow:hidden; border:2px solid var(--gold,#facc15); flex-shrink:0; background:#0a1622;}
.mm-av img, .mm-ch img{width:100%; height:100%; object-fit:cover; display:block;}
.mm-ch{width:40px; height:40px; border-radius:9px; overflow:hidden; border:1px solid var(--gold,#facc15); flex-shrink:0; background:#0a1622;}
.mm-txt{min-width:0; flex:1;}
.mm-txt b{display:block; font-size:17px; font-weight:800;}
.mm-meta{display:flex; gap:10px; flex-wrap:wrap; font-size:12px; color:var(--text-dim,#9db3c4); font-weight:600; margin-top:2px;}
.mm-pts{margin-left:auto; text-align:right; flex-shrink:0;}
.mm-pts b{display:block; font-family:Rajdhani,sans-serif; font-size:28px; font-weight:800; line-height:1; color:var(--gold,#facc15);}
.mm-pts small{font-size:10px; font-weight:800; letter-spacing:.08em; color:var(--text-faint,#6d8ba3); text-transform:uppercase;}
.mm-card.pending{border-color:var(--border,#16324a); box-shadow:none; opacity:.8;}
.mm-card.pending .mm-badge{background:var(--panel-2,rgba(13,26,38,.75)); color:var(--text-faint,#6d8ba3);}
.mm-card.pending .mm-av{border-color:var(--border,#16324a); display:flex; align-items:center; justify-content:center; font-size:22px;}

@media (max-width:620px){
  .rh-row{padding:12px 14px;}
  .bm-in{flex-wrap:wrap;}
  .bm-champ{width:58px; height:58px;}
  .bm-score{width:62px; height:62px;} .bm-score b{font-size:20px;}
  .mm-card{flex-wrap:wrap; gap:12px;}
  .mm-pts{margin-left:0;}
}
`;
function injectCss() {
  if (document.getElementById('rh-style')) return;
  const st = document.createElement('style'); st.id = 'rh-style'; st.textContent = CSS; document.head.appendChild(st);
}

const QUEUES = [['RANKED_SOLO_5x5', 'SoloQ'], ['RANKED_FLEX_SR', 'Flex']];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (period) => { const [y, m] = period.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }) : '…';
const currentPeriod = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const HIDE = `this.style.visibility='hidden'`;
const ROLE_ES = { TOP: 'Top', JUNGLE: 'Jungla', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };
const dur = (s) => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—';
const catalogs = loadCatalogs();   // una sola vez: versión de Data Dragon + nombres en español

// ── Historial de rangos por split ──
export function renderRankHistory(el, { supabase, playerId }) {
  injectCss();
  let queue = 'RANKED_SOLO_5x5', data = null;

  async function load() {
    const [{ data: splits }, { data: ranks }] = await Promise.all([
      supabase.from('splits').select('*').order('starts_at', { ascending: false }),
      supabase.from('split_ranks').select('*').eq('player_id', playerId),
    ]);
    data = { splits: splits ?? [], ranks: ranks ?? [] };
    draw();
  }
  function rankCell(kind, r) {
    const [tier, div, lp] = kind === 'peak' ? [r?.peak_tier, r?.peak_division, r?.peak_lp] : [r?.last_tier, r?.last_division, r?.last_lp];
    if (!tier) return `<div class="rh-rank ${kind}"><span class="none">—</span></div>`;
    return `<div class="rh-rank ${kind}"><img src="${emblemUrl(tier)}" alt="" onerror="${HIDE}">
      <span style="min-width:0"><span class="lbl">${kind === 'peak' ? 'Pico' : r.__now ? 'Actual' : 'Final'}</span>
      <span class="v">${esc(rankText({ tier, division: div }))} <i>${lp ?? 0} LP</i></span></span></div>`;
  }
  function draw() {
    if (!data) return;
    const now = Date.now();
    const byS = new Map(data.ranks.filter(r => r.queue_type === queue).map(r => [r.split_id, r]));
    const rows = data.splits.filter(s => new Date(s.starts_at).getTime() <= now)
      .map(s => {
        const isNow = !s.ends_at || new Date(s.ends_at).getTime() > now;
        const r = byS.get(s.id);
        return { s, isNow, r: r ? { ...r, __now: isNow } : null };
      })
      .filter(x => x.r || x.isNow);
    const hasFlex = data.ranks.some(r => r.queue_type === 'RANKED_FLEX_SR');
    el.innerHTML = `<div class="rh-card">
      <div class="rh-head"><h3>🏅 Historial de rangos</h3>
        ${hasFlex || queue !== 'RANKED_SOLO_5x5' ? `<div class="rh-tabs">${QUEUES.map(([k, l]) => `<button type="button" data-q="${k}" class="${k === queue ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}</div>
      ${rows.length ? rows.map(({ s, isNow, r }) => `
        <div class="rh-row ${isNow ? 'now' : ''}">
          <div class="rh-split"><b>${esc(s.name)} ${isNow ? '<span class="rh-now">En curso</span>' : ''}</b>
            <small>${shortDate(s.starts_at)} → ${s.ends_at ? shortDate(s.ends_at) : 'sin fecha'}</small></div>
          ${r ? rankCell('peak', r) + rankCell('last', r) : `<div class="rh-rank" style="grid-column:span 2"><span class="none">Sin partidas clasificatorias en este split todavía</span></div>`}
        </div>`).join('') : `<div class="rh-empty">Todavía no hay rangos guardados.</div>`}
      <div class="rh-foot">Pico = el rango más alto que tocó en el split. El historial empieza desde que SharkTracker guarda rangos.</div>
    </div>`;
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (b) { queue = b.dataset.q; draw(); }
  });
  load();
  return { reload: load };
}

// ── Mejor partida del mes (perfil) ──
export function renderBestMatch(el, { supabase, playerId }) {
  injectCss();
  let rows = null, period = currentPeriod();

  async function load() {
    const { data } = await supabase.from('best_matches').select('*').eq('player_id', playerId).order('period', { ascending: false });
    await catalogs;
    rows = data ?? [];
    draw();
  }
  function draw() {
    if (!rows) return;
    const periods = [...new Set([currentPeriod(), ...rows.map(r => r.period)])].sort().reverse().slice(0, 6);
    if (!periods.includes(period)) period = periods[0];
    const m = rows.find(r => r.period === period);
    const isNow = period === currentPeriod();
    const tabs = periods.length > 1 ? `<div class="rh-tabs">${periods.map(p => `<button type="button" data-p="${p}" class="${p === period ? 'on' : ''}">${cap(monthName(p).slice(0, 3))}${p.slice(0, 4) !== currentPeriod().slice(0, 4) ? ' ' + p.slice(2, 4) : ''}</button>`).join('')}</div>` : '';
    const head = `<div class="rh-head"><h3>⭐ Mejor partida · ${cap(monthName(period))}</h3>${tabs}</div>`;
    if (!m) {
      el.innerHTML = `<div class="rh-card">${head}<div class="rh-empty">${isNow ? 'Todavía no hay partidas de SoloQ de 15+ minutos este mes.' : 'Sin partidas de SoloQ ese mes.'}</div></div>`;
      return;
    }
    const mins = (m.duration_seconds || 60) / 60;
    const role = ROLE_ES[roleLabel(m.role)] ?? '';
    const kda = ((m.kills + m.assists) / Math.max(1, m.deaths)).toFixed(1);
    el.innerHTML = `<div class="rh-card">${head}
      <a class="bm-body" href="partidas.html?id=${encodeURIComponent(m.match_id)}&jugador=${encodeURIComponent(playerId)}" title="Ver la partida completa">
        <div class="bm-bg" style="background-image:url('${splashUrl(m.champion, 0)}')"></div>
        <div class="bm-in">
          <div class="bm-champ"><img src="${champImg(m.champion)}" alt="" onerror="${HIDE}"></div>
          <div class="bm-main">
            <div class="nm">${esc(champName(m.champion))} <span class="bm-res ${m.win ? 'w' : 'l'}">${m.win ? 'Victoria' : 'Derrota'}</span></div>
            <div class="bm-kda">${m.kills} <span>/</span> <span class="d">${m.deaths}</span> <span>/</span> ${m.assists}</div>
            <div class="bm-sub">${[role, `KDA ${kda}`, shortDate(m.ended_at)].filter(Boolean).join(' · ')}</div>
          </div>
          <div class="bm-score" style="--p:${Math.round(m.score)}" title="Puntuación de rendimiento"><b>${Math.round(m.score)}</b><small>/100</small></div>
        </div>
        <div class="bm-stats">
          ${m.kp != null ? `<div><span>Part. kills</span><b>${Math.round(m.kp * 100)}%</b></div>` : ''}
          <div><span>Daño/min</span><b>${Math.round((m.damage ?? 0) / mins)}</b></div>
          <div><span>CS/min</span><b>${((m.cs ?? 0) / mins).toFixed(1)}</b></div>
          <div><span>Visión</span><b>${m.vision ?? 0}</b></div>
          <div><span>Duración</span><b>${dur(m.duration_seconds)}</b></div>
          ${m.lp_change != null ? `<div><span>LP</span><b style="color:${m.lp_change >= 0 ? '#4ade80' : '#ff8a6b'}">${m.lp_change > 0 ? '+' : ''}${m.lp_change}</b></div>` : ''}
        </div>
        <span class="bm-go">Ver partida y análisis →</span>
      </a></div>`;
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (b) { e.preventDefault(); period = b.dataset.p; draw(); }
  });
  load();
  return { reload: load };
}

// ── Partida del mes del grupo (index) ──
export function renderMatchOfMonth(el, { supabase }) {
  injectCss();
  async function load() {
    const period = currentPeriod();
    const [{ data: best }, { data: players }, { data: profiles }] = await Promise.all([
      supabase.from('best_matches').select('*').eq('period', period).order('score', { ascending: false }).limit(1),
      supabase.from('players').select('id, riot_game_name, icon_id'),
      supabase.from('player_profiles').select('player_id, display_name'),
    ]);
    await catalogs;
    const m = best?.[0];
    const p = m ? (players ?? []).find(x => x.id === m.player_id) : null;
    const badge = `<div class="mm-badge">Partida del mes · ${cap(monthName(period).split(' ')[0])}</div>`;
    if (!m || !p) {
      el.innerHTML = `<div class="mm-card pending">${badge}<div class="mm-av">⭐</div>
        <div class="mm-txt" style="font-size:13px;color:var(--text-faint,#6d8ba3);font-weight:600;">Todavía no hay partidas de SoloQ este mes.</div></div>`;
      return;
    }
    const nick = (profiles ?? []).find(x => x.player_id === p.id)?.display_name || p.riot_game_name;
    el.innerHTML = `<a class="mm-card" href="partidas.html?id=${encodeURIComponent(m.match_id)}&jugador=${encodeURIComponent(p.id)}" title="Ver la partida">
      <div class="mm-bg" style="background-image:url('${splashUrl(m.champion, 0)}')"></div>${badge}
      <div class="mm-av"><img src="${iconOr1(p.icon_id)}" alt="" onerror="${ICON_ONERROR()}"></div>
      <div class="mm-ch"><img src="${champImg(m.champion)}" alt="" onerror="${HIDE}"></div>
      <div class="mm-txt"><b>${esc(nick)}</b>
        <div class="mm-meta"><span>${esc(champName(m.champion))}</span><span>${m.kills}/${m.deaths}/${m.assists} KDA</span>
          <span>${m.win ? 'Victoria' : 'Derrota'}</span><span>${shortDate(m.ended_at)}</span></div></div>
      <div class="mm-pts"><b>${Math.round(m.score)}</b><small>de 100 pts</small></div>
    </a>`;
  }
  load();
  return { reload: load };
}
