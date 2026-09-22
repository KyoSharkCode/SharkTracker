# perfil.html — pendientes para retomar

Pausa del 2026-09-22. Acá queda todo lo que se definió para el `perfil.html` nuevo, más lo que falta decidir antes de construirlo. Cuando volvamos, arrancar leyendo esto en vez de repetir el análisis.

**Contexto:** se armaron 2 mockups funcionales (conectados a Supabase real) como punto de partida — `perfil-mockup-a.html` (ficha vertical, retrato) y `perfil-mockup-b.html` (banner horizontal). KyoSumi los tomó como base y mandó un rediseño (screenshot con anotaciones en rojo) que mezcla ideas de ambos. El `perfil.html` final se construye sobre ESE rediseño, no sobre A ni B tal cual.

---

## 1. Layout confirmado (del rediseño con anotaciones)

- **Hero**: splash del campeón favorito como banner horizontal (no vertical). Overlay con avatar, nombre + tag, flechita (ver punto 2), rol principal y rango/LP. Badge "#N en el Ranking" arriba a la derecha de la imagen.
- **Columna de "tags destacados"**: al lado del hero (no debajo, no como tira horizontal).
- **Caja de Stream vs. caja de partida en vivo — son DOS componentes separados**, no uno solo como se había hecho en los mockups A/B:
  - Caja de Stream: solo se renderiza si está en vivo en Twitch (misma lógica que index.html — si no está en stream, no ocupa espacio).
  - Barra de estado de partida ("OFFLINE" / en cola / en partida): siempre visible.
- **Grid de 3 stats**: Top 3 Maestrías / Top Campeones (SoloQ) / Roles más jugados — sin cambios respecto a los mockups.
- **Historial con tabs por cola** (nuevo, ninguno de los 2 mockups lo tenía): SoloQ / Flex / Reclutamiento / Otros.

## 2. Flecha junto al nombre (la puso Claude en los mockups originales, pero con lógica distinta)

Sigue la idea de la flecha de tendencia de index.html, PERO con ventana propia: mira las **últimas 10 partidas de SoloQ** (no las últimas 5 de todas las colas). Más victorias que derrotas → verde/arriba. Más derrotas → roja/abajo. Empate → sin flecha (mismo criterio que index.html).

## 3. Mapeo de tabs de historial → colas reales (confirmado contra `QUEUE_NAMES` en el código)

| Tab | queue_id(s) | queue_type guardado |
|---|---|---|
| SoloQ | 420 | `Solo/Duo` |
| Flex | 440 | `Flex` |
| Reclutamiento | 400 | `Reclutamiento` (= Normal Draft) |
| Otros | 490, 430, 450, 700, 1700/1710/1720, y cualquier no mapeado | Partida Rápida, LoL Classic, ARAM, Clash, Arena, "Modo Destacado" |

## 4. Badges — chequeado contra `old/perfil.html` vs. lo que ya calcula v2

Casi todo ya existe en `weekly_badges` / `compute_recent_badges()` y se puede traer filtrado por jugador, igual que hace index.html — **incluyendo "Rey de la Temporada"** (categoría `rey_temporada`, 👑 días en el #1), que en un primer análisis pensé que faltaba y no era así.

**Gaps reales encontrados (requieren cambio de backend, no solo de `perfil.html`):**
- **"Ciego"** (partidas sin ward de control): el dato (`wards_control`) ya se guarda por partida, pero no hay ninguna regla de badge que lo compute todavía.
- **"Top 1/2/3 del Torneo"** (podio final de temporada): no existe nada parecido en el backend — probablemente se define manualmente al cerrar el reto, no se puede derivar de datos en vivo.

**❓ Pendiente de tu respuesta:** ¿agrego estos dos al backend ahora (antes de construir el perfil), o el perfil arranca solo con los badges que ya existen y estos quedan para después?

## 5. "Dúo con" para gente fuera del roster — limitación técnica real, no solo una duda

Cómo funciona hoy: `duoCon` = otros jugadores TRACKEADOS que estén en el mismo equipo en esa partida. Funciona como aproximación razonable de "dúo" porque es un grupo cerrado de amigos.

**El problema:** Riot no expone en ningún lado de su API quién queueó junto a quién (no hay campo "premade"/"party"). Si se extiende a gente no trackeada, lo único que se puede mostrar es "cualquier otro jugador del mismo equipo" — en una partida normal son hasta 4 desconocidos random, no necesariamente el dúo real. Mostrar eso como "Dúo con [nombre]" sería falso la mayoría de las veces.

**Recomendación de Claude:** dejar "Dúo con" como está (solo roster trackeado) y no extenderlo a gente externa, porque no hay forma honesta de calcularlo con los datos que entrega Riot.

**❓ Pendiente de tu respuesta:** ¿de acuerdo con dejarlo así, o preferís que se intente igual con esa limitación aclarada en la UI (tipo "puede no ser exacto")?

---

## Próximo paso al retomar

Con los puntos 4 y 5 resueltos, construir `perfil.html` sobre el layout del punto 1, reusando toda la lógica/CSS ya escrita en los mockups A/B (ya validada contra el schema real de v2).

**Mockups de referencia (artifacts en vivo, con datos reales):**
- Variante A (ficha vertical): https://claude.ai/artifact/MFgqCuPLBPdaDei2gSe5Cd?jugador=Galactic%20Shark
- Variante B (banner horizontal): https://claude.ai/artifact/EiTKLcTqHpG2VD3rLs6css?jugador=Galactic%20Shark
