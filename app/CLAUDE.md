# SharkTracker (app de escritorio) — contexto del proyecto

App de escritorio personal (Electron) estilo Porofessor para League of Legends,
con la marca **SharkTracker** (mismo nombre y logo que la web `sharktracker.lol`).
Vive en la carpeta `app/` del **repo de SharkTracker** (monorepo) y comparte su
backend de Supabase: las Edge Functions y migraciones de ambos están en
`supabase/` en la raíz del repo. Construida por Alex (streamer, sabe desarrollo web, primera
vez haciendo una app de escritorio).

## Decisiones ya tomadas (no las re-abras sin que la usuaria lo pida)

- **Stack:** Electron, no Tauri — se reutiliza el mockup en HTML/CSS/JS tal cual
  como las vistas de la app, y ella no tiene experiencia en Rust.
- **Arquitectura de datos:**
  - El overlay en partida y la pantalla de carga son **100% locales**, vía la
    Live Client Data API de League (`https://127.0.0.1:2999`, certificado
    autofirmado — hay que pasar `rejectUnauthorized: false`). Cero dependencia
    del backend web.
  - "Mi Perfil" (historial, elo, tags de comportamiento, maestrías) reutiliza
    el **backend de Supabase de SharkTracker** en vez de duplicar la
    integración con la API de Riot.
  - La key de Riot para búsquedas de rango/WR de rivales en la pantalla de
    carga es la **misma key compartida de SharkTracker** (cómoda hasta
    ~20-30 jugadores) — no se pide una key de producción aparte.
  - **La key NUNCA va dentro de la app** (cualquiera puede extraer el código de
    una app de Electron). La app llama a una Edge Function de Supabase que
    guarda la key, exige sesión de Discord y cachea resultados unos minutos.
- **Login:** Discord vía Supabase Auth. El proveedor Discord **ya está
  activado** en el proyecto de Supabase de SharkTracker (Client ID/Secret ya
  cargados) — no hace falta crear una app nueva en el Discord Developer
  Portal. Lo que sí falta configurar:
  1. Agregar el redirect URL propio `sharktracker://auth-callback` en
     Supabase → Authentication → URL Configuration → Redirect URLs.
  2. Registrar ese esquema en Electron (`app.setAsDefaultProtocolClient`).
  3. Manejar el deep link entrante en el proceso main y pasárselo al cliente
     de Supabase.
  - Usar el flujo **PKCE** de Supabase Auth: por el deep link llega un código
    de un solo uso (`exchangeCodeForSession`), no el token en la URL.
  - En Windows el deep link abre una segunda instancia: usar
    `app.requestSingleInstanceLock()` + evento `second-instance` para que lo
    reciba la ventana ya abierta.
- **Motor de clips (autoclipper):** se construye **propio**, no se depende de
  OBS — solo Alex usa OBS, el resto del grupo de SharkTracker no, y la función
  debe funcionar para todo el grupo. Arquitectura decidida: Electron como
  orquestador/UI + un proceso nativo aparte (FFmpeg con codificación por
  hardware, o un módulo nativo) que hace la captura + buffer circular,
  disparado por eventos de la Live Client Data API. **Esto va en una fase
  posterior a la Fase 1, no la toques todavía.**

## Alcance de la Fase 1 (lo único que se construye ahora)

**Sí entra:**
- Login con Discord (Supabase Auth) + detección automática del cliente de LoL.
- Ventana flotante + navegación entre secciones (ya hecho, ver abajo).
- ✅ "En partida": overlay real vía Live Client Data API — oro, timers, indicador
  Barón/Ancestral, objetivos, rendimiento propio ("Tu build" pasa a la Fase 2 con Meta).
- ✅ "Pantalla de carga": rango/LP propio y rival vía la key de Riot de SharkTracker.
- ✅ "Mi Perfil" completo, incluido el estado "sin conexión" (tira del backend
  de SharkTracker/Supabase).
- ✅ "Ajustes → Overlay": toggles reales + reposicionar elementos.

