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
  Portal. Configurado y funcionando:
  1. Redirect URL propio `sharktracker://auth-callback` en Supabase →
     Authentication → URL Configuration → Redirect URLs.
  2. Esquema registrado en Electron (`app.setAsDefaultProtocolClient`, main.js).
  3. El deep link entrante lo recibe el proceso main y se lo pasa al cliente
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
  disparado por eventos de la Live Client Data API. En curso (fase C0): ver
  "Motor de clips (Fase 2, bloque 5)".

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
- ~~"En Vivo" (selección de campeones)~~ — hecho en la v0.4.0 (Fase 2, bloque 3; LCU en `src/lcu.js`).
- ~~"Meta" (tier list, counters, tendencias)~~ — hecho en la v0.3.0 (Fase 2, bloque 2; datos de OP.GG).
- ~~"Ajustes → Apariencia" y "Ajustes → Notificaciones"~~ — hechas en la v0.8.0 (Fase 2, bloque 4).
- ~~El motor de clips~~: en curso (Fase 2, bloque 5; fase C0).

## Referencia visual

El diseño completo de todas las pantallas (13 tableros) está en un Claude
Artifact (tipo Design/canvas), no en este repo:
`https://claude.ai/artifact/46xGEAX3s83srpnFYK4rr4`

Incluye: ventana flotante, pantalla de carga, en partida, login, Mi Perfil +
su estado sin conexión, En Vivo (selección y ya-elegiste), Meta, y los 4
sub-tabs de Ajustes (Cuenta/Overlay/Apariencia/Notificaciones). Usa esos
mockups como referencia de estilo (colores, tipografías Inter/Rajdhani,
tono oscuro con acento turquesa `#00e5c7`) al construir cada pantalla real.

## Diseño y marca (decisiones de Alex, oct 2026)

- **Las decisiones de este archivo mandan sobre las skills de diseño** de `.claude/skills/`
  (taste, impeccable, emil…): las skills aportan criterio y técnica, pero no cambian el stack ni
  la marca por su cuenta.
- **Stack**: web y app en HTML, CSS y JavaScript sin frameworks (nada de React/Next/Tailwind).
  Alex lo conoce y aporta lógica e ideas en ese formato.
- **Identidad «Abisal» (v0.9.0)**. La guía oficial es el brandkit
  `https://claude.ai/artifact/YcCHQQLcgoXPxHes6AB3UH` (tokens, logo, íconos, voz, vocabulario y
  componentes de muestra): **leerla antes de diseñar algo nuevo**. Resumen en `PRODUCT.md` (raíz);
  tableros del proceso en el canvas `https://claude.ai/artifact/TXBprLRBTFAGZVEA5SGcnG`.
  - **Se conserva el layout** de la web y la app. Cambiaron colores, vocabulario, fuentes, íconos y logo.
  - **Fuentes**: Unbounded en títulos (mayúsculas), Albert Sans en la interfaz y Red Hat Mono en las
    cifras (LP, KDA, winrate, tiempos, versión). Los nombres de rango («Oro II») van en Albert Sans 800.
  - **Fases**: 1 brief, 2 dirección, 3 logo + íconos + brandkit y 4 aplicado en el código (hechas).
    Falta la 5: auditoría y release v0.9.0.
  - **En la app**: los tokens de `:root` de `renderer/style.css` tienen los valores Abisal y al final
    del archivo está el bloque «v0.9 — identidad Abisal». Los acentos de Apariencia conservan sus
    claves (`turquesa`, `lila`…) con los tonos nuevos.
  - **Mi Perfil**: sin la etiqueta «Conectado a SharkTracker». El punto del chip de Discord
    (`.discordchip .dcdot`) es el indicador de conexión: `marcarConexion()` en `renderer/perfil.js`
    le pone la clase `offline` (salmón, tooltip «Sin conexión: mostrando datos guardados»). Sin
    conexión, el botón junto al rango dice «Reintentar conexión».
  - **Rachas**: «Frenesí» (ícono de fuego, `--frenesi`) y «Marea baja» (hielo, `--helado`), en
    `perfil-calculos.js` (íconos `fuego` / `hielo`) y en las etiquetas de En Vivo y la pantalla de carga.
