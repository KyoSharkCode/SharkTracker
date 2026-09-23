# SharkTracker — bugs visuales / de datos

Comparando el tracker nuevo contra el viejo (SoloQReto, que se usa como referencia de "esto es lo correcto"). Se acumularon acá y se resolvieron todos juntos, en un solo batch, con luz verde de KyoSumi (2026-09-22).

**Pendiente de tu lado para que los cambios de base de datos surtan efecto** (ver el mensaje del chat con el detalle):
1. Correr `supabase/migrations/20260922020000_first_win_fixes.sql` en el SQL Editor de Supabase (agrega columnas + arregla `compute_recent_badges()`).
2. Redeployar la Edge Function `sync-matches` (el código cambió — ahora guarda más datos de la primera victoria).

---

## 1. "Primera Victoria del Día" muestra la victoria de AYER

**Reportado:** 2026-09-22, comparando capturas del tracker nuevo vs. el viejo. El nuevo mostraba a adrianNOOBYT como primera victoria del día a las 23:46; el viejo (fuente de verdad) decía "Nadie ha ganado hoy todavía".

**Causa raíz:** `daily_first_win_state` solo se actualiza en la Edge Function `sync-matches` cuando aparece una partida NUEVA que cumple los requisitos (SoloQ, victoria, dentro de la ventana del día = 6AM Madrid a 6AM Madrid). Nada reseteaba esa fila cuando el día cambia sin que nadie haya ganado todavía en la ventana nueva.

**Fix aplicado:** `compute_recent_badges()` (ya corre cada 3 min y ya calcula el corte de 6AM Madrid) ahora resetea `daily_first_win_state` a null cuando el `day_start` guardado no coincide con el día actual calculado en esa misma corrida. Ver `supabase/migrations/20260922020000_first_win_fixes.sql`.

**Estado:** ✅ aplicado — pendiente correr la migración en Supabase.

---

## 2. Orden de las tarjetas de "Últimas 10 Partidas" incorrecto

**Reportado:** 2026-09-22. En el nuevo el orden era Top Asesino / Top Observador / Sin Rendirse. En el viejo (referencia) es Top Asesino / Sin Rendirse / Top Observador — Sin Rendirse va en el medio.

**Fix aplicado:** array reordenado a `['top_asesino', 'sin_rendirse', 'top_observador']` en `index.html`.

**Estado:** ✅ aplicado.

---

## 3. Columna de "campeón representativo" visible en la fila del ranking

**Pedido:** 2026-09-22, mockup de KyoSumi. Entre el nombre del jugador y la columna de Estado va una caja de imagen visible con el campeón representativo del jugador (en vivo si está jugando, si no su campeón elegido), con corte diagonal adaptado a la paleta del sitio.

**Fix aplicado:** nueva columna `.col-champ-outer`/`.col-champ-inner` en cada fila del ranking, con el mismo dato que ya usaba `.row-splash` (`favorite_champion`/`favorite_skin`, o el campeón en vivo). Borde con glow teal normalmente, y glow rojo cuando el jugador está en partida.

**Nota:** el editor de perfil self-service para que cada jugador cambie su propio campeón representativo sigue pendiente para más adelante (después de `perfil.html`) — esto solo cambia cómo se MUESTRA.

**Estado:** ✅ aplicado.

---

## 4. Íconos de corona/medalla — podio y fila del ranking

**Pedido:** 2026-09-22, KyoSumi pidió agregar corona (top 1) y medalla (top 2/3) con brillo/glow, en podio y también en la fila de la lista (mejora nueva, no solo réplica del viejo).

**Fix aplicado:**
- Podio: se agregó el ícono grande `.podium-medal` (👑/🥈/🥉 con glow dorado/plata/bronce), además del chip de texto que ya existía.
- Fila del ranking: top 3 ahora muestra 👑/🥈/🥉 en vez del número, con clases `.pos-1`/`.pos-2`/`.pos-3` (glow dorado/plata/bronce respectivamente) — antes solo existía `.pos-1`.

**Estado:** ✅ aplicado.

---

## 5. Tarjetas del podio muy "cuadradas"

**Pedido:** 2026-09-22, KyoSumi — que las tarjetas del podio (`.podium-card`) fueran más altas.

**Fix aplicado:** más padding vertical y `min-height` en `.podium-card` (250px) y `.podium-card.rank1` (300px).

**Estado:** ✅ aplicado.

---

## 6. Ícono de Twitch pegado al nombre + falta ícono de racha (🔥/❄️)

**Reportado:** 2026-09-22, KyoSumi (perfil de Galactic Shark, VTuber en Twitch).

**Fix aplicado:**
- El ícono de Twitch se movió a su propio lugar: ahora es una insignia (`.twitch-badge`) en la esquina del avatar del jugador, no pegado al nombre.
- En el espacio libre junto al nombre ahora aparece 🔥 (3+ victorias seguidas) o ❄️ (3+ derrotas seguidas), calculado con `getStreakType()` a partir del historial cacheado (ver punto 7).
- El ícono de Twitch ahora es un `<a>` clickeable siempre (`https://twitch.tv/usuario`), y se pone en rojo (filtro CSS) cuando `stream.is_live` es verdadero.

**Estado:** ✅ aplicado — el filtro CSS del rojo es una aproximación a `var(--danger)`, avísame si el tono no queda como quieres y lo afino.