**Se deja para después (no construir todavía):**
- "En Vivo" (selección de campeones) — necesita integrarse con el LCU API
  del cliente de League, es una pieza aparte.
- "Meta" (tier list, counters, tendencias) — necesita una fuente de datos
  externa o que Alex la mantenga.
- "Ajustes → Apariencia" y "Ajustes → Notificaciones" — ya están marcadas como
  "próximamente" en el mockup visual.
- El motor de clips.

## Referencia visual

El diseño completo de todas las pantallas (13 tableros) está en un Claude
Artifact (tipo Design/canvas), no en este repo:
`https://claude.ai/artifact/46xGEAX3s83srpnFYK4rr4`

Incluye: ventana flotante, pantalla de carga, en partida, login, Mi Perfil +
su estado sin conexión, En Vivo (selección y ya-elegiste), Meta, y los 4
sub-tabs de Ajustes (Cuenta/Overlay/Apariencia/Notificaciones). Usa esos
mockups como referencia de estilo (colores, tipografías Inter/Rajdhani,
tono oscuro con acento turquesa `#00e5c7`) al construir cada pantalla real.

## Estado actual del código

**Fase 1 completa y validada por Alex en partidas reales (29/09/2026)**: login con
Discord, overlay en partida (Barón/Ancestral, avisos, oro con Tab, Tu rendimiento),
pantalla de carga (con Ctrl + X), Ajustes → Overlay con editor y Mi Perfil.
**Fase 2 en curso** (plan acordado): Bloque 0 puesta a punto ✅ · Bloque 1 early access ✅
(instalador + actualizaciones automáticas) · Bloque 2 Meta (v0.3.0, datos del MCP de OP.GG
guardados en Supabase; ver sección "Meta") ✅ · Bloque 3 En Vivo (LCU; en ranked NO revelar
nombres ocultos en selección) · Bloque 4 Ajustes Apariencia/Notificaciones · Bloque 5 motor
de clips + timers de campamentos. La app es **solo para el grupo de amigos** (no pública).

## Versión, empaquetado y publicación (Fase 2, bloques 0 y 1)

- **Versión**: sale de `package.json` (`app.getVersion()`); la barra de título muestra
  "vX.Y" y Ajustes → Cuenta → "Acerca de" la versión completa + el aviso legal de Riot
  (también en el pie de index.html y perfil.html de la web).
- **Electron 44** (antes 33; Node más nuevo). supabase-js sigue recibiendo `ws` como
  transporte de realtime.
- **Empaquetado**: electron-builder (campo `build` de package.json): instalador NSIS de un
  clic por usuario, `SharkTracker-Setup.exe` (nombre fijo, sin versión: así
  `releases/latest/download/SharkTracker-Setup.exe` siempre es el último), registra `sharktracker://`.
  `npmRebuild: false` (uiohook-napi trae binarios N-API precompilados; quedan fuera del
  asar solos). Sin firma de código: Windows avisa "Windows protegió tu PC" la primera vez.
- **Actualizaciones**: electron-updater desde **GitHub Releases** (repo público): busca al
  abrir y cada 4 h, descarga sola, instala al cerrar o con "Reiniciar y actualizar".
  Solo en la app instalada (con `npm start` no).
- **Publicar una versión**: subir `version` en app/package.json (merge) → pestaña Actions
  del repo → **"App: publicar versión"** → Run workflow (`.github/workflows/app-publicar.yml`,
  arma en windows-latest, sube a un Release en borrador y lo publica como `vX.Y.Z`; GitHub
  no deja crear un Release ya publicado sin etiqueta). Probar local: `npm run dist`.
- **Descarga desde la web**: `descargar.html` (menú ☰ → "App de escritorio"). El botón usa
  el enlace de descarga de la última publicación y muestra versión/fecha/tamaño leyendo la API pública de GitHub
  (`api.github.com` está en su CSP). Sin versión publicada, el botón dice "Muy pronto".
  Solo para miembros: sin sesión el botón lleva a login.html; con sesión pero sin cuenta de
  LoL vinculada, no descarga. La guía y el enlace del instalador solo aparecen a miembros.
  Ojo: es un candado de la web; el Release de GitHub es público (repo público). El candado
  real es la app, que exige Discord + cuenta vinculada.
