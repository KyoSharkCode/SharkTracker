# SharkTracker — ronda 2 (comparación vs. old/index.html)

Alex se ausenta y dejó esto como orden de trabajo para lo que quede de la
sesión (2026-09-22, ~11:35). Salió de comparar `index.html` (v2) contra
`old/index.html` (v1/SoloQReto) a fondo, para no dejar ninguna feature del
viejo sin portar. Los issues 1-8 ya están todos aplicados y subidos a
`index.html`/migraciones (2026-09-22, ~12:15). El 9 queda pospuesto
(ver abajo).

**Pendiente de tu lado:** correr `supabase/migrations/20260922030000_badge_ties.sql`
en el SQL Editor de Supabase (agrega `weekly_badges.player_ids`/`champion`
y reescribe `compute_recent_badges()`/`compute_weekly_badges()` — issue 4
y 5 no se ven en la web hasta que corra). El resto (1, 2, 3, 6, 8) son
puramente de `index.html`, ya funcionan en cuanto subas ese archivo.

---

## 1. Ninguna imagen tiene fallback si falla la carga

**Encontrado:** el viejo usa `onerror` en avatares, campeones, hechizos,
runas y emblemas (`AVATAR_ONERROR`, `onerror="this.style.visibility='hidden'"`,
etc.) para degradarse con gracia. En el nuevo no hay ningún `onerror` —
si algo no carga (ícono de invocador recién salido, ícono de campeón,
hechizo, runa, emblema), queda el ícono roto a la vista. Muy visible en
stream.

**Aplicado:** `AVATAR_ONERROR`/`HIDE_ONERROR` agregados a todos los
`<img>` de Data Dragon (avatares, campeones, hechizos, runas, emblemas)
en ranking, podio, Primera Victoria, Rey de la Temporada e historial.
Los logos locales (`logo/*.png`) y los íconos de `assets/` no se
tocaron — bajo riesgo, son archivos propios, igual que hacía el viejo.

**Estado:** ✅ aplicado.

---

## 2. Bug de nombre "FiddleSticks"

**Encontrado:** Riot devuelve `championName: "FiddleSticks"` (S mayúscula)
pero el archivo real en Data Dragon es `Fiddlesticks.png` (s minúscula).
El viejo ya lo corregía (`CHAMPION_ID_OVERRIDES` + `champKey()`). El nuevo
arma la URL directo con el nombre crudo — cualquier partida de
Fiddlesticks rompe el ícono en la fila del ranking, Primera Victoria,
historial individual y podio (si alguien lo pone de favorito).

**Aplicado:** `CHAMPION_ID_OVERRIDES`/`champKey()` agregados, usados
tanto en `champIconUrl()` como en `splashUrl()` (el ícono de campeón Y
la franja diagonal de la fila).

**Estado:** ✅ aplicado.

---

## 3. Desapareció el indicador de "actualizado hace Xs"

**Encontrado:** el viejo tenía un indicador con punto pulsante en el
header ("Cargando…" → "Actualizado hace Xs/Xm"). El nuevo no tiene nada
parecido. Para alguien mostrando esto en vivo es la señal de "esto no se
congeló, sigue actualizando".

**Aplicado:** indicador restaurado junto al logo del header (punto
pulsante + texto), se actualiza cada segundo y se pisa cada vez que
`render()` termina de traer datos nuevos de Supabase.

**Estado:** ✅ aplicado.

---

## 4. Empates en badges ya no se muestran (bug de datos, no solo de UI)

**Encontrado:** el viejo mostraba varios avatares/nombres apilados
cuando dos o más jugadores empataban en una categoría (`avatarStackHtml`
/ `namesJoined`, filtro `>= max`). El nuevo solo puede guardar UN
`player_id` por categoría en `weekly_badges` (`category text primary
key, player_id uuid`), así que aunque el frontend quisiera mostrar el
empate, la base de datos ya perdió esa información.

**Categorías del viejo que SÍ soportaban empate** (mismo criterio se
aplica acá, ni más ni menos): Top Asesino, Top Observador, Sin Rendirse
(en `compute_recent_badges()`), y Escalador, Agresivo, KDA Player,
Maestro del Champion Pool, El Tortuga, El Asistente, Pentakills, El
Ladrón, El Destructor, Stop (en `compute_weekly_badges()`). OTP del
Torneo, Dúo Dinámico, El Farmeador, El Defensor, Horas en la Grieta y
Rey de la Temporada NUNCA soportaron empate en el viejo tampoco — no se
les agrega ahora, para no inventar comportamiento nuevo que no pidió.

**A hacer:**
1. Migración SQL: agregar `weekly_badges.player_ids uuid[]` (se
   mantiene `player_id` como el primero del array, por compatibilidad).
2. Reescribir `compute_recent_badges()` y `compute_weekly_badges()` para
   calcular TODOS los empatados en el máximo (o mínimo, para El Tortuga)
   de cada categoría con empate soportado, guardando el array completo.
   Las categorías sin empate quedan igual, solo envueltas en un array de
   un elemento (para que el frontend sea uniforme).
