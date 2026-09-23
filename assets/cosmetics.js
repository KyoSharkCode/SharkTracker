// ============================================================
// Cosméticos de la tienda (🦷): marcos de avatar, efectos de fila del
// ranking, bordes del banner del perfil, color de nombre y emoji.
// Todo SVG + CSS siguiendo la receta de decoraciones (ver guía del
// proyecto): lienzo 260×260, avatar = 66 % del centro, filtro de brillo
// común y biblioteca fija de animaciones.
//
//   injectCosmeticsCss()
//   decorateAvatar(avatarEl, itemId, px, item?)   marco alrededor de un avatar de px píxeles
//   frameHtml(itemId, px)                         marco suelto (tienda) con un avatar de muestra
//   applyRowEffect(rowEl, itemId)                 efecto de fila (ranking)
//   applyBanner(bannerEl, itemId)                 borde del banner (perfil)
//   nameHtml(name, cos)                           nombre con color/degradado + emoji
//   loadEquipped(supabase) → Map(player_id → cosméticos)
// ============================================================

export const NAME_COLORS = ['#ff8a6b', '#facc15', '#4ade80', '#60a5fa', '#c084fc', '#ff5fa8', '#00e5c7', '#ffffff'];
export const EMOJIS = ['🦈', '👑', '🔥', '🌙', '⚡', '💜', '⭐', '🎮', '🐰', '🍀', '💀', '🌸'];
export const IMAGE_ANIMS = { none: 'Sin animación', flicker: 'Parpadeo de fuego', shine: 'Destello', float: 'Flotar', spin: 'Girar', glow: 'Brillo pulsante' };