- **Vista previa** en descargar.html (visible para todos): capturas en `assets/app/*.webp`
  (lista `CAPTURAS` en la página). Son capturas reales con los nombres de otros jugadores
  y el chat difuminados: al cambiar una, difuminar igual.
- `app/GUIA.md`: guía para los amigos (instalar, primera vez, atajos, actualizaciones).

```
app/
  package.json           → Electron (dev) + @supabase/supabase-js 2.117.2 + ws + uiohook-napi
  package-lock.json      → versiones exactas (npm install las respeta)
  CLAUDE.md              → este archivo
  src/
    config.js            → URL y anon key de Supabase (públicas), protocolo sharktracker://
    auth.js              → sesión de Discord en el proceso main: PKCE, sesión cifrada
                           con safeStorage (userData/session.bin), cuenta de LoL
                           vinculada (players.user_id), cierre de sesión local
    main.js              → ventana, instancia única + deep link sharktracker://auth-callback,
                           IPC de sesión, Live Client Data API y detección automática
                           de partida (cada 5 s, avisa solo al cambiar)
    preload.js           → contextBridge (window.sharkTracker): ventana, checkLiveGame,
                           estado de partida, auth
    rendimiento.js       → "Tu rendimiento": división objetivo y comparación con la referencia
    perfil.js            → Mi Perfil: lee SharkTracker, íconos de DDragon, copia local (sin conexión)
    perfil-calculos.js   → Mi Perfil: radar, etiquetas, historial de elo y de partidas
    game-state.js        → "cerebro" del overlay (sin Electron, se prueba en Node):
                           buff de Barón/Ancestral y titulares, anuncios de objetivos
                           e inhibidores por reaparecer, toasts de dragón/alma,
                           Vacuolarvas, Heraldo, torres e inhibidores, diferencia de oro
                           por fila del Tab. Tiempos en TIEMPOS
    preload-overlay.js   → contextBridge (window.overlay): recibe el estado, Tab y los ajustes
    overlay-config.js    → ajustes del overlay (qué se ve y dónde) en userData/overlay.json,
                           y la captura de fondo opcional del editor
    preload-editor.js    → contextBridge (window.editor) de la ventana "Reposicionar elementos"
    editor/              → ventana "Reposicionar elementos" (pantalla emulada del juego)
    overlay/             → ventana transparente sobre el juego (index.html, overlay.css,
                           overlay.js, icons.js). Coordenadas a 1920×1080 escaladas con
                           --s; zona central anclada a la barra de objetivos y zona
                           derecha al borde derecho
    assets/icon.png      → ícono de la ventana (logo del tiburón)
    renderer/
      img/               → logos (copias de /logo; la app empaquetada no ve la raíz del repo)
      index.html         → CSP estricta, barra de título (chip de partida + chip de Discord), login,
                           sidebar, secciones; Ajustes → Cuenta y Ajustes → Overlay
      style.css          → estilos del mockup (Login y Ajustes → Cuenta incluidos)
      app.js             → navegación, login/cierre de sesión, chips, Ajustes, diagnóstico
      perfil.js          → dibuja Mi Perfil (y su estado "sin conexión")
```

Para correrla: abrir el repo en VS Code, y en la terminal `cd app`,
`npm install` (una vez, y cada vez que cambien las dependencias) y `npm start`.

Notas técnicas:
- Nombre visible "SharkTracker" (`productName`), AppUserModelId `lol.sharktracker.app`.
- El renderer tiene una CSP estricta (sin scripts inline): no usar `onclick="…"` ni
  `<script>` dentro del HTML; los eventos se enganchan desde `app.js`.
- El Node de Electron 33 no trae WebSocket: supabase-js recibe `ws` como
  `realtime.transport`.
