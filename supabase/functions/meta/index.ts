// Edge Function — ficha de un campeón para "Meta" (app de escritorio).
//
// La llama la app (con tu sesión de Discord) al abrir un campeón en Meta:
// body { champion_id, posicion }. Devuelve build (inicio, core, botas y
// situacionales), runas, hechizos, orden de habilidades y counters, en
// Esmeralda+, sacados del MCP público de OP.GG.
//
// "Verify JWT" va ENCENDIDO (default) y solo responde a cuentas vinculadas
// en SharkTracker.
//
// Caché en meta_campeon: la ficha se pide a OP.GG una vez y vale 24 h o
// hasta que cambie el parche (lo anota meta-tier en meta_estado). Si OP.GG
// no responde, se devuelve la ficha guardada aunque sea vieja.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MCP_URL = 'https://mcp-api.op.gg/mcp';
const ELO = 'emerald_plus';
const CACHE_MS = 24 * 3600 * 1000;
const POSICIONES = ['top', 'jungle', 'mid', 'adc', 'support'];
const GRUPO = '{ids[],pick_rate,play,win}';
const CAMPOS = [
  'data.summary.average_stats.{ban_rate,kda,pick_rate,play,rank,tier,win_rate}',
  `data.starter_items.${GRUPO}`,
  `data.core_items.${GRUPO}`,
  `data.boots.${GRUPO}`,
  `data.fourth_items[].${GRUPO}`,
  `data.fifth_items[].${GRUPO}`,
  `data.sixth_items[].${GRUPO}`,
  'data.runes.{id,pick_rate,play,primary_page_id,primary_rune_ids[],secondary_page_id,secondary_rune_ids[],stat_mod_ids[],win}',
  `data.summoner_spells.${GRUPO}`,
  'data.skill_masteries.{ids[],pick_rate,play,win}',
  'data.skills.{order[],pick_rate,play,win}',
  'data.weak_counters[].{champion_id,champion_name,play,win,my_win_rate}',
  'data.strong_counters[].{champion_id,champion_name,play,win,my_win_rate}',
  'data.damage_type',
];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

// ── MCP de OP.GG (JSON-RPC por HTTP; puede responder JSON o SSE) ──
async function llamarOpgg(tool: string, args: Record<string, unknown>) {
  let sesion: string | null = null;
  let id = 1;
  async function rpc(method: string, params?: unknown, notificacion = false) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (sesion) headers['Mcp-Session-Id'] = sesion;
    const cuerpo = notificacion ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: id++, method, params };
    const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(20_000) });
    sesion = res.headers.get('Mcp-Session-Id') ?? sesion;
    const texto = await res.text();
    if (notificacion) return null;
    if (!res.ok) throw new Error(`OP.GG ${method} → ${res.status}: ${texto.slice(0, 300)}`);
    const json = (res.headers.get('Content-Type') ?? '').includes('text/event-stream')
      ? texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).pop()
      : JSON.parse(texto);
    if (json?.error) throw new Error(`OP.GG ${method}: ${JSON.stringify(json.error).slice(0, 300)}`);
    return json?.result;
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sharktracker', version: '1.0' } });
  await rpc('notifications/initialized', undefined, true);
  const r = await rpc('tools/call', { name: tool, arguments: args });
  if (r?.isError) throw new Error(`OP.GG ${tool}: ${r.content?.[0]?.text?.slice(0, 300)}`);
  return leerOpgg(r?.content?.[0]?.text ?? '');
}

// OP.GG responde en un formato propio: primero "class X: campo1,campo2" y
// luego X(valor1, valor2). Esto lo convierte a objetos normales.
function leerOpgg(texto: string): any {
  const clases = new Map<string, string[]>();
  const lineas = texto.split('\n');
  let i = 0;
  for (; i < lineas.length; i++) {
    const m = lineas[i].match(/^class (\w+): ?(.*)$/);
    if (!m) { if (lineas[i].trim()) break; else continue; }
    clases.set(m[1], m[2] ? m[2].split(',').map((s) => s.trim()) : []);
  }
  const s = lineas.slice(i).join('\n');
  let p = 0;
  const esp = () => { while (p < s.length && /\s/.test(s[p])) p++; };
  function lista(cierre: string) {
    const a: any[] = [];
    esp();
    if (s[p] === cierre) { p++; return a; }
    while (true) {
      a.push(valor()); esp();
      if (s[p] === ',') { p++; continue; }
      if (s[p] === cierre) { p++; return a; }
      throw new Error(`OP.GG: se esperaba "${cierre}" en la posición ${p}`);
    }
  }
  function valor(): any {
    esp();
    if (s[p] === '"') {
      let j = p + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      const v = JSON.parse(s.slice(p, j + 1)); p = j + 1; return v;
    }
    if (s[p] === '[') { p++; return lista(']'); }
    const m = s.slice(p).match(/^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|\w+)/);
    if (!m) throw new Error(`OP.GG: no se entiende "${s.slice(p, p + 30)}"`);
    p += m[0].length;
    const t = m[0];
    if (/^-?\d/.test(t)) return Number(t);
    if (t === 'true' || t === 'True') return true;
    if (t === 'false' || t === 'False') return false;
    if (t === 'null' || t === 'None') return null;
    esp();
    if (s[p] !== '(') return t;
    p++;
    const campos = clases.get(t) ?? [];
    const o: Record<string, any> = {};
    lista(')').forEach((v, k) => { o[campos[k] ?? `_${k}`] = v; });
    return o;
  }
  return valor();
}

