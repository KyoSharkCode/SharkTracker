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
- "En partida": overlay real vía Live Client Data API — oro, timers, indicador
  Barón/Ancestral, objetivos, build propia, rendimiento propio.
- ✅ "Pantalla de carga": rango/LP propio y rival vía la key de Riot de SharkTracker.
- "Mi Perfil" completo, incluido el estado "sin conexión" (tira del backend
  de SharkTracker/Supabase).
- "Ajustes → Overlay": toggles reales + reposicionar elementos.

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

Validado en Windows (29/09/2026): esqueleto, **login con Discord** (PKCE +
deep link) y nombre/logo de SharkTracker. En curso: **overlay "En partida"**.

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
      app.js             → navegación, login/cierre de sesión, chips, panel de prueba
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
   Probado en partida real. Atakhan ya no existe en el juego (quitado).
   ✅ Estructuras: toast de torre/inhibidor destruido (qué nivel y carril) y aviso
   1:00 antes de que reaparezca un inhibidor (5:00 tras caer).
2. ✅ (pendiente de probar en partida real) Diferencia de oro **solo con Tab pulsado**:
   `uiohook-napi` en el proceso main escucha SOLO la tecla Tab mientras hay partida.
   Oro = suma de `items[].price × count` (lo visible en el Tab). Fila i = i-ésimo
   aliado vs i-ésimo enemigo (orden de `allPlayers`). "1550 >" azul = va por delante
   tu equipo; "< 1180" rojo = el rival. Filas a y = 352/428/501/577/653 (1920×1080),
   medidas sobre una captura real del Tab.
   En el Tab el **lado azul va siempre a la izquierda** y el rojo a la derecha
   (confirmado por Alex): si juegas en rojo, la flecha se invierte (la flecha sale
   de la columna que va por delante); el color sigue siendo azul = tu equipo.
   **Verificar**: que `price` sea el coste total del objeto.
3. ✅ (pendiente de probar en partida real) "Tu rendimiento" **contra la división de
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
4. ✅ (pendiente de probar en Windows) Ajustes → Overlay (pestañas Cuenta / Overlay en Ajustes):
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

✅ (pendiente de probar en una normal/ranked real — la herramienta de práctica y algunas
partidas contra bots no salen en el "espectador" de Riot)
- Detección: el proceso `League of Legends.exe` abierto (tasklist) y el reloj de la
  partida sin arrancar = pantalla de carga. **Ojo: la API local YA responde durante la
  carga (con `gameTime` 0)**, así que "en partida" = gamestats responde **y** `gameTime > 0`
  (visto en la primera prueba real). Tras una partida, el juego abierto no cuenta como
  carga hasta que el proceso se cierra (`partidaTerminada`).
- Datos: Edge Function `pantalla-carga` (**"Verify JWT" ENCENDIDO**: exige sesión de
  Discord y cuenta de LoL vinculada; la key de Riot vive allí). 1 petición al espectador
  (los 10 jugadores) + liga por jugador (rango, LP, V/D, racha) + maestría top 3 (etiqueta
  "Main del campeón" / "Fuera de su main"). Los de SharkTracker salen de la base (0 peticiones).
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

Decisiones:
- **"Tu build"**: se deja para cuando exista "Meta" (hace falta la build de referencia).
- **Meta**: el MCP oficial de OP.GG (`https://mcp-api.op.gg/mcp`) tiene tier list, builds y
  counters; es la fuente candidata para Meta y "Tu build" (no documenta límites de uso).
  Alternativa: un recolector propio como `referencias-elo`, rotando por parche.
- **Timers de campamentos**: SÍ se quieren, solo de campamentos cuya muerte se vio
  (como Blitz/Porofessor/Itero). La API local no tiene eventos de campamentos: hay
  que leer el minimapa por captura de pantalla → se hace después, reutilizando la
  captura del motor de clips. Revisar la política de Riot antes de publicarlo.

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
