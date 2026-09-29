// "Mi Perfil": junta tus datos de SharkTracker (Supabase) y los arma para la
// app. Corre en el proceso main. Guarda una copia en userData/perfil.json:
// si SharkTracker no responde, la app muestra lo último guardado (estado
// "sin conexión", como en el mockup).

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const auth = require('./auth');
const calc = require('./perfil-calculos');
const { TIER_ES } = require('./rendimiento');

const archivoCache = () => path.join(app.getPath('userData'), 'perfil.json');
const leerCache = () => { try { return JSON.parse(fs.readFileSync(archivoCache(), 'utf8')); } catch { return null; } };
const guardarCache = (datos) => { try { fs.writeFileSync(archivoCache(), JSON.stringify(datos)); } catch { /* sin copia */ } };

function getJson(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

// Íconos oficiales (DDragon, públicos): versión, hechizos y runas. Una vez por sesión.
let catalogos = null;
async function cargarCatalogos() {
  if (catalogos) return catalogos;
  try {
    const version = (await getJson('https://ddragon.leagueoflegends.com/api/versions.json'))[0];
    const [hechizos, runas, campeones] = await Promise.all([
      getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_MX/summoner.json`),
      getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_MX/runesReforged.json`),
      getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_MX/champion.json`),
    ]);
    const img = 'https://ddragon.leagueoflegends.com/cdn';
    const mapaHechizos = {};
    for (const h of Object.values(hechizos.data ?? {})) mapaHechizos[h.key] = { nombre: h.name, img: `${img}/${version}/img/spell/${h.image.full}` };
    const mapaRunas = {};
    for (const estilo of runas ?? []) {
      for (const fila of estilo.slots ?? []) {
        for (const r of fila.runes ?? []) mapaRunas[r.id] = { nombre: r.name, img: `${img}/img/${r.icon}` };
      }
    }
    // Nombre en español por id interno ("MonkeyKing" → "Wukong").
    const mapaCampeones = {};
    for (const c of Object.values(campeones.data ?? {})) mapaCampeones[c.id] = c.name;
    catalogos = { version, hechizos: mapaHechizos, runas: mapaRunas, campeones: mapaCampeones };
  } catch {
    catalogos = null; // sin íconos: la app usa iniciales
  }
  return catalogos ?? { version: null, hechizos: {}, runas: {}, campeones: {} };
}

async function cargarPerfil() {
  const cliente = auth.client();
  const { data: { session } } = await cliente.auth.getSession();
  if (!session) return { estado: 'sin_sesion' };

  try {
    const { data: jugador, error: e1 } = await cliente.from('players')
      .select('id, riot_game_name, riot_tag_line, icon_id, primary_role').eq('user_id', session.user.id).maybeSingle();
    if (e1) throw e1;
    if (!jugador) return { estado: 'sin_cuenta' };

    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [rangos, snapshots, maestrias, partidas, referencia, cat] = await Promise.all([
      cliente.from('rank_latest').select('queue_type, tier, division, lp, wins, losses').eq('player_id', jugador.id),
      cliente.from('rank_snapshots').select('tier, division, lp, elo_score, recorded_at')
        .eq('player_id', jugador.id).eq('queue_type', 'RANKED_SOLO_5x5').gte('recorded_at', hace30)
        .order('recorded_at', { ascending: true }),
      cliente.from('player_masteries').select('rank, champion, level, points').eq('player_id', jugador.id).order('rank'),
      cliente.from('matches')
        .select('match_id, queue_id, duration_seconds, ended_at, match_participants!inner(champion, win, kills, deaths, assists, cs, gold, damage_to_champions, vision_score, role, team, keystone_perk, summoner_spells, lp_change, extra_stats, player_id)')
        .eq('match_participants.player_id', jugador.id)
        .order('ended_at', { ascending: false }).limit(150),
      auth.getReferencia().catch(() => null),
      cargarCatalogos(),
    ]);
    for (const r of [rangos, snapshots, maestrias, partidas]) if (r.error) throw r.error;

    const rango = (cola) => {
      const r = (rangos.data ?? []).find((x) => x.queue_type === cola);
      return r ? { texto: calc.textoRango(r), tier: r.tier, lp: r.lp, victorias: r.wins, derrotas: r.losses } : null;
    };
    const lista = (partidas.data ?? []).map(calc.aplanar);
    const res = calc.resumen(lista);
    const refRol = referencia?.porRol?.[referencia?.rolPrincipal];
    const refValida = refRol && Number(refRol.muestras) >= 30 ? refRol : null;

    const perfil = {
      estado: 'ok',
      actualizado: new Date().toISOString(),
      jugador: {
        nombre: jugador.riot_game_name,
        tag: jugador.riot_tag_line,
        icono: jugador.icon_id
          ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${jugador.icon_id}.jpg`
          : null,
        rol: { TOP: 'Top', JUNGLE: 'Jungla', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' }[jugador.primary_role] ?? null,
      },
      solo: rango('RANKED_SOLO_5x5'),
      flex: rango('RANKED_FLEX_SR'),
      resumen: res,
      radar: calc.radar(res, refValida),
      referencia: refValida ? `${TIER_ES[referencia.tier] ?? referencia.tier}` : null,
      etiquetas: calc.etiquetas(lista),
      maestrias: (maestrias.data ?? []).map((m) => ({ campeon: m.champion, nivel: m.level, puntos: m.points })),
      elo: calc.historialElo(snapshots.data),
      historial: calc.historial(lista),
      iconos: cat,
    };
    guardarCache(perfil);
    return perfil;
  } catch (e) {
    // Sin conexión (o SharkTracker caído): lo último guardado, si hay.
    return { estado: 'sin_conexion', error: e?.message ?? String(e), cache: leerCache() };
  }
}

module.exports = { cargarPerfil, leerCache };
