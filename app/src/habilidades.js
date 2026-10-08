// Qué habilidad subir ahora (overlay en partida). Sin Electron: se prueba en Node.
//
// La API del juego (activePlayer) da tu nivel y el nivel de cada habilidad.
// Si tienes un punto sin gastar, toca la habilidad que va atrasada respecto al
// orden de OP.GG (ficha de Meta → habilidades.orden, una letra por nivel). Lo que
// no se puede subir ahora (la R antes del 6, una básica al máximo para tu nivel)
// se salta.

const TECLAS = ['Q', 'W', 'E', 'R'];

// Máximo de puntos que puede tener cada habilidad a este nivel.
function maximo(tecla, nivel) {
  if (tecla === 'R') return [6, 11, 16].filter((n) => nivel >= n).length;
  return Math.min(5, Math.ceil(nivel / 2));
}

// activePlayer: { level, abilities: { Q: { abilityLevel }, … } }
// orden: ['Q', 'E', 'W', 'Q', …] (hasta 18). Devuelve null si no hay punto que gastar.
function siguienteHabilidad(activePlayer, orden) {
  const nivel = Number(activePlayer?.level) || 0;
  const hab = activePlayer?.abilities ?? {};
  if (!nivel || !Array.isArray(orden) || !orden.length) return null;
  const puntos = Object.fromEntries(TECLAS.map((k) => [k, Number(hab[k]?.abilityLevel) || 0]));
  const gastados = TECLAS.reduce((s, k) => s + puntos[k], 0);
  if (gastados >= nivel) return null;
  const sePuede = (k) => TECLAS.includes(k) && puntos[k] < maximo(k, nivel);
  // Se recorre el orden contando cuántos puntos pide cada habilidad hasta ahí: la primera
  // que va atrasada (y se puede subir) es la que toca. Así, si te desviaste del orden
  // (subiste otra antes), igual te señala la que quedó pendiente.
  const pedidos = { Q: 0, W: 0, E: 0, R: 0 };
  let tecla = null;
  for (const k of orden) {
    if (!TECLAS.includes(k)) continue;
    pedidos[k]++;
    if (pedidos[k] > puntos[k] && sePuede(k)) { tecla = k; break; }
  }
  tecla = tecla ?? TECLAS.find(sePuede);
  if (!tecla) return null;
  return { tecla, nivel, pendientes: nivel - gastados, puntos };
}

module.exports = { siguienteHabilidad, maximo, TECLAS };