- Live Client Data API: `activePlayer.summonerName` trae el Riot ID completo
  (`Nombre#TAG`); los bots no tienen `#tag` (ignorarlos al buscar rangos).
- Íconos de invocador sin versión de parche: CommunityDragon `latest`.
- Overlay: ventana transparente, `focusable: false`, `setIgnoreMouseEvents(true)`,
  `alwaysOnTop 'screen-saver'`. Se muestra cuando la detección ve partida y lee
  `allgamedata` cada 1 s. **LoL debe estar en modo "Sin bordes"** (en pantalla
  completa exclusiva no se puede dibujar encima).
- El overlay solo usa información que el juego ya muestra (regla de Riot/Vanguard).
- Los buffs se aproximan: titulares = vivos del equipo al detectar el evento,
  y se pierden al morir (ChampionKill). Barón 180 s, Ancestral 150 s.

## Meta (Fase 2, bloque 2 — v0.3.0)

Fuente: MCP público de OP.GG (`https://mcp-api.op.gg/mcp`, JSON-RPC; responde en un formato
propio "class X: campos" + `X(valores)` que traduce `leerOpgg`). **La app nunca llama a OP.GG**:
- Edge Function `meta-tier` (cron `meta-tier-cada-6h`, Verify JWT APAGADO + x-cron-secret):
  `lol_list_lane_meta_champions` con position "all" (1 consulta = 5 roles) → tabla `meta_tier`
  (champion_id sacado de DDragon por nombre en inglés). Anota el parche en `meta_estado`.
  La tier list de OP.GG NO tiene filtro de elo (usa el suyo por defecto).
- Edge Function `meta` (Verify JWT encendido, solo cuentas vinculadas): body
  `{champion_id, posicion}` → `lol_get_champion_analysis` en **Esmeralda+** (`tier: emerald_plus`)
  → ficha normalizada (inicio, core, botas, 4.º/5.º/6.º, runas, hechizos, subir primero, orden
  por nivel, counters). Caché en `meta_campeon`: 24 h o hasta que cambie el parche; si OP.GG no
  responde, devuelve la guardada. OP.GG pide el campeón en MAYÚSCULAS ("LEE_SIN"): se prueban
  nombre en snake, id de DDragon en mayúsculas y nombre sin guiones.
- Parche: DDragon/OP.GG dicen "16.19"; en el juego se ve con el año ("26.19" = +10). La app
  muestra el del juego; en la base se guarda el de DDragon.
- Winrates = victorias ÷ partidas (OP.GG redondea los suyos a 2 decimales).
- App: `src/meta.js` (main; catálogos es_MX de campeones, objetos, runas y hechizos) +
  `renderer/meta.js`. Rol por defecto = rol principal de la web; campeón por defecto = tu más
  jugado (maestrías) si se juega en ese rol (role_rate ≥ 15 %), si no el #1. Tier 1–5 de OP.GG
  se muestra como S+/S/A/B/C. Tendencias = puestos ganados/perdidos vs el parche anterior
  (`rank_prev_patch`, solo campeones con 1000+ partidas). Los counters muestran tu winrate
  contra ese campeón y la diferencia con tu winrate medio en el rol.
- Meta validado por Alex (30/09/2026) con datos reales; la función de prueba `meta-prueba` se borró.
- Pendiente para después con estos datos: "Tu build" en partida y counters en En Vivo.

## En Vivo (Fase 2, bloque 3 — v0.4.0, partes A + B)

Regla de Alex: **el usuario decide SIEMPRE**. Nada se importa ni se cambia en el cliente sin
que pulse un botón.

- `src/lcu.js` (main): API local del cliente de LoL (LCU). Puerto y contraseña salen de la
  línea de comandos de `LeagueClientUx.exe` (PowerShell `Get-CimInstance`) o del `lockfile` en
  `C:\Riot Games\League of Legends`. Sondeo: fase del cliente cada 3 s (5 s sin cliente); en
  selección, `/lol-champ-select/v1/session` cada 1 s. Solo avisa a la ventana si algo cambió.
