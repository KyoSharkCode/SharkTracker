// ============================================================
// Franja de Pickems para la portada: aparece debajo de la cabecera solo
// cuando hay algo que hacer, y se puede cerrar (se recuerda por fase).
//   · Una fase abierta → cuenta atrás, premio y "Armar mi bracket" (con tu progreso).
//   · Si no, una apuesta abierta → "Apuesta abierta: C9 vs KC".
// Si no hay nada de eso, no se muestra nada.
//
// Uso:  import { createPickemsBanner } from './assets/pickems-banner.js';
//       createPickemsBanner({ supabase });
// ============================================================
import { equipo } from './equipos.js';
import { createBracket } from './pickems.js';

const CSS = `
.pkb{position:relative; overflow:hidden; isolation:isolate; display:flex; align-items:center; gap:16px; margin:0 0 26px; padding:16px 18px 16px 20px;
  border-radius:16px; background:var(--panel,#08202C); border:1px solid rgba(61,255,210,.35); color:var(--text,#E6FBF8); font-family:'Albert Sans',system-ui,sans-serif;
  animation:pkb-in 380ms cubic-bezier(0.23,1,0.32,1) both;}
@keyframes pkb-in{ from{opacity:0; transform:translateY(-8px);} }
.pkb.out{animation:pkb-out 200ms ease-in forwards;}
@keyframes pkb-out{ to{opacity:0; transform:translateY(-6px);} }
.pkb-bg{position:absolute; inset:0 0 0 35%; z-index:-1; background-size:cover; background-repeat:no-repeat; opacity:.45;
  -webkit-mask-image:linear-gradient(90deg, transparent, #000 60%); mask-image:linear-gradient(90deg, transparent, #000 60%);}
.pkb-bg::after{content:''; position:absolute; inset:0; background:linear-gradient(90deg, rgba(8,32,44,.3), rgba(8,32,44,.75));}
.pkb-logos{display:flex; flex-shrink:0;}
.pkb-logos span{position:relative; width:34px; height:34px; border-radius:9px; background:var(--panel-2,#0A2533); box-shadow:0 0 0 2px var(--panel,#08202C);
  display:flex; align-items:center; justify-content:center; font:600 11px 'Red Hat Mono',ui-monospace,monospace; color:var(--text-soft,#C9ECE8);}
.pkb-logos span + span{margin-left:-8px;}
.pkb-logos img{position:absolute; inset:0; width:100%; height:100%; padding:3px; box-sizing:border-box; object-fit:contain; border-radius:inherit; background:var(--panel-2,#0A2533);}
.pkb-logos span:has(img) b{visibility:hidden;}
.pkb-txt{flex:1; min-width:0;}
.pkb-txt b{display:block; font-family:'Unbounded',sans-serif; font-size:15px; font-weight:700; line-height:1.3;}
.pkb-txt small{display:block; margin-top:3px; font-size:13px; color:var(--text-soft,#C9ECE8);}
.pkb-txt small i{font-style:normal; font-family:'Red Hat Mono',ui-monospace,monospace; font-weight:600; color:var(--text,#E6FBF8); white-space:nowrap;}
.pkb-prog{flex-shrink:0; font:600 12px 'Red Hat Mono',ui-monospace,monospace; padding:4px 9px; border-radius:99px; background:rgba(3,17,26,.6); color:var(--accent,#3DFFD2);}
.pkb-prog.full{color:var(--gold,#FFB547);}
.pkb-cta{flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:8px 16px; border-radius:10px; background:var(--accent,#3DFFD2); color:var(--on-accent,#03111A);
  font:800 13.5px 'Albert Sans',system-ui,sans-serif; text-decoration:none; white-space:nowrap; transition:transform 140ms cubic-bezier(0.23,1,0.32,1);}
.pkb-cta:active{transform:scale(0.97);}
.pkb-x{flex-shrink:0; width:44px; height:44px; margin:-8px -10px -8px -6px; border:none; background:none; color:var(--text-faint,#7FAFAD); font-size:22px; line-height:1; cursor:pointer; border-radius:10px; transition:color 150ms ease;}
.pkb-x:hover{color:var(--text,#E6FBF8);}
@media (max-width:640px){
  .pkb{flex-wrap:wrap; gap:12px; padding:14px;}
  .pkb-bg{inset:0; opacity:.22; -webkit-mask-image:none; mask-image:none;}
  .pkb-txt{flex-basis:calc(100% - 140px);}
  .pkb-cta{flex:1;}
  .pkb-x{position:absolute; top:8px; right:8px; margin:0;}
}
@media (prefers-reduced-motion: reduce){ .pkb{animation-name:pkb-fade;} .pkb.out{animation-name:pkb-fade-out;} .pkb-cta:active{transform:none;}
  @keyframes pkb-fade{ from{opacity:0;} } @keyframes pkb-fade-out{ to{opacity:0;} } }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageOf = (n) => { const i = n.indexOf(' · '); return i < 0 ? n : n.slice(i + 3); };
const pad = (n) => String(n).padStart(2, '0');
function countdown(target) {
  const d = Math.max(0, target - Date.now());
  const days = Math.floor(d / 86400000), h = Math.floor(d / 3600000) % 24, m = Math.floor(d / 60000) % 60, s = Math.floor(d / 1000) % 60;
  return `${days > 0 ? `${days} d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}
const getHidden = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const setHidden = (k) => { try { localStorage.setItem(k, '1'); } catch { /* sin almacenamiento: se cierra solo por ahora */ } };

export async function createPickemsBanner({ supabase, anchor = '.wrap > header' }) {
  const where = document.querySelector(anchor);
  if (!where) return;
  const now = Date.now();
  const { data: events } = await supabase.from('pickem_events').select('*').is('finished_at', null);
  const evs = (events ?? []).filter(e => !e.opens_at || new Date(e.opens_at).getTime() <= now);
  if (!evs.length) return;
  const { data: matches } = await supabase.from('pickem_matches').select('*').in('event_id', evs.map(e => e.id)).order('sort').order('id');
  const ms = matches ?? [];

  // 1) Fase abierta (la que cierra antes) con series
  const open = evs.filter(e => new Date(e.locks_at).getTime() > now && ms.some(m => m.event_id === e.id))
    .sort((a, b) => new Date(a.locks_at) - new Date(b.locks_at))[0];
  let view = null;
  if (open) {
    const em = ms.filter(m => m.event_id === open.id);
    const max = em.reduce((a, m) => a + m.points, 0);
    // Tu progreso (si tienes la cuenta vinculada)
    let mine = null;
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: me } = await supabase.from('players').select('id').eq('user_id', session.user.id).maybeSingle();
      if (me) {
        const { count } = await supabase.from('pickem_picks').select('match_id', { count: 'exact', head: true })
          .eq('player_id', me.id).in('match_id', em.map(m => m.id));
        mine = count ?? 0;
      }
    }
    const teams = [...new Set(em.flatMap(m => [m.team1, m.team2]).filter(Boolean))].slice(0, 4);
    view = {
      key: `pkb-hide-${open.id}-abierto`, ev: open, teams,
      title: `Pickems · ${stageOf(open.name)}`,
      sub: () => `Cierra en <i data-pkb-count="${new Date(open.locks_at).getTime()}">${countdown(new Date(open.locks_at).getTime())}</i> · Hasta 🦷 ${max} y ${esc(open.perfect_prize)}`,
      prog: mine == null ? null : { n: mine, total: em.length },
      cta: mine == null ? 'Ver Pickems' : mine === em.length ? 'Revisar mi bracket' : 'Armar mi bracket',
      href: `pickems.html?id=${open.id}`,
    };
  } else {
    // 2) Apuesta abierta (equipos conocidos, sin resultado, sin cerrar)
    for (const e of evs) {
      const br = createBracket(ms.filter(m => m.event_id === e.id));
      const m = ms.find(x => x.event_id === e.id && x.bets_enabled && x.score1 == null && !x.bets_closed_at
        && (!x.starts_at || new Date(x.starts_at).getTime() > now) && br.actual(x, 1) && br.actual(x, 2));
      if (!m) continue;
      const t1 = br.actual(m, 1), t2 = br.actual(m, 2);
      view = {
        key: `pkb-hide-${e.id}-apuesta-${m.id}`, ev: e, teams: [t1, t2],
        title: `Apuesta abierta: ${t1} vs ${t2}`,
        sub: () => `${esc(m.label ?? 'Serie')} de ${esc(stageOf(e.name))}${m.starts_at ? ` · Cierra en <i data-pkb-count="${new Date(m.starts_at).getTime()}">${countdown(new Date(m.starts_at).getTime())}</i>` : ''} · Los que aciertan se reparten el bote`,
        prog: null, cta: 'Apostar', href: `pickems.html?id=${e.id}`,
      };
      break;
    }
  }
  if (!view || getHidden(view.key)) return;

  if (!document.getElementById('pkb-style')) {
    const st = document.createElement('style'); st.id = 'pkb-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('aside');
  el.className = 'pkb';
  el.setAttribute('aria-label', 'Pickems');
  const bg = view.ev.bg_image ? `<span class="pkb-bg" aria-hidden="true" style="background-image:url('${esc(view.ev.bg_image)}'); background-position:${esc(view.ev.bg_focus ?? '50% 35%')}"></span>` : '';
  el.innerHTML = `${bg}
    ${view.teams.length ? `<span class="pkb-logos" aria-hidden="true">${view.teams.map(t => { const q = equipo(t);
      return `<span><b>${esc(q?.code ?? t.slice(0, 3).toUpperCase())}</b>${q ? `<img src="${q.logo}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>`; }).join('')}</span>` : ''}
    <div class="pkb-txt"><b>${esc(view.title)}</b><small>${view.sub()}</small></div>
    ${view.prog ? `<span class="pkb-prog ${view.prog.n === view.prog.total ? 'full' : ''}" title="Elecciones hechas">${view.prog.n}/${view.prog.total}</span>` : ''}
    <a class="pkb-cta" href="${view.href}">${view.cta}</a>
    <button class="pkb-x" type="button" aria-label="Ocultar este aviso">×</button>`;
  where.after(el);

  const timer = setInterval(() => {
    const c = el.querySelector('[data-pkb-count]');
    if (!c) return;
    const target = Number(c.dataset.pkbCount);
    if (target <= Date.now()) { clearInterval(timer); el.remove(); return; }   // cerró: el aviso ya no tiene sentido
    c.textContent = countdown(target);
  }, 1000);
  el.querySelector('.pkb-x').addEventListener('click', () => {
    setHidden(view.key);
    clearInterval(timer);
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  });
}