const CSS = `
/* ── Marcos ── */
.cx-frame{position:absolute; pointer-events:none; z-index:3;}
.cx-frame.cx-behind{z-index:-1;}
.cx-frame svg{position:absolute; inset:0; width:100%; height:100%; overflow:visible;}
.cx-frame.mini .detail{display:none;}
.cx-frame img.cx-img{position:absolute; inset:0; width:100%; height:100%; object-fit:contain;}
.cx-sample{position:relative; flex-shrink:0; display:inline-block;}
.cx-sample .cx-face{position:absolute; left:50%; top:50%; width:66%; height:66%; transform:translate(-50%,-50%); border-radius:50%; overflow:hidden; z-index:1;
  background:radial-gradient(circle at 40% 35%, #9fd8ff, #2b6cb0 55%, #12263d);}
.cx-sample .cx-face img{width:100%; height:100%; object-fit:cover; display:block;}
.cx-sample .cx-frame{inset:0; z-index:2;} .cx-sample .cx-frame.cx-behind{z-index:0;}

/* ── Biblioteca de animaciones ── */
.a-flick{animation:a-flick 3.2s infinite;} @keyframes a-flick{0%,19%,21%,62%,64%,100%{opacity:1;} 20%,63%{opacity:.35;}}
.a-twinkle{transform-box:fill-box; transform-origin:center; animation:a-twinkle 1.8s ease-in-out infinite;}
@keyframes a-twinkle{0%,100%{transform:scale(1) rotate(0); opacity:1;} 50%{transform:scale(.55) rotate(30deg); opacity:.5;}}
.a-drip{stroke-dasharray:60; stroke-dashoffset:60; animation:a-drip 3.6s ease-in infinite;}
@keyframes a-drip{0%{stroke-dashoffset:60;} 55%,80%{stroke-dashoffset:0; opacity:1;} 100%{stroke-dashoffset:0; opacity:0;}}
.a-pulse{transform-box:fill-box; transform-origin:center; animation:a-pulse 1.4s ease-in-out infinite;}
@keyframes a-pulse{0%,100%{transform:scale(1);} 15%{transform:scale(1.12);} 30%{transform:scale(1);} 45%{transform:scale(1.07);}}
.a-breathe{transform-box:fill-box; transform-origin:center; animation:a-breathe 4s ease-in-out infinite;}
@keyframes a-breathe{0%,100%{opacity:.8; transform:scale(1);} 50%{opacity:1; transform:scale(1.08);}}
.a-hop{transform-box:fill-box; transform-origin:50% 100%; animation:a-hop 2.4s ease-in-out infinite;}
@keyframes a-hop{0%,70%,100%{transform:translateY(0);} 80%{transform:translateY(-6px) rotate(-6deg);} 90%{transform:translateY(0);}}
.a-float{transform-box:fill-box; transform-origin:center; animation:a-float 3s ease-in-out infinite;} @keyframes a-float{0%,100%{transform:translateY(0);} 50%{transform:translateY(-6px);}}
.a-fall{transform-box:fill-box; animation:a-fall 5s linear infinite;}
@keyframes a-fall{0%{transform:translate(0,-30px) rotate(0); opacity:0;} 10%{opacity:1;} 90%{opacity:1;} 100%{transform:translate(18px,60px) rotate(160deg); opacity:0;}}
.a-rise{transform-box:fill-box; animation:a-rise 3.6s ease-in infinite;} @keyframes a-rise{0%{transform:translateY(24px); opacity:0;} 15%{opacity:1;} 100%{transform:translate(8px,-46px); opacity:0;}}
.a-spin{transform-box:view-box; transform-origin:130px 130px; animation:a-spin 20s linear infinite;} @keyframes a-spin{to{transform:rotate(360deg);}}
.a-spin-fast{transform-box:view-box; transform-origin:130px 130px; animation:a-spin 5s linear infinite;}
.a-sway{transform-box:fill-box; transform-origin:50% 100%; animation:a-sway 1.6s ease-in-out infinite;} @keyframes a-sway{0%,100%{transform:rotate(-12deg);} 50%{transform:rotate(12deg);}}
.a-beam{transform-box:fill-box; transform-origin:50% 0; animation:a-beam 4s ease-in-out infinite;} @keyframes a-beam{0%,100%{transform:rotate(-18deg);} 50%{transform:rotate(18deg);}}
.a-eq{transform-box:fill-box; transform-origin:50% 100%; animation:a-eq .9s ease-in-out infinite;} @keyframes a-eq{0%,100%{transform:scaleY(.35);} 50%{transform:scaleY(1);}}
.d1{animation-delay:-.3s;} .d2{animation-delay:-.6s;} .d3{animation-delay:-.9s;} .d4{animation-delay:-1.2s;} .d5{animation-delay:-1.8s;} .d6{animation-delay:-2.4s;}
/* Animaciones para artículos de imagen */
.im-flicker{animation:im-flicker 1.3s ease-in-out infinite; transform-origin:50% 55%;}
@keyframes im-flicker{0%,100%{filter:drop-shadow(0 0 6px rgba(255,120,0,.55)) brightness(1); transform:scale(1);} 25%{filter:drop-shadow(0 0 14px rgba(255,150,0,.85)) brightness(1.12); transform:scale(1.015) rotate(.6deg);} 75%{filter:drop-shadow(0 0 16px rgba(255,170,40,.9)) brightness(1.15); transform:scale(1.02) rotate(-.6deg);}}
.im-shine{animation:im-glow 3s ease-in-out infinite;}
.im-glow{animation:im-glow 2.6s ease-in-out infinite;} @keyframes im-glow{0%,100%{filter:drop-shadow(0 0 5px rgba(255,255,255,.35)) brightness(1);} 50%{filter:drop-shadow(0 0 16px rgba(255,255,255,.8)) brightness(1.15);}}
.im-float{animation:a-float 3s ease-in-out infinite;} .im-spin{animation:im-spin 16s linear infinite;} @keyframes im-spin{to{transform:rotate(360deg);}}

/* ── Filas del ranking ── */
.cx-fx{position:absolute; inset:0; z-index:0; pointer-events:none; overflow:hidden; border-radius:inherit;}
.cx-fx svg{position:absolute; inset:0; width:100%; height:100%;}
.cx-ring{position:absolute; inset:0; border-radius:inherit; pointer-events:none; padding:1.5px;
  -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude;}
.cxr-brillo{animation:cxr-glow 2.8s ease-in-out infinite; border-color:rgba(0,229,199,.55) !important;}
@keyframes cxr-glow{0%,100%{box-shadow:inset 0 0 14px rgba(0,229,199,.12), 0 0 10px rgba(0,229,199,.12);} 50%{box-shadow:inset 0 0 26px rgba(0,229,199,.3), 0 0 22px rgba(0,229,199,.3);}}
.cxr-bub{position:absolute; bottom:-12px; border-radius:50%; border:1.5px solid rgba(160,220,255,.55); background:radial-gradient(circle at 35% 35%, rgba(255,255,255,.5), rgba(120,200,255,.08) 60%); animation:cxr-rise linear infinite;}
@keyframes cxr-rise{0%{transform:translate(0,0); opacity:0;} 10%{opacity:1;} 100%{transform:translate(12px,-90px); opacity:0;}}
.cxr-water{position:absolute; left:0; right:0; bottom:0; height:16px; opacity:.55; background-size:80px 16px; background-repeat:repeat-x; animation:cxr-waves 3s linear infinite;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='16' viewBox='0 0 80 16'%3E%3Cpath d='M0 8 Q10 2 20 8 T40 8 T60 8 T80 8 V16 H0Z' fill='%2300e5c7' fill-opacity='.35'/%3E%3C/svg%3E");}
@keyframes cxr-waves{to{background-position:80px 0;}}
.cxr-fin{position:absolute; bottom:6px; left:-60px; width:46px; height:30px; opacity:.8; filter:drop-shadow(0 0 6px rgba(0,229,199,.7)); animation:cxr-swim 9s linear infinite;}
@keyframes cxr-swim{0%{left:-60px;} 100%{left:calc(100% + 20px);}}
.cxr-sweep{position:absolute; inset:0; background:linear-gradient(105deg,transparent 40%,rgba(233,230,255,.2) 48%,rgba(255,95,168,.16) 52%,transparent 60%) 0 0/250% 100%; animation:cxr-sweep 3.4s ease-in-out infinite;}
@keyframes cxr-sweep{0%{background-position:160% 0;} 70%,100%{background-position:-60% 0;}}
.cxr-beam{position:absolute; top:-10px; width:120px; height:130px; transform-origin:50% 0; background:linear-gradient(180deg,rgba(255,255,255,.26),transparent 85%);
  clip-path:polygon(44% 0,56% 0,100% 100%,0 100%); mix-blend-mode:screen; animation:a-beam 3.6s ease-in-out infinite;}
.cxr-bars{position:absolute; left:0; right:0; bottom:0; height:55%; display:flex; align-items:flex-end; gap:5px; padding:0 8px; opacity:.3;}
.cxr-bars i{flex:1; height:100%; border-radius:3px 3px 0 0; background:linear-gradient(0deg,#a66bff,#ff5fa8 60%,#ffd36b); transform-origin:50% 100%; animation:a-eq 1s ease-in-out infinite;}

/* ── Bordes de banner ── */
.cx-bn{position:absolute; inset:0; z-index:6; pointer-events:none; border-radius:inherit;}
.cx-bn .cx-ring{padding:5px;}
.cx-bn svg{position:absolute; inset:0; width:100%; height:100%; overflow:visible;}
@property --cx-a{syntax:'<angle>'; initial-value:0deg; inherits:false;}
.cxb-rot{animation:cxb-rot 5s linear infinite;} @keyframes cxb-rot{to{--cx-a:360deg;}}
.cx-bulb{animation:cx-bulb 1.2s steps(1) infinite;} .cx-bulb.o{animation-delay:-.6s;}
@keyframes cx-bulb{0%{fill:#fff6d6; filter:drop-shadow(0 0 5px #ffd36b);} 50%{fill:#7a5a2a; filter:none;}}
.cx-conf{animation:cx-conf 4.5s linear infinite; transform-box:fill-box; transform-origin:center;}
@keyframes cx-conf{0%{transform:translateY(-20px) rotate(0); opacity:0;} 10%{opacity:1;} 100%{transform:translateY(420px) rotate(540deg); opacity:.2;}}

/* ── Nombre ── */
.cx-grad{background:linear-gradient(90deg,#00e5c7,#4c9dff,#b06bff,#ff5f9e,#00e5c7); background-size:250% 100%; -webkit-background-clip:text; background-clip:text; color:transparent !important; animation:cx-flow 5s linear infinite;}
@keyframes cx-flow{to{background-position:250% 0;}}
.cx-emoji{margin-left:5px; font-style:normal;}

@media (prefers-reduced-motion: reduce){ .cx-frame *, .cx-fx, .cx-fx *, .cx-bn *, .cx-grad, [class*="cxr-"]{animation:none !important;} }
`;

