// ============================================================
// Menú del ícono de perfil (arriba a la derecha) — compartido por
// index.html, perfil.html y admin.html.
//
//   Vinculado:     Ir a perfil · Editar perfil · (Admin Dashboard) · Cerrar sesión
//   Sin vincular:  Terminar vinculación / Solicitud pendiente · Cerrar sesión
//   Sin sesión:    botón "Iniciar sesión"
//
// Uso:
//   const menu = createAuthMenu({ supabase, profileIconUrl, onEdit });
//   menu.render(session, players, profiles);   // cada vez que la página recarga datos
// ============================================================
import { icono } from './iconos.js';

const CSS = `
.am-wrap{position:relative; display:flex; align-items:center;}
.am-trigger{position:relative; padding:0; cursor:pointer; overflow:visible !important; appearance:none; font:inherit;}
.am-trigger > img{border-radius:50%;}
.am-trigger .am-inner{width:100%; height:100%; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center;}
.am-dot{position:absolute; top:-4px; right:-4px; min-width:18px; height:18px; padding:0 5px; border-radius:99px; background:var(--gold,#FFB547); color:#03111A; font:800 10px/18px 'Albert Sans',system-ui,sans-serif; text-align:center; box-shadow:0 0 0 2px var(--bg,#03111A); pointer-events:none;}
.am-menu{position:absolute; top:calc(100% + 10px); right:0; z-index:80; width:260px; background:rgba(8,32,44,.98); border:1px solid var(--border,#154152); border-radius:14px; padding:6px; box-shadow:0 18px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(61,255,210,.08) inset; font-family:'Albert Sans',system-ui,sans-serif;}
.am-menu[hidden]{display:none;}
.am-head{display:flex; align-items:center; gap:10px; padding:10px 10px 12px; border-bottom:1px solid var(--border,#154152); margin-bottom:6px;}
.am-head img{width:34px; height:34px; border-radius:50%; object-fit:cover; border:2px solid var(--accent,#3DFFD2); flex-shrink:0; background:#0B2836;}
.am-head b{display:block; color:#E6FBF8; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.am-head small{display:block; color:var(--text-faint,#7FAFAD); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.am-item{display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px; border:none; border-radius:9px; background:none; color:var(--text-dim,#A7D3CF); font:600 13px 'Albert Sans',system-ui,sans-serif; text-decoration:none; text-align:left; cursor:pointer;}
.am-item:hover, .am-item:focus-visible{background:rgba(61,255,210,.08); color:#E6FBF8; outline:none;}
.am-item .ico{width:18px; display:flex; justify-content:center; flex-shrink:0;}
.am-item .count{margin-left:auto; min-width:20px; padding:1px 7px; border-radius:99px; background:var(--gold,#FFB547); color:#03111A; font-size:11px; font-weight:800; text-align:center;}
.am-item.danger:hover{background:rgba(255,111,142,.1); color:var(--danger,#FF6F8E);}
.am-sep{height:1px; background:var(--border,#154152); margin:6px 4px;}

.am-toast{position:fixed; left:50%; top:22px; transform:translateX(-50%); z-index:95; padding:10px 16px; border-radius:12px; background:rgba(8,32,44,.97); border:1px solid var(--accent,#3DFFD2); color:#E6FBF8; font:700 13px 'Albert Sans',system-ui,sans-serif; box-shadow:0 10px 30px rgba(0,0,0,.5); transition:opacity .3s;}
.am-toast.err{border-color:var(--danger,#FF6F8E);}
`;

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
    el.setAttribute('role', isError ? 'alert' : 'status');   // el lector de pantalla lo anuncia
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 3500);
    setTimeout(() => el.remove(), 3900);
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
      el.innerHTML = `<a class="login-btn" href="login.html">Iniciar sesión</a>`;
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
      const perfilUrl = `perfil.html?jugador=${encodeURIComponent(mine.id)}`;
      items = `
        <a class="am-item" role="menuitem" href="${perfilUrl}"><span class="ico">${icono('grupo', { size: 16 })}</span>Ir a perfil</a>
        <a class="am-item" role="menuitem" href="${perfilUrl}&editar=1" data-action="edit"><span class="ico">${icono('lapiz', { size: 16 })}</span>Editar perfil</a>
        ${state.isAdmin ? `<a class="am-item" role="menuitem" href="admin.html"><span class="ico">${icono('escudo', { size: 16 })}</span>Admin Dashboard${state.pendingCount ? `<span class="count">${state.pendingCount}</span>` : ''}</a>` : ''}
        <div class="am-sep"></div>
        <button class="am-item danger" role="menuitem" type="button" data-action="logout"><span class="ico">↩</span>Cerrar sesión</button>`;
    } else {
      const av = meta.avatar_url;
      trigger = `<span class="am-inner">${av ? `<img src="${esc(av)}" alt="">` : '?'}</span>`;
      head = `<div class="am-head">${av ? `<img src="${esc(av)}" alt="">` : ''}<div><b>${esc(discordName)}</b><small>Sin cuenta de LoL vinculada</small></div></div>`;
      items = `
        <a class="am-item" role="menuitem" href="login.html"><span class="ico">${icono(state.ownRequest ? 'reloj_arena' : 'enlace', { size: 16 })}</span>${state.ownRequest ? 'Solicitud pendiente' : 'Terminar vinculación'}</a>
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
    if (action === 'logout') {
      e.preventDefault();
      await supabase.auth.signOut();
      location.reload();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

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
