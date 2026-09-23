// ============================================================
// Menú del ícono de perfil (arriba a la derecha) — compartido por
// index.html, perfil.html y admin.html.
//
//   Vinculado:     Ir a perfil · Editar perfil · Mi Twitch · (Admin Dashboard) · Cerrar sesión
//   Sin vincular:  Terminar vinculación / Solicitud pendiente · Cerrar sesión
//   Sin sesión:    botón "Login"
//
// Uso:
//   const menu = createAuthMenu({ supabase, profileIconUrl, onEdit });
//   menu.render(session, players, profiles);   // cada vez que la página recarga datos
// ============================================================

const CSS = `
.am-wrap{position:relative; display:flex; align-items:center;}
.am-trigger{position:relative; padding:0; cursor:pointer; overflow:visible !important; appearance:none; font:inherit;}
.am-trigger > img{border-radius:50%;}
.am-trigger .am-inner{width:100%; height:100%; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center;}
.am-dot{position:absolute; top:-4px; right:-4px; min-width:18px; height:18px; padding:0 5px; border-radius:99px; background:var(--gold,#facc15); color:#032018; font:800 10px/18px Inter,system-ui,sans-serif; text-align:center; box-shadow:0 0 0 2px var(--bg,#030812); pointer-events:none;}
.am-menu{position:absolute; top:calc(100% + 10px); right:0; z-index:80; width:260px; background:rgba(8,18,29,.98); border:1px solid var(--border,#16324a); border-radius:14px; padding:6px; box-shadow:0 18px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(0,229,199,.08) inset; font-family:Inter,system-ui,sans-serif;}
.am-menu[hidden]{display:none;}
.am-head{display:flex; align-items:center; gap:10px; padding:10px 10px 12px; border-bottom:1px solid var(--border,#16324a); margin-bottom:6px;}
.am-head img{width:34px; height:34px; border-radius:50%; object-fit:cover; border:2px solid var(--accent,#00e5c7); flex-shrink:0; background:#0a1622;}
.am-head b{display:block; color:#fff; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.am-head small{display:block; color:var(--text-faint,#6d8ba3); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.am-item{display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px; border:none; border-radius:9px; background:none; color:var(--text-dim,#9db3c4); font:600 13px Inter,system-ui,sans-serif; text-decoration:none; text-align:left; cursor:pointer;}
.am-item:hover, .am-item:focus-visible{background:rgba(0,229,199,.08); color:#fff; outline:none;}
.am-item .ico{width:18px; text-align:center; flex-shrink:0;}
.am-item .sub{margin-left:auto; font-size:11px; font-weight:700; color:var(--text-faint,#6d8ba3); max-width:110px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.am-item .sub.ok{color:#bf94ff;}
.am-item .count{margin-left:auto; min-width:20px; padding:1px 7px; border-radius:99px; background:var(--gold,#facc15); color:#032018; font-size:11px; font-weight:800; text-align:center;}
.am-item.danger:hover{background:rgba(255,95,61,.1); color:var(--danger,#ff5f3d);}
.am-sep{height:1px; background:var(--border,#16324a); margin:6px 4px;}

.am-modal-bg{position:fixed; inset:0; z-index:90; background:rgba(3,8,18,.7); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; padding:20px;}
.am-modal-bg[hidden]{display:none;}
.am-modal{width:100%; max-width:400px; background:rgba(8,18,29,.99); border:1px solid #9146ff; border-radius:18px; padding:24px; box-shadow:0 0 40px rgba(145,70,255,.25); font-family:Inter,system-ui,sans-serif; color:#fff; position:relative;}
.am-modal h3{margin:0 0 6px; font-family:Rajdhani,sans-serif; font-weight:700; font-size:24px; letter-spacing:.03em; text-transform:uppercase;}
.am-modal p{margin:0 0 18px; font-size:13px; line-height:1.55; color:var(--text-dim,#9db3c4);}
.am-modal .close{position:absolute; top:12px; right:14px; background:none; border:none; color:var(--text-faint,#6d8ba3); font-size:22px; cursor:pointer; line-height:1;}
.am-modal .close:hover{color:#fff;}
.am-tw-status{display:flex; align-items:center; gap:10px; background:rgba(145,70,255,.1); border:1px solid rgba(145,70,255,.4); border-radius:12px; padding:12px 14px; margin-bottom:16px; font-size:13px;}
.am-tw-status b{color:#fff;}
.am-tw-status .tag{margin-left:auto; font-size:11px; font-weight:800; padding:2px 9px; border-radius:99px;}
.am-tw-status .tag.ok{background:rgba(145,70,255,.25); color:#d4bbff;}
.am-tw-status .tag.warn{background:rgba(250,204,21,.15); color:var(--gold,#facc15);}
.am-btn{display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:13px 16px; border:none; border-radius:12px; font:800 14px Inter,system-ui,sans-serif; cursor:pointer; margin-bottom:8px;}
.am-btn.twitch{background:#9146ff; color:#fff; box-shadow:0 8px 24px rgba(145,70,255,.35);}
.am-btn.twitch:hover{background:#a970ff;}
.am-btn.twitch svg{width:18px; height:18px; fill:#fff;}
.am-btn.ghost{background:transparent; border:1px solid var(--border,#16324a); color:var(--text-dim,#9db3c4);}
.am-btn.ghost:hover{border-color:var(--danger,#ff5f3d); color:var(--danger,#ff5f3d);}
.am-btn:disabled{opacity:.55; cursor:not-allowed;}
.am-err{font-size:12.5px; font-weight:600; color:var(--danger,#ff5f3d); margin-top:6px;}
.am-err:empty{display:none;}

.am-toast{position:fixed; left:50%; top:22px; transform:translateX(-50%); z-index:95; padding:10px 16px; border-radius:12px; background:rgba(8,18,29,.97); border:1px solid var(--accent,#00e5c7); color:#fff; font:700 13px Inter,system-ui,sans-serif; box-shadow:0 10px 30px rgba(0,0,0,.5); transition:opacity .3s;}
.am-toast.err{border-color:var(--danger,#ff5f3d);}
`;

const TWITCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createAuthMenu({ supabase, profileIconUrl, onEdit, slotId = 'auth-slot' }) {
  if (!document.getElementById('am-style')) {
    const st = document.createElement('style');
    st.id = 'am-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const state = {
    session: null, mine: null, profile: null,
    isAdmin: false, adminChecked: null, pendingCount: 0,
    ownRequest: undefined, // undefined = sin consultar, null = no tiene
    open: false, channel: null,
  };
  const slot = () => document.getElementById(slotId);

  // ── Toast ──
  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = `am-toast ${isError ? 'err' : ''}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 3500);
    setTimeout(() => el.remove(), 3900);
  }

  // ── Vuelta de Twitch: la URL trae ?twitch=conectado ──
  const url = new URL(location.href);
  if (url.searchParams.get('twitch') === 'conectado') {
    // Si Supabase/Twitch devolvió un error (ej. esa cuenta de Twitch ya está
    // conectada a otro Discord, o se canceló), viene en la URL o en el #hash.
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const oauthError = url.searchParams.get('error_description') || hashParams.get('error_description');
    for (const k of ['twitch', 'error', 'error_code', 'error_description']) url.searchParams.delete(k);
    history.replaceState(null, '', url.pathname + url.search + (oauthError ? '' : url.hash));
    if (oauthError) {
      setTimeout(() => toast(`No se pudo conectar Twitch: ${oauthError.replace(/\+/g, ' ')}`, true), 300);
    } else {
      (async () => {
        const { data, error } = await supabase.rpc('link_my_twitch');
        if (error) { toast(`No se pudo conectar Twitch: ${error.message}`, true); return; }
        toast(`📺 Twitch conectado: ${data}`);
        if (state.profile) { state.profile.twitch_username = data; draw(); }
      })();
    }
  }

  // ── Admin: ¿soy admin? + contador de solicitudes pendientes ──
  async function checkAdmin(userId) {
    if (state.adminChecked === userId) return;
    state.adminChecked = userId;
    const { data } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
    state.isAdmin = !!data;
    if (state.isAdmin) {
      await refreshPending();
      if (!state.channel && supabase.channel) {
        state.channel = supabase.channel('auth-menu-claims')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'claim_requests' }, () => refreshPending().then(draw));
        state.channel.subscribe();
      }
    }
  }
  async function refreshPending() {
    const { data } = await supabase.from('claim_requests').select('id').eq('status', 'pending');
    state.pendingCount = (data ?? []).length;
  }

  async function checkOwnRequest(userId) {
    if (state.ownRequest !== undefined) return;
    const { data } = await supabase.from('claim_requests').select('id, status')
      .eq('user_id', userId).eq('status', 'pending').maybeSingle();
    state.ownRequest = data ?? null;
  }

  // ── Dibujo ──
  function draw() {
    const el = slot();
    if (!el) return;
    const { session, mine } = state;
    if (!session) {
      el.innerHTML = `<a class="login-btn" href="login.html">Login</a>`;
      return;
    }
    const meta = session.user.user_metadata ?? {};
    const discordName = meta.custom_claims?.global_name || meta.full_name || meta.name || 'Discord';
    const fallbackIcon = profileIconUrl(1);

    let trigger, head, items;
    if (mine) {
      const icon = profileIconUrl(mine.icon_id) ?? fallbackIcon;
      trigger = `<span class="am-inner"><img src="${icon}" alt="" onerror="this.onerror=null;this.src='${fallbackIcon}';"></span>`;
      head = `<div class="am-head"><img src="${icon}" alt="" onerror="this.onerror=null;this.src='${fallbackIcon}';"><div><b>${esc(mine.riot_game_name)}</b><small>${esc(discordName)} · Discord</small></div></div>`;
      const tw = state.profile?.twitch_username;
      const perfilUrl = `perfil.html?jugador=${encodeURIComponent(mine.id)}`;
      items = `
        <a class="am-item" role="menuitem" href="${perfilUrl}"><span class="ico">👤</span>Ir a perfil</a>
        <a class="am-item" role="menuitem" href="${perfilUrl}&editar=1" data-action="edit"><span class="ico">✎</span>Editar perfil</a>
        <button class="am-item" role="menuitem" type="button" data-action="twitch"><span class="ico">📺</span>Mi Twitch<span class="sub ${tw ? 'ok' : ''}">${tw ? esc(tw) : 'Conectar'}</span></button>
        ${state.isAdmin ? `<a class="am-item" role="menuitem" href="admin.html"><span class="ico">🛡️</span>Admin Dashboard${state.pendingCount ? `<span class="count">${state.pendingCount}</span>` : ''}</a>` : ''}
        <div class="am-sep"></div>
        <button class="am-item danger" role="menuitem" type="button" data-action="logout"><span class="ico">↩</span>Cerrar sesión</button>`;
    } else {
      const av = meta.avatar_url;
      trigger = `<span class="am-inner">${av ? `<img src="${esc(av)}" alt="">` : '?'}</span>`;
      head = `<div class="am-head">${av ? `<img src="${esc(av)}" alt="">` : ''}<div><b>${esc(discordName)}</b><small>Sin cuenta de LoL vinculada</small></div></div>`;
      items = `
        <a class="am-item" role="menuitem" href="login.html"><span class="ico">${state.ownRequest ? '⏳' : '🔗'}</span>${state.ownRequest ? 'Solicitud pendiente' : 'Terminar vinculación'}</a>
        <div class="am-sep"></div>
        <button class="am-item danger" role="menuitem" type="button" data-action="logout"><span class="ico">↩</span>Cerrar sesión</button>`;
    }
    const dot = state.isAdmin && state.pendingCount ? `<span class="am-dot" title="${state.pendingCount} solicitud(es) pendiente(s)">${state.pendingCount}</span>` : '';
    el.innerHTML = `
      <div class="am-wrap">
        <button class="avatar am-trigger ${mine ? '' : 'pending'}" type="button" aria-haspopup="menu" aria-expanded="${state.open}" title="Tu cuenta">${trigger}${dot}</button>
        <div class="am-menu" role="menu" ${state.open ? '' : 'hidden'}>${head}${items}</div>
      </div>`;
  }

  function setOpen(open) {
    state.open = open;
    const el = slot();
    el?.querySelector('.am-menu')?.toggleAttribute('hidden', !open);
    el?.querySelector('.am-trigger')?.setAttribute('aria-expanded', String(open));
  }

  // Eventos (el contenido se redibuja: se escucha desde el contenedor).
  document.addEventListener('click', async (e) => {
    const el = slot();
    if (!el) return;
    if (!el.contains(e.target)) { if (state.open) setOpen(false); return; }
    if (e.target.closest('.am-trigger')) { setOpen(!state.open); return; }
    const item = e.target.closest('[data-action]');
    if (!item) return;
    const action = item.dataset.action;
    if (action === 'edit' && onEdit) {
      // Si ya estás en tu propio perfil, se abre el modo edición sin recargar.
      if (onEdit(state.mine)) { e.preventDefault(); setOpen(false); }
      return;
    }
    if (action === 'twitch') { e.preventDefault(); setOpen(false); openTwitchModal(); return; }
    if (action === 'logout') {
      e.preventDefault();
      await supabase.auth.signOut();
      location.reload();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setOpen(false); closeTwitchModal(); }
  });

  // ── Modal "Mi Twitch" ──
  let modal = null;
  function closeTwitchModal() { if (modal) modal.hidden = true; }
  async function openTwitchModal() {
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'am-modal-bg';
      modal.addEventListener('click', (e) => { if (e.target === modal) closeTwitchModal(); });
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    modal.innerHTML = `<div class="am-modal" role="dialog" aria-label="Mi Twitch"><button class="close" type="button" aria-label="Cerrar">×</button><h3>Mi Twitch</h3><p>Cargando…</p></div>`;
    modal.querySelector('.close').onclick = closeTwitchModal;

    const { data: idData } = await supabase.auth.getUserIdentities();
    const twitchIdentity = (idData?.identities ?? []).find(i => i.provider === 'twitch');
    const verifiedLogin = twitchIdentity ? String(twitchIdentity.identity_data?.name ?? '').toLowerCase() : null;
    const tw = state.profile?.twitch_username ?? null;
    const verified = !!tw && verifiedLogin === tw.toLowerCase();

    const status = tw
      ? `<div class="am-tw-status">📺 <b>${esc(tw)}</b><span class="tag ${verified ? 'ok' : 'warn'}">${verified ? 'Verificado ✓' : 'Sin verificar'}</span></div>` : '';
    const intro = tw
      ? (verified
          ? '<p>Tu Twitch está conectado. Cuando estés en vivo, tu ícono se pone rojo y aparece tu stream en el ranking y en tu perfil.</p>'
          : '<p>Este Twitch fue cargado a mano. Conéctalo con tu cuenta de Twitch para verificarlo (o cambiarlo por el tuyo).</p>')
      : '<p>Conecta tu cuenta de Twitch: cuando estés en vivo, tu ícono se pone rojo y tu stream aparece en el ranking y en tu perfil. Solo se usa tu nombre de usuario de Twitch.</p>';
    modal.querySelector('.am-modal').innerHTML = `
      <button class="close" type="button" aria-label="Cerrar">×</button>
      <h3>Mi Twitch</h3>
      ${intro}
      ${status}
      ${!verified ? `<button class="am-btn twitch" type="button" data-tw="connect">${TWITCH_SVG}Conectar con Twitch</button>` : ''}
      ${tw ? `<button class="am-btn ghost" type="button" data-tw="disconnect">Desconectar Twitch</button>` : ''}
      <div class="am-err" id="am-tw-err"></div>`;
    modal.querySelector('.close').onclick = closeTwitchModal;
    const errEl = modal.querySelector('#am-tw-err');

    modal.querySelector('[data-tw="connect"]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const back = new URL(location.href);
      back.searchParams.set('twitch', 'conectado');
      // Si ya había una identidad de Twitch distinta, se quita antes de conectar la nueva.
      if (twitchIdentity) await supabase.auth.unlinkIdentity(twitchIdentity);
      const { error } = await supabase.auth.linkIdentity({ provider: 'twitch', options: { redirectTo: back.toString() } });
      if (error) { errEl.textContent = `No se pudo abrir Twitch: ${error.message}`; e.currentTarget.disabled = false; }
    });
    modal.querySelector('[data-tw="disconnect"]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      if (twitchIdentity) {
        const { error } = await supabase.auth.unlinkIdentity(twitchIdentity);
        if (error) { errEl.textContent = `No se pudo desconectar: ${error.message}`; e.currentTarget.disabled = false; return; }
      }
      const { error } = await supabase.rpc('unlink_my_twitch');
      if (error) { errEl.textContent = `No se pudo desconectar: ${error.message}`; e.currentTarget.disabled = false; return; }
      if (state.profile) state.profile.twitch_username = null;
      draw();
      closeTwitchModal();
      toast('Twitch desconectado');
    });
  }

  // ── API pública ──
  async function render(session, players, profiles) {
    state.session = session;
    state.mine = session ? (players ?? []).find(p => p.user_id === session.user.id) ?? null : null;
    state.profile = state.mine ? (profiles ?? []).find(pr => pr?.player_id === state.mine.id) ?? null : null;
    draw();
    if (!session) return;
    if (state.mine) await checkAdmin(session.user.id);
    else await checkOwnRequest(session.user.id);
    draw();
  }

  // Para que admin.html actualice el contador al aprobar/rechazar sin esperar a Realtime.
  const refreshPendingCount = async () => { if (state.isAdmin) { await refreshPending(); draw(); } };
  return { render, toast, refreshPendingCount, get state() { return state; } };
}
