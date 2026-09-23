// ============================================================
// Generador del overlay para OBS (botón "📺 Overlay OBS" del perfil).
// Arma la URL de overlay.html con las opciones elegidas, muestra una
// vista previa en vivo y permite probar las alertas.
//
// Uso:  import { openOverlayGenerator } from './assets/overlay-generator.js';
//       openOverlayGenerator({ id, name });
// ============================================================

const CSS = `
.og-bg{position:fixed; inset:0; z-index:90; background:rgba(3,8,18,.72); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:16px;}
.og{width:760px; max-width:100%; max-height:calc(100vh - 32px); overflow-y:auto; background:rgba(6,14,23,.99); border:1px solid var(--border,#16324a); border-radius:18px; box-shadow:0 30px 80px rgba(0,0,0,.6); font-family:Inter,system-ui,sans-serif; color:#fff;}
.og-head{display:flex; align-items:center; gap:10px; padding:18px 20px 14px; border-bottom:1px solid var(--border,#16324a);}
.og-head h2{margin:0; font-family:Rajdhani,sans-serif; font-size:22px; letter-spacing:.05em; text-transform:uppercase;}
.og-head small{display:block; color:var(--text-faint,#6d8ba3); font-size:12.5px; font-weight:600; margin-top:2px;}
.og-x{margin-left:auto; background:none; border:none; color:var(--text-faint,#6d8ba3); font-size:26px; line-height:1; cursor:pointer; padding:4px;}
.og-x:hover{color:#fff;}
.og-body{display:grid; grid-template-columns:1fr 1fr; gap:18px; padding:18px 20px 20px;}
.og-opts{display:flex; flex-direction:column; gap:14px;}
.og-f > span{display:block; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--text-faint,#6d8ba3); margin-bottom:6px;}
.og-chips{display:flex; flex-wrap:wrap; gap:6px;}
.og-chips label{display:inline-flex; align-items:center; gap:6px; background:rgba(13,26,38,.8); border:1px solid var(--border,#16324a); border-radius:99px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; user-select:none; color:var(--text-dim,#9db3c4);}
.og-chips label:has(input:checked){border-color:var(--accent,#00e5c7); background:rgba(0,229,199,.1); color:#fff;}
.og-chips input{accent-color:var(--accent,#00e5c7); margin:0;}
.og-note{font-size:11.5px; color:var(--text-faint,#6d8ba3); margin-top:5px; line-height:1.45;}
.og-prev{display:flex; flex-direction:column; gap:10px; min-width:0;}
.og-stage{position:relative; border-radius:12px; border:1px solid var(--border,#16324a); overflow:hidden; min-height:150px; display:flex; align-items:center; justify-content:center; padding:10px;
  background:linear-gradient(135deg,#1d3b2a 0%,#2c4a33 35%,#3b3a2a 65%,#20303f 100%);}
.og-stage::after{content:'Vista previa sobre el juego'; position:absolute; right:8px; bottom:6px; font-size:10px; font-weight:700; color:rgba(255,255,255,.55); letter-spacing:.04em;}
.og-frame{overflow:hidden; flex-shrink:0;}
.og-stage iframe{border:none; background:transparent; display:block; transform-origin:0 0;}
.og-test{display:flex; gap:6px; flex-wrap:wrap;}
.og-btn{border:1px solid var(--border,#16324a); background:transparent; color:var(--text-dim,#9db3c4); border-radius:9px; padding:7px 12px; font:700 12.5px Inter,sans-serif; cursor:pointer;}
.og-btn:hover{border-color:var(--accent,#00e5c7); color:#fff;}
.og-btn.pri{background:var(--accent,#00e5c7); border-color:var(--accent,#00e5c7); color:#032018;}
.og-btn.pri:hover{box-shadow:0 0 14px rgba(0,229,199,.45);}
.og-url{display:flex; gap:6px;}
.og-url input{flex:1; min-width:0; background:#06111c; border:1px solid var(--border,#16324a); border-radius:9px; padding:8px 10px; color:#fff; font:600 12px ui-monospace,Menlo,Consolas,monospace; outline:none;}
.og-steps{margin:0; padding-left:18px; font-size:12.5px; line-height:1.6; color:var(--text-dim,#9db3c4);}
.og-steps b{color:#fff;}
@media (max-width:700px){ .og-body{grid-template-columns:1fr;} }
`;

const PANELS = [['rango', 'Rango + LP'], ['hoy', 'Resumen de hoy'], ['misiones', 'Misiones semanales']];
const ALERTS = [['liga', 'Subida/bajada de liga'], ['mision', 'Misión completada']];
const SIZES = [['0.8', 'Pequeño'], ['1', 'Normal'], ['1.25', 'Grande'], ['1.5', 'Muy grande']];
const SECS = ['6', '10', '15', '20'];

