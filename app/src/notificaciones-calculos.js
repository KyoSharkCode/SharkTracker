// Avisos de Windows (Ajustes → Notificaciones): convierte lo que llega de la base
// en los textos de cada aviso. Sin Electron: se prueba en Node.

const SITIO = 'https://sharktracker.lol/';

// Por qué ganaste dientes (wallet_tx.reason), como en la tienda de la web.
const MOTIVO = {
  mision: 'misión completada', grupal: 'misión grupal', top: 'tabla semanal', victoria: 'victoria',
  primera_victoria: 'primera victoria del día', perfecta: 'partida perfecta', pentakill: 'pentakill',
  partida_mes: 'partida del mes', reto: 'reto', reembolso: 'devolución', admin: 'ajuste de la admin',
};
const DIFICULTAD = { easy: 'fácil', medium: 'media', hard: 'difícil' };
const miles = (n) => Number(n ?? 0).toLocaleString('es-ES');
const puesto = (n) => `${n}.º`;

// Fecha y hora "de pared" en Madrid de un instante.
function enMadrid(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, dia: p.weekday };
}
// Cuánto va Madrid por delante de UTC en ese instante (1 h en invierno, 2 h en verano).
function desfaseMadrid(d) {
  const p = enMadrid(d);
  return Date.UTC(p.y, p.m, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}
// Hora de pared de Madrid → instante real (dos pasadas por si cae cerca del cambio de hora).
function paredMadrid(y, m, d, h) {
  const pared = Date.UTC(y, m, d, h);
  let t = pared - desfaseMadrid(new Date(pared));
  t = pared - desfaseMadrid(new Date(t));
  return new Date(t);
}

// Lunes a las 6:00 (hora de Madrid) de la semana de `fecha`: cuando se reinician
// las misiones (igual que mission_week_start() en la base).
function inicioSemana(fecha = new Date()) {
  const p = enMadrid(new Date(fecha.getTime() - 6 * 3600 * 1000)); // el "día" empieza a las 6:00
  const dias = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.dia];
  return paredMadrid(p.y, p.m, p.d - dias, 6);
}
const claveSemana = (d) => d.toISOString().slice(0, 10);

// ── Dientes ganados (se juntan en un solo aviso) y premios resueltos ──
function avisosDientes(movimientos = [], premios = []) {
  const avisos = [];
  const ganados = movimientos.filter((m) => m.amount > 0);
  if (ganados.length) {
    const total = ganados.reduce((t, m) => t + m.amount, 0);
    const motivos = [...new Set(ganados.map((m) => MOTIVO[m.reason] ?? m.reason))];
    avisos.push({
      tipo: 'dientes', titulo: `+${miles(total)} dientes`,
      cuerpo: `Por ${motivos.slice(0, 3).join(', ')}${motivos.length > 3 ? ' y más' : ''}.`,
      url: `${SITIO}tienda.html`,
    });
  }
  for (const p of premios) {
    if (p.status === 'entregado') {
      avisos.push({ tipo: 'dientes', titulo: 'Premio entregado', cuerpo: `${p.item_name}: la admin lo marcó como entregado.`, url: `${SITIO}tienda.html` });
    } else if (p.status === 'rechazado') {
      avisos.push({ tipo: 'dientes', titulo: 'Premio no disponible', cuerpo: `${p.item_name}: no se pudo entregar y te devolvimos los dientes.`, url: `${SITIO}tienda.html` });
    }
  }
  return avisos;
}

// ── Misiones completadas (tuyas) y misión grupal ──
function avisosMisiones(mias = [], grupales = []) {
  const avisos = [];
  if (mias.length === 1) {
    const m = mias[0];
    avisos.push({
      tipo: 'misiones', titulo: `Misión ${DIFICULTAD[m.tier] ?? ''} completada`.replace('  ', ' '),
      cuerpo: `${m.titulo ?? 'Misión semanal'}${m.puntos ? ` · +${m.puntos} pt${m.puntos === 1 ? '' : 's'}` : ''}`,
      url: SITIO,
    });
  } else if (mias.length > 1) {
    avisos.push({ tipo: 'misiones', titulo: `${mias.length} misiones completadas`, cuerpo: mias.map((m) => m.titulo).filter(Boolean).join(' · '), url: SITIO });
  }
  for (const g of grupales) {
    avisos.push({ tipo: 'misiones', titulo: 'Misión grupal completada', cuerpo: `${g.titulo ?? 'El grupo la terminó'}: hay dientes para quien jugó.`, url: SITIO });
  }
  return avisos;
}

// ── Retos: empieza uno / terminó uno (ganador y tu puesto si participaste) ──
function avisosRetos(empezados = [], terminados = []) {
  const avisos = [];
  for (const r of empezados) {
    avisos.push({ tipo: 'retos', titulo: `Empieza el reto: ${r.name}`, cuerpo: 'Sigue la clasificación en la web.', url: `${SITIO}reto.html?id=${r.id}` });
  }
  for (const r of terminados) {
    const partes = [r.ganador ? `Ganó ${r.ganador}` : 'Terminó sin ganador'];
    if (r.miPuesto) partes.push(`tú quedaste ${puesto(r.miPuesto)}`);
    avisos.push({ tipo: 'retos', titulo: `Terminó el reto: ${r.name}`, cuerpo: `${partes.join(' · ')}.`, url: `${SITIO}reto.html?id=${r.id}` });
  }
  return avisos;
}

// ── Resumen de tu semana (el lunes, de la semana que acaba de cerrar) ──
function avisoSemana({ misiones = 0, dientes = 0, top = null } = {}) {
  if (!misiones && !dientes && !top) return null;
  const partes = [];
  if (top) partes.push(`Top ${top} de la semana`);
  partes.push(`${misiones} misi${misiones === 1 ? 'ón' : 'ones'}`);
  if (dientes) partes.push(`+${miles(dientes)} dientes`);
  return { tipo: 'semana', titulo: 'Tu semana en SharkTracker', cuerpo: `${partes.join(' · ')}. Ya hay misiones nuevas.`, url: `${SITIO}tienda.html` };
}

// Como mucho `max` avisos por vuelta: si sobran, los últimos se juntan en uno.
function limitar(avisos, max = 4) {
  if (avisos.length <= max) return avisos;
  const quedan = avisos.slice(0, max - 1);
  const resto = avisos.slice(max - 1);
  quedan.push({ tipo: 'varios', titulo: `${resto.length} novedades más`, cuerpo: resto.map((a) => a.titulo).join(' · '), url: SITIO });
  return quedan;
}

module.exports = { inicioSemana, claveSemana, avisosDientes, avisosMisiones, avisosRetos, avisoSemana, limitar, SITIO, MOTIVO };
