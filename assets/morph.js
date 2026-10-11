// ============================================================
// morph(): actualiza un contenedor con HTML nuevo SIN reemplazar los
// elementos que ya existen. Así las transiciones CSS se ven (un cambio de
// clase anima en vez de "saltar"), el foco del teclado se conserva y los
// <details> abiertos siguen abiertos.
//
// · data-key="…"        empareja elementos aunque cambien de orden (filas que se reordenan);
//                        si cambia la etiqueta (<div> → <button>), el elemento se reemplaza.
// · data-morph-skip     no toca los hijos de ese elemento (SVG dibujado a mano,
//                        números que se animan desde JS).
// · Los <input> conservan lo que se escribió, salvo que su valor cambie desde fuera.
//
// Uso:  import { morph } from './assets/morph.js';
//       morph(document.getElementById('board'), html);
// ============================================================

export function morph(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}

const keyOf = (n) => n.nodeType === 1 ? n.getAttribute('data-key') : null;

function patchChildren(a, b) {
  const keyed = new Map();
  for (const c of a.children) { const k = keyOf(c); if (k) keyed.set(k, c); }
  const next = [...b.childNodes];
  let i = 0;
  for (const nb of next) {
    const cur = a.childNodes[i] ?? null;
    const k = keyOf(nb);
    if (k) {
      const match = keyed.get(k);
      if (match && match.nodeName === nb.nodeName) {
        if (match !== cur) a.insertBefore(match, cur);
        patch(match, nb);
        keyed.delete(k);
      } else if (match) {
        // Cambió de etiqueta (p. ej. un <div> que pasa a ser <button>): se reemplaza, no se parchea
        a.insertBefore(nb.cloneNode(true), cur);
        match.remove();
        keyed.delete(k);
      } else {
        a.insertBefore(nb.cloneNode(true), cur);
      }
    } else if (cur && !keyOf(cur) && cur.nodeType === nb.nodeType && cur.nodeName === nb.nodeName) {
      patch(cur, nb);
    } else {
      a.insertBefore(nb.cloneNode(true), cur);
    }
    i++;
  }
  while (a.childNodes.length > next.length) a.lastChild.remove();
}

function patch(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  const oldValue = a.nodeName === 'INPUT' ? a.getAttribute('value') : null;
  // Atributos
  for (const { name } of [...a.attributes]) {
    if (!b.hasAttribute(name) && !(name === 'open' && a.nodeName === 'DETAILS')) a.removeAttribute(name);
  }
  for (const { name, value } of b.attributes) {
    if (name === 'open' && a.nodeName === 'DETAILS') continue;   // lo decide quien lo abrió
    if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  if (a.nodeName === 'INPUT') {
    // Solo se pisa lo escrito si el valor cambió de verdad (p. ej. llegó del servidor) y no se está escribiendo
    const v = b.getAttribute('value');
    if (document.activeElement !== a && v !== oldValue) a.value = v ?? '';
    if (a.type === 'checkbox') a.checked = b.hasAttribute('checked');
    return;
  }
  if (a.hasAttribute('data-morph-skip')) return;
  patchChildren(a, b);
}