- Privacidad: el nombre de un aliado solo se pasa si el cliente lo marca visible
  (`nameVisibilityType === 'VISIBLE'`); en ranked suele estar oculto → no se muestra. Los
  amigos de SharkTracker se reconocen por Riot ID (solo si es visible) con su rango de la base
  (0 peticiones a Riot).
- Botones (`lcu.js`):
  - **Importar runas**: borra las páginas "SharkTracker · …" y crea una nueva (current: true).
    Tus páginas no se tocan; si no hay hueco, avisa que borres una.
  - **Importar build**: set de objetos "SharkTracker · Campeón Rol" en
    `/lol-item-sets/v1/item-sets/{summonerId}/sets` (reemplaza el anterior de SharkTracker).
  - **Poner hechizos**: `PATCH my-selection`; si ya llevas Destello en D o F, se queda en esa tecla.
- `renderer/envivo.js`: salta sola a En Vivo al entrar a selección (el nav muestra "ON").
  Antes de fijar: picks (tus más jugados en el rol, meta del rol, y "le ganan a" tu rival de
  línea) y bans (los que le cuestan a tu campeón en mente, y los más baneados sin incluir tus
  campeones). Al fijar: runas, hechizos y build de tu campeón (ficha de Meta) con los botones.
  Rol de los rivales: el cliente no lo da → se estima con el role_rate de la tier list.
  Colas sin roles (ARAM, Arena, URF): sin recomendaciones de Meta.
- Pendiente (parte C): build adaptativa según el equipo rival (reglas: tipo de daño,
  curación → antisanación, tanques, control → Mercurio, burst) + guía de matchup de OP.GG.

## Overlay por mapa (feedback de partidas en ARAM, 01/10/2026)

- `game-state.js` mira `gameData.mapNumber` (11 Grieta/URF, 12 ARAM, 30 Arena; si falta, `gameMode`):
  - Barón, dragones, Ancestral, Heraldo y Vacuolarvas (anuncios, buffs y toasts): solo en la Grieta.
  - Torres e inhibidores: Grieta y ARAM. El inhibidor reaparece a los 5:00 en la Grieta y a los
    4:00 en ARAM (`INHIB_REAPARECE`; si en partida real sale desfasado, se ajusta ahí).
  - Arena: sin objetivos, sin estructuras y sin diferencia de oro en el Tab.
  - Los "packs de vida" de ARAM no salen en la API del juego: no se pueden anunciar.
- Al terminar una partida y al empezar cada pantalla de carga se limpia el overlay
  (`limpiarOverlay`): antes "Tu rendimiento" de la partida anterior aparecía en la siguiente carga.
- Pantalla de carga: en ARAM / Arena / URF no hay "Main del campeón" ni "Fuera de su main"
  (y no se piden maestrías a Riot).
- ARAM de temporada (cola 2400) cuenta como ARAM en Mi Perfil, En Vivo y la pantalla de carga.

## Estilo visual del overlay (acordado con Alex — tableros "Overlay — estilo
visual" y "Overlay — estructuras" del canvas)

- TODO el estilo de sharktracker.lol: paleta (#030812, paneles rgba(8,18,29,.9),
  borde #16324a, acento #00e5c7, dorado #facc15), Rajdhani para tiempos/etiquetas
  (etiquetas en MAYÚSCULAS) e Inter para texto.
- **Regla de color única: lo hace o lo tiene tu equipo → azul #4c9dff; el enemigo →
  rojo #ff5f6d** (colores relativos de LoL). Objetivos con su color propio (dragón
  por elemento), Alma en dorado con brillo.
- Íconos: SVG propios (mismo set que assets/lol-icons.js de la web), sin imágenes
  externas. Fichas de campeón **variante B**: cuadrado redondeado con borde del
  equipo y retrato de DDragon (respaldo: iniciales).
- Animación: **solo entrada y salida** (250 ms, opacidad + posición), una vez por
  aviso. Nada en bucle. Urgencia (últimos 10 s) solo cambia el color.