export function injectCosmeticsCss() {
  if (document.getElementById('cx-style')) return;
  const st = document.createElement('style'); st.id = 'cx-style'; st.textContent = CSS; document.head.appendChild(st);
}

// ── Piezas comunes ──
let uidN = 0;
const uid = () => 'cx' + (uidN++);
const DEFS = (u) => `<defs>
  <filter id="gl${u}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.6" result="a"/><feGaussianBlur stdDeviation="6" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="ro${u}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3"/></filter>
  <linearGradient id="chr${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#cfc8ff"/><stop offset=".55" stop-color="#8f86c9"/><stop offset=".75" stop-color="#f2eeff"/><stop offset="1" stop-color="#a99fe0"/></linearGradient>
  <linearGradient id="cry${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc2e0"/><stop offset=".5" stop-color="#ff5fa8"/><stop offset="1" stop-color="#a0246a"/></linearGradient>
  <linearGradient id="brz${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e7b07a"/><stop offset=".3" stop-color="#8a5428"/><stop offset=".6" stop-color="#d99a5b"/><stop offset="1" stop-color="#7a4a22"/></linearGradient>
  <linearGradient id="slv${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#8d99a6"/><stop offset=".6" stop-color="#f2f6fa"/><stop offset="1" stop-color="#9aa7b4"/></linearGradient>
  <linearGradient id="gld${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4b8"/><stop offset=".3" stop-color="#c8900f"/><stop offset=".6" stop-color="#ffe27a"/><stop offset="1" stop-color="#a8740c"/></linearGradient>
</defs>`;
const star4 = (x, y, s) => `M${x} ${y - s} L${x + s * .28} ${y - s * .28} L${x + s} ${y} L${x + s * .28} ${y + s * .28} L${x} ${y + s} L${x - s * .28} ${y + s * .28} L${x - s} ${y} L${x - s * .28} ${y - s * .28}Z`;
const heart = (x, y, s) => `M${x} ${y + s * .9} C${x - s * 1.3} ${y} ${x - s} ${y - s} ${x} ${y - s * .35} C${x + s} ${y - s} ${x + s * 1.3} ${y} ${x} ${y + s * .9}Z`;
const note = (x, y, s, c) => `<g fill="${c}"><ellipse cx="${x}" cy="${y}" rx="${s * .55}" ry="${s * .4}" transform="rotate(-20 ${x} ${y})"/><rect x="${x + s * .4}" y="${y - s * 1.6}" width="${s * .16}" height="${s * 1.6}"/><path d="M${x + s * .5} ${y - s * 1.6} q${s * .6} ${s * .2} ${s * .7} ${s * .8} q-${s * .2} -${s * .4} -${s * .7} -${s * .4}z"/></g>`;
const crystalHeart = (x, y, s, u, cls = 'a-pulse') => `<g class="${cls}" filter="url(#gl${u})">
  <path d="${heart(x, y, s)}" fill="url(#cry${u})" stroke="url(#chr${u})" stroke-width="${s * .18}"/>
  <path d="M${x} ${y - s * .35} L${x - s * .45} ${y + s * .1} L${x} ${y + s * .9} M${x} ${y - s * .35} L${x + s * .45} ${y + s * .1} L${x} ${y + s * .9}" fill="none" stroke="#ffe1f0" stroke-width="${s * .06}" opacity=".7"/>
  <path d="M${x - s * .62} ${y - s * .45} q${s * .2} -${s * .25} ${s * .45} -${s * .2}" fill="none" stroke="#fff" stroke-width="${s * .1}" stroke-linecap="round"/></g>`;
const lightstick = (x, y, rot, c, u, cls = '') => `<g class="a-sway ${cls}" transform="rotate(${rot} ${x} ${y})" filter="url(#gl${u})">
  <rect x="${x - 3}" y="${y - 6}" width="6" height="30" rx="3" fill="url(#chr${u})"/><path d="${heart(x, y - 16, 12)}" fill="${c}" stroke="#fff" stroke-width="1.5"/></g>`;

