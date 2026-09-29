// Íconos SVG de SharkTracker (mismo set que la web, assets/lol-icons.js).
// Un solo color: toman el color del texto (currentColor), así se tiñen por
// objetivo, por elemento del dragón o por equipo desde el CSS.
const ICONOS = {
  dragon: 'M2.5 14.5c1.3-4.6 5.1-7.6 10-7.9l1.8-3.4.9 3.6 3.2-2.3-.9 3.9c2.3 1 3.9 2.9 4 5.1l-3.3.4-2.7 1.9h-3.1l-2.3 2.7-.6-2.6-3.5 3.5.4-4.1zM15.8 10.2a1.1 1.1 0 1 0 0 .01z',
  elder: 'M2.5 15c1.3-4.3 5-7.1 9.6-7.4l1.9-3.1.8 3.2 3.1-2-.8 3.6c2.2 1 3.7 2.8 3.9 4.9l-3.2.4-2.6 1.8h-3l-2.2 2.6-.6-2.5-3.4 3.4.4-3.9zM15.6 10.9a1 1 0 1 0 0 .01zM4 3.5l1.6 2.6L7.2 2.8l1.2 3.4 1.8-2.9.3 3.3H4.9z',
  baron: 'M12 4c4.2 0 7 2.9 7 6.6 0 2.7-1.5 4.8-3.6 5.9l-.9 5.5h-5l-.9-5.5C6.5 15.4 5 13.3 5 10.6 5 6.9 7.8 4 12 4zM9.2 10.2l2 1.4-.6 1.2-2.3-1.1zM14.8 10.2l-2 1.4.6 1.2 2.3-1.1zM10.6 16l.6 2.4h1.6l.6-2.4zM6.5 5.3L2.8 1.8l.8 4.9zM17.5 5.3l3.7-3.5-.8 4.9z',
  herald: 'M12 3.5c5.3 0 9.5 4.1 10 8.5-.5 4.4-4.7 8.5-10 8.5S2.5 16.4 2 12c.5-4.4 4.7-8.5 10-8.5zM12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 1 0 0-9.6zM12 9.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4z',
  grubs: 'M12 7.5c3.3 0 5.5 2.2 5.5 5.2S15.3 18.5 12 18.5s-5.5-2.8-5.5-5.8S8.7 7.5 12 7.5zM10.3 11.2a1 1 0 1 0 0 .01zM13.7 11.2a1 1 0 1 0 0 .01zM9 7.9L7.2 3.8l1.3-.4 1.9 3.9zM15 7.9l1.8-4.1-1.3-.4-1.9 3.9zM6.6 12.5l-3.8-1.2.4-1.3 3.9 1.1zM17.4 12.5l3.8-1.2-.4-1.3-3.9 1.1zM7.1 15.7l-3.4 2 .7 1.1 3.3-1.9zM16.9 15.7l3.4 2-.7 1.1-3.3-1.9z',
  tower: 'M7 22h10v-2.2l-1.3-1.3V10.5l1.6-1.6V4.5h-2.1v1.8h-1.4V4.5h-1.6v1.8h-1.4V4.5H8.7v4.4l1.6 1.6v8l-1.3 1.3zM11 12h2v3h-2zM12 1l1.3 2h-2.6z',
  inhibitor: 'M12 2l5 7.5L12 17 7 9.5zM12 5.6L9.4 9.5 12 13.4l2.6-3.9zM5 19h14v3H5zM8 17.2h8V19H8z',
  stats: 'M3 20h18v2H3zM4.5 12h3.2v6.5H4.5zM10.4 7.5h3.2v11h-3.2zM16.3 3h3.2v15.5h-3.2z',
};

// Devuelve un <svg> listo para insertar (construido con DOM, sin innerHTML).
function icono(nombre, tamano = 18) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', tamano);
  svg.setAttribute('height', tamano);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', ICONOS[nombre] ?? ICONOS.dragon);
  svg.append(path);
  return svg;
}