## Plan del overlay "En partida" (acordado con Alex)

1. ✅ Ventana del overlay + Barón/Ancestral + anuncios de objetivos + toasts de
   dragón/alma, Vacuolarvas (x de 3, una sola aparición a las 8:00) y Heraldo.
   Probado en partida real. Atakhan ya no existe en el juego (quitado). **Barón aparece a
   las 20:00** (visto en partida real; antes estaba a 25:00).
   ✅ Estructuras: toast de torre/inhibidor destruido (qué nivel y carril) y aviso
   1:00 antes de que reaparezca un inhibidor (5:00 tras caer).
2. ✅ Diferencia de oro **solo con Tab pulsado**:
   `uiohook-napi` en el proceso main escucha SOLO la tecla Tab mientras hay partida.
   Oro = suma de `items[].price × count` (lo visible en el Tab). Fila i = i-ésimo
   aliado vs i-ésimo enemigo (orden de `allPlayers`). La flecha **apunta al jugador
   con más oro** ("◀ 425" = el de la izquierda, "425 ▶" = el de la derecha; antes era al
   revés y confundía) y el color dice de quién es: azul tu equipo, rojo el rival. Filas a y = 352/428/501/577/653 (1920×1080),
   medidas sobre una captura real del Tab.
   En el Tab el **lado azul va siempre a la izquierda** y el rojo a la derecha
   (confirmado por Alex): si juegas en rojo, la flecha se invierte (sigue apuntando a
   la columna que va por delante); el color sigue siendo azul = tu equipo.
   **Verificado en partida real: `items[].price` NO es el coste total** (solo el último
   paso de la receta). Se usa `gold.total` de DDragon `item.json` (main.js `cargarPrecios`,
   `estadoPartida.setPrecios`); `price` queda solo de respaldo.
3. ✅ "Tu rendimiento" **contra la división de
   ARRIBA de la tuya** (Oro → Platino; Diamante y Master+ → Master+; sin rango → Oro),
   por rol. **Siempre a la vista desde que empieza la partida**, arriba a la derecha
   (y = 72, encima de los avisos; como en el mockup). Oro/min, CS/min, visión/min y KP;
   azul ▲ = por encima de la referencia, rojo ▼ = por debajo. Antes del minuto 5 no se
   colorea (los números por minuto saltan mucho al principio).
   - Datos propios (no OP.GG): Edge Function `referencias-elo` (cron cada 10 min, ≤ 11
     llamadas a Riot por corrida). Key **personal** (100 peticiones / 2 min) compartida
     con la web, que con 7 jugadores gasta ~33 cada 2 min: el recolector empieza 30 s
     tarde, pide de a una cada 1.5 s y se corta si la key pasa del 60 % (lo lee de las
     cabeceras de Riot) o si hay 429. Responde 202 y trabaja en segundo plano
     (EdgeRuntime.waitUntil; el log sale en Logs de la Function). Toma 2 jugadores al azar de una
     división de LAN (rota Bronce…Master+), baja sus partidas de SoloQ y suma los 10
     jugadores en `elo_referencias` (sumas por división + rol + día, sin guardar partidas).
   - **Rotación de 14 días** (≈ un parche): la vista `elo_referencias_promedio` solo mira
     los últimos 14 días y `limpiar_referencias_elo()` borra lo demás cada madrugada.
   - Oro/min en partida = valor de objetos + oro sin gastar (el juego no da el oro
     ganado): sale algo por debajo del `goldEarned` real. Con < 30 muestras en ese
     rol/división (o sin sesión) se ven tus números sin comparar, con el aviso arriba.
   - Lógica en `rendimiento.js`; `auth.getReferencia()` lee rango (rank_latest), rol
     principal y promedios al empezar la partida.