// ── Marcos (back = detrás del avatar, front = delante) ──
export const FRAMES = {
  'marco-bronce': {
    back: () => '',
    front: (u) => `<circle cx="130" cy="130" r="91" fill="none" stroke="url(#brz${u})" stroke-width="9"/><circle cx="130" cy="130" r="96" fill="none" stroke="#e7b07a" stroke-width="1" opacity=".5"/>` },
  'marco-plata': {
    back: () => '',
    front: (u) => `<circle cx="130" cy="130" r="91" fill="none" stroke="url(#slv${u})" stroke-width="9"/>
      <g class="a-spin-fast"><path d="M130 39 A91 91 0 0 1 194 65" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75" filter="url(#gl${u})"/></g>` },
  'marco-oro': {
    back: () => `<circle class="a-breathe" cx="130" cy="130" r="98" fill="none" stroke="#facc15" stroke-width="12" opacity=".35" style="filter:blur(8px)"/>`,
    front: (u) => `<circle cx="130" cy="130" r="91" fill="none" stroke="url(#gld${u})" stroke-width="10"/>
      <g filter="url(#gl${u})"><path class="a-twinkle" d="M130 26 L140 40 L130 54 L120 40Z" fill="#fff3a8" stroke="#facc15" stroke-width="2"/></g>
      <g fill="#fff" filter="url(#gl${u})"><path class="a-twinkle d3 detail" d="${star4(212, 64, 7)}"/><path class="a-twinkle d5 detail" d="${star4(46, 196, 6)}"/></g>` },
  'marco-arcoiris': {
    back: () => `<circle class="a-breathe" cx="130" cy="130" r="98" fill="none" stroke="#b06bff" stroke-width="12" opacity=".3" style="filter:blur(8px)"/>`,
    front: (u) => `<g class="a-spin-fast" filter="url(#gl${u})">${['#ff5f3d', '#facc15', '#22c55e', '#00e5c7', '#4c9dff', '#b06bff'].map((c, i) =>
        `<circle cx="130" cy="130" r="91" fill="none" stroke="${c}" stroke-width="8" stroke-dasharray="95.3 476.5" stroke-dashoffset="${-i * 95.3}"/>`).join('')}</g>` },
  'marco-neon': {
    back: (u) => `<ellipse class="a-breathe" cx="208" cy="78" rx="34" ry="30" fill="#ff6fd8" opacity=".7" style="filter:blur(6px)"/>`,
    front: (u) => `
      <g stroke="#ff7fe0" stroke-width="5" stroke-linecap="round" fill="none" filter="url(#gl${u})"><path class="a-drip" d="M198 100 q1 18 -1 34"/><path class="a-drip d2" d="M214 102 q2 12 0 26"/></g>
      <g class="a-flick" fill="none" stroke="#5ad8ff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#gl${u})">
        <path d="M62 44 c8 -14 22 -12 18 2 c-3 10 -16 12 -12 22 c4 9 20 2 26 -8 c5 -9 1 -18 10 -20 c9 -2 12 10 6 18 c-5 8 4 14 12 6 c8 -8 10 -20 18 -22"/></g>
      <g stroke="#a974ff" stroke-linecap="round" fill="none" filter="url(#gl${u})"><path d="M40 92 c10 -8 26 -10 38 -6" stroke-width="9"/>
        <path class="a-drip" d="M48 94 q-1 22 1 40" stroke-width="7"/><path class="a-drip d3" d="M64 90 q2 16 0 30" stroke-width="7"/></g>
      <g fill="#ff9be9" filter="url(#gl${u})"><path class="a-twinkle" d="${star4(36, 66, 11)}"/><path class="a-twinkle d1 detail" d="${star4(152, 32, 8)}"/><path class="a-twinkle d2" d="${star4(236, 160, 10)}"/></g>
      <g fill="#39ff7a" filter="url(#gl${u})"><circle cx="84" cy="208" r="6"/><circle cx="190" cy="220" r="5"/><circle class="detail" cx="224" cy="120" r="4"/></g>
      <g class="a-hop detail" fill="none" stroke="#6fa8ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#gl${u})">
        <path d="M40 206 c-4 -16 -2 -30 4 -30 c5 0 5 14 3 24"/><path d="M52 204 c2 -16 8 -28 13 -26 c5 2 0 16 -6 24"/>
        <path d="M34 218 c0 -12 10 -18 20 -16 c11 2 16 12 12 22 c-4 9 -18 12 -26 6 c-4 -3 -6 -7 -6 -12z"/><path d="M44 214 l0 .1 M56 214 l0 .1" stroke-width="4"/></g>
      <circle class="a-flick" cx="130" cy="130" r="88" fill="none" stroke="#5ad8ff" stroke-width="2" stroke-dasharray="18 7 4 7" filter="url(#gl${u})"/>` },
  'marco-tiburon': {
    back: () => `<circle class="a-breathe" cx="130" cy="130" r="100" fill="none" stroke="#00e5c7" stroke-width="10" opacity=".25" style="filter:blur(8px)"/>`,
    front: (u) => `
      <g class="a-spin" fill="#eafffb" filter="url(#gl${u})">${Array.from({ length: 18 }, (_, i) => `<path transform="rotate(${i * 20} 130 130)" d="M130 34 l5 10 l-10 0z"/>`).join('')}</g>
      <circle cx="130" cy="130" r="90" fill="none" stroke="#00e5c7" stroke-width="3.5" filter="url(#gl${u})"/>
      <path class="a-float" d="M112 44 C122 30 128 14 146 4 C144 18 148 32 160 44Z" fill="#00e5c7" stroke="#eafffb" stroke-width="2.5" filter="url(#gl${u})"/>
      <g fill="none" stroke="#4c9dff" stroke-width="3.5" stroke-linecap="round" filter="url(#gl${u})" class="a-flick">
        <path d="M36 196 q12 -10 24 0 t24 0 t24 0"/><path class="detail" d="M170 222 q10 -8 20 0 t20 0"/></g>
      <g fill="none" stroke="#bff6ff" stroke-width="2.2" filter="url(#gl${u})">
        <circle class="a-rise" cx="218" cy="180" r="6"/><circle class="a-rise d2" cx="232" cy="200" r="4"/><circle class="a-rise d4 detail" cx="206" cy="206" r="3"/>
        <circle class="a-rise d1" cx="28" cy="140" r="5"/><circle class="a-rise d3 detail" cx="40" cy="160" r="3"/></g>` },
  'marco-sakura': {
    back: () => `<ellipse class="a-breathe" cx="60" cy="70" rx="40" ry="34" fill="#ff9ec7" opacity=".45" style="filter:blur(10px)"/><ellipse class="a-breathe d3" cx="206" cy="200" rx="36" ry="30" fill="#c792ff" opacity=".4" style="filter:blur(10px)"/>`,
    front: (u) => `
      <circle cx="130" cy="130" r="89" fill="none" stroke="#ffd1e6" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round" filter="url(#gl${u})"/>
      <g fill="#ff9ec7" stroke="#fff" stroke-width="1.2" filter="url(#gl${u})">
        ${[[40, 40, 0], [200, 30, 1], [230, 110, 2], [26, 130, 3], [180, 200, 4], [70, 210, 5]].map(([x, y, d]) => `<g transform="translate(${x} ${y}) rotate(${d * 47})"><path class="a-fall d${d}${d > 3 ? ' detail' : ''}" d="M0 -11 L3 -7 L6 -10 C10 -3 7 6 0 11 C-7 6 -10 -3 -6 -10 L-3 -7Z"/></g>`).join('')}</g>
      <g filter="url(#gl${u})"><path class="a-float" d="${heart(214, 64, 14)}" fill="#ff6fae"/><path class="a-float d2 detail" d="${heart(46, 196, 10)}" fill="#ff9ec7"/></g>
      <g fill="#fff" filter="url(#gl${u})"><path class="a-twinkle" d="${star4(170, 22, 8)}"/><path class="a-twinkle d2" d="${star4(244, 170, 9)}"/><path class="a-twinkle d4 detail" d="${star4(22, 90, 7)}"/></g>` },
  'marco-galaxia': {
    back: (u) => `<circle class="a-breathe" cx="130" cy="130" r="104" fill="none" stroke="#8b7bff" stroke-width="14" opacity=".25" style="filter:blur(10px)"/>
      <g class="a-spin"><ellipse cx="130" cy="130" rx="116" ry="42" fill="none" stroke="#5ad8ff" stroke-width="2" stroke-dasharray="4 8" transform="rotate(-25 130 130)" filter="url(#gl${u})"/>
        <circle cx="240" cy="94" r="5" fill="#ffe27a" filter="url(#gl${u})"/></g>`,
    front: (u) => `
      <g class="a-float" filter="url(#gl${u})"><circle cx="212" cy="56" r="17" fill="#ff7fe0"/><ellipse cx="212" cy="56" rx="29" ry="8" fill="none" stroke="#ffe27a" stroke-width="3" transform="rotate(-18 212 56)"/></g>
      <g class="a-flick detail" filter="url(#gl${u})"><path d="M24 214 L66 186" stroke="#5ad8ff" stroke-width="4" stroke-linecap="round" opacity=".7"/><circle cx="68" cy="185" r="6" fill="#fff"/></g>
      <g fill="#ffe27a" filter="url(#gl${u})"><path class="a-twinkle" d="${star4(40, 60, 10)}"/><path class="a-twinkle d2" d="${star4(128, 16, 7)}"/><path class="a-twinkle d4" d="${star4(240, 200, 9)}"/>
        <path class="a-twinkle d1 detail" d="${star4(90, 236, 6)}" fill="#fff"/><path class="a-twinkle d3 detail" d="${star4(20, 140, 5)}" fill="#fff"/></g>` },
  'marco-demonio': {
    back: () => `<ellipse class="a-breathe" cx="130" cy="228" rx="90" ry="26" fill="#ff5a3d" opacity=".45" style="filter:blur(12px)"/>`,
    front: (u) => `
      <circle class="a-flick" cx="130" cy="130" r="89" fill="none" stroke="#ff3d6e" stroke-width="3" filter="url(#gl${u})"/>
      <g fill="#ff3d6e" stroke="#ffd0da" stroke-width="2" filter="url(#gl${u})"><path d="M78 58 C66 40 64 22 72 8 C78 26 90 38 102 46Z"/><path d="M182 58 C194 40 196 22 188 8 C182 26 170 38 158 46Z"/></g>
      <path class="a-hop detail" d="M214 190 C236 196 240 222 226 232 C236 226 238 212 226 206 L236 196 L224 198 C220 192 214 190 214 190Z" fill="#b06bff" stroke="#e7d2ff" stroke-width="1.6" filter="url(#gl${u})"/>
      <g filter="url(#gl${u})">${[[60, 226, 0], [100, 240, 2], [150, 242, 1], [196, 230, 3]].map(([x, y, d]) => `<path class="a-breathe d${d}" d="M${x} ${y} c-8 -8 -6 -18 0 -26 c2 8 8 10 8 18 c0 5 -4 8 -8 8z" fill="#ff9a3d"/>`).join('')}</g>
      <g fill="#ffe27a" filter="url(#gl${u})"><circle class="a-rise" cx="40" cy="170" r="3"/><circle class="a-rise d2" cx="222" cy="150" r="3.5"/><circle class="a-rise d4 detail" cx="30" cy="120" r="2.5"/></g>` },
  'idol-corazon': {
    back: () => `<circle cx="130" cy="130" r="104" fill="none" stroke="#ff5fa8" stroke-width="16" opacity=".22" style="filter:blur(10px)"/>`,
    front: (u) => `<circle cx="130" cy="130" r="90" fill="none" stroke="url(#chr${u})" stroke-width="6"/>
      <circle cx="130" cy="130" r="96" fill="none" stroke="#ff5fa8" stroke-width="1.5" stroke-dasharray="3 7" class="a-spin detail" filter="url(#gl${u})"/>
      ${crystalHeart(130, 40, 26, u)}
      <g fill="#fff" filter="url(#gl${u})"><path class="a-twinkle" d="${star4(58, 64, 10)}"/><path class="a-twinkle d3" d="${star4(212, 70, 8)}"/><path class="a-twinkle d5 detail" d="${star4(232, 190, 9)}" fill="#ffd36b"/><path class="a-twinkle d2 detail" d="${star4(30, 170, 7)}" fill="#ffd36b"/></g>` },
  'idol-lightsticks': {
    back: () => `<ellipse cx="130" cy="210" rx="110" ry="36" fill="#a66bff" opacity=".35" style="filter:blur(12px)"/>`,
    front: (u) => `<circle cx="130" cy="130" r="89" fill="none" stroke="#a66bff" stroke-width="3" filter="url(#gl${u})"/>
      ${lightstick(42, 214, -20, '#ff5fa8', u)}${lightstick(218, 214, 20, '#a66bff', u, 'd3')}
      <g filter="url(#gl${u})"><g class="a-rise">${note(70, 70, 16, '#ffd36b')}</g><g class="a-rise d4">${note(196, 60, 14, '#ff5fa8')}</g><g class="a-rise d2 detail">${note(232, 130, 12, '#7fe3ff')}</g></g>
      <path class="a-float" d="${heart(130, 26, 12)}" fill="#ff5fa8" filter="url(#gl${u})"/>` },
  'idol-escenario': {
    back: () => `<g style="mix-blend-mode:screen"><path class="a-beam" d="M60 -20 L40 150 L96 150Z" fill="#ff5fa8" opacity=".35" style="filter:blur(4px)"/>
        <path class="a-beam d4" d="M200 -20 L166 150 L222 150Z" fill="#a66bff" opacity=".35" style="filter:blur(4px)"/></g>`,
    front: (u) => `<circle cx="130" cy="130" r="89" fill="none" stroke="url(#chr${u})" stroke-width="4.5"/>
      <g filter="url(#gl${u})">${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect class="a-eq d${i % 6}" x="${86 + i * 13}" y="206" width="9" height="30" rx="3" fill="${['#ff5fa8', '#a66bff', '#ffd36b'][i % 3]}"/>`).join('')}</g>
      <g filter="url(#gl${u})"><path class="a-float" d="${heart(44, 76, 11)}" fill="#ff5fa8"/><path class="a-float d3" d="${heart(220, 96, 9)}" fill="#ffd36b"/><path class="a-float d5 detail" d="${heart(226, 40, 7)}" fill="#a66bff"/></g>
      <g fill="#fff" filter="url(#gl${u})"><path class="a-twinkle d1" d="${star4(130, 22, 9)}"/><path class="a-twinkle d4 detail" d="${star4(26, 130, 7)}"/></g>` },
};

// Marco = dos capas: detrás del avatar (cx-behind) y delante. px = tamaño del avatar.
function frameEls(itemId, px, item) {
  const mk = (extra) => { const e = document.createElement('span'); e.className = 'cx-frame' + extra + (px <= 48 ? ' mini' : ''); return e; };
  if (item?.image_url) {
    const front = mk('');
    front.innerHTML = `<img class="cx-img ${item.image_anim && item.image_anim !== 'none' ? 'im-' + item.image_anim : ''}" src="${escAttr(item.image_url)}" alt="">`;
    return [front];
  }
  const f = FRAMES[itemId];
  if (!f) return [];
  const u = uid();
  const back = mk(' cx-behind'), front = mk('');
  back.innerHTML = `<svg viewBox="0 0 260 260" aria-hidden="true">${DEFS(u + 'b')}${f.back(u + 'b')}</svg>`;
  front.innerHTML = `<svg viewBox="0 0 260 260" aria-hidden="true">${DEFS(u)}${f.front(u)}</svg>`;
  return [back, front];
}

// Pone el marco alrededor de un avatar existente (el marco es circular).
export function decorateAvatar(avatarEl, itemId, px, item) {
  if (!avatarEl) return;
  const host = avatarEl.parentElement;
  host.querySelectorAll(':scope > .cx-frame').forEach(n => n.remove());
  if (!itemId) return;
  const els = frameEls(itemId, px, item);
  if (!els.length) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.style.isolation = 'isolate';        // la capa de atrás queda detrás del avatar, no del resto de la página
  const side = px / 0.66;
  const l = avatarEl.offsetLeft + px / 2 - side / 2, t = avatarEl.offsetTop + px / 2 - side / 2;
  for (const e of els) { Object.assign(e.style, { width: side + 'px', height: side + 'px', left: l + 'px', top: t + 'px' }); host.appendChild(e); }
}

// Marco suelto con avatar de muestra (tienda / inventario).
export function frameHtml(itemId, px, avatarUrl, item) {
  const wrap = document.createElement('span');
  wrap.className = 'cx-sample';
  const side = Math.round(px / 0.66);
  wrap.style.width = wrap.style.height = side + 'px';
  wrap.innerHTML = `<span class="cx-face">${avatarUrl ? `<img src="${escAttr(avatarUrl)}" alt="">` : ''}</span>`;
  for (const e of frameEls(itemId, px, item)) wrap.appendChild(e);
  return wrap;
}

// ── Efectos de fila ──
export const ROWS = {
  'fila-brillo': { cls: 'cxr-brillo', html: () => '' },
  'fila-burbujas': { html: () => Array.from({ length: 14 }, () => {
      const s = 4 + Math.random() * 7;
      return `<span class="cxr-bub" style="left:${(Math.random() * 100).toFixed(1)}%; width:${s.toFixed(1)}px; height:${s.toFixed(1)}px; animation-duration:${(3 + Math.random() * 3).toFixed(2)}s; animation-delay:${(-Math.random() * 5).toFixed(2)}s"></span>`;
    }).join('') },
  'fila-aleta': { html: () => `<span class="cxr-water"></span><svg class="cxr-fin" viewBox="0 0 46 30" aria-hidden="true"><path d="M2 29 C12 22 18 9 30 1 C29 11 32 21 44 29Z" fill="#00e5c7" stroke="#eafffb" stroke-width="1.4"/></svg>`,
    style: 'background:linear-gradient(180deg, transparent 55%, rgba(0,90,110,.3))' },
  'idol-cromo': { html: () => `<span class="cx-ring" style="background:linear-gradient(90deg,#ff5fa8,#e9e6ff,#a66bff,#ffd36b)"></span><span class="cxr-sweep"></span>` },
  'idol-focos': { html: () => `<span class="cxr-beam" style="left:6%; background:linear-gradient(180deg,rgba(255,95,168,.42),transparent 85%)"></span>
      <span class="cxr-beam" style="left:40%; animation-delay:-1.2s"></span><span class="cxr-beam" style="left:72%; animation-delay:-2.4s; background:linear-gradient(180deg,rgba(166,107,255,.42),transparent 85%)"></span>` },
  'idol-eq': { html: () => `<div class="cxr-bars">${Array.from({ length: 40 }, () => `<i style="animation-delay:${(-Math.random()).toFixed(2)}s; animation-duration:${(.7 + Math.random() * .6).toFixed(2)}s"></i>`).join('')}</div>
      <svg viewBox="0 0 1000 66" preserveAspectRatio="none" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<path class="a-rise d${i % 6}" d="${heart(80 + i * 120, 70, 9)}" fill="${['#ff5fa8', '#ffd36b', '#a66bff'][i % 3]}" style="animation-duration:${3 + (i % 3) * .6}s"/>`).join('')}</svg>` },
};