// OP.GG pide el campeón por nombre en MAYÚSCULAS ("LEE_SIN"); se saca de DDragon
// por el id numérico. Se prueban las formas posibles hasta que una funcione.
let campeones: Map<number, { id: string; name: string }> | null = null;
async function nombresOpgg(championId: number): Promise<string[]> {
  if (!campeones) {
    const versiones = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    const { data } = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${versiones[0]}/data/en_US/champion.json`)).json();
    campeones = new Map(Object.values<any>(data).map((c) => [Number(c.key), { id: c.id, name: c.name }]));
  }
  const c = campeones.get(championId);
  if (!c) return [];
  const snake = c.name.normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).join('_').toUpperCase();
  return [...new Set([snake, c.id.toUpperCase(), snake.replace(/_/g, '')])];
}

// Porcentaje con victorias ÷ partidas (OP.GG redondea los suyos a 2 decimales).
const wr = (g: any) => (g?.play ? g.win / g.play : null);
const grupo = (g: any) => (g?.ids?.length
  ? { ids: g.ids, partidas: g.play ?? 0, winrate: wr(g), pickrate: g.pick_rate ?? null } : null);
const grupos = (lista: any) => (Array.isArray(lista) ? lista.map(grupo).filter(Boolean) : []);
const counters = (lista: any) => (Array.isArray(lista) ? lista : []).map((c: any) => ({
  champion_id: c.champion_id, partidas: c.play ?? 0, winrate: c.play ? c.win / c.play : c.my_win_rate ?? null,
}));

function armarFicha(r: any, parche: string | null) {
  const d = r?.data ?? {};
  const s = d.summary?.average_stats ?? {};
  const ru = d.runes ?? {};
  return {
    parche,
    elo: ELO,
    tipo_dano: d.damage_type ?? null,
    resumen: {
      partidas: s.play ?? 0, winrate: s.win_rate ?? null, pickrate: s.pick_rate ?? null,
      banrate: s.ban_rate ?? null, kda: s.kda ?? null, tier: s.tier ?? null, rank: s.rank ?? null,
    },
    inicio: grupo(d.starter_items),
    core: grupo(d.core_items),
    botas: grupo(d.boots),
    cuarto: grupos(d.fourth_items),
    quinto: grupos(d.fifth_items),
    sexto: grupos(d.sixth_items),
    runas: ru.primary_page_id ? {
      principal: ru.primary_page_id, runas_principales: ru.primary_rune_ids ?? [],
      secundaria: ru.secondary_page_id, runas_secundarias: ru.secondary_rune_ids ?? [],
      fragmentos: ru.stat_mod_ids ?? [], partidas: ru.play ?? 0, winrate: wr(ru), pickrate: ru.pick_rate ?? null,
    } : null,
    hechizos: grupo(d.summoner_spells),
    maximizar: d.skill_masteries?.ids?.length
      ? { orden: d.skill_masteries.ids, partidas: d.skill_masteries.play ?? 0, winrate: wr(d.skill_masteries) } : null,
    habilidades: d.skills?.order?.length
      ? { orden: d.skills.order, partidas: d.skills.play ?? 0, winrate: wr(d.skills) } : null,
    te_cuesta: counters(d.weak_counters),
    le_ganas: counters(d.strong_counters),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    // ── 1) ¿Quién llama? Tiene que tener sesión y cuenta de LoL vinculada ──
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
    const user = userData?.user;
    if (!user) return json({ error: 'Tienes que iniciar sesión.' }, 401);
    const { data: yo } = await supabase.from('players').select('id').eq('user_id', user.id).maybeSingle();
    if (!yo) return json({ estado: 'sin_cuenta' });

    const body = await req.json().catch(() => ({}));
    const championId = Number(body?.champion_id);
    const posicion = String(body?.posicion ?? '');
    if (!Number.isInteger(championId) || !POSICIONES.includes(posicion)) return json({ error: 'Faltan champion_id o posicion' }, 400);

    // ── 2) Caché: vale 24 h y mientras no cambie el parche ──
    const [{ data: estado }, { data: guardada }] = await Promise.all([
      supabase.from('meta_estado').select('parche').eq('id', 1).maybeSingle(),
      supabase.from('meta_campeon').select('datos, parche, actualizado')
        .eq('champion_id', championId).eq('posicion', posicion).eq('elo', ELO).maybeSingle(),
    ]);
    const parche = estado?.parche ?? null;
    const fresca = guardada && (!parche || guardada.parche === parche)
      && Date.now() - new Date(guardada.actualizado).getTime() < CACHE_MS;
    if (fresca) return json({ estado: 'ok', datos: guardada.datos, actualizado: guardada.actualizado });

    // ── 3) Pedirla a OP.GG ──
    try {
      let respuesta: any = null;
      let ultimoError: unknown = null;
      for (const nombre of await nombresOpgg(championId)) {
        try {
          respuesta = await llamarOpgg('lol_get_champion_analysis', {
            game_mode: 'ranked', champion: nombre, position: posicion, tier: ELO, desired_output_fields: CAMPOS,
          });
          break;
        } catch (e) { ultimoError = e; }
      }
      if (!respuesta) throw ultimoError ?? new Error(`Campeón ${championId} no está en DDragon`);

      const datos = armarFicha(respuesta, parche);
      const actualizado = new Date().toISOString();
      await supabase.from('meta_campeon').upsert({ champion_id: championId, posicion, elo: ELO, parche, datos, actualizado });
      return json({ estado: 'ok', datos, actualizado });
    } catch (e) {
      console.error('[meta] OP.GG:', e instanceof Error ? e.message : e);
      if (guardada) return json({ estado: 'ok', datos: guardada.datos, actualizado: guardada.actualizado, vieja: true });
      return json({ estado: 'opgg_caido' });
    }
  } catch (e) {
    console.error('[meta]', e);
    return json({ error: 'Error inesperado' }, 500);
  }
});
