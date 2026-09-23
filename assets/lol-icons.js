// ============================================================
// Íconos de objetivos de LoL — set propio de SharkTracker.
// SVG de un solo color (toman el color del texto / del equipo), así
// se ven igual en todas las páginas y no dependen de ninguna web externa.
//
// Uso:
//   import { lolIcon, LOL_ICON_NAMES } from './assets/lol-icons.js';
//   lolIcon('dragon')                          → <svg class="lol-ic">…</svg>
//   lolIcon('baron', { size: 18, color: '#4c9dff', title: 'Barón' })
//   lolIconSvg('tower', x, y, size, color)    → para dibujar DENTRO de otro <svg>
// ============================================================

// viewBox 0 0 24 24. fill-rule evenodd: los "huecos" (ojos, ventanas) salen transparentes.
const PATHS = {
  // Torre: base ancha, cuerpo, almenas y un cristal arriba.
  tower: 'M7 22h10v-2.2l-1.3-1.3V10.5l1.6-1.6V4.5h-2.1v1.8h-1.4V4.5h-1.6v1.8h-1.4V4.5H8.7v4.4l1.6 1.6v8l-1.3 1.3zM11 12h2v3h-2zM12 1l1.3 2h-2.6z',
  // Inhibidor: cristal rombo sobre pedestal.
  inhibitor: 'M12 2l5 7.5L12 17 7 9.5zM12 5.6L9.4 9.5 12 13.4l2.6-3.9zM5 19h14v3H5zM8 17.2h8V19H8z',
  // Nexo: cristal grande con facetas sobre base doble.
  nexus: 'M12 1l6.5 8.5L12 18 5.5 9.5zM12 4.4L8.1 9.5 12 14.6zM3 19.5h18V22H3zM6 17.8h12v1.7H6zM2.5 9.5L5 7l.9 2.5L5 12zM21.5 9.5L19 7l-.9 2.5L19 12z',
  // Dragón: cabeza de perfil con cuernos y mandíbula.
  dragon: 'M2.5 14.5c1.3-4.6 5.1-7.6 10-7.9l1.8-3.4.9 3.6 3.2-2.3-.9 3.9c2.3 1 3.9 2.9 4 5.1l-3.3.4-2.7 1.9h-3.1l-2.3 2.7-.6-2.6-3.5 3.5.4-4.1zM15.8 10.2a1.1 1.1 0 1 0 0 .01z',
  // Dragón Ancestral: dragón + corona de puntas.
  elder: 'M2.5 15c1.3-4.3 5-7.1 9.6-7.4l1.9-3.1.8 3.2 3.1-2-.8 3.6c2.2 1 3.7 2.8 3.9 4.9l-3.2.4-2.6 1.8h-3l-2.2 2.6-.6-2.5-3.4 3.4.4-3.9zM15.6 10.9a1 1 0 1 0 0 .01zM4 3.5l1.6 2.6L7.2 2.8l1.2 3.4 1.8-2.9.3 3.3H4.9z',
  // Barón Nashor: cabeza de serpiente frontal con cuernos y colmillos.
  baron: 'M12 4c4.2 0 7 2.9 7 6.6 0 2.7-1.5 4.8-3.6 5.9l-.9 5.5h-5l-.9-5.5C6.5 15.4 5 13.3 5 10.6 5 6.9 7.8 4 12 4zM9.2 10.2l2 1.4-.6 1.2-2.3-1.1zM14.8 10.2l-2 1.4.6 1.2 2.3-1.1zM10.6 16l.6 2.4h1.6l.6-2.4zM6.5 5.3L2.8 1.8l.8 4.9zM17.5 5.3l3.7-3.5-.8 4.9z',
  // Heraldo: ojo grande dentro de un caparazón.
  herald: 'M12 3.5c5.3 0 9.5 4.1 10 8.5-.5 4.4-4.7 8.5-10 8.5S2.5 16.4 2 12c.5-4.4 4.7-8.5 10-8.5zM12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 1 0 0-9.6zM12 9.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4z',
  // Larvas del Vacío: bichito con patas y antenas.
  grubs: 'M12 7.5c3.3 0 5.5 2.2 5.5 5.2S15.3 18.5 12 18.5s-5.5-2.8-5.5-5.8S8.7 7.5 12 7.5zM10.3 11.2a1 1 0 1 0 0 .01zM13.7 11.2a1 1 0 1 0 0 .01zM9 7.9L7.2 3.8l1.3-.4 1.9 3.9zM15 7.9l1.8-4.1-1.3-.4-1.9 3.9zM6.6 12.5l-3.8-1.2.4-1.3 3.9 1.1zM17.4 12.5l3.8-1.2-.4-1.3-3.9 1.1zM7.1 15.7l-3.4 2 .7 1.1 3.3-1.9zM16.9 15.7l3.4 2-.7 1.1-3.3-1.9z',
  // Atakhan: máscara de demonio con cuernos curvos.
  atakhan: 'M3 2.5c2 1.2 3.3 3 3.8 5h10.4c.5-2 1.8-3.8 3.8-5l-.9 7.6c-.3 5.9-3.7 10.3-8.1 11.4-4.4-1.1-7.8-5.5-8.1-11.4zM7.6 11.2l3.2 1.4-.4 1.6-3.3-.9zM16.4 11.2l-3.2 1.4.4 1.6 3.3-.9zM9.8 17h4.4l-2.2 2z',
  // Kills: espadas cruzadas.
  kills: 'M4.2 2.8l8.6 8.6-1.4 1.4-8.6-8.6V2.8zM19.8 2.8v1.4l-6 6-1.4-1.4 6-6zM6.7 14.1l3.2 3.2-1.8 1.8 1.3 1.3-1.4 1.4-1.3-1.3-2.2 2.2-1.4-1.4 2.2-2.2-1.3-1.3 1.4-1.4 1.3 1.3zM17.3 14.1l-3.2 3.2 1.8 1.8-1.3 1.3 1.4 1.4 1.3-1.3 2.2 2.2 1.4-1.4-2.2-2.2 1.3-1.3-1.4-1.4-1.3 1.3zM13.3 12.5l1.4 1.4-2 2-1.4-1.4z',
  // Oro: moneda.
  gold: 'M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18zM12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12zM12 8.2l3.2 3.8-3.2 3.8-3.2-3.8z',
};

export const LOL_ICON_NAMES = Object.keys(PATHS);

// Nombres de eventos de Riot → ícono.
export const RIOT_EVENT_ICON = {
  DRAGON: 'dragon', ELDER_DRAGON: 'elder', BARON_NASHOR: 'baron', RIFTHERALD: 'herald',
  HORDE: 'grubs', ATAKHAN: 'atakhan', TOWER: 'tower', INHIBITOR: 'inhibitor', NEXUS: 'nexus',
};

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ícono suelto para HTML.
export function lolIcon(name, { size = 16, color = 'currentColor', title = '', cls = '' } = {}) {
  const d = PATHS[name];
  if (!d) return '';
  return `<svg class="lol-ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" fill-rule="evenodd" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img"` : ''} style="display:inline-block;vertical-align:middle;flex-shrink:0">${title ? `<title>${escAttr(title)}</title>` : ''}<path d="${d}"/></svg>`;
}

// Ícono para meter dentro de otro <svg> (gráficas), centrado en (cx, cy).
export function lolIconSvg(name, cx, cy, size, color) {
  const d = PATHS[name];
  if (!d) return '';
  return `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" fill-rule="evenodd"><path d="${d}"/></svg>`;
}