export function applyRowEffect(rowEl, itemId) {
  if (!rowEl) return;
  rowEl.querySelectorAll(':scope > .cx-fx').forEach(n => n.remove());
  Object.values(ROWS).forEach(r => r.cls && rowEl.classList.remove(r.cls));
  const r = ROWS[itemId];
  if (!r) return;
  if (r.cls) rowEl.classList.add(r.cls);
  const html = r.html();
  if (html || r.style) {
    const fx = document.createElement('div');
    fx.className = 'cx-fx';
    if (r.style) fx.style.cssText = r.style;
    fx.innerHTML = html;
    rowEl.prepend(fx);
  }
}

// ── Bordes de banner ──
export const BANNERS = {
  'banner-animado': { html: () => `<span class="cx-ring cxb-rot" style="background:conic-gradient(from var(--cx-a),#00e5c7,#4c9dff,#b06bff,#00e5c7)"></span>` },
  'banner-tiburon': { html: (u) => `<span class="cx-ring" style="background:linear-gradient(135deg,#00e5c7,#0a6b8a 40%,#00e5c7 60%,#0a6b8a)"></span>
      <span style="position:absolute; left:24px; right:24px; top:5px; height:10px; opacity:.9; background-size:14px 10px; background-repeat:repeat-x;
        background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='10'%3E%3Cpath d='M0 0 L7 9 L14 0Z' fill='%23eafffb'/%3E%3C/svg%3E&quot;)"></span>
      ${['none', 'scaleX(-1)', 'scaleY(-1)', 'scale(-1,-1)'].map((tr, i) => `<svg viewBox="0 0 46 46" aria-hidden="true" style="position:absolute; inset:auto; width:46px; height:46px; ${i % 2 ? 'right' : 'left'}:0; ${i > 1 ? 'bottom' : 'top'}:0; transform:${tr}">
        <path d="M4 42 V10 Q4 4 10 4 H42" fill="none" stroke="#eafffb" stroke-width="3"/><path d="M12 12 L20 12 L12 20Z" fill="#eafffb"/><circle cx="10" cy="10" r="3" fill="#00e5c7" stroke="#eafffb" stroke-width="1.5"/></svg>`).join('')}` },
  'idol-marquesina': { html: () => `<span class="cx-ring" style="padding:12px; background:linear-gradient(90deg,#ff5fa8,#a66bff,#ffd36b,#ff5fa8)"></span><svg class="cx-bulbs" aria-hidden="true"></svg>`,
    init: (el) => {
      const svg = el.querySelector('.cx-bulbs');
      const draw = () => {
        const W = svg.clientWidth, H = svg.clientHeight, m = 6, step = 17;
        if (!W || !H) return;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        let s = '', k = 0;
        const put = (x, y) => { s += `<circle class="cx-bulb ${k++ % 2 ? 'o' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6"/>`; };
        const nx = Math.max(1, Math.round((W - 2 * m) / step)), ny = Math.max(1, Math.round((H - 2 * m) / step));
        for (let i = 0; i < nx; i++) put(m + i * (W - 2 * m) / nx, m);
        for (let i = 0; i < ny; i++) put(W - m, m + i * (H - 2 * m) / ny);
        for (let i = 0; i < nx; i++) put(W - m - i * (W - 2 * m) / nx, H - m);
        for (let i = 0; i < ny; i++) put(m, H - m - i * (H - 2 * m) / ny);
        svg.innerHTML = s;
      };
      draw();
      if (window.ResizeObserver) new ResizeObserver(draw).observe(svg);
    } },
  'idol-final': { html: (u) => `<span class="cx-ring cxb-rot" style="background:conic-gradient(from var(--cx-a),#ff5fa8,#e9e6ff,#a66bff,#ffd36b,#ff5fa8)"></span>
      <svg aria-hidden="true" style="overflow:hidden">${Array.from({ length: 22 }, (_, i) => {
        const x = ((i * 37) % 100), c = ['#ff5fa8', '#ffd36b', '#a66bff', '#fff'][i % 4], d = (-(i * .41) % 4.5).toFixed(2);
        return i % 3 ? `<rect class="cx-conf" x="${x}%" y="0" width="6" height="10" rx="1.5" fill="${c}" style="animation-delay:${d}s"/>`
                     : `<circle class="cx-conf" cx="${x}%" cy="0" r="4" fill="${c}" style="animation-delay:${d}s"/>`; }).join('')}</svg>
      ${[['left', 'top'], ['right', 'top'], ['left', 'bottom'], ['right', 'bottom']].map(([h, v], i) => `<svg viewBox="-16 -16 32 32" aria-hidden="true" style="position:absolute; width:34px; height:34px; inset:auto; ${h}:2px; ${v}:2px">${DEFS(u + i)}${crystalHeart(0, 0, 11, u + i, 'a-pulse d' + i)}</svg>`).join('')}` },
};

