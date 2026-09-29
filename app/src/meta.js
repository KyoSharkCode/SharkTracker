// "Meta": tier list, builds, runas y counters. Corre en el proceso main.
//
// Los datos vienen de OP.GG pero la app nunca le pregunta: la tier list la
// guarda Supabase cada 6 h (Edge Function meta-tier → tabla meta_tier) y la
// ficha de cada campeón la trae la Edge Function "meta", que la guarda 24 h.
// Aquí se juntan con los catálogos de DDragon en español (nombres e íconos
// de campeones, objetos, runas y hechizos).

const https = require('https');
const auth = require('./auth');

const DD = 'https://ddragon.leagueoflegends.com/cdn';
// players.primary_role (web) → posición de OP.GG.
const POS_WEB = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPPORT: 'support' };

function getJson(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

// Catálogos en español, una vez por sesión.
let catalogos = null;
async function cargarCatalogos() {
  if (catalogos) return catalogos;
  const version = (await getJson('https://ddragon.leagueoflegends.com/api/versions.json'))[0];
  const base = `${DD}/${version}/data/es_MX`;
  const [campeones, objetos, runas, hechizos] = await Promise.all([
    getJson(`${base}/champion.json`), getJson(`${base}/item.json`),
    getJson(`${base}/runesReforged.json`), getJson(`${base}/summoner.json`),
  ]);
  const c = {};
  for (const x of Object.values(campeones.data ?? {})) {
    c[x.key] = { id: x.id, nombre: x.name, img: `${DD}/${version}/img/champion/${x.id}.png` };
  }
  const o = {};
  for (const [id, x] of Object.entries(objetos.data ?? {})) {
    o[id] = { nombre: x.name, img: `${DD}/${version}/img/item/${id}.png` };
  }
  const r = {};
  for (const estilo of runas ?? []) {
    r[estilo.id] = { nombre: estilo.name, img: `${DD}/img/${estilo.icon}` };
    for (const fila of estilo.slots ?? []) {
      for (const x of fila.runes ?? []) r[x.id] = { nombre: x.name, img: `${DD}/img/${x.icon}` };
    }
  }
  const h = {};
  for (const x of Object.values(hechizos.data ?? {})) {
    h[x.key] = { nombre: x.name, img: `${DD}/${version}/img/spell/${x.image.full}` };
  }
  catalogos = { version, campeones: c, objetos: o, runas: r, hechizos: h };
  return catalogos;
}

// Tier list de los 5 roles + tu rol principal y tus campeones más jugados.
async function cargarTier() {
  const cliente = auth.client();
  const { data: { session } } = await cliente.auth.getSession();
  if (!session) return { estado: 'sin_sesion' };
  try {
    const [tier, estado, jugador, cat] = await Promise.all([
      cliente.from('meta_tier')
        .select('posicion, champion_id, tier, rank, rank_prev_patch, partidas, victorias, pick_rate, ban_rate, role_rate, is_rip')
        .order('rank'),
      cliente.from('meta_estado').select('parche, actualizado').eq('id', 1).maybeSingle(),
      cliente.from('players').select('id, primary_role').eq('user_id', session.user.id).maybeSingle(),
      cargarCatalogos(),
    ]);
    if (tier.error) throw tier.error;
    let misCampeones = [];
    if (jugador.data) {
      const { data } = await cliente.from('player_masteries').select('champion').eq('player_id', jugador.data.id).order('rank').limit(5);
      // player_masteries guarda el id interno ("MonkeyKing") → id numérico.
      const porId = Object.fromEntries(Object.entries(cat.campeones).map(([key, x]) => [x.id, Number(key)]));
      misCampeones = (data ?? []).map((m) => porId[m.champion]).filter(Boolean);
    }
    return {
      estado: 'ok',
      parche: estado.data?.parche ?? null,
      actualizado: estado.data?.actualizado ?? null,
      rol: POS_WEB[jugador.data?.primary_role] ?? 'jungle',
      misCampeones,
      filas: tier.data ?? [],
      catalogos: cat,
    };
  } catch (e) {
    return { estado: 'error', error: e?.message ?? String(e) };
  }
}

// Ficha de un campeón en un rol (build, runas, hechizos, habilidades, counters).
async function cargarCampeon(championId, posicion) {
  const cliente = auth.client();
  const { data: { session } } = await cliente.auth.getSession();
  if (!session) return { estado: 'sin_sesion' };
  const { data, error } = await cliente.functions.invoke('meta', { body: { champion_id: championId, posicion } });
  if (error) return { estado: 'error' };
  return data;
}

module.exports = { cargarTier, cargarCampeon };
