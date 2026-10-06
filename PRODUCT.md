# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Código existente; se mantiene por decisión de Alex:
- **Web y app**: HTML, CSS y JavaScript sin frameworks (nada de React, Next ni Tailwind).
- **Web** (sharktracker.lol): estática, sin build, publicada con GitHub Pages desde la raíz del repo.
- **App de escritorio** (`app/`): Electron, en Windows 11.
- **Backend**: Supabase (Postgres con RLS, Edge Functions, Realtime y cron).

## Users

- **Principal: el grupo de amigos de Alex**, que juega SoloQ de League of Legends en el servidor LAN (la1), todos con Windows 11.
  - La **app** la usan antes, durante y después de sus partidas: perfil, En Vivo, Meta y builds, overlay en partida y, pronto, clips.
  - La **web** la usan para ver el ranking, compararse, picarse en las insignias y gastar 🦷 en la tienda.
- **Secundario: los viewers del stream de Alex** (KyoSumiVT, Twitch/Discord). Llegan a la web desde el directo o la comunidad. No juegan en el grupo, pero ven el ranking, el podio, la partida en vivo y el overlay de OBS. Por eso la web también tiene que lucirse ante gente de fuera.

## Product Purpose

Tracker privado de un grupo de amigos que convierte la SoloQ en una competencia compartida:
- ranking en vivo, historial y estadísticas;
- insignias, retos, misiones semanales y una tienda de recompensas con 🦷;
- avisos en Discord.

La app suma herramientas para jugar mejor: overlay en partida, build adaptada, meta, consejo de IA y, más adelante, clips.

**Éxito:**
- El grupo vuelve cada día porque le motiva jugar y mejorar.
- No necesitan abrir OP.GG, Porofessor ni League of Graphs, porque SharkTracker ya les da eso dentro de su propio grupo.

## Positioning

Tan útil y completo como OP.GG, Porofessor o League of Graphs, pero con dos diferencias:
- **Gira en torno al grupo** (ranking entre amigos, piques, recompensas compartidas), no a datos globales anónimos.
- **No se ve tosca, simple ni técnica.** Nunca puede parecer una web de 2013.

## Operating Context

- **App:**
  - corre junto al cliente de LoL (LCU) y dentro del juego, con el overlay sobre la partida;
  - se usa en ratos cortos entre partidas, a menudo con una partida a punto de empezar.
- **Web:**
  - se consulta en PC y en celular y se muestra en el stream;
  - se actualiza sola por Realtime.
- **Datos:**
  - fuentes: Riot API, Data Dragon, Twitch, OP.GG (meta) y Gemini (consejos de IA);
  - historial de 30 días.

## Capabilities and Constraints

- **Web:** ranking, podio, perfil, detalle de partida, partida en vivo, estadísticas, versus, retos, tienda, rewind, overlay de OBS, login con Discord y panel de admin.
- **App:**
  - Mi Perfil, En Vivo (selección de campeón y en partida), Meta y Tu build, overlay por mapa, Ajustes (apariencia y notificaciones);
  - motor de clips en curso (fase C0).
- **Restricciones fijas:**
  - la key de Riot nunca va dentro de la app;
  - texto de 12px como mínimo (11px solo en etiquetas en mayúsculas);
  - se respeta `prefers-reduced-motion`;
  - zonas táctiles de 44px en celular;
  - el overlay en partida conserva sus animaciones de entrada y salida, nada en bucle, y la opacidad de sus paneles es 0.8.
- **Región:** los datos del servidor solo funcionan para LAN (la1 / americas).
- **Sin fines de lucro:** proyecto personal, no respaldado por Riot Games.

## Brand Commitments