export function applyBanner(bannerEl, itemId) {
  if (!bannerEl) return;
  bannerEl.querySelectorAll(':scope > .cx-bn').forEach(n => n.remove());
  const b = BANNERS[itemId];
  if (!b) return;
  const el = document.createElement('div');
  el.className = 'cx-bn';
  el.innerHTML = b.html(uid());
  bannerEl.appendChild(el);
  if (b.init) requestAnimationFrame(() => b.init(el));
}

// ── Nombre ──
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escAttr = esc;
export function nameHtml(name, cos) {
  let style = '', cls = '';
  if (cos?.nombre === 'nombre-color' && NAME_COLORS.includes(cos.nombre_valor)) style = ` style="color:${cos.nombre_valor}"`;
  if (cos?.nombre === 'nombre-degradado') cls = ' cx-grad';
  const emoji = cos?.emoji && EMOJIS.includes(cos.emoji) ? `<i class="cx-emoji">${cos.emoji}</i>` : '';
  return `<span class="cx-name${cls}"${style}>${esc(name)}</span>${emoji}`;
}

// ── Datos: lo que tiene puesto cada jugador ──
export async function loadEquipped(supabase) {
  const [{ data: rows }, { data: items }] = await Promise.all([
    supabase.from('player_cosmetics').select('*'),
    supabase.from('shop_items').select('id, image_url, image_anim').not('image_url', 'is', null),
  ]);
  const img = new Map((items ?? []).map(i => [i.id, i]));
  const map = new Map();
  for (const r of rows ?? []) map.set(r.player_id, { ...r, marcoItem: img.get(r.marco) ?? null });
  return map;
}

