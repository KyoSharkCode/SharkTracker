// Esqueletos de carga (estilos en tema.css: .sk-stack / .sk / .sk-b).
// Dos formas de uso, ambas con el contenido real y su esqueleto apilados en la
// misma celda de un .sk-stack (fundido cruzado de 300 ms al llegar los datos):
//  1) <div class="sk">…</div> junto a un contenedor que el JS rellena: el esqueleto
//     se va cuando ese contenedor recibe sus primeros elementos (inicio, rewind).
//  2) <div class="sk" data-sk-de="main">…</div>: el esqueleto se va cuando el
//     elemento #main se hace visible (páginas con "cargando" + <main hidden>).
//     data-sk-error="id" → si se muestra ese aviso de error, el esqueleto se quita.
//     Si la página escribe un texto dentro del esqueleto (p. ej. un error), el
//     texto queda y el esqueleto deja de serlo.
// Se carga con un <script> normal justo antes del script principal de la página.
(() => {
  const visible = (el) => el && !el.hidden && el.style.display !== 'none';
  const fundir = (sk, real) => {
    if (sk.classList.contains('sk-sale')) return;
    sk.hidden = false;
    sk.classList.add('sk-sale');
    real?.classList.add('sk-entra');
    setTimeout(() => {
      sk.hidden = true;
      sk.classList.remove('sk-sale');
      real?.classList.remove('sk-entra');
    }, 320);
  };
  const todos = [];
  document.querySelectorAll('.sk').forEach((sk) => {
    const sigueSiendo = () => sk.classList.contains('sk') && sk.querySelector('.sk-b');
    if (sk.dataset.skDe) {
      const real = document.getElementById(sk.dataset.skDe);
      if (!real) return;
      let antes = visible(real);
      new MutationObserver(() => {
        const ahora = visible(real);
        if (ahora && !antes && sigueSiendo()) fundir(sk, real);
        antes = ahora;
      }).observe(real, { attributes: true, attributeFilter: ['hidden', 'style'] });
      const err = sk.dataset.skError && document.getElementById(sk.dataset.skError);
      if (err) new MutationObserver(() => { if (visible(err)) sk.hidden = true; })
        .observe(err, { attributes: true, attributeFilter: ['hidden', 'style'] });
      // La página reemplazó el esqueleto por un texto (error, "hacen falta 2 jugadores"…).
      new MutationObserver(() => { if (!sk.querySelector('.sk-b')) sk.classList.remove('sk', 'sk-pagina'); })
        .observe(sk, { childList: true });
      return; // aquí manda la página: el esqueleto ES su "cargando" (sin límite de tiempo)
    }
    const stack = sk.closest('.sk-stack');
    const real = stack?.querySelector(':scope > :not(.sk)');
    if (!real) return;
    const retirar = () => { if (!sk.hidden) { fundir(sk, real); setTimeout(() => sk.remove(), 330); } };
    const obs = new MutationObserver(() => { if (real.childElementCount) { obs.disconnect(); retirar(); } });
    obs.observe(real, { childList: true });
    todos.push(retirar);
  });
  // (Forma 1) El inicio avisa cuando terminó su primera carga: lo que siga vacío
  // suelta su esqueleto. Y por si la red falla, ninguno dura más de 15 s.
  const soltar = () => todos.forEach((f) => f());
  document.addEventListener('sharktracker:listo', soltar, { once: true });
  setTimeout(soltar, 15000);
})();
