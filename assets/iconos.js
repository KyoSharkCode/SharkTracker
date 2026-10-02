// ============================================================
// Íconos de interfaz de SharkTracker (rediseño visual, oct 2026).
// Reemplazan a los emoji: trazo de 2 px, viewBox 24×24 y toman el color
// del texto (o el que se pase). Para objetivos de LoL (dragón, barón,
// torre…) sigue estando assets/lol-icons.js.
//
// Uso:
//   import { icono } from './assets/iconos.js';
//   icono('corona')                              → <svg class="ico-svg">…</svg>
//   icono('fuego', { size: 16, color: '#ffb38a', title: 'Racha de victorias' })
// ============================================================

// Cada ícono: contenido del <svg> (trazos). `relleno: true` = figura rellena.
const ICONOS = {
  corona: { d: '<path d="M3 18h18l1.5-11-5.5 4-5-7-5 7L1.5 7z"/>', relleno: true },
  medalla: { d: '<circle cx="12" cy="14" r="6"/><path d="M8.5 2.5 12 8l3.5-5.5M9 14l2 2 4-4"/>' },
  espadas: { d: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>' },
  ojo: { d: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  mando: { d: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01"/>' },
  diana: { d: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>' },
  sube: { d: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>' },
  baja: { d: '<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>' },
  reloj: { d: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>' },
  gota: { d: '<path d="M12 3c3 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.5 6-11z"/>' },
  barras: { d: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  calavera: { d: '<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10 20v-2M14 20v-2"/>' },
  caparazon: { d: '<path d="M3 15c0-4.5 4-8 9-8s9 3.5 9 8z"/><path d="M8 15l1.5-4h5L16 15M12 7v4M2 15h20M6 15v3M18 15v3"/>' },
  manos: { d: '<path d="M11 17l2 2a1.4 1.4 0 0 0 2-2M14 14l2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a5 5 0 0 1 5.8-.9l.5.3a2 2 0 0 0 1.4.2L21 4M21 3l1 9-2 2M3 3l-1 9 6.5 6.5a1.4 1.4 0 0 0 2-2M3 4h8"/>' },
  espiga: { d: '<path d="M12 22V9M12 9c-3 0-5-2-5-5 3 0 5 2 5 5zM12 9c3 0 5-2 5-5-3 0-5 2-5 5zM12 15c-3 0-5-2-5-5 3 0 5 2 5 5zM12 15c3 0 5-2 5-5-3 0-5 2-5 5z"/>' },
  escudo: { d: '<path d="M12 3 4 6v6c0 4.5 3.3 8 8 9 4.7-1 8-4.5 8-9V6z"/>' },
  mano: { d: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 6.5a1.5 1.5 0 0 1 3 0V13M17 8.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5-2.1l-3.4-3.6a1.5 1.5 0 0 1 2.2-2.1L8 16"/>' },
  explosion: { d: '<path d="M12 2l1.8 5.2L19 5l-2.2 5.2L22 12l-5.2 1.8L19 19l-5.2-2.2L12 22l-1.8-5.2L5 19l2.2-5.2L2 12l5.2-1.8L5 5l5.2 2.2z"/>' },
  alto: { d: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M8 12h8"/>' },
  capas: { d: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5M2 17.5l10 5 10-5"/>' },
  fuego: { d: '<path d="M12 3c2 4 6 5 6 10a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-2-1-4 0-6z"/>' },
  copo: { d: '<path d="M12 2v20M4 7l16 10M20 7 4 17M9 3l3 3 3-3M9 21l3-3 3 3M3 10l3.5 1L5 14M21 10l-3.5 1L19 14M3 14l3.5-1L5 10M21 14l-3.5-1L19 10"/>' },
  amanecer: { d: '<path d="M3 18h18M5 14a7 7 0 0 1 14 0M12 3v4M4.2 7.2l2.1 2.1M19.8 7.2l-2.1 2.1M8 21h8"/>' },
  trofeo: { d: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>' },
  dado: { d: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/><circle cx="8.5" cy="15.5" r="1.3"/>' },
  bolsa: { d: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  regalo: { d: '<path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-2 0-4-1-4-3s3-2 4 3c1-5 4-5 4-3s-2 3-4 3z"/>' },
  grupo: { d: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.4 2.4 4 5.2"/>' },
  campana: { d: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>' },
  espada: { d: '<path d="M14.5 3H21v6.5L9 21.5 2.5 15z"/><path d="M5 18l-2 2M12 9l3 3"/>' },
  diente: { d: '<path d="M7 3c-2.5 0-4 2-4 5 0 4 2 5 2.5 9 .3 2.2 1 4 2.2 4 1.5 0 1.5-4 4.3-4s2.8 4 4.3 4c1.2 0 1.9-1.8 2.2-4 .5-4 2.5-5 2.5-9 0-3-1.5-5-4-5-2 0-3 1-5 1S9 3 7 3z"/>' },
  tienda: { d: '<path d="M4 9h16l-1.5-5h-13zM5 9v11h14V9M9 20v-6h6v6"/>' },
  mochila: { d: '<path d="M6 9a6 6 0 0 1 12 0v11H6z"/><path d="M9 5V3h6v2M9 14h6"/>' },
  lista: { d: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>' },
  insignia: { d: '<circle cx="12" cy="9" r="6"/><path d="M9 14l-2 7 5-3 5 3-2-7"/>' },
  candado: { d: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' },
  pantalla: { d: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>' },
  lapiz: { d: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  destello: { d: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>' },
  pelicula: { d: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>' },
  imagen: { d: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>' },
  twitch: { d: '<path d="M4 3h16v11l-4 4h-4l-3 3H7v-3H4z"/><path d="M11 7v4M15 7v4"/>' },
  intercambio: { d: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>' },
  dormir: { d: '<path d="M4 6h5l-5 6h5M13 3h4l-4 5h4M20 13a8 8 0 1 1-8-8"/>' },
  arriba: { d: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
  abajo: { d: '<path d="M12 5v14M19 12l-7 7-7-7"/>' },
  check: { d: '<path d="M5 12l5 5 9-10"/>' },
  ojo_tachado: { d: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>' },
  mareo: { d: '<circle cx="12" cy="12" r="9"/><path d="M8 9.5l2 1.5-2 1.5M16 9.5l-2 1.5 2 1.5M9 16.5c1-1 2-1 3 0s2 1 3 0"/>' },
  paleta: { d: '<path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-2 0-1.4-1.1-1.6-1.1-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.2-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>' },
  calendario: { d: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  estrella: { d: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/>' },
  aviso: { d: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>' },
  enlace: { d: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' },
  bandera: { d: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>' },
  diablo: { d: '<path d="M5 3l2.5 4.5M19 3l-2.5 4.5"/><circle cx="12" cy="13" r="7"/><path d="M9 12l1.5 1M15 12l-1.5 1M9.5 16.5c1.5 1 3.5 1 5 0"/>' },
  reloj_arena: { d: '<path d="M6 2h12M6 22h12M7 2v4l5 6 5-6V2M7 22v-4l5-6 5 6v4"/>' },
};

export const ICONO_NOMBRES = Object.keys(ICONOS);

export function icono(nombre, { size = 20, color = 'currentColor', title = '', clase = '' } = {}) {
  const ic = ICONOS[nombre];
  if (!ic) return '';
  const pintura = ic.relleno
    ? `fill="${color}" stroke="none"`
    : `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const t = title ? `<title>${String(title).replace(/[&<>"]/g, '')}</title>` : '';
  return `<svg class="ico-svg ${clase}" width="${size}" height="${size}" viewBox="0 0 24 24" ${pintura} ${title ? 'role="img"' : 'aria-hidden="true"'}>${t}${ic.d}</svg>`;
}
