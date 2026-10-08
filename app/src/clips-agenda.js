// Agenda de clips (C2): junta las jugadas seguidas en un solo clip y decide cuándo
// guardarlo. Sin Electron (se prueba en Node con relojes cortos).
//
// Cada jugada (evento automático o Ctrl + F8) pide `antes` s previos y `despues` s
// siguientes. Si llega otra antes de que se guarde la anterior, se alarga el mismo
// clip (del primero − antes al último + después), con un tope de 2 min. El clip se
// guarda `despues` s después de la última jugada (+ un margen para que FFmpeg cierre
// el último trozo del búfer).

const TOPE = 120;      // segundos máximos de un clip
const MARGEN = 2500;   // ms para que se cierre el último trozo de 2 s

// alGuardar({ segundos, fin, etiquetas, manual, desde }) → Promise (lo guarda el motor).
// `fin`: hora (ms) en que termina el clip; `segundos`: cuánto dura hacia atrás.
function crearAgenda({ alGuardar, tope = TOPE, margen = MARGEN, reloj = () => Date.now() }) {
  let abierta = null;          // la jugada que todavía se puede alargar
  const agendadas = new Set();  // jugadas esperando su momento de guardarse
  const pendientes = new Set(); // guardados en curso (para esperar al terminar la partida)

  function disparar(c) {
    clearTimeout(c.timer);
    agendadas.delete(c);
    if (abierta === c) abierta = null;
    const fin = Math.min(c.hasta + c.despues * 1000, reloj());
    const segundos = Math.min(tope, Math.round(c.antes + Math.max(0, fin - c.desde) / 1000));
    const p = Promise.resolve()
      .then(() => alGuardar({ segundos, fin, etiquetas: c.etiquetas, manual: c.manual, desde: c.desde }))
      .catch(() => null)
      .finally(() => pendientes.delete(p));
    pendientes.add(p);
    return p;
  }

  function programar(c) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => disparar(c), Math.max(0, c.hasta + c.despues * 1000 + margen - reloj()));
  }

  // Una jugada: desde = cuándo empieza (la ulti, si hubo), hasta = cuándo pasó.
  // Devuelve 'nueva' o 'unida'.
  function marcar({ desde, hasta = desde, etiqueta, manual = false }, { antes, despues }) {
    const a = abierta;
    if (a && desde <= a.hasta + a.despues * 1000) {
      const nuevoDesde = Math.min(a.desde, desde);
      const nuevoHasta = Math.max(a.hasta, hasta);
      const total = a.antes + (nuevoHasta - nuevoDesde) / 1000 + Math.max(a.despues, despues);
      if (total <= tope) {
        a.desde = nuevoDesde;
        a.hasta = nuevoHasta;
        a.despues = Math.max(a.despues, despues);
        a.etiquetas.push(etiqueta);
        a.manual ||= manual;
        programar(a);
        return 'unida';
      }
      // Pasaría de 2 min: esa se guarda como está y empieza otra.
    }
    abierta = { desde, hasta, antes, despues, etiquetas: [etiqueta], manual, timer: null };
    agendadas.add(abierta);
    programar(abierta);
    return 'nueva';
  }

  // Al terminar la partida: lo que falte se guarda ya (con lo que haya grabado).
  async function vaciar() {
    for (const c of [...agendadas]) disparar(c);
    await Promise.all([...pendientes]);
  }

  // Al apagar los clips a mitad de partida: se descarta lo pendiente.
  function cancelar() {
    for (const c of agendadas) clearTimeout(c.timer);
    agendadas.clear();
    abierta = null;
  }

  return { marcar, vaciar, cancelar, ocupada: () => agendadas.size > 0 || pendientes.size > 0 };
}

module.exports = { crearAgenda, TOPE, MARGEN };