- **Íconos**: SVG propios para lo que no existe en librerías (íconos de LoL: dragón, Barón, torre…) y
  para lo que es identidad; para íconos utilitarios se puede usar una librería con el mismo trazo.
  Figma (conectado) se usa cuando ayuda a diseñar mejor (íconos en grilla, logo, tableros).
- **Íconos Abisal**: siluetas en `assets/iconos/*.svg` (raíz del repo); los de objetivos están
  copiados en `src/overlay/icons.js` y en `assets/lol-icons.js` de la web.
- **SharkTracker es independiente de la marca personal "KyoSumi"** (skill `marca-kyosumi`, Marea
  Nocturna): no se usa esa guía para la web ni para la app.

## Estado actual del código

**Fase 1 completa y validada por Alex en partidas reales (29/09/2026)**: login con
Discord, overlay en partida (Barón/Ancestral, avisos, oro con Tab, Tu rendimiento),
pantalla de carga (con Ctrl + X), Ajustes → Overlay con editor y Mi Perfil.
**Fase 2 en curso** (plan acordado): Bloque 0 puesta a punto ✅ · Bloque 1 early access ✅
(instalador + actualizaciones automáticas) · Bloque 2 Meta (v0.3.0, datos del MCP de OP.GG
guardados en Supabase; ver sección "Meta") ✅ · Bloque 3 En Vivo ✅ · Bloque 4 Ajustes Apariencia/Notificaciones ✅ (v0.8.0, ver abajo) · Bloque 5 motor
de clips + timers de campamentos. La app es **solo para el grupo de amigos** (no pública).

## Versión, empaquetado y publicación (Fase 2, bloques 0 y 1)

- **Versión**: sale de `package.json` (`app.getVersion()`); la barra de título muestra
  "vX.Y.Z" y Ajustes → Cuenta → "Acerca de" la versión completa + el aviso legal de Riot
  (también en el pie de index.html y perfil.html de la web).
- **Electron 44**. supabase-js sigue recibiendo `ws` como
  transporte de realtime.
- **Empaquetado**: electron-builder (campo `build` de package.json): instalador NSIS de un
  clic por usuario, `SharkTracker-Setup.exe` (nombre fijo, sin versión: así
  `releases/latest/download/SharkTracker-Setup.exe` siempre es el último), registra `sharktracker://`.
  `npmRebuild: false` (uiohook-napi trae binarios N-API precompilados; quedan fuera del
  asar solos). Sin firma de código: Windows avisa "Windows protegió tu PC" la primera vez.
- **Actualizaciones**: electron-updater desde **GitHub Releases** (repo público): busca al
  abrir y cada 4 h, descarga sola, instala al cerrar o con "Reiniciar y actualizar". Cuando la
  versión nueva está descargada, la barra de título muestra "vX.Y.Z lista · Reiniciar" (`#update-chip`).
  Solo en la app instalada (con `npm start` no).
- **Publicar una versión**: subir `version` en app/package.json (merge) → pestaña Actions
  del repo → **"App: publicar versión"** → Run workflow (`.github/workflows/app-publicar.yml`,
  arma en windows-latest, sube a un Release en borrador y lo publica como `vX.Y.Z`; GitHub
  no deja crear un Release ya publicado sin etiqueta). Probar local: `npm run dist`.
  **Notas del parche**: al publicar, agregar la versión arriba del todo en `NOTAS` de
  `descargar.html` (sección "Notas del parche", visible para todos).
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
    ajustes-app.js       → Ajustes → Apariencia (acento, ventana) y Notificaciones, en userData/ajustes.json
    notificaciones.js    → avisos de Windows del grupo (cada 60 s); textos en notificaciones-calculos.js
    overlay-config.js    → ajustes del overlay (qué se ve, dónde, tamaño y opacidad) en userData/overlay.json,
                           y la captura de fondo opcional del editor
    preload-editor.js    → contextBridge (window.editor) de la ventana "Reposicionar elementos"
    lcu.js               → API local del cliente de LoL (En Vivo): fase, selección, runas, build, hechizos
    meta.js              → Meta: catálogos de DDragon y llamadas a la Edge Function `meta`
    build-adaptada.js    → build contra el equipo rival y "siguiente compra" (sin Electron, se prueba en Node)
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
      envivo.js          → dibuja En Vivo (selección de campeones y partida en curso)
      meta.js            → dibuja Meta (tier list, ficha, tendencias)
  pruebas/
    prueba-clips-C0.bat  → prueba C0 del motor de clips (ver "Motor de clips")