4. ✅ Ajustes → Overlay (pestañas Cuenta / Overlay en Ajustes):
   - Interruptores reales: diferencia de oro, Barón/Ancestral, anuncios de objetivos,
     avisos de lo que pasó (toasts) y Tu rendimiento. Se aplican al instante (IPC
     `overlay:config`), también en partida. "Timers de campamentos", "Tu build" y la
     tarjeta "Pantalla de carga" se ven como "Próximamente".
   - "Reposicionar elementos" abre una **ventana aparte** (`editor/`) que emula la
     pantalla del juego: esquema del HUD de LoL (siluetas propias, sin imágenes de Riot)
     o una captura propia de fondo (se copia a userData, solo en este PC). Reutiliza
     overlay.css/icons.js/overlay.js con datos de ejemplo (editor-puente.js imita
     window.overlay). Se arrastran Barón, Ancestral, Tu rendimiento y la columna de
     avisos; flechas = 1 px (Shift 10 px); "Ver Tab" muestra la silueta del marcador
     con el oro (que no se mueve). Guardar / Restablecer / Cancelar (Esc).
   - Todo en `userData/overlay.json` (overlay-config.js), posiciones en 1920×1080
     (esquina superior izquierda de cada pieza).

## Pantalla de carga (acordado con Alex)

✅ Validado en normales reales (la herramienta de práctica y algunas partidas contra bots
no salen en el "espectador" de Riot).
- Detección: el proceso `League of Legends.exe` abierto (tasklist) y la partida sin
  empezar = pantalla de carga. **Ojo: la API local YA responde durante la carga, y hasta
  el reloj avanza** (visto en dos pruebas reales), así que "en partida" = existe el evento
  **`GameStart`** en `/eventdata` (o más de 3 min de reloj, por si faltara el evento). Tras una partida, el juego abierto no cuenta como
  carga hasta que el proceso se cierra (`partidaTerminada`).
- Datos: Edge Function `pantalla-carga` (**"Verify JWT" ENCENDIDO**: exige sesión de
  Discord y cuenta de LoL vinculada; la key de Riot vive allí). 1 petición al espectador
  (los 10 jugadores) + liga por jugador (rango, LP, V/D, racha) + maestría top 3 (etiqueta
  "Main del campeón" / "Fuera de su main"). Los de SharkTracker salen de la base (0 peticiones).
  Ojo: en league-v4 la división viene en el campo **`rank`** (no `division`).
- Cupo (la key es la personal, compartida con la web): lo esencial hasta el 85 % de la
  ventana de 2 min, la maestría solo por debajo del 60 %; rivales primero. Lo que falte
  queda "Rango pendiente…" y la app reintenta cada 15 s (hasta 5 min). Caché: panel por
  partida 10 min (`carga_partidas`, con "bloqueo" para que en una premade se arme una sola
  vez) y rango por jugador 30 min (`carga_rangos`); limpieza cada hora.
- Winrate con ese campeón concreto y "Autorrelleno" (del mockup) NO: costarían ~200
  peticiones o necesitan la selección de campeones (LCU). Se muestra el winrate de la temporada.
- Overlay: panel `#carga` arriba a la derecha (x 1500, y 60; 400 px). Tapa la última
  columna de cartas **a propósito**: Alex prefirió mantener el panel grande y ocultarlo
  con un atajo antes que una columna angosta. **Ctrl + X** (durante la carga) lo muestra u
  oculta; la decisión se guarda (`visible.carga`) y oculto queda una pastilla mini
  "Ctrl + X: rangos". El atajo usa el mismo uiohook-napi que Tab (encendido en carga y
  partida; solo mira Tab y Ctrl+X). También hay interruptor en Ajustes → Overlay.
  Medidas de la pantalla de carga real a 1920×1080 (esquema del editor): cartas de x 233
  a 1671 (5 por fila, 254 px + 42), filas en y 68–528 y 591–1051. Movible en el editor
  ("Ver pantalla de carga"). Interruptores en Ajustes → Overlay (rango/winrate de cada
  equipo y etiquetas; "Counters del rival" próximamente).

## Mi Perfil (mockup "La cara de la app" + su estado "sin conexión")

