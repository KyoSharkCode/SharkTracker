// ============================================================
// Misiones semanales — pestañita flotante en el borde derecho.
// Si las misiones están pausadas (Admin Dashboard), no aparece nada.
//
// Uso:  import { createMissionsWidget } from './assets/missions-widget.js';
//       createMissionsWidget({ supabase, profileIconUrl });
// ============================================================

const TIERS = {
  easy:   { label: 'Fácil',   color: '#22c55e', pts: 1 },
  medium: { label: 'Media',   color: '#facc15', pts: 2 },
  hard:   { label: 'Difícil', color: '#ff5f3d', pts: 3 },
};
const TIER_ORDER = ['easy', 'medium', 'hard'];
const GROUP_PTS = 2;

const CSS = `
.mw-tab{position:fixed; right:0; top:50%; transform:translateY(-50%); z-index:70; display:flex; flex-direction:column; align-items:center; gap:8px; padding:14px 8px; border:1px solid var(--accent,#00e5c7); border-right:none; border-radius:14px 0 0 14px; background:rgba(6,14,23,.96); color:#fff; cursor:pointer; box-shadow:-6px 0 24px rgba(0,229,199,.18); font-family:Inter,system-ui,sans-serif; transition:padding .15s, background .15s;}
.mw-tab:hover{padding-right:12px; background:rgba(0,229,199,.1);}
.mw-tab .t{writing-mode:vertical-rl; transform:rotate(180deg); font-family:Rajdhani,sans-serif; font-weight:800; font-size:14px; letter-spacing:.12em; text-transform:uppercase;}
.mw-tab .c{writing-mode:vertical-rl; transform:rotate(180deg); font-size:11px; font-weight:700; color:var(--accent,#00e5c7); white-space:nowrap;}
.mw-tab .dots{display:flex; flex-direction:column; gap:4px;}
.mw-tab .dots i{width:8px; height:8px; border-radius:50%; border:1.5px solid currentColor; opacity:.9;}
.mw-tab .dots i.done{background:currentColor;}
.mw-tab .ic{font-size:16px; line-height:1;}
.mw-bg{position:fixed; inset:0; z-index:83; background:rgba(3,8,18,.55); backdrop-filter:blur(2px); opacity:0; pointer-events:none; transition:opacity .2s;}
.mw-bg.open{opacity:1; pointer-events:auto;}
.mw-panel{position:fixed; top:0; right:0; bottom:0; z-index:84; width:400px; max-width:100vw; background:rgba(6,14,23,.985); border-left:1px solid var(--border,#16324a); box-shadow:-20px 0 60px rgba(0,0,0,.5); transform:translateX(102%); transition:transform .25s ease; display:flex; flex-direction:column; font-family:Inter,system-ui,sans-serif; color:#fff;}
.mw-panel.open{transform:none;}
.mw-head{display:flex; align-items:center; gap:10px; padding:18px 18px 14px; border-bottom:1px solid var(--border,#16324a);}
.mw-head h2{margin:0; font-family:Rajdhani,sans-serif; font-size:21px; letter-spacing:.06em; text-transform:uppercase;}
.mw-head small{display:block; font-size:12px; color:var(--text-faint,#6d8ba3); font-weight:600; margin-top:2px;}
.mw-head small b{color:var(--accent,#00e5c7);}
.mw-close{margin-left:auto; background:none; border:none; color:var(--text-faint,#6d8ba3); font-size:24px; cursor:pointer; line-height:1; padding:4px;}
.mw-close:hover{color:#fff;}
.mw-body{overflow-y:auto; padding:14px 16px 24px; display:flex; flex-direction:column; gap:18px;}
.mw-panel section.mw-sec{margin:0; padding:0;}
.mw-sec h3{margin:0 0 10px; display:flex; align-items:center; gap:8px; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--text-faint,#6d8ba3);}
.mw-sec h3 .rr{margin-left:auto; text-transform:none; letter-spacing:0; font-size:12px; color:var(--text-dim,#9db3c4);}
.mw-sec h3 .rr b{color:#fff;}
.mw-card{position:relative; background:rgba(13,26,38,.8); border:1px solid var(--border,#16324a); border-left:3px solid var(--tc); border-radius:12px; padding:11px 12px 12px; margin-bottom:8px;}
.mw-card.done{border-color:rgba(250,204,21,.45); border-left-color:var(--tc); background:rgba(250,204,21,.05);}
.mw-card .top{display:flex; align-items:center; gap:8px;}
.mw-chip{font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; padding:2px 8px; border-radius:99px; color:#032018; background:var(--tc);}
.mw-pts{margin-left:auto; font-size:11.5px; font-weight:800; color:var(--text-dim,#9db3c4);}
.mw-card.done .mw-pts{color:var(--gold,#facc15);}
.mw-card .ttl{font-size:14px; font-weight:700; margin:7px 0 2px; line-height:1.35;}
.mw-card .note{font-size:11px; color:var(--text-faint,#6d8ba3);}
.mw-bar{display:flex; align-items:center; gap:8px; margin-top:8px;}
.mw-bar .tr{flex:1; height:7px; border-radius:5px; background:rgba(255,255,255,.07); overflow:hidden;}
.mw-bar .tr i{display:block; height:100%; border-radius:5px; background:var(--tc);}
.mw-bar span{font-size:11.5px; font-weight:800; color:var(--text-dim,#9db3c4); min-width:34px; text-align:right;}
.mw-reroll{border:1px solid var(--border,#16324a); background:none; color:var(--text-dim,#9db3c4); border-radius:8px; padding:3px 8px; font-size:12px; font-weight:700; cursor:pointer;}
.mw-reroll:hover{border-color:var(--accent,#00e5c7); color:#fff;}
.mw-reroll:disabled{opacity:.5; cursor:wait;}
.mw-confirm{margin-top:9px; padding:9px 10px; border-radius:9px; background:rgba(0,229,199,.07); border:1px solid rgba(0,229,199,.3); font-size:12.5px; color:var(--text-dim,#9db3c4);}
.mw-confirm .acts{display:flex; gap:6px; margin-top:7px;}
.mw-confirm button{border:none; border-radius:8px; padding:6px 11px; font-weight:800; font-size:12px; cursor:pointer;}
.mw-confirm .yes{background:var(--accent,#00e5c7); color:#032018;} .mw-confirm .no{background:none; border:1px solid var(--border,#16324a); color:var(--text-dim,#9db3c4);}
.mw-err{color:var(--danger,#ff5f3d); font-size:12px; font-weight:600; margin-top:6px;}
.mw-group{--tc:#4c9dff;}
.mw-login{font-size:12.5px; color:var(--text-dim,#9db3c4); background:rgba(13,26,38,.8); border:1px dashed var(--border,#16324a); border-radius:12px; padding:12px; text-align:center;}
.mw-login a{color:var(--accent,#00e5c7); font-weight:700;}
.mw-rank{border:1px solid var(--border,#16324a); border-radius:12px; overflow:hidden;}
.mw-row{display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; border:none; border-bottom:1px solid rgba(22,50,74,.6); background:none; color:#fff; font:inherit; text-align:left; cursor:pointer;}
.mw-row:last-child{border-bottom:none;}
.mw-row:hover{background:rgba(255,255,255,.03);}
.mw-row.me{background:rgba(0,229,199,.06);}
.mw-row .pos{width:18px; font-family:Rajdhani,sans-serif; font-weight:800; font-size:16px; color:var(--text-faint,#6d8ba3);}
.mw-row img{width:28px; height:28px; border-radius:50%; object-fit:cover; background:#0a1622;}
.mw-row .nm{flex:1; min-width:0; font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.mw-row .d3{display:flex; gap:4px;}
.mw-row .d3 i{width:9px; height:9px; border-radius:50%; border:1.5px solid var(--tc); }
.mw-row .d3 i.done{background:var(--tc);}
.mw-row .pt{font-family:Rajdhani,sans-serif; font-size:18px; font-weight:800; min-width:30px; text-align:right;}
.mw-detail{padding:4px 12px 10px 40px; border-bottom:1px solid rgba(22,50,74,.6); font-size:12.5px; color:var(--text-dim,#9db3c4);}
.mw-detail div{display:flex; gap:8px; align-items:center; padding:3px 0;}
.mw-detail i{width:8px; height:8px; border-radius:50%; background:var(--tc); flex-shrink:0;}
.mw-detail .ok{margin-left:auto; color:var(--gold,#facc15); font-weight:800;}
.mw-foot{font-size:11.5px; color:var(--text-faint,#6d8ba3); line-height:1.5;}
@media (max-width:560px){ .mw-panel{width:100vw;} .mw-tab{padding:10px 6px;} .mw-tab .t{font-size:12px;} }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function timeLeft(ms) {
  if (ms <= 0) return 'unos minutos';
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m} min`;
}