---

## 7. Cambiar de jugador en "Historial Individual" mostraba "Cargando..."

**Reportado:** 2026-09-22, KyoSumi. En el viejo el cambio era instantáneo.

**Fix aplicado:** `render()` ahora trae de una sola vez el historial reciente (hasta 10 partidas de SoloQ) de TODOS los jugadores del roster, y lo guarda en un `Map` en memoria (`historyByPlayer`). `selectPlayer()` dejó de ser async contra la red — solo lee de ese `Map` y redibuja al instante. Este mismo `Map` alimenta el cálculo de racha del punto 6.

**Estado:** ✅ aplicado.

---

## 8. "Primera Victoria del Día" le faltaba información estructural

**Reportado:** 2026-09-22, KyoSumi pidió confirmar si la tarjeta estaba bien estructurada comparándola con `old/index.html` — se confirmó que sí faltaba info, aparte del bug del punto 1.

**Fix aplicado:**
1. Se agregaron columnas `champion, kills, deaths, assists, summoner_spells, team, duration_seconds` a `daily_first_win_state` (`supabase/migrations/20260922020000_first_win_fixes.sql`).
2. `sync-matches/index.ts` ahora guarda esos campos junto con `day_start`/`player_id`/`won_at` cuando detecta la primera victoria del día (el dato ya estaba disponible ahí mismo).
3. La tarjeta en `index.html` se reconstruyó para mostrar: foto real de invocador (antes solo iniciales), ícono del campeón, KDA, hechizos, lado del equipo (azul/rojo) y duración de la partida — igual que el sitio viejo.

**Estado:** ✅ aplicado — pendiente correr la migración y redeployar `sync-matches` para que empiece a guardar estos datos (las victorias de ANTES de redeployar no van a tener esta info extra, solo las de ahí en adelante).

---

## 9. Falta animación de "barrido" al actualizarse un dato en vivo

**Pedido:** 2026-09-22, KyoSumi — que un dato que cambia (ej. LP) se resalte con un barrido en vez de que toda la web se sienta parpadeando.

**Causa raíz:** cada vez que Realtime avisaba de un cambio en cualquier tabla, `render()` reconstruía TODO el HTML del ranking desde cero, sin importar si solo había cambiado un dato de un solo jugador.

**Fix aplicado:**
- La fila del ranking ahora se compara contra su versión anterior (una "firma" con todo lo que se ve); si el set y el orden de jugadores visibles no cambiaron, solo se reemplaza la fila que realmente cambió — el resto ni se toca.
- Cuando el LP, el rango o el winrate de un jugador cambian, ese dato puntual se resalta con una animación de brillo que lo cruza (`.value-changed`), tanto en la fila del ranking como en el podio.
- Esto cubre los datos más visibles (LP, rango, winrate). El mismo patrón se puede extender a cualquier otro campo más adelante si hace falta.

**Estado:** ✅ aplicado (alcance: LP, rango y winrate en fila del ranking y podio).

---

## 10. Los 4 cron jobs (Riot, Matches, Live Status, Twitch) fallaban en silencio — nada se actualizaba

**Reportado:** 2026-09-22 23:03, KyoSumi en directo en Twitch, notó que el estado de stream no se actualizaba en el sitio ("el twitch estatus no da").

**Causa raíz:** los 4 Cron Jobs (Integrations → Cron → Jobs) que disparan las Edge Functions vía `net.http_post` sacan el header `x-cron-secret` del Vault con `(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')` — pero el secreto en el Vault está guardado como `CRON_SECRET` (mayúsculas). La búsqueda por nombre es sensible a mayúsculas/minúsculas, así que nunca lo encontraba, mandaba el header vacío, y las 4 funciones (`sync-twitch-status`, `sync-matches`, `sync-live-status`, `sync-riot-data`) rechazaban CADA corrida con 401 antes de ejecutar una sola línea de lógica — ni siquiera llegaban a llamar a Riot o a Twitch. Estuvo así corriendo en el vacío un buen rato (al menos ~1h30 confirmado en los logs de invocaciones de esa noche, probablemente más).

**Fix aplicado:**
1. En cada uno de los 4 cron jobs se corrigió `where name = 'cron_secret'` → `where name = 'CRON_SECRET'`.
2. Se sincronizó también el valor en sí: se puso el mismo valor nuevo tanto en Edge Functions → Secrets (`CRON_SECRET`) como en Vault (`CRON_SECRET`), para eliminar cualquier otro desfasaje entre esos dos cajones de secretos (son independientes entre sí, aunque tengan el mismo nombre).

**Estado:** ✅ aplicado y confirmado — las 4 funciones dieron su primer `200` en Invocations esa misma noche (Twitch 23:26, Matches y Live Status ~23:3x, Riot Data 23:34).

**Nota para el futuro:** si se agrega una 5ta función con cron propio, chequear desde el vamos que su job use `'CRON_SECRET'` en mayúsculas — este mismo typo se copió igual en las 4 funciones existentes, así que es fácil que se repita si se copia el snippet de nuevo.

---

<!-- Próximos bugs de este estilo se agregan acá abajo, mismo formato:
## N. Título corto
**Reportado:** fecha, cómo se detectó
**Causa raíz:** qué está mal en el código
**Fix propuesto:** qué cambiar
**Estado:** diagnosticado / aplicado
-->