```

Para correrla: abrir el repo en VS Code, y en la terminal `cd app`,
`npm install` (una vez, y cada vez que cambien las dependencias) y `npm start`.

Notas técnicas:
- Nombre visible "SharkTracker" (`productName`), AppUserModelId `lol.sharktracker.app`.
- El renderer tiene una CSP estricta (sin scripts inline): no usar `onclick="…"` ni
  `<script>` dentro del HTML; los eventos se enganchan desde `app.js`.
- supabase-js recibe `ws` como `realtime.transport` (ver "Electron 44" arriba).
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
- ✅ Parte C (v0.5.0): build adaptada al equipo rival. Ver "Build adaptada y build en partida".
- ✅ "Contra {rival}" (v0.6.0): guía de enfrentamiento de OP.GG (`lol_get_lane_matchup_guide`)
  contra tu rival de línea. La pide la función `meta` con `rival_id` (caché en `meta_campeon` con
  elo = `vs_<rival_id>`). Esa herramienta solo acepta `lang` en_US / ko_KR (el consejo llega en
  inglés) y no filtra por elo (todos los elos). Trae: quién gana la línea y quién mata más en
  solitario, estilo recomendado, consejo, hechizos/botas/inicio/core, orden de habilidades y
  **varias páginas de runas** (hasta 3, cada una con su botón "Importar"): es el selector de runas
  alternativas (`lol_get_champion_analysis` solo da una página).
  Bloque 3 cerrado.

## Build adaptada y build en partida (Fase 2, bloque 3 parte C — v0.5.0)

- `src/build-adaptada.js` (main, sin Electron, se prueba en Node): parte de la ficha de Meta y
  de los campeones rivales. Perfil del rival: tipo de daño por `info.attack`/`info.magic` de
  DDragon (diferencia < 2 = mixto, cuenta 0,5 y 0,5), tanques/asesinos por el primer tag, y
  listas escritas a mano de los que se curan (`CURAN`) y de mucho control (`CONTROL`).
  Reglas: se curan → Heridas Graves; 3+ físico → armadura; 3+ mágico → resistencia mágica;
  2+ tanques → penetración; 2+ asesinos → defensivo; botas: Mercurios (3+ mágico o 2+ de
  control) o Botas de acero (3+ físico). El objeto sale primero de los situacionales de OP.GG
  (⭐ en En Vivo), luego de `PREFERIDOS` (por tipo de tu campeón: ad/ap/tanque, deducido de los
  objetos de su build) y si no, del catálogo (etiquetas de DDragon: objetos terminados de la
  Grieta, `final`; Heridas Graves = la descripción lo dice). Máximo 3 sugerencias + botas.
- En Vivo: sección "Contra este equipo" en la tarjeta de build (se recalcula al fijar cada
  rival) y botón **"Importar build adaptada"** (set con un bloque "Contra este equipo" al
  principio; reemplaza el set anterior de SharkTracker, como "Importar build").
- **Build en partida**: en partida, **Ctrl + X** muestra/oculta la build completa en orden
  (inicio, core, botas, 4.º–6.º con lo adaptado ⭐ y su motivo), panel `#build` en la zona
  izquierda del overlay (x 16, y 16; 430 px; movible en el editor). Empieza oculta en cada
  partida; al estar lista sale 12 s la pista "Ctrl + X: tu build". Lo comprado sale con ✓
  (`misObjetos` en `overlay:state`). main.js `prepararBuild`: una vez por partida (reintento a
  los 30 s si falla), solo en la Grieta (mapa 11). Campeón por `rawChampionName`; rol: el de la
  partida (`position`), si no el de la última selección (lcu) con ese campeón, si no el rol
  donde más se juega (`meta_tier.role_rate`). Interruptor "Tu build" en Ajustes → Overlay.