✅ Validado con datos reales.
- `perfil.js` (main) lee con tu sesión (RLS: lectura pública) players, rank_latest,
  rank_snapshots (SoloQ, 30 días), player_masteries y matches + match_participants
  (150 más recientes; la base guarda 30 días). Íconos y nombres en español de DDragon
  (summoner.json, runesReforged.json, champion.json; una vez por sesión).
- **El radar sigue la pestaña de cola** (la comparte con el historial: cambiar una cambia
  las dos). SoloQ/Flex/Normal/Partida Rápida se comparan con la división de arriba; ARAM y
  Arena, sin comparar. (`rendimientoPorCola`.)
- Cálculos en `perfil-calculos.js` (se prueba en Node): radar de las últimas 20 partidas con
  los 4 ejes de "Tu rendimiento" (CS/min, oro/min, visión/min, KP) contra la división de
  arriba de tu rol (`auth.getReferencia`, ≥ 30 muestras); KDA, daño/min y WR aparte.
  Etiquetas (últimas 30 SoloQ, sin remakes): buena/mala racha (3+), Tilteado (misma idea
  que la web), mejor en lado azul/rojo (4+ por lado, 10+ pts), amante (5+ con un campeón),
  bueno/malo con (4+ partidas, ≥ 60 % / ≤ 40 %). Historial de elo = elo_score de
  rank_snapshots. Historial por cola: SoloQ, Flex, Normal, Partida Rápida, ARAM, Arena
  (últimas 10; remake < 5 min; LP y Égida de extra_stats).
- "Sin conexión": copia en `userData/perfil.json`; si falla SharkTracker se ve tu identidad
  y último rango guardado + el aviso del mockup con "Reintentar conexión". Se recarga al
  iniciar sesión y al volver a Mi Perfil (si pasaron 2+ min), o con "Actualizar".
- El panel de prueba "Comprobar ahora" pasó a Ajustes → Cuenta ("Diagnóstico").
- "Nivel" del mockup no está (la base no lo guarda); "Autorrelleno" tampoco (LCU).

Decisiones:
- **"Tu build"**: se deja para cuando exista "Meta" (hace falta la build de referencia).
- **Meta**: el MCP oficial de OP.GG (`https://mcp-api.op.gg/mcp`) tiene tier list, builds y
  counters; es la fuente candidata para Meta y "Tu build" (no documenta límites de uso).
  Alternativa: un recolector propio como `referencias-elo`, rotando por parche.
- **Timers de campamentos**: SÍ se quieren, solo de campamentos cuya muerte se vio
  (como Blitz/Porofessor/Itero). La API local no tiene eventos de campamentos: hay
  que leer el minimapa por captura de pantalla → se hace después, reutilizando la
  captura del motor de clips. Revisar la política de Riot antes de publicarlo.

## Key de Riot y PUUID

Riot cifra los PUUID **por key**: al pasar de la key de desarrollo a la personal
(30/09/2026) los guardados en `players.puuid` dejaron de valer (Riot responde **400**).
`sync-riot-data` lo cura solo: si la liga responde 400 con un PUUID guardado, lo vuelve a
sacar con el Riot ID (account-v1) y lo guarda. Las demás Functions leen `players.puuid`, así
que se arreglan en cuanto corre (cada minuto). Si algún día se cambia la key, pasa lo mismo.

## Pendiente fuera de la app

- ✅ Dominio `sharktracker.lol` (GitHub Pages, HTTPS) activo; Site URL de Supabase y
  SQL de Discord aplicados. Cuando haya un rato: quitar `kyosharkcode.github.io` de la
  lista de CORS de las 3 Edge Functions (ya redirige al dominio).
- Actualizar Electron (el de la v33 trae Node 20 y supabase-js avisa que lo dejará).

## Estilo de comunicación de Alex

- Español (LatAm), directa, respuestas concisas.
- Prefiere que se le den decisiones tomadas con su razonamiento breve, no
  listas de opciones genéricas.
- Sabe desarrollo web pero es su primera app de escritorio — explica términos
  nuevos (terminal, IPC, etc.) sin asumir que los conoce, pero sin ser
  condescendiente.