3. Frontend: `renderBadgeCard()` y el resto de las tarjetas que leen
   `weekly_badges` pasan a leer `player_ids` (avatares apilados +
   nombres unidos con " & ", como hacía `avatarStackHtml`/`namesJoined`
   del viejo) en vez de un solo jugador.

**Aplicado:** `weekly_badges` tiene ahora `player_ids uuid[]` y
`champion text` (migración `20260922030000_badge_ties.sql`, pendiente
de correr en Supabase — ver nota arriba del todo). `compute_recent_badges()`
y `compute_weekly_badges()` reescritas con la lógica de empate en las
13 categorías correspondientes. `renderBadgeCard()` del frontend ya lee
`player_ids` y une los nombres con " & " cuando hay más de uno.

**Estado:** ✅ aplicado — pendiente correr la migración para que se vea.

---

## 5. Falta ícono de campeón (imagen) en 3 tarjetas

**Encontrado:** el viejo muestra un ícono pequeño de campeón junto al
texto en **OTP del Torneo**, **El Farmeador** y **El Defensor** — no
solo el nombre en texto, la imagen (`champ-icon-small` /
`.otp-champ-info`).

**Aplicado:** misma migración de arriba (`champion text` en
`weekly_badges`) — OTP del Torneo y El Farmeador ya tenían el campeón
disponible en la misma fila, para El Defensor se toma el campeón de su
partida individual con más daño absorbido (el valor mostrado sigue
siendo el promedio de la semana, eso no se tocó). `renderBadgeCard()`
del frontend ya muestra el ícono cuando `champion` viene con dato.

**Estado:** ✅ aplicado — pendiente la misma migración del punto 4.

---

## 6. Flecha de tendencia — CAMBIO DE CRITERIO (pedido nuevo de Alex)

**Antes (viejo):** la flecha ▲/▼ reflejaba si la ÚLTIMA partida se ganó
o se perdió.

**Ahora (lo que Alex pidió hoy):** ya no es sobre la última partida —
debe reflejar si el jugador está en alza o en déficit según el balance
de victorias/derrotas de sus **últimas 5 partidas de SoloQ**. Ejemplo:
3 victorias y 2 derrotas → flecha arriba. 2 victorias y 3 derrotas →
flecha abajo.

**Aplicado:** `getTrendArrow()` nueva, usa el `historyByPlayer` ya
precargado, toma las 5 partidas más recientes de SoloQ. Con menos de 3
partidas jugadas, o empate 2-2, no se muestra flecha (para no mostrar
una tendencia que no es real con tan poca muestra).

**Estado:** ✅ aplicado.

---

## 7. Nombres de jugador y partidas ya no son clickeables

**Encontrado:** en el viejo, el nombre en el podio y en cada fila del
ranking eran links a `perfil.html?jugador=...`, y cada partida del
historial individual era un link a `partida.html?match_id=...`. Esas dos
páginas TODAVÍA NO EXISTEN en el repo del v2.

**Decisión (Alex dijo "tú decides"):** no se arman los `<a href="...">`
todavía — un link a una página que no existe es un 404 en vivo en
stream, peor que texto plano sin enlace. Se deja la estructura/CSS lista
para activarlo rápido (cursor, hover) apenas `perfil.html`/`partida.html`
existan, pero sin navegación real por ahora.

**Estado:** pospuesto a propósito (ver razón arriba) — no es un olvido.

---

## 8. Historial individual: LP null no muestra nada (el viejo mostraba la duración)

**Encontrado:** cuando `lp_change` es `null` (típicamente en remakes),
el viejo mostraba la duración de la partida en ese mismo lugar en vez de
dejarlo vacío. El nuevo simplemente no muestra nada ahí.

**Aplicado:** mismo fallback que el viejo — si `lp_change` es null,
muestra la duración (`m.matches.duration_seconds`) en el lugar del chip
de LP. Se agregó `formatDuration()` como helper compartido (también lo
usa ahora la tarjeta de Primera Victoria, antes tenía el cálculo
duplicado).

**Estado:** ✅ aplicado.

---

## 9. Menú flotante (Campeones / Versus) — POSPUESTO, prioridad baja

**Encontrado:** el viejo tenía un botón flotante (FAB) abajo a la
derecha con accesos a `campeones.html` y `versus.html`. Esas páginas
tampoco existen todavía en el v2.

**Cambio de diseño pedido por Alex (para cuando se retome):** no un FAB
como el viejo — un **menú lateral desplegable** en su lugar.

**Estado:** pospuesto, prioridad baja, NO se toca en esta ronda (Alex
dijo explícitamente "por ahora hagamos hasta el punto 8").

---

## Aparte — cosas notadas pero fuera de este pedido puntual (no tocar sin que lo pida)

- El viejo exigía un mínimo de 3 partidas jugadas en el día para el
  badge "Sin Rendirse" (`maxDiaTop>=3`); la lógica actual de
  `compute_recent_badges()` no tiene ese mínimo (alcanza con 1 partida).
  No estaba en la lista de 9 issues comparados, así que no se toca en
  esta ronda — queda anotado por si en algún momento se quiere alinear.
- Toasts de logros en vivo (con sonido) y el editor de perfil
  self-service ya estaban identificados como pendientes de antes — no
  son parte de esta ronda tampoco.
