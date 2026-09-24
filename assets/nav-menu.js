// ============================================================
// Menú ☰ de navegación (arriba a la izquierda) — compartido por todas
// las páginas. Solo NAVEGACIÓN del sitio, igual para todos.
// Lo que es de TU cuenta (perfil, editar, Twitch, admin, cerrar sesión)
// vive en el menú del ícono de perfil (auth-menu.js), no acá.
//
// Uso:  import { createNavMenu } from './assets/nav-menu.js';
//       createNavMenu({ current: 'ranking' });   // resalta la página actual
// ============================================================

const ITEMS = [
  { key: 'ranking', label: 'Ranking', href: 'index.html', desc: 'Clasificación SoloQ en vivo',
    icon: 'M4 20h4v-8H4zM10 20h4V4h-4zM16 20h4v-12h-4z' },
  { key: 'envivo', label: 'En vivo', href: 'en-vivo.html', desc: 'Partidas del grupo ahora mismo',
    icon: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6M6.3 6.3l1.4 1.4a6 6 0 0 0 0 8.6l-1.4 1.4a8 8 0 0 1 0-11.4m11.4 0a8 8 0 0 1 0 11.4l-1.4-1.4a6 6 0 0 0 0-8.6zM3.5 3.5l1.4 1.4a10 10 0 0 0 0 14.2l-1.4 1.4a12 12 0 0 1 0-17m17 0a12 12 0 0 1 0 17l-1.4-1.4a10 10 0 0 0 0-14.2z' },
  { key: 'reto', label: 'Reto actual', href: 'reto.html', desc: 'Cuenta regresiva y clasificación',
    icon: 'M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v4H8v-4h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zM6 7v1a2 2 0 0 0 1.2 1.8A5 5 0 0 1 7 8.5V7zM18 7h-1v1.5c0 .5 0 .9-.2 1.3A2 2 0 0 0 18 8z' },
  { key: 'fama', label: 'Salón de la fama', href: 'reto.html#fame-sec', desc: 'Ganadores de retos anteriores',
    icon: 'M12 2l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 16.9 6.1 20l1.2-6.5L2.5 8.9 9.1 8z' },
  { key: 'versus', label: 'Versus', href: 'versus.html', desc: 'Compara a dos jugadores',
    icon: 'M3 4h4.5L12 13l4.5-9H21l-7 14h-4zM2 20h20v2H2z' },
  { key: 'tienda', label: 'Tienda', href: 'tienda.html', desc: 'Gasta tus 🦷 en marcos, efectos y premios',
    icon: 'M6 7V6a6 6 0 0 1 12 0v1h3l-1.5 14h-15L3 7zm2 0h8V6a4 4 0 0 0-8 0zM9 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2m6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2' },
  { key: 'rewind', label: 'SoloQ Rewind', href: 'rewind.html', desc: 'Tu split en historias',
    icon: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1m1 2v10h14V7zm8.5 1.5L9 12l4.5 3.5zm-1 0v7l-4.5-3.5z' },
  { key: 'stats', label: 'Estadísticas', href: 'estadisticas.html', desc: 'Campeones, roles, dúos y récords',
    icon: 'M3 3h2v16h16v2H3zM7 13l4-4 3 3 5-6 1.5 1.3-6.4 7.6-3.1-3.1L8.4 14.4z' },
];

const CSS = `
.nav-btn{width:40px; height:40px; flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:11px; border:1px solid var(--border,#16324a); background:rgba(10,22,34,.7); color:var(--text-dim,#9db3c4); cursor:pointer; transition:border-color .15s, color .15s, background .15s; padding:0;}
.nav-btn:hover, .nav-btn[aria-expanded="true"]{border-color:var(--accent,#00e5c7); color:#fff; background:rgba(0,229,199,.08);}
.nav-btn svg{width:20px; height:20px;}
.nav-bg{position:fixed; inset:0; z-index:85; background:rgba(3,8,18,.6); backdrop-filter:blur(3px); opacity:0; pointer-events:none; transition:opacity .2s;}
.nav-bg.open{opacity:1; pointer-events:auto;}
.nav-panel{position:fixed; top:0; left:0; bottom:0; z-index:86; width:300px; max-width:86vw; background:rgba(6,14,23,.98); border-right:1px solid var(--border,#16324a); box-shadow:20px 0 60px rgba(0,0,0,.5); transform:translateX(-102%); transition:transform .25s ease; display:flex; flex-direction:column; font-family:Inter,system-ui,sans-serif;}
.nav-panel.open{transform:none;}
.nav-top{display:flex; align-items:center; gap:12px; padding:20px 18px 16px; border-bottom:1px solid var(--border,#16324a);}
.nav-top img{height:34px; width:auto;}
.nav-top b{font-family:Rajdhani,sans-serif; font-size:20px; letter-spacing:.05em; text-transform:uppercase; background:linear-gradient(90deg,#fff 0%,var(--accent,#00e5c7) 100%); -webkit-background-clip:text; background-clip:text; color:transparent;}
.nav-close{margin-left:auto; background:none; border:none; color:var(--text-faint,#6d8ba3); font-size:24px; line-height:1; cursor:pointer; padding:4px;}
.nav-close:hover{color:#fff;}
.nav-list{padding:12px 10px; display:flex; flex-direction:column; gap:3px; overflow-y:auto;}
.nav-item{position:relative; display:flex; align-items:center; gap:12px; padding:11px 12px; border-radius:11px; text-decoration:none; color:var(--text-dim,#9db3c4);}
.nav-item svg{width:20px; height:20px; flex-shrink:0; fill:currentColor;}
.nav-item b{display:block; font-size:14px; font-weight:700; color:inherit;}
.nav-item small{display:block; font-size:11.5px; color:var(--text-faint,#6d8ba3); margin-top:1px;}
a.nav-item:hover{background:rgba(0,229,199,.07); color:#fff;}
.nav-item.active{background:rgba(0,229,199,.1); color:#fff;}
.nav-item.active::before{content:''; position:absolute; left:0; top:9px; bottom:9px; width:3px; border-radius:2px; background:var(--accent,#00e5c7); box-shadow:0 0 10px var(--accent-glow,rgba(0,229,199,.45));}
.nav-item.active svg{color:var(--accent,#00e5c7);}
.nav-item.soon{opacity:.45; cursor:default;}
.nav-soon{margin-left:auto; font-size:9.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; padding:2px 7px; border-radius:99px; border:1px solid var(--border,#16324a); color:var(--text-faint,#6d8ba3); white-space:nowrap;}
.nav-foot{margin-top:auto; padding:14px 18px; border-top:1px solid var(--border,#16324a); font-size:11.5px; color:var(--text-faint,#6d8ba3);}
@media (max-width:700px){ .nav-panel{width:88vw;} .nav-btn{width:38px; height:38px;} }
/* En celular el ☰ ocupa el lugar del logo (el logo sigue dentro del panel y en el título). */
@media (max-width:560px){ header .logo-slot img{display:none;} header .logo-slot{gap:8px;} }
`;

export function createNavMenu({ current = null, slotSelector = '.logo-slot' } = {}) {
  if (!document.getElementById('nav-style')) {
    const st = document.createElement('style');
    st.id = 'nav-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const slot = document.querySelector(slotSelector);
  if (!slot) return;

  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Abrir menú');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'nav-panel');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  slot.prepend(btn);

  const bg = document.createElement('div');
  bg.className = 'nav-bg';
  const panel = document.createElement('nav');
  panel.className = 'nav-panel';
  panel.id = 'nav-panel';
  panel.setAttribute('aria-label', 'Secciones del sitio');
  panel.innerHTML = `
    <div class="nav-top"><img src="logo/FlaviIconLogo.png" alt=""><b>SharkTracker</b>
      <button class="nav-close" type="button" aria-label="Cerrar menú">×</button></div>
    <div class="nav-list">
      ${ITEMS.map(it => {
        const inner = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${it.icon}"/></svg>
          <span><b>${it.label}</b><small>${it.desc}</small></span>${it.soon ? '<span class="nav-soon">Pronto</span>' : ''}`;
        const active = it.key === current ? ' active' : '';
        return it.soon || !it.href
          ? `<div class="nav-item soon" aria-disabled="true">${inner}</div>`
          : `<a class="nav-item${active}" href="${it.href}"${active ? ' aria-current="page"' : ''}>${inner}</a>`;
      }).join('')}
    </div>
    <div class="nav-foot">hecho por KyoSumiVT</div>`;
  document.body.append(bg, panel);

  const setOpen = (open) => {
    panel.classList.toggle('open', open);
    bg.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('.nav-item.active, a.nav-item')?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  bg.addEventListener('click', () => setOpen(false));
  panel.querySelector('.nav-close').addEventListener('click', () => { setOpen(false); btn.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) { setOpen(false); btn.focus(); } });
  // Enlaces a la misma página con #ancla: cerrar el panel y desplazarse.
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('a.nav-item');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.pathname === location.pathname) {
      setOpen(false);
      if (url.hash) {
        e.preventDefault();
        history.replaceState(null, '', url.hash);
        document.querySelector(url.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (!url.hash && !location.hash) {
        e.preventDefault();
      }
    }
  });
  return { open: () => setOpen(true), close: () => setOpen(false) };
}
