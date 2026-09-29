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
- "Pantalla de carga": rango/LP propio y rival vía la key de Riot de SharkTracker.
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

Esqueleto **validado en Windows** (29/09/2026) + **login con Discord**
implementado (pendiente de probar en Windows).

```
app/
  package.json           → Electron (dev) + @supabase/supabase-js 2.117.2 + ws
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
    assets/icon.png      → ícono de la ventana (logo del tiburón)
    renderer/
      img/               → logos (copias de /logo; la app empaquetada no ve la raíz del repo)
      index.html         → CSP estricta, barra de título (chip de partida + chip de Discord), login,
                           sidebar, secciones; Ajustes → Cuentas conectadas
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

## Siguiente paso pendiente

1. Alex agrega `sharktracker://auth-callback` en Supabase → Authentication →
   URL Configuration → Redirect URLs, y prueba el login en Windows.
2. Después: "En partida" (overlay real con la Live Client Data API).

## Estilo de comunicación de Alex

- Español (LatAm), directa, respuestas concisas.
- Prefiere que se le den decisiones tomadas con su razonamiento breve, no
  listas de opciones genéricas.
- Sabe desarrollo web pero es su primera app de escritorio — explica términos
  nuevos (terminal, IPC, etc.) sin asumir que los conoce, pero sin ser
  condescendiente.