export function createMissionsWidget({ supabase, profileIconUrl }) {
  if (!document.getElementById('mw-style')) {
    const st = document.createElement('style'); st.id = 'mw-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const iconUrl = (id) => profileIconUrl(id) ?? profileIconUrl(1);
  const fallback = () => `this.onerror=null;this.src='${profileIconUrl(1)}';`;
  const st = { data: null, open: false, confirm: null, error: null, expanded: null, busy: false };
  let tab = null, bg = null, panel = null;

  function ensureDom() {
    if (tab) return;
    tab = document.createElement('button');
    tab.className = 'mw-tab'; tab.type = 'button';
    tab.setAttribute('aria-controls', 'mw-panel'); tab.setAttribute('aria-expanded', 'false');
    bg = document.createElement('div'); bg.className = 'mw-bg';
    panel = document.createElement('aside'); panel.className = 'mw-panel'; panel.id = 'mw-panel';
    panel.setAttribute('aria-label', 'Misiones semanales');
    document.body.append(tab, bg, panel);
    tab.addEventListener('click', () => setOpen(!st.open));
    bg.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.open) setOpen(false); });
    panel.addEventListener('click', onPanelClick);
  }
  function removeDom() { [tab, bg, panel].forEach(n => n?.remove()); tab = bg = panel = null; st.open = false; }
  function setOpen(open) {
    st.open = open;
    panel?.classList.toggle('open', open); bg?.classList.toggle('open', open);
    tab?.setAttribute('aria-expanded', String(open));
    if (!open) { st.confirm = null; st.error = null; }
    draw();
  }

  async function load() {
    const { data: settings } = await supabase.from('mission_settings').select('*').maybeSingle();
    if (!settings?.enabled) { st.data = null; removeDom(); return; }
    const [{ data: weeks }, { data: session }] = await Promise.all([
      supabase.from('mission_weeks').select('*').order('week_start', { ascending: false }).limit(1),
      supabase.auth.getSession(),
    ]);
    const week = weeks?.[0];
    if (!week) { st.data = null; removeDom(); return; }
    const since = new Date(Math.max(new Date(week.week_start).getTime(), new Date(settings.enabled_at ?? week.week_start).getTime())).toISOString();
    const [{ data: missions }, { data: catalog }, { data: rerolls }, { data: players }, { data: profiles }, { data: played }] = await Promise.all([
      supabase.from('player_missions').select('*').eq('week_start', week.week_start),
      supabase.from('mission_catalog').select('*'),
      supabase.from('player_rerolls').select('*'),
      supabase.from('players').select('id, riot_game_name, icon_id, user_id'),
      supabase.from('player_profiles').select('player_id, display_name'),
      supabase.from('match_participants').select('player_id, matches!inner(ended_at)').gte('matches.ended_at', since),
    ]);
    const cat = new Map((catalog ?? []).map(c => [c.code, c]));
    const nick = new Map((profiles ?? []).map(p => [p.player_id, p.display_name]));
    const contributors = new Set((played ?? []).filter(x => x.matches && x.matches.ended_at >= since).map(x => x.player_id));
    const byPlayer = new Map();
    for (const m of missions ?? []) (byPlayer.get(m.player_id) ?? byPlayer.set(m.player_id, []).get(m.player_id)).push({ ...m, cat: cat.get(m.code) });
    const groupCat = cat.get(week.group_code);
    const groupDone = !!week.group_completed_at;
    const rows = (players ?? []).filter(p => byPlayer.has(p.id)).map(p => {
      const ms = byPlayer.get(p.id).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
      const pts = ms.filter(m => m.completed_at).reduce((s, m) => s + (m.cat?.points ?? TIERS[m.tier].pts), 0)
        + (groupDone && contributors.has(p.id) ? (groupCat?.points ?? GROUP_PTS) : 0);
      const nm = nick.get(p.id) && nick.get(p.id) !== p.riot_game_name ? nick.get(p.id) : p.riot_game_name;
      return { ...p, nm, ms, pts, rerolls: (rerolls ?? []).find(r => r.player_id === p.id)?.available ?? 0 };
    }).sort((a, b) => b.pts - a.pts || a.nm.localeCompare(b.nm));
    const uid = session?.session?.user?.id ?? null;
    st.data = { week, resetAt: new Date(week.week_start).getTime() + 7 * 86400000, rows, groupCat, groupDone,
                mine: uid ? rows.find(r => r.user_id === uid) ?? null : null, loggedIn: !!uid };
    ensureDom();
    draw();
  }

  function missionCard(m, own) {
    const t = TIERS[m.tier];
    const target = m.cat?.target ?? 1, prog = Math.min(m.progress, target);
    const done = !!m.completed_at;
    const confirming = own && st.confirm === m.id;
    return `<div class="mw-card ${done ? 'done' : ''}" style="--tc:${t.color}">
      <div class="top"><span class="mw-chip">${t.label}</span>
        ${own && !done && st.data.mine.rerolls > 0 && !confirming ? `<button class="mw-reroll" type="button" data-reroll="${m.id}" title="Cambiar por otra misión ${t.label.toLowerCase()}">🎲 Cambiar</button>` : ''}
        <span class="mw-pts">${done ? '✓ ' : ''}+${m.cat?.points ?? t.pts} pt${(m.cat?.points ?? t.pts) === 1 ? '' : 's'}</span></div>
      <div class="ttl">${esc(m.cat?.title ?? m.code)}</div>
      ${m.cat?.rift_only ? '<div class="note">Solo cuenta en la Grieta del Invocador</div>' : ''}
      <div class="mw-bar"><div class="tr"><i style="width:${Math.round(100 * prog / target)}%"></i></div><span>${prog}/${target}</span></div>
      ${confirming ? `<div class="mw-confirm">¿Cambiar esta misión por otra ${t.label.toLowerCase()}? Gastas 1 reroll y la nueva empieza de cero.
        <div class="acts"><button class="yes" type="button" data-reroll-yes="${m.id}" ${st.busy ? 'disabled' : ''}>🎲 Sí, cambiar</button><button class="no" type="button" data-reroll-no>Cancelar</button></div>
        ${st.error ? `<div class="mw-err">${esc(st.error)}</div>` : ''}</div>` : ''}
    </div>`;
  }

  function draw() {
    const d = st.data;
    if (!d || !tab) return;
    const left = d.resetAt - Date.now();
    const mineDots = d.mine ? `<span class="dots">${d.mine.ms.map(m => `<i class="${m.completed_at ? 'done' : ''}" style="color:${TIERS[m.tier].color}"></i>`).join('')}</span>` : '<span class="ic">🎯</span>';
    tab.innerHTML = `${mineDots}<span class="t">Misiones</span><span class="c">⏳ ${timeLeft(left)}</span>`;
    tab.title = `Misiones semanales — se reinician en ${timeLeft(left)}`;
    if (!st.open) { panel.innerHTML = ''; return; }
    const g = d.groupCat;
    const gTarget = g?.target ?? 1, gProg = Math.min(d.week.group_progress, gTarget);
    panel.innerHTML = `
      <div class="mw-head"><div><h2>🎯 Misiones semanales</h2><small>Se reinician en <b>${timeLeft(left)}</b> · lunes 6:00 (hora de Madrid)</small></div>
        <button class="mw-close" type="button" aria-label="Cerrar">×</button></div>
      <div class="mw-body">
        ${d.mine ? `<section class="mw-sec"><h3>Tus misiones <span class="rr">🎲 Rerolls: <b>${d.mine.rerolls}</b>/2</span></h3>
            ${d.mine.ms.map(m => missionCard(m, true)).join('')}</section>`
          : `<div class="mw-login">${d.loggedIn ? 'Tu cuenta de LoL todavía no está vinculada: <a href="login.html">termina de vincularla</a> para tener misiones.' : '<a href="login.html">Inicia sesión</a> para ver tus misiones y usar rerolls.'}</div>`}
        ${g ? `<section class="mw-sec"><h3>👥 Misión grupal</h3>
          <div class="mw-card mw-group ${d.groupDone ? 'done' : ''}" style="--tc:#4c9dff">
            <div class="top"><span class="mw-chip">Grupo</span><span class="mw-pts">${d.groupDone ? '✓ ' : ''}+${g.points} pts a quien juegue</span></div>
            <div class="ttl">${esc(g.title)}</div>
            <div class="mw-bar"><div class="tr"><i style="width:${Math.round(100 * gProg / gTarget)}%"></i></div><span>${gProg}/${gTarget}</span></div>
          </div></section>` : ''}
        <section class="mw-sec"><h3>🏆 Tabla de la semana</h3>
          <div class="mw-rank">${d.rows.map((r, i) => `
            <button class="mw-row ${d.mine?.id === r.id ? 'me' : ''}" type="button" data-expand="${r.id}" aria-expanded="${st.expanded === r.id}">
              <span class="pos">${i + 1}</span><img src="${iconUrl(r.icon_id)}" alt="" onerror="${fallback()}">
              <span class="nm">${esc(r.nm)}</span>
              <span class="d3">${r.ms.map(m => `<i class="${m.completed_at ? 'done' : ''}" style="--tc:${TIERS[m.tier].color}" title="${esc(m.cat?.title ?? '')}"></i>`).join('')}</span>
              <span class="pt">${r.pts}</span></button>
            ${st.expanded === r.id ? `<div class="mw-detail">${r.ms.map(m => `<div style="--tc:${TIERS[m.tier].color}"><i></i>${esc(m.cat?.title ?? m.code)} <span style="color:var(--text-faint,#6d8ba3)">${Math.min(m.progress, m.cat?.target ?? 1)}/${m.cat?.target ?? 1}</span>${m.completed_at ? '<span class="ok">✓</span>' : ''}</div>`).join('')}
              <div style="color:var(--text-faint,#6d8ba3)">🎲 ${r.rerolls}/2 rerolls</div></div>` : ''}`).join('')}</div></section>
        <p class="mw-foot">Cuentan todas las colas (sin remakes). Fácil 1 pt · Media 2 · Difícil 3. Todos empiezan la semana con 1 reroll; se gana otro (máximo 2) con una pentakill, una victoria sin morir o subiendo de liga.</p>
      </div>`;
  }

  async function onPanelClick(e) {
    if (e.target.closest('.mw-close')) { setOpen(false); tab?.focus(); return; }
    const ex = e.target.closest('[data-expand]');
    if (ex) { st.expanded = st.expanded === ex.dataset.expand ? null : ex.dataset.expand; draw(); return; }
    const rr = e.target.closest('[data-reroll]');
    if (rr) { st.confirm = Number(rr.dataset.reroll); st.error = null; draw(); return; }
    if (e.target.closest('[data-reroll-no]')) { st.confirm = null; st.error = null; draw(); return; }
    const yes = e.target.closest('[data-reroll-yes]');
    if (yes) {
      st.busy = true; draw();
      const { error } = await supabase.rpc('reroll_mission', { p_mission_id: Number(yes.dataset.rerollYes) });
      st.busy = false;
      if (error) { st.error = error.message; draw(); return; }
      st.confirm = null; st.error = null;
      await load();
    }
  }

  // Contador vivo + Realtime.
  setInterval(() => { if (st.data) draw(); }, 30000);
  let t = null;
  const reload = () => { clearTimeout(t); t = setTimeout(load, 500); };
  if (supabase.channel) {
    const ch = supabase.channel('missions-widget');
    ['mission_settings', 'mission_weeks', 'player_missions', 'player_rerolls'].forEach(table =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload));
    ch.subscribe();
  }
  load();
  return { reload: load, open: () => setOpen(true) };
}