## Feedback de la v0.5 (v0.6.0)

- **Vacuolarvas del rival**: la API avisa de cada una aunque no haya visión (Riot/Vanguard: solo
  info que el juego te da). La API no dice qué ves, así que las del rival solo se muestran cuando
  terminan el grupo (las 3, o `LARVAS_TANDA` = 15 s sin otra), de golpe, como el anuncio del juego.
  Las de tu equipo siguen una a una.
- **Importar runas sin hueco**: reemplaza la página seleccionada en el cliente (si no se puede
  borrar, tu primera página propia) y el aviso dice cuál. Solo hay UNA página de runas por
  campeón/rol (la más usada en OP.GG Esmeralda+); no hay selector de alternativas todavía.
- **Siguiente compra** (`siguienteCompra` en build-adaptada.js): primer objeto de la build que no
  tienes, coste restante descontando componentes que ya llevas (receta `desde` de DDragon) y, si
  no te alcanza, el componente más caro que te falta; oro = `activePlayer.currentGold`. Pieza
  `#siguiente` del overlay (x 1395, y 1000; 240 px, a la izquierda del minimapa), interruptor
  "Siguiente compra" y movible en el editor.
- **Partida en la app** (segundo monitor): main.js `avisarPartidaApp` manda a la ventana
  (`partida:datos`) el panel de carga, la build, lo comprado y la siguiente compra, desde la carga
  hasta que termina la partida. `renderer/envivo.js` los dibuja en En Vivo (salta sola al empezar
  la carga).

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

## Rediseño visual (v0.7.0, oct 2026 — mockup "SharkTracker — mejoras visuales")

Mockup: `https://claude.ai/artifact/6gK8Gg31m9YjTo1ptqaLt8`. Un solo PR con app + web + overlay OBS.
- **App** (`renderer/style.css`, bloque "v0.7" al final): tarjetas sólidas `#0c131d` sin la franja de
  color de arriba ni brillos; títulos sin degradado; grises más claros (texto mínimo: ver v0.8.1)
  (`#8696a8` / `#7d8ea0` / `#a9b7c6`); números tabulares; íconos SVG en el menú lateral (`.navico`);
  foco visible (`:focus-visible` turquesa); siluetas `.esqueleto` mientras carga Mi Perfil.
  Mi Perfil: las etiquetas van en fila debajo del nombre (ya no hay tarjeta "Etiquetas") y el radar
  es más grande (260×240).
- **Overlay en partida** (`overlay/overlay.css`): todos los textos +1 px, números tabulares, `--tenue`
  más claro. **La transparencia del panel sigue en 0.8** (Alex no la quiere más opaca). Las piezas
  se ensancharon un poco y sus posiciones de fábrica se movieron para que sigan cabiendo
  (rendimiento x 1676 / 234 px, avisos x 1634 / 276 px, carga x 1484 / 420 px, build 452 px,
  siguiente x 1385 y 996 / 250 px; quien ya movió una pieza conserva la suya). El Alma ya no
  brilla: solo borde dorado. ⭐ de lo adaptado pasó a "★" (toma el color dorado del texto).
