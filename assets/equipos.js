// ============================================================
// Equipos de esports (Pickems): sigla y logo a partir del nombre.
//
// Los logos van en assets/equipos/<archivo>.webp (cuadrados de 160 px, fondo
// transparente y en colores que se lean sobre el fondo oscuro de la web).
// Si un archivo todavía no existe, se muestra la sigla en su lugar. El nombre se compara sin
// mayúsculas, tildes ni espacios, así que "Cloud9 Kia" y "cloud9" valen igual.
//
// Uso:  import { equipo } from './assets/equipos.js';
//       equipo('Karmine Corp')  → { code: 'KC', logo: 'assets/equipos/karmine-corp.webp' }
// ============================================================

const EQUIPOS = [
  { code: 'FUR', file: 'furia',        names: ['furia', 'furiaesports'] },
  { code: 'MVK', file: 'mvk',          names: ['mvk', 'mvkesports'] },
  { code: 'C9',  file: 'cloud9',       names: ['c9', 'cloud9', 'cloud9kia'] },
  { code: 'KC',  file: 'karmine-corp', names: ['kc', 'karmine', 'karminecorp'] },
  // Worlds 2026 · Fase suiza
  { code: 'GEN',  file: 'gen-g',              names: ['gen', 'geng'] },
  { code: 'IG',   file: 'invictus-gaming',    names: ['ig', 'invictus', 'invictusgaming'] },
  { code: 'TLAW', file: 'team-liquid',        names: ['tl', 'tlaw', 'teamliquid', 'teamliquidalienware'] },
  { code: 'CFO',  file: 'ctbc-flying-oyster', names: ['cfo', 'flyingoyster', 'ctbcflyingoyster'] },
  { code: 'AL',   file: 'anyones-legend',     names: ['al', 'anyoneslegend'] },
  { code: 'G2',   file: 'g2-esports',         names: ['g2', 'g2esports'] },
  { code: 'DK',   file: 'dplus-kia',          names: ['dk', 'dplus', 'dpluskia'] },
  { code: 'HLE',  file: 'hanwha-life',        names: ['hle', 'hanwha', 'hanwhalife', 'hanwhalifeesports'] },
  { code: 'TES',  file: 'top-esports',        names: ['tes', 'topesports'] },
  { code: 'LOS',  file: 'los',                names: ['los'] },
  { code: 'T1',   file: 't1',                 names: ['t1'] },
  { code: 'TSW',  file: 'team-secret-whales', names: ['tsw', 'teamsecretwhales'] },
  { code: 'LYON', file: 'lyon',               names: ['lyon', 'lyongaming'] },
  { code: 'BLG',  file: 'bilibili-gaming',    names: ['blg', 'bilibili', 'bilibiligaming'] },
  { code: 'MKOI', file: 'movistar-koi',       names: ['mkoi', 'koi', 'movistarkoi'] },
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_NAME = new Map(EQUIPOS.flatMap(e => e.names.map(n => [n, e])));

// Equipo conocido → { code, logo }. Hueco del bracket ("Ganador FUR/MVK") o equipo sin registrar → null.
export function equipo(nombre) {
  const e = BY_NAME.get(norm(nombre));
  return e ? { code: e.code, logo: `assets/equipos/${e.file}.webp` } : null;
}
