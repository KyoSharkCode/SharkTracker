// Avisos de Windows (Ajustes → Notificaciones): lo mismo que el grupo ya recibe
// en Discord, pero en tu PC y solo lo tuyo: dientes ganados y premios, misiones,
// retos del grupo y el resumen de tu semana.
//
// Cada minuto (con sesión y cuenta de LoL vinculada) se pregunta a SharkTracker
// qué pasó desde la última vez. Todo se lee con tu sesión (las tablas son de
// lectura pública): no hace falta SQL ni Edge Functions nuevas. Solo llegan
// mientras la app está abierta (o en la bandeja, si activas esa opción).

const { app, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const calc = require('./notificaciones-calculos');

const CADA_MS = 60 * 1000;
const MAX_ATRAS_MS = 12 * 3600 * 1000; // al abrir la app no se avisa de lo de hace más de 12 h
const archivo = () => path.join(app.getPath('userData'), 'avisos.json');

let ctx = null;      // { auth, ajustes, abrirApp }
let estado = null;   // { desde, semana }
let corriendo = false;

function leerEstado() {
  try { return JSON.parse(fs.readFileSync(archivo(), 'utf8')); } catch { return {}; }
}
function guardarEstado() {
  try { fs.writeFileSync(archivo(), JSON.stringify(estado)); } catch { /* sin disco: queda en memoria */ }
}

function mostrar(aviso) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: aviso.titulo, body: aviso.cuerpo, icon: path.join(__dirname, 'assets', 'icon.png') });
  // Clic: abre en la web lo que corresponde (la tienda, el reto…).
  n.on('click', () => { if (aviso.url) shell.openExternal(aviso.url); else ctx?.abrirApp(); });
  n.show();
}

// Tu jugador (cuenta de LoL vinculada) o null.
async function miJugador(db) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data } = await db.from('players').select('id').eq('user_id', session.user.id).maybeSingle();
  return data?.id ?? null;
}

async function vuelta() {
  if (corriendo || !ctx) return;
  const activos = ctx.ajustes.leer().avisos;
  if (!Object.values(activos).some(Boolean)) return;
  corriendo = true;
  try {
    const db = ctx.auth.client();
    const yo = await miJugador(db);
    if (!yo) return;
    const ahora = new Date();
    const desde = new Date(Math.max(new Date(estado.desde ?? ahora).getTime(), ahora.getTime() - MAX_ATRAS_MS)).toISOString();
    const hasta = ahora.toISOString();
    const avisos = [];

    if (activos.dientes) {
      const [{ data: movs }, { data: premios }] = await Promise.all([
        db.from('wallet_tx').select('amount, reason').eq('player_id', yo).gt('created_at', desde).lte('created_at', hasta),
        db.from('prize_claims').select('item_name, status').eq('player_id', yo).gt('resolved_at', desde).lte('resolved_at', hasta),
      ]);
      avisos.push(...calc.avisosDientes(movs ?? [], premios ?? []));
    }

    if (activos.misiones) {
      const [{ data: mias }, { data: grupo }] = await Promise.all([
        db.from('player_missions').select('tier, completed_at, mission_catalog(title, points)').eq('player_id', yo).gt('completed_at', desde).lte('completed_at', hasta),
        db.from('mission_weeks').select('group_completed_at, mission_catalog(title)').gt('group_completed_at', desde).lte('group_completed_at', hasta),
      ]);
      avisos.push(...calc.avisosMisiones(
        (mias ?? []).map((m) => ({ tier: m.tier, titulo: m.mission_catalog?.title, puntos: m.mission_catalog?.points })),
        (grupo ?? []).map((g) => ({ titulo: g.mission_catalog?.title }))));
    }

    if (activos.retos) {
      const [{ data: empezados }, { data: terminados }] = await Promise.all([
        db.from('challenges').select('id, name').is('finished_at', null).gt('starts_at', desde).lte('starts_at', hasta),
        db.from('challenges').select('id, name').gt('finished_at', desde).lte('finished_at', hasta),
      ]);
      const fin = [];
      for (const r of terminados ?? []) {
        const { data: res } = await db.from('challenge_results').select('player_id, position, display_name, riot_game_name')
          .eq('challenge_id', r.id).order('position', { ascending: true });
        const g = res?.find((x) => x.position === 1);
        fin.push({ ...r, ganador: g ? (g.display_name || g.riot_game_name) : null, miPuesto: res?.find((x) => x.player_id === yo)?.position ?? null });
      }
      avisos.push(...calc.avisosRetos(empezados ?? [], fin));
    }

    // Resumen de tu semana: una vez, el lunes después de las 6:00 (hasta el miércoles si abres tarde).
    const semana = calc.inicioSemana(ahora);
    const clave = calc.claveSemana(semana);
    if (estado.semana !== clave && ahora - semana < 3 * 86400 * 1000) {
      if (activos.semana) {
        const antes = new Date(semana.getTime() - 7 * 86400 * 1000).toISOString();
        const [{ data: movs }, { data: hechas }, { data: top }] = await Promise.all([
          db.from('wallet_tx').select('amount').eq('player_id', yo).gt('amount', 0).gte('created_at', antes).lt('created_at', semana.toISOString()),
          db.from('player_missions').select('id').eq('player_id', yo).gte('completed_at', antes).lt('completed_at', semana.toISOString()),
          // El premio del top de la semana se paga al cerrarla (lunes 6:00).
          db.from('wallet_tx').select('detail').eq('player_id', yo).eq('reason', 'top').gte('created_at', semana.toISOString()),
        ]);
        const aviso = calc.avisoSemana({
          misiones: hechas?.length ?? 0,
          dientes: (movs ?? []).reduce((t, m) => t + m.amount, 0),
          top: Number(/Top (\d)/.exec(top?.[0]?.detail ?? '')?.[1]) || null,
        });
        if (aviso) avisos.push(aviso);
      }
      estado.semana = clave;
    }

    calc.limitar(avisos).forEach(mostrar);
    estado.desde = hasta;
    guardarEstado();
  } catch {
    // Sin conexión: se reintenta en la siguiente vuelta, con el mismo "desde".
  } finally {
    corriendo = false;
  }
}

function iniciar(opciones) {
  ctx = opciones;
  estado = leerEstado();
  // Primera vez: se empieza desde ahora (sin avisos de cosas viejas).
  if (!estado.desde) { estado.desde = new Date().toISOString(); estado.semana = calc.claveSemana(calc.inicioSemana()); guardarEstado(); }
  setTimeout(vuelta, 15 * 1000); // un rato después de abrir, con la sesión ya cargada
  setInterval(vuelta, CADA_MS);
}

// Botón "Probar" de Ajustes → Notificaciones.
function probar() {
  if (!Notification.isSupported()) return false;
  mostrar({ titulo: 'Así se verán los avisos', cuerpo: 'Dientes, misiones, retos y tu resumen semanal llegan aquí mientras SharkTracker esté abierto.' });
  return true;
}

module.exports = { iniciar, probar };
