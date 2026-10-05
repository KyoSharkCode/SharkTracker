// Esqueletos de carga (estilos en tema.css: .sk-stack / .sk / .sk-b).
// Cada .sk-stack apila en la misma celda el contenido real (vacío al cargar) y
// su esqueleto (.sk). En cuanto el contenido real recibe sus primeros datos,
// fundido cruzado de 300 ms: el esqueleto se va mientras el contenido entra.
// Se carga con un <script> normal justo antes del script principal de la página.
(() => {
  const stacks = [...document.querySelectorAll('.sk-stack')];
  const retirar = (stack) => {
    const sk = stack.querySelector(':scope > .sk');
    if (!sk || sk.classList.contains('sk-sale')) return;
    const real = stack.querySelector(':scope > :not(.sk)');
    real?.classList.add('sk-entra');
    sk.classList.add('sk-sale');
    setTimeout(() => { sk.remove(); real?.classList.remove('sk-entra'); }, 320);
  };
  stacks.forEach((stack) => {
    const real = stack.querySelector(':scope > :not(.sk)');
    if (!real) return;
    const obs = new MutationObserver(() => {
      if (real.childElementCount) { obs.disconnect(); retirar(stack); }
    });
    obs.observe(real, { childList: true });
  });
  // La página avisa cuando terminó la primera carga: lo que siga vacío (una sección sin
  // datos) también suelta su esqueleto. Y por si la red falla, nunca más de 15 s.
  const todos = () => stacks.forEach(retirar);
  document.addEventListener('sharktracker:listo', todos, { once: true });
  setTimeout(todos, 15000);
})();
