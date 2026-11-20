// Voz del coach: el lector de pantalla de Windows (gratis, sin conexión), a través de
// speechSynthesis de Chromium. Lo cargan el overlay (habla en partida) y la ventana
// de la app (botón "Probar voz" de Ajustes → Coach).
(function () {
  const sintesis = window.speechSynthesis;
  const entre = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));

  // Voces instaladas en Windows. La lista llega un momento después de abrir la ventana.
  function voces() {
    return (sintesis?.getVoices() ?? []).filter((v) => v.localService !== false)
      .map((v) => ({ nombre: v.name, idioma: v.lang }));
  }

  // voz: nombre de la voz ('' = la primera en español). volumen 0–100. velocidad 70–150 (100 = normal).
  function decir(texto, { voz = '', volumen = 80, velocidad = 100 } = {}) {
    if (!sintesis || !texto) return false;
    const frase = new SpeechSynthesisUtterance(String(texto));
    const lista = sintesis.getVoices();
    const elegida = lista.find((v) => v.name === voz) ?? lista.find((v) => /^es/i.test(v.lang)) ?? null;
    if (elegida) { frase.voice = elegida; frase.lang = elegida.lang; } else frase.lang = 'es-MX';
    frase.volume = entre(volumen, 0, 100) / 100;
    frase.rate = entre(velocidad, 70, 150) / 100;
    sintesis.cancel(); // si quedaba una frase a medias, manda la nueva
    sintesis.speak(frase);
    return true;
  }

  sintesis?.getVoices(); // que Chromium vaya cargando la lista
  window.vozCoach = {
    voces,
    decir,
    callar: () => sintesis?.cancel(),
    alCambiarVoces: (callback) => sintesis?.addEventListener('voiceschanged', callback),
  };
})();