- **Nombre:** "SharkTracker".
- **Símbolo:** el tiburón, que se queda. Todo lo que hace Alex lleva la marca Tiburón/Shark.
- **Independiente de la marca "KyoSumi"** (Marea Nocturna): no se usa esa guía.
- **Estética base:** neón / cyberpunk futurista. Todo lo demás (paleta, tipografía, logo, íconos) cambia en el rebranding de oct 2026.
- **El layout actual se conserva** (decisión de Alex, 06/10/2026): el rebranding cambia colores, vocabulario, fuentes, íconos y logo, pero no la estructura ni la forma de comunicar de la web y la app. Por ejemplo, la web mantiene el menú hamburguesa, el título centrado, el podio con splash art y el orden de sus secciones. La barra de enlaces arriba al estilo OP.GG es justo lo que NO se busca.
- **Dirección elegida: «Abisal»** (06/10/2026). Fondo abisal, verde agua bioluminiscente (#3DFFD2), violeta medusa (#A98BFF), ámbar señuelo (#FFB547) y coral (#FF6F8E). Fuentes: Unbounded (títulos), Albert Sans (interfaz) y Red Hat Mono (cifras). Símbolo: aleta sobre la línea de agua con ondas de sonar.
- **Logo: «Tiburón sonar»** (elegido el 06/10/2026). El tiburón se curva en una «C» y su cola se convierte en ondas de sonar, con un degradado de verde agua a violeta.
  - Se generó con la IA de Figma y se vectorizó.
  - Archivos en `logo/`:
    - `simbolo.svg`: color, para fondos oscuros;
    - `simbolo-oscuro.svg`: para fondos claros;
    - `simbolo-claro.svg`: una tinta;
    - `favicon.svg`: sin las ondas, para tamaños de 24 px o menos.
  - Fuente editable: archivo de Figma «SharkTracker — Marca».
  - Logotipo: símbolo + «SHARKTRACKER» en Unbounded Bold, con «TRACKER» en verde agua.
- **Personalidad:** competitiva, motivante, útil, limpia.
- **Vocabulario marino** (elegido por Alex el 06/10/2026). Solo estas cinco palabras; no se agrega más jerga marina sin preguntar, para que no se vuelva disfraz:
  - **Sonar**: reemplaza a «Actualizado» (por ejemplo, «Sonar · hace 28 s»);
  - **Frenesí**: racha de victorias;
  - **Marea baja**: mala racha;
  - **Emergió**: subió de división (por ejemplo, «Emergió a Oro I»);
  - **Se hundió**: bajó de división.

  Los nombres de los destacados e insignias del grupo no se cambian.
- **Voz, mezclada según el contexto:**
  - técnica y precisa en estadísticas, meta, builds y recomendaciones de la app;
  - burlona y juguetona en las insignias y en la web, donde el grupo se pica.
- **Íconos (Abisal, 06/10/2026):**
  - Generados con la IA de Figma, aprobados por Alex y vectorizados en `assets/iconos/*.svg`.
  - Son siluetas sólidas de 24×24 con `currentColor`, legibles a 16 px porque se usan en la web, la app y el overlay.
  - El set:
    - **objetivos:** dragón, Barón, Heraldo, Vacuolarvas, torre e inhibidor;
    - **roles:** top, jungla, medio, ADC y soporte;
    - **interfaz:** diente (moneda), Frenesí (fuego, ámbar #FFB547) y racha de derrotas (hielo, cian helado #7FD4FF).
  - **Estética de las rachas:** la de victorias es caliente (fuego) y la de derrotas es fría (congelada). Nada de olas para las derrotas.
  - Los íconos utilitarios (cerrar, flechas, ajustes) salen de una librería de trazo similar.
  - Fuente editable: archivo de Figma «SharkTracker — Marca», página «Íconos — Abisal».

## Evidence on Hand

- **Logos actuales** en `logo/` (`MainLogo.webp`, `HorizontalLogo.webp`, `FlaviIconLogo.*`): tiburón con degradado cian→magenta y wordmark en cursiva. Es la referencia a reemplazar.
- **Moodboard:** https://claude.ai/artifact/YZ6x5iK3Wi8xB4a2U6Mf3q
- **Canvas de mockups** de la app y la web, y el de pulido visual: https://claude.ai/artifact/6gK8Gg31m9YjTo1ptqaLt8
- **Brandkit «SharkTracker · Abisal»**, la guía oficial de la marca (tokens, logo, íconos, voz, vocabulario y componentes de muestra): https://claude.ai/artifact/YcCHQQLcgoXPxHes6AB3UH. Hay que leerla antes de diseñar cualquier pieza nueva.
- **Datos reales** en Supabase (jugadores, rangos, partidas, insignias). No inventar jugadores, estadísticas ni testimonios.

## Product Principles

1. **El grupo primero.** Cada pantalla responde "¿cómo voy frente a mis amigos?" antes de mostrar datos globales.
2. **Útil sin ser tosca.** Densidad de datos de herramienta pro, con jerarquía clara y acabado cuidado.
3. **Motiva, no castiga.** El progreso, las rachas y las recompensas invitan a jugar otra partida; la burla es entre amigos, nunca humillante.
4. **Preciso cuando juegas.** En partida y en la selección de campeón: claridad, velocidad y cero distracciones.

## Accessibility & Inclusion

- Contraste WCAG AA sobre fondos oscuros.
- `prefers-reduced-motion`: las animaciones se reproducen una sola vez; solo los spinners siguen en bucle.
- Navegación por teclado con foco visible.
- Tamaños mínimos de texto como se indica arriba.