export function openOverlayGenerator({ id, name }) {
  if (!document.getElementById('og-style')) {
    const st = document.createElement('style'); st.id = 'og-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const chips = (name, list, type, checked) => list.map(([v, l]) =>
    `<label><input type="${type}" name="${name}" value="${v}" ${checked(v) ? 'checked' : ''}>${l}</label>`).join('');

  const bg = document.createElement('div');
  bg.className = 'og-bg';
  bg.innerHTML = `<div class="og" role="dialog" aria-modal="true" aria-labelledby="og-title">
    <div class="og-head"><div><h2 id="og-title">📺 Overlay para OBS</h2><small>${esc(name)} · se actualiza solo mientras juegas</small></div>
      <button class="og-x" type="button" aria-label="Cerrar">×</button></div>
    <div class="og-body">
      <div class="og-opts">
        <div class="og-f"><span>Qué muestra (va rotando)</span><div class="og-chips">${chips('p', PANELS, 'checkbox', () => true)}</div>
          <div class="og-note">Si las misiones están pausadas, ese panel se salta solo.</div></div>
        <div class="og-f"><span>Segundos por panel</span><div class="og-chips">${chips('seg', SECS.map(s => [s, s + ' s']), 'radio', v => v === '10')}</div></div>
        <div class="og-f"><span>Alertas animadas</span><div class="og-chips">${chips('a', ALERTS, 'checkbox', () => true)}</div></div>
        <div class="og-f"><span>"Hoy" cuenta</span><div class="og-chips">${chips('cola', [['soloq', 'Solo SoloQ'], ['todas', 'Todas las colas']], 'radio', v => v === 'soloq')}</div>
          <div class="og-note">Los LP siempre son de SoloQ.</div></div>
        <div class="og-f"><span>Tamaño</span><div class="og-chips">${chips('esc', SIZES, 'radio', v => v === '1')}</div></div>
      </div>
      <div class="og-prev">
        <div class="og-stage"><div class="og-frame"><iframe title="Vista previa del overlay"></iframe></div></div>
        <div class="og-test"><button class="og-btn" type="button" data-test="liga">Probar alerta de liga</button><button class="og-btn" type="button" data-test="mision">Probar alerta de misión</button></div>
        <div class="og-url"><input readonly aria-label="URL del overlay"><button class="og-btn pri" type="button" data-copy>Copiar URL</button></div>
        <ol class="og-steps">
          <li>En OBS: <b>+ Fuente → Navegador</b>.</li>
          <li>Pega la URL y pon <b>Ancho <span data-w></span></b> y <b>Alto <span data-h></span></b>.</li>
          <li>Colócalo donde quieras. El fondo ya es transparente.</li>
        </ol>
      </div>
    </div></div>`;
  document.body.appendChild(bg);

  const $ = (s) => bg.querySelector(s);
  const iframe = $('iframe');
  let lastUrl = '';
  function build() {
    const val = (n) => [...bg.querySelectorAll(`input[name="${n}"]:checked`)].map(i => i.value);
    const p = val('p'), a = val('a'), seg = val('seg')[0], cola = val('cola')[0], esc = val('esc')[0];
    const u = new URL('overlay.html', location.href);
    u.search = '';
    u.searchParams.set('jugador', id);
    if (p.length && p.length < PANELS.length) u.searchParams.set('paneles', p.join(','));
    if (seg !== '10') u.searchParams.set('seg', seg);
    if (a.length < ALERTS.length) u.searchParams.set('alertas', a.length ? a.join(',') : 'no');
    if (cola !== 'soloq') u.searchParams.set('cola', cola);
    if (esc !== '1') u.searchParams.set('escala', esc);
    const s = Number(esc);
    const w = Math.ceil(356 * s), h = Math.ceil(108 * s);
    $('[data-w]').textContent = w; $('[data-h]').textContent = h;
    $('.og-url input').value = u.href;
    $('[data-copy]').disabled = !p.length;
    if (u.href !== lastUrl) {
      lastUrl = u.href;
      iframe.width = w; iframe.height = h;
      const k = Math.min(1, ($('.og-stage').clientWidth - 20) / w);
      iframe.style.transform = k < 1 ? `scale(${k})` : '';
      $('.og-frame').style.width = `${Math.floor(w * k)}px`; $('.og-frame').style.height = `${Math.floor(h * k)}px`;
      iframe.src = p.length ? u.href : 'about:blank';
    }
  }
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', async (e) => {
    if (e.target === bg || e.target.closest('.og-x')) return close();
    const t = e.target.closest('[data-test]');
    if (t) iframe.contentWindow?.postMessage({ type: 'st-overlay-test', alert: t.dataset.test }, location.origin);
    const c = e.target.closest('[data-copy]');
    if (c) {
      const inp = $('.og-url input');
      try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand?.('copy'); }
      c.textContent = '✓ Copiada'; setTimeout(() => { c.textContent = 'Copiar URL'; }, 1800);
    }
  });
  bg.addEventListener('change', build);
  build();
  $('.og-x').focus();
  return { close };
}
