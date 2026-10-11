// ============================================================
// Lógica del bracket de Pickems (igual que las funciones pickem_* de la base),
// compartida por pickems.html y admin.html.
//
// Una serie tiene equipos fijos (team1/team2) o los recibe de otra serie:
// src1_match + src1_win (true = el ganador, false = el perdedor).
//
// Uso:  const b = createBracket(matches);
//       b.actual(m, 1)            → equipo real del lado 1 (o null si aún no se sabe)
//       b.winner(m)               → ganador real (o null)
//       b.mine(picks, m, 2)       → equipo del lado 2 en el bracket de un jugador
//       b.placeholder(m, 1)       → "Ganador FUR/MVK", "Perdedor Final de ganadores"…
// ============================================================
import { equipo } from './equipos.js';

export function createBracket(matches) {
  const byId = new Map(matches.map(m => [m.id, m]));
  const hasResult = (m) => m?.score1 != null && m?.score2 != null;

  function actual(m, slot) {
    const fixed = slot === 1 ? m.team1 : m.team2;
    if (fixed) return fixed;
    const src = byId.get(slot === 1 ? m.src1_match : m.src2_match);
    if (!src || !hasResult(src)) return null;
    const wantWin = slot === 1 ? m.src1_win : m.src2_win;
    return actual(src, (src.score1 > src.score2) === wantWin ? 1 : 2);
  }
  const winner = (m) => hasResult(m) ? actual(m, m.score1 > m.score2 ? 1 : 2) : null;

  // picks: Map match_id → equipo elegido por ESE jugador
  function mine(picks, m, slot) {
    const fixed = slot === 1 ? m.team1 : m.team2;
    if (fixed) return fixed;
    const src = byId.get(slot === 1 ? m.src1_match : m.src2_match);
    const pick = src ? picks.get(src.id) : null;
    if (!pick) return null;
    if (slot === 1 ? m.src1_win : m.src2_win) return pick;
    const a = mine(picks, src, 1), b = mine(picks, src, 2);
    return pick === a ? b : a;
  }

  const short = (t) => equipo(t)?.code ?? t;
  function placeholder(m, slot) {
    const src = byId.get(slot === 1 ? m.src1_match : m.src2_match);
    if (!src) return '';
    const a = actual(src, 1), b = actual(src, 2);
    const desc = a && b ? `${short(a)}/${short(b)}` : (src.label ?? 'serie anterior');
    return `${(slot === 1 ? m.src1_win : m.src2_win) ? 'Ganador' : 'Perdedor'} ${desc}`;
  }

  return { byId, hasResult, actual, winner, mine, placeholder };
}

// Marcadores posibles de una serie al mejor de N, del lado del equipo 1 al del 2 (BO3 → 2-0, 2-1, 1-2, 0-2)
export function scoreOptions(bo) {
  const w = (bo + 1) / 2, out = [];
  for (let l = 0; l < w; l++) out.push([w, l]);
  for (let l = w - 1; l >= 0; l--) out.push([l, w]);
  return out;
}

export const MIN_BET = 10;    // igual que pickem_min_bet() en la base
export const MAX_BET = 500;   // igual que pickem_max_bet()