// ── Iconos de premios reales (propios, sin logos de marcas) ──
const sp = (x, y, s, c = '#fff') => `<path class="a-twinkle" d="M${x} ${y - s} L${x + s * .3} ${y - s * .3} L${x + s} ${y} L${x + s * .3} ${y + s * .3} L${x} ${y + s} L${x - s * .3} ${y + s * .3} L${x - s} ${y} L${x - s * .3} ${y - s * .3}Z" fill="${c}"/>`;
export const PRIZE_ICONS = {
  moneda: { name: 'Moneda de juego', svg: (f) => `<g class="a-float" filter="url(#${f})"><ellipse cx="32" cy="36" rx="20" ry="20" fill="#b8860b"/><circle cx="32" cy="32" r="20" fill="#facc15" stroke="#fff3a8" stroke-width="2"/>
      <circle cx="32" cy="32" r="13" fill="none" stroke="#b8860b" stroke-width="2.5"/><path d="M32 23 L37 32 L32 41 L27 32Z" fill="#fff7c2"/></g>${sp(52, 12, 5)}` },
  juego: { name: 'Juego', svg: (f) => `<g class="a-float" filter="url(#${f})"><path d="M14 24 C8 24 5 32 6 42 C7 50 13 52 18 46 L22 41 H42 L46 46 C51 52 57 50 58 42 C59 32 56 24 50 24Z" fill="#1f3b5c" stroke="#00e5c7" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M18 30 v10 M13 35 h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="44" cy="32" r="2.6" fill="#ff5fa8"/><circle cx="49" cy="37" r="2.6" fill="#facc15"/><circle cx="39" cy="37" r="2.6" fill="#4c9dff"/><circle cx="44" cy="42" r="2.6" fill="#22c55e"/></g>` },
  skin: { name: 'Skin', svg: (f) => `<g class="a-float" filter="url(#${f})"><path d="M44 8 L56 20 L30 46 L20 36Z" fill="#a66bff" stroke="#e7d2ff" stroke-width="2" stroke-linejoin="round"/>
      <path d="M20 36 L30 46 C28 54 18 58 8 56 C12 52 10 44 20 36Z" fill="#ff5fa8" stroke="#ffd1e6" stroke-width="2" stroke-linejoin="round"/></g>${sp(52, 46, 5, '#ffd36b')}${sp(12, 14, 4)}` },
  regalo: { name: 'Tarjeta regalo', svg: (f) => `<g class="a-float" filter="url(#${f})"><rect x="6" y="16" width="52" height="34" rx="6" fill="#123a4a" stroke="#00e5c7" stroke-width="2.5"/><rect x="6" y="24" width="52" height="6" fill="#00e5c7" opacity=".6"/>
      <path d="M40 36 c-4 -6 -12 -4 -8 2 c-6 -2 -8 6 -2 6 l10 0" fill="none" stroke="#ff5fa8" stroke-width="2.5" stroke-linecap="round"/><rect x="12" y="40" width="16" height="3" rx="1.5" fill="#9db3c4"/></g>` },
  suscripcion: { name: 'Suscripción', svg: (f) => `<g class="a-float" filter="url(#${f})"><path d="M32 6 L39 22 L56 24 L43 36 L47 53 L32 44 L17 53 L21 36 L8 24 L25 22Z" fill="#9146ff" stroke="#d4bbff" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="32" cy="30" r="7" fill="#fff" opacity=".9"/></g>${sp(55, 48, 4, '#ffd36b')}` },
  pase: { name: 'Pase / evento', svg: (f) => `<g class="a-float" filter="url(#${f})"><path d="M8 18 H56 V28 C51 28 51 36 56 36 V46 H8 V36 C13 36 13 28 8 28Z" fill="#3a1a37" stroke="#ffd36b" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M22 20 V44" stroke="#ffd36b" stroke-width="2" stroke-dasharray="3 3"/><path d="M40 25 l2.5 5 5.5 .8 -4 3.8 1 5.4 -5 -2.6 -5 2.6 1 -5.4 -4 -3.8 5.5 -.8z" fill="#ff5fa8"/></g>` },
  merch: { name: 'Merch', svg: (f) => `<g class="a-float" filter="url(#${f})"><path d="M22 8 L10 14 L4 26 L14 30 L16 26 V56 H48 V26 L50 30 L60 26 L54 14 L42 8 C40 14 24 14 22 8Z" fill="#0f2c40" stroke="#00e5c7" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M26 34 C30 26 36 24 42 26 C38 30 38 36 42 40 C34 42 28 40 26 34Z" fill="#00e5c7" opacity=".85"/></g>` },
  sorpresa: { name: 'Sorpresa', svg: (f) => `<g class="a-float" filter="url(#${f})"><rect x="10" y="26" width="44" height="30" rx="4" fill="#ff5fa8" stroke="#ffd1e6" stroke-width="2"/><rect x="6" y="18" width="52" height="10" rx="3" fill="#ff7fbf" stroke="#ffd1e6" stroke-width="2"/>
      <rect x="28" y="18" width="8" height="38" fill="#ffd36b"/><path d="M32 18 C24 6 12 10 20 18 M32 18 C40 6 52 10 44 18" fill="none" stroke="#ffd36b" stroke-width="3" stroke-linecap="round"/></g>${sp(56, 10, 5)}` },
};
export function prizeIconSvg(key) {
  const ic = PRIZE_ICONS[key] ?? PRIZE_ICONS.sorpresa, f = uid();
  return `<svg viewBox="0 0 64 64" aria-hidden="true" style="overflow:visible"><defs><filter id="${f}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="a"/><feMerge><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${ic.svg(f)}</svg>`;
}
