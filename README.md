# SharkTracker 🦈

Tracker de League of Legends (servidor LAN) para un grupo de amigos: ranking de SoloQ en vivo, historial de partidas, insignias, retos, misiones semanales, tienda de recompensas y avisos en Discord. Todo se actualiza solo, casi en tiempo real.

Proyecto personal, sin fines comerciales. No está respaldado por Riot Games.

---

## Qué tiene

| Página | Para qué sirve |
|---|---|
| `index.html` | Portada: ranking, podio, historial reciente, insignias, Rey de la Temporada, primera victoria del día y logros. |
| `perfil.html` | Perfil de cada jugador: rango, historial por cola, campeones, roles, maestrías, gráfica de LP y consejo de IA. |
| `partidas.html` | Detalle de una partida: los 10 jugadores, objetos, runas, gráfica de oro y análisis de IA. |
| `en-vivo.html` | Partida en curso: lobby, baneos y quién del grupo está jugando. |
| `estadisticas.html` | Estadísticas del grupo. |
| `versus.html` | Comparativa entre dos jugadores. |
| `reto.html` | Retos del grupo y sus resultados. |
| `tienda.html` | Tienda de cosméticos y premios con los 🦷 ganados jugando. |
| `rewind.html` | Resumen de la temporada de SoloQ de cada jugador. |
| `overlay.html` | Overlay para OBS (rango y misiones en directo). |
| `login.html` | Inicio de sesión con Discord y vinculación de la cuenta de LoL. |
| `admin.html` | Panel de administración: roster, retos, misiones, tienda y Discord. |

---

## Cómo funciona

```
Riot / Twitch ──► Edge Functions (cada 1–3 min) ──► Base de datos ──► Realtime ──► Páginas abiertas
                   sync-riot-data, sync-matches,       (Supabase)        (aviso al instante,
                   sync-live-status, sync-twitch-status                  redibuja solo lo que cambió)
```

- **Web estática** (HTML + JavaScript, sin build). Cada página lee los datos directamente de Supabase.
- **Supabase** hace de backend:
  - **Base de datos PostgreSQL** con reglas de seguridad (RLS): la web solo puede *leer* datos públicos. Todo lo que modifica datos pasa por funciones que comprueban quién llama.
  - **Edge Functions** (`supabase/functions/`): hablan con Riot, Twitch y el servicio de IA. Las automáticas las dispara `pg_cron` y están protegidas para que solo el cron pueda llamarlas.
  - **Cron jobs** en la base: insignias, misiones, recompensas, cierre de retos, avisos de Discord y limpieza diaria.
  - **Realtime**: avisa a las páginas abiertas cuando cambia algo, sin recargar.
- **Historial de 30 días**: la limpieza diaria borra partidas, eventos y rangos más antiguos (siempre se conserva el último rango de cada jugador y las "mejores partidas").
- **Datos solo cuando cambian**: los procesos automáticos no reescriben nada si no hay novedades, para no generar tráfico ni recargas innecesarias.

### Claves y seguridad

Las claves privadas de los servicios externos (Riot, Twitch, IA, Discord) y el secreto de los cron jobs **no están en este repositorio**: viven en los *Secrets* de las Edge Functions y en *Vault* de Supabase. Lo único que aparece en el código es la URL del proyecto y su *anon key* (`assets/supabase.js`), que son públicas por diseño: lo que protege los datos son las reglas RLS y los permisos de la base.

Nunca subas archivos `.env` ni claves al repositorio (ya están excluidos en `.gitignore`).

---

## Estructura del repositorio

```
*.html                    Páginas de la web
assets/
  supabase.js             Conexión a Supabase (URL, anon key y versión de supabase-js)
  lol-data.js             Datos de LoL compartidos (Data Dragon, rangos, roles, esc())
  auth-menu.js, nav-menu.js, cosmetics.js, missions-widget.js, rank-history.js, …
logo/                     Logos
supabase/
  functions/<nombre>/     Edge Functions (una carpeta por función, con su index.ts)
  migrations/             Cambios de la base de datos, en orden de fecha
  seed.sql                Datos iniciales
```

---

## Cómo aplicar cambios

- **Web**: los cambios en `*.html` y `assets/` se publican al unirse a `main`.
- **Base de datos**: cada archivo nuevo de `supabase/migrations/` se ejecuta **una vez**, en orden, en el *SQL Editor* de Supabase.
- **Edge Functions**: se actualizan copiando el `index.ts` de su carpeta en el editor de la función en Supabase (o con la CLI de Supabase).
- Cuando un cambio incluye SQL y funciones, primero se ejecuta el SQL y después se actualizan las funciones.