- **Web**: `assets/tema.css` (se carga después del `<style>` de cada página, excepto `overlay.html`)
  - **Paleta única** en el `:root` de `tema.css` (`--bg`, `--panel`, `--field`, `--placeholder`, `--text-soft`, `--accent`, `--on-accent`, `--danger`, `--green`, `--gold`/`--gold-soft`, `--blue`/`--blue-soft`, `--red`/`--red-soft`, `--twitch`, `--discord`…). En el CSS de las páginas se usa `var(--…)`, nunca hex sueltos; el `:root` de cada página solo guarda sus colores propios (p. ej. `--a`/`--b` de Versus). Rojos: `--danger` (#ff5f3d, en vivo/errores) ≠ `--red` (#ff5f6d, equipo rojo).
  - Texto mínimo 12 px; 11 px solo para etiquetas en MAYÚSCULAS / con letter-spacing. Imágenes que rellena el JS van sin `src` (tema.css las oculta hasta tenerlo), nunca `src=""`.
  - Imágenes generadas por JS con `loading="lazy" decoding="async"`.
  - **Esqueletos de carga**: `.sk-stack` (contenido real + `.sk` en la misma celda) + `assets/esqueletos.js`; fundido cruzado de 300 ms cuando llegan los datos, y `document.dispatchEvent(new Event('sharktracker:listo'))` al terminar la primera carga para soltar los que queden. Dos formas: (1) junto a un contenedor que el JS rellena (inicio, rewind) y (2) `data-sk-de="main"` en el propio `#loading`, que se funde cuando `#main` se hace visible (tienda, versus, estadísticas, partidas, en vivo, reto, perfil; `data-sk-error` = aviso de error que lo quita). Piezas en tema.css: `.sk-pagina`, `.sk-panel`, `.sk-fila`, `.sk-col`, `.sk-rejilla.sk-cN`, `.sk-solo-pc`. Las animaciones del inicio (podio, LP, ranking) son solo del inicio. Para desplegar algo, animar `grid-template-rows`/`opacity`, no márgenes.
  y `assets/iconos.js` (`icono(nombre, {size, color, title})`, reemplaza a los emoji). ❄️ es el
  indicador de **mala racha** (no un cosmético): en el ranking va en su propia columna
  "Racha · últimas 5". Los emoji de la tienda (cosméticos que eligió cada jugador) e insignias
  (vienen de la base) se quedan.
- **Web, segunda pasada (pulido para la 1.0, oct 2026)**: en el primer PR solo el inicio se había
  reestructurado; las demás páginas solo tenían el tema común. Ahora cada una sigue su tablero:
  tienda (saldo con "esta semana" e insignias, pestañas subrayadas, premios compactos, precio en el botón),
  perfil (banner de 300 px con degradado lateral, rango a la derecha, objetivo + estado de partida lado
  a lado, historial junto a LP y Rewind), versus (los dos jugadores en un panel, azul vs rojo), estadísticas
  (filtros en panel, totales en una franja), partida (resumen azul | marcador | rojo), en vivo (filas en dos
  columnas en vez de cartas), reto (cabecera compacta con cuenta atrás a la derecha) y rewind (tarjetas con
  ícono). Destacados del inicio: el JS elige 5, 4 o 3 columnas para que las filas queden parejas.
- **Overlay OBS** (`overlay.html`): panel sólido `rgba(8,16,26,.94)`, borde fino y sombra, sin barra
  lateral ni brillos; etiquetas en minúsculas a 14 px; íconos SVG. Mismo tamaño y parámetros.

## Ajustes → Apariencia y Notificaciones (Fase 2, bloque 4 — v0.8.0)

Mockup: tableros "Ajustes — Apariencia" y "Ajustes — Notificaciones" del canvas de la app.
Decidido con Alex: color de acento + overlay + ventana; tema claro y "Versiones temáticas"
quedan como "Próximamente" (el claro obligaría a rehacer ~400 colores fijos). Avisos = los del
grupo del mockup (no los de la app).
- `ajustes-app.js` (main): `userData/ajustes.json` → `acento` (turquesa/lila/dorado/azul/rojo),
  `ventana` (`siempreEncima`, `bandeja`, `alIniciar`, todo apagado de fábrica) y `avisos`
  (`dientes`, `misiones`, `semana`, `retos`, encendidos de fábrica). IPC `ajustes:get/set`,
  `ajustes:changed`, `ajustes:probarAviso`.
- **Acento**: `renderer/style.css` usa `--acento` (y `--acento-claro`/`--acento-oscuro` con
  color-mix) en lugar del turquesa fijo; app.js la cambia. **El overlay en partida sigue en
  turquesa** (azul y rojo ahí son los equipos).
- **Overlay**: `overlay-config.js` guarda `apariencia: { escala (0.8–1.2), opacidad (0.5–0.95, 0.8 de
  fábrica) }`; overlay.js multiplica `--s` por la escala y pone `--op` (alfa de `--panel` y de los avisos).
- **Ventana** (main.js `aplicarVentana`): `setAlwaysOnTop`; bandeja con `Tray` (Abrir / Salir) y la ×
  solo esconde (`saliendo` = true al Salir, al actualizar y en `before-quit`); `setLoginItemSettings`
  con `--al-iniciar` (solo app instalada): con bandeja activada arranca escondida.
- **Avisos** (`notificaciones.js` + `notificaciones-calculos.js`, este último se prueba en Node): cada
  60 s, con sesión y cuenta vinculada, lee con tu sesión (tablas de lectura pública, **sin SQL nuevo**)
  lo que pasó desde la última vuelta (`userData/avisos.json`: `desde` y `semana`; al abrir, nunca más
  de 12 h atrás; la primera vez empieza "desde ahora"): `wallet_tx` (dientes > 0, juntos en un aviso)
  y `prize_claims.resolved_at` (premio entregado/rechazado); `player_missions.completed_at` y
  `mission_weeks.group_completed_at`; `challenges` que empiezan o terminan (+ ganador y tu puesto de
  `challenge_results`); resumen de tu semana el lunes ≥ 6:00 Madrid (hasta 3 días después): misiones,
  dientes y Top N (`wallet_tx` reason `top`, detalle "Top N de la semana"). Máx. 4 avisos por vuelta.
  Clic → abre la página en sharktracker.lol. Solo llegan con la app abierta o en la bandeja.

## Motor de clips (Fase 2, bloque 5) — en curso (fase C0)

Decisiones de Alex (oct 2026).
- **Arquitectura**: FFmpeg (build LGPL recortado, ~20–30 MB) como proceso aparte e invisible dentro de la
  carpeta de la app (como PowerShell para el LCU): la app lo abre al `GameStart` y lo cierra al terminar.
  Captura por GPU (`ddagrab`, Desktop Duplication) + codificación por **hardware** (NVENC / AMF / QuickSync),
  prioridad baja. Búfer en anillo de trozos de 2 s en disco (`-f segment -segment_wrap`), con margen para
  30 s antes + 30 s después. Guardar = pegar trozos sin recodificar (`-c copy`): instantáneo, sin pérdida.
  El overlay se excluye de la captura con `setContentProtection(true)` (opción para incluirlo).
- **Audio** (Ajustes → Clips → Audio): juego (solo League), Discord, micrófono (elegir dispositivo) o todo el
  PC (elegir salida), cada uno con on/off y volumen; opción de pistas separadas en el .mp4. Captura por
  aplicación (WASAPI process loopback, Windows 10 2004+/11) con un ayudante nativo pequeño, también invisible
  (FFmpeg no la trae). Avisar al grupo que se graban voces de Discord.
- **Calidad**: Máxima (resolución de la pantalla hasta 1440p, 60 fps) · **Alta de fábrica (1080p60, H.264)** ·
  Ligera (720p30). Sin GPU compatible → Ligera por defecto. HEVC/AV1 como opción si la GPU lo soporta.
- **Todo opcional**: interruptor general en Ajustes → Clips, **apagado de fábrica**; la primera partida pregunta
  una vez si se activa. Apagado = no se graba nada.
- **Eventos (de fábrica, cada uno con interruptor)**, solo si participaste (autor, asistencia o víctima, según
  la Live Client Data API): kill, multikill, muerte, objetivos (dragón, Barón, Heraldo, larvas) y estructuras
  (torres, inhibidores). **Ulti**: la API no la avisa; se detecta la tecla de la R (uiohook, configurable si la
  cambiaste) y cuenta solo si en los **10 s siguientes participas en una kill u objetivo**. Opción "cada ulti"
  apagada de fábrica (Elise, Jayce, Nidalee, Karma la usan a cada rato).
- **Duración**: **20 s antes y 15 s después** de fábrica; ajustable de 10 a 30 s en cada lado. Eventos
  encadenados = un solo clip (del primero −antes al último +después), tope 2 min.
- **Atajo manual: Ctrl + F8**.
- **Espacio**: límite de **10 GB** para clips normales (se borran los más viejos); los **favoritos (★) no cuentan
  ni se borran solos**. Aviso si el disco queda con menos de 15 GB libres.
- **UI**: sección "Clips" (galería por partida con miniaturas, reproducir, renombrar, favorito, borrar, abrir
  carpeta) + Ajustes → Clips.
- **Fases**: C0 prueba (script que mide FPS/CPU/RAM con y sin grabar en la PC de Alex y la de un amigo, y valida
  el audio por aplicación) → C1 búfer + Ctrl+F8 → C2 eventos automáticos → C3 sección Clips + ajustes →
  C4 extras (resumen de la partida; base para leer el minimapa de los timers de campamentos).
  Meta: < 3 % de FPS, < 150 MB de RAM, < 5 % de CPU.
- **C0 (prueba)**: `app/pruebas/prueba-clips-C0.bat` (un solo archivo: .bat + PowerShell embebido tras `#PS-INICIO`).
  Pide admin (PresentMon lo necesita), baja FFmpeg LGPL (BtbN) y PresentMon a `%LOCALAPPDATA%\SharkTracker-prueba-clips`,
  prueba qué codificador funciona (NVENC directo / con copia a memoria para laptops híbridas, AMF, QuickSync),
  espera la partida (Live Client API, `gameTime` > 15 s) y mide 4 tramos de 75 s (sin / con / sin / con grabar):
  FPS y 1 % bajo (PresentMon), CPU, GPU 3D y codificador (CIM, independiente del idioma de Windows), CPU y RAM de
  FFmpeg. Graba como la app: `ddagrab` + trozos de 2 s en anillo; al final arma un clip con `-c copy`. Deja
  `resultados-clips-C0.txt` y `clip-prueba-C0.mp4` junto al .bat. El audio por programa solo se comprueba por
  versión de Windows (la prueba real va en C1 con el ayudante nativo). Equipos de prueba: RTX 3060 12 GB (Alex)
  y RTX 4060 laptop (amigo); en el grupo hay una AMD (AMF), todos con Windows 11.

## Estilo visual del overlay (acordado con Alex — tableros "Overlay — estilo
visual" y "Overlay — estructuras" del canvas)

- TODO el estilo de sharktracker.lol: paleta (#030812, paneles rgba(8,18,29,.9),
  borde #16324a, acento #00e5c7, dorado #facc15), Rajdhani para tiempos/etiquetas
  (etiquetas en MAYÚSCULAS) e Inter para texto.
- **Regla de color única: lo hace o lo tiene tu equipo → azul #4c9dff; el enemigo →
  rojo #ff5f6d** (colores relativos de LoL). Objetivos con su color propio (dragón
  por elemento), Alma en dorado (desde v0.7 sin brillo, solo el borde).
- Íconos: SVG propios (mismo set que assets/lol-icons.js de la web), sin imágenes
  externas. Fichas de campeón **variante B**: cuadrado redondeado con borde del
  equipo y retrato de DDragon (respaldo: iniciales).
- Animación: **solo entrada y salida** (250 ms, opacidad + posición), una vez por
  aviso. Nada en bucle. Urgencia (últimos 10 s) solo cambia el color.

## Plan del overlay "En partida" (acordado con Alex)

1. ✅ Ventana del overlay + Barón/Ancestral + anuncios de objetivos + toasts de
   dragón/alma, Vacuolarvas (x de 3, una sola aparición a las 8:00) y Heraldo.
   Probado en partida real. Atakhan ya no existe en el juego (quitado). **Barón aparece a
   las 20:00** (visto en partida real).
   ✅ Estructuras: toast de torre/inhibidor destruido (qué nivel y carril) y aviso
   1:00 antes de que reaparezca un inhibidor (5:00 tras caer).
2. ✅ Diferencia de oro **solo con Tab pulsado**:
   `uiohook-napi` en el proceso main escucha SOLO la tecla Tab mientras hay partida.
   Oro = suma de `items[].price × count` (lo visible en el Tab). Fila i = i-ésimo
   aliado vs i-ésimo enemigo (orden de `allPlayers`). La flecha **apunta al jugador
   con más oro** ("◀ 425" = el de la izquierda, "425 ▶" = el de la derecha) y el color dice de quién es: azul tu equipo, rojo el rival. Filas a y = 352/428/501/577/653 (1920×1080),
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
     avisos de lo que pasó (toasts), Tu rendimiento y Tu build (Ctrl + X). Se aplican al instante (IPC
     `overlay:config`), también en partida. "Timers de campamentos" y la
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
- **"Tu build"** y **Meta**: hechos con el MCP de OP.GG (ver "Meta" y "Build adaptada y build en partida").
- **Timers de campamentos**: SÍ se quieren, solo de campamentos cuya muerte se vio
  (como Blitz/Porofessor/Itero). La API local no tiene eventos de campamentos: hay
  que leer el minimapa por captura de pantalla → se hace después, reutilizando la
  captura del motor de clips. Revisar la política de Riot antes de publicarlo.

## v0.8.1: auditoría visual de la app (accesibilidad y pulido)
- Paleta en el `:root` de `renderer/style.css` (`--fondo`, `--panel`, `--texto`, `--texto-tenue`, `--texto-apagado`, `--texto-mudo`, `--verde`, `--en-vivo`, `--dorado`, `--rojo-suave`, `--salmon`, `--lila`, `--azul`, `--rojo`, `--discord`, además de `--acento`). En el CSS se usa `var(--…)`; los hex sueltos que quedan son tonos únicos. `editor.css` usa las variables del overlay más `--ed-*`.
- Texto mínimo 12 px en la app (11 px solo en etiquetas en MAYÚSCULAS); en el overlay, mínimo 11 px (se agranda con la escala de Apariencia).
- Menú lateral = `<nav>` con `<button class="navitem">` y `aria-current="page"` (se usa con Tab + Enter).
- `prefers-reduced-motion`: todo lo que late en bucle da una sola pasada.
- Íconos (`icono()` en meta.js, envivo.js y perfil.js) con `loading="lazy"`.
- Nada de guiones largos (—) en los textos; se usa `:`, `·` o una coma. "—" solo como valor vacío en números.
- **Movimiento** (sección final de style.css, criterio Emil Kowalski): curvas `--ease-out` / `--ease-in-out`; todo < 300 ms salvo el acento.
  - Botones: hover 150 ms y `scale: .97` al presionar (`:where(button)`, sin especificidad). Interruptores: la bolita se desliza con `transform`.
  - Menú lateral y pestañas de Ajustes: un indicador (`.nav-indicador` / `.stab-indicador`, creado en app.js) se desliza al activo; el contenido cambia al instante.
  - `--acento` registrado con `@property`: se funde 300 ms al cambiarlo.
  - En Vivo: `cascada()` hace entrar las tarjetas en cascada (al entrar a selección, fijar campeón o empezar la carga) y sigue donde iba si la vista se repinta; los botones de importar cambian de texto dentro del propio botón.
  - Chip de estado con fundido al cambiar; chips que aparecen con `scale(.95)`; avisos que suben 4 px.
  - Con reducir movimiento: sin desplazamientos, solo fundidos.
  - No se animan: el contenido al cambiar de sección, las filas de la tier list, los relojes ni nada del teclado.

## Key de Riot y PUUID

Riot cifra los PUUID **por key**: al pasar de la key de desarrollo a la personal
(30/09/2026) los guardados en `players.puuid` dejaron de valer (Riot responde **400**).
`sync-riot-data` lo cura solo: si la liga responde 400 con un PUUID guardado, lo vuelve a
sacar con el Riot ID (account-v1) y lo guarda. Las demás Functions leen `players.puuid`, así
que se arreglan en cuanto corre (cada minuto). Si algún día se cambia la key, pasa lo mismo.

## Pendiente fuera de la app

- ✅ Dominio `sharktracker.lol` (GitHub Pages, HTTPS) activo; Site URL de Supabase y
  SQL de Discord aplicados. `kyosharkcode.github.io` ya se quitó del CORS de las Edge Functions (v0.2.0).
- ✅ Electron actualizado a la v44.

## Estilo de comunicación de Alex

- Español (LatAm), directa, respuestas concisas.
- Prefiere que se le den decisiones tomadas con su razonamiento breve, no
  listas de opciones genéricas.
- Sabe desarrollo web pero es su primera app de escritorio — explica términos
  nuevos (terminal, IPC, etc.) sin asumir que los conoce, pero sin ser
  condescendiente.
