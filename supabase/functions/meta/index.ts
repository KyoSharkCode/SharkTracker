// Edge Function — ficha de un campeón para "Meta" (app de escritorio).
//
// La llama la app (con tu sesión de Discord) al abrir un campeón en Meta:
// body { champion_id, posicion }. Devuelve build (inicio, core, botas y
// situacionales), runas, hechizos, orden de habilidades y counters, en
// Esmeralda+, sacados del MCP público de OP.GG.
//
// Con rival_id (body { champion_id, posicion, rival_id }) devuelve el
// enfrentamiento contra ese campeón (lol_get_lane_matchup_guide): quién tiene
// ventaja en línea, consejo de OP.GG, hechizos, botas, objetos, inicio y varias
// páginas de runas. El consejo llega en inglés (la herramienta solo acepta
// en_US / ko_KR): se descarta si nombra a un campeón que no es ninguno de los
// dos, y se traduce al español con Gemini (GEMINI_API_KEY, el mismo secreto de
// las otras funciones). Si Gemini falla, queda en inglés (consejo_idioma: 'en').
// Todos los elos (esa herramienta no filtra por elo). Misma caché, con
// elo = "vs_<rival_id>".
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
const GEMINI_API_KEY = (Deno.env.get('GEMINI_API_KEY') ?? '').trim();

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
  const texto = r?.content?.[0]?.text ?? '';
  // Algunas herramientas (la guía de enfrentamiento) responden JSON normal.
  if (/^\s*[{[]/.test(texto)) return JSON.parse(texto);
  return leerOpgg(texto);
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

// Jerga de LoL como la dice el grupo (español latino). La IA a veces traduce
// literal ("selva", "carril"): se le pide en el prompt y además se corrige "selva"
// en la respuesta, también en los análisis ya guardados.
const JERGA_PROMPT = 'Usa la jerga de League of Legends como se habla en Latinoamérica: "jungla" y "jungla/jungler" (NUNCA "selva" ni "selvático"), "línea" (no "carril"), "farmear", "rotar", "wards", "early/mid/late game" o "inicio/mitad/final de la partida", y los nombres de campeones, objetos y objetivos tal cual (Barón, Dragón, Heraldo, Vacuolarvas).';
const JERGA_FIX: [RegExp, string][] = [
  [/\bselv[aá]tic[oa]s?\b/gi, 'de la jungla'], [/\bselvas\b/gi, 'junglas'], [/\bselva\b/gi, 'jungla'],
];
function corregirJerga(v: any): any {
  if (typeof v === 'string') {
    return JERGA_FIX.reduce((t, [re, por]) => t.replace(re, (m) => (m[0] === m[0].toUpperCase() ? por[0].toUpperCase() + por.slice(1) : por)), v);
  }
  if (Array.isArray(v)) return v.map(corregirJerga);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, corregirJerga(x)]));
  return v;
}

// El consejo de OP.GG a veces es de otro enfrentamiento (p. ej. habla de Volibear
// cuando el rival es Warwick). Si nombra a un campeón que no es ninguno de los dos,
// no se muestra. Nombres con mayúscula, tal como los escribe OP.GG.
function consejoValido(tip: string | null, ids: number[]): string | null {
  if (!tip || !campeones) return tip;
  for (const [key, c] of campeones) {
    if (ids.includes(key)) continue;
    const nombre = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z])${nombre}([^A-Za-z]|$)`).test(tip)) return null;
  }
  return tip;
}

// Traduce el consejo al español latino. null si no hay clave o la IA falla.
async function traducirConsejo(tip: string, mio: string, rival: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const prompt = `Traduce al español latino este consejo de League of Legends para jugar ${mio} contra ${rival}. ${JERGA_PROMPT} Deja los nombres de las habilidades como vienen y la tecla entre paréntesis, por ejemplo (E). Responde SOLO con la traducción, sin comillas.\n\n${tip}`;
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 300 } }),
    });
    if (!res.ok) return null;
    const out = await res.json();
    const texto = String(out?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().replace(/^["«]|["»]$/g, '');
    return texto ? corregirJerga(texto) : null;
  } catch { return null; }
}

// Porcentaje con victorias ÷ partidas (OP.GG redondea los suyos a 2 decimales).
const wr = (g: any) => (g?.play ? g.win / g.play : null);
const grupo = (g: any) => (g?.ids?.length
  ? { ids: g.ids, partidas: g.play ?? 0, winrate: wr(g), pickrate: g.pick_rate ?? null } : null);
const grupos = (lista: any) => (Array.isArray(lista) ? lista.map(grupo).filter(Boolean) : []);
const counters = (lista: any) => (Array.isArray(lista) ? lista : []).map((c: any) => ({
  champion_id: c.champion_id, partidas: c.play ?? 0, winrate: c.play ? c.win / c.play : c.my_win_rate ?? null,
}));

// Enfrentamiento contra un rival (lol_get_lane_matchup_guide).
const ESTILO: Record<string, string> = { even: 'parejo', aggressive: 'agresivo', passive: 'pasivo', defensive: 'defensivo' };
function armarMatchup(g: any, parche: string | null) {
  const d = g?.data ?? {};
  const mio = String(g?.my_champion ?? '').toLowerCase();
  const quien = (nombre: unknown) => (nombre ? (String(nombre).toLowerCase() === mio ? 'tu' : 'rival') : null);
  const hechizos = Array.isArray(d.summoner_spells) ? d.summoner_spells : [];
  const partidas = hechizos.reduce((s: number, h: any) => s + (h.play ?? 0), 0);
  const victorias = hechizos.reduce((s: number, h: any) => s + (h.win ?? 0), 0);
  const pagina = (ru: any) => ({
    principal: ru.primary_page_id, runas_principales: ru.primary_rune_ids ?? [],
    secundaria: ru.secondary_page_id, runas_secundarias: ru.secondary_rune_ids ?? [],
    fragmentos: ru.stat_mod_ids ?? [], partidas: ru.play ?? 0, winrate: wr(ru), pickrate: ru.pick_rate ?? null,
  });
  const maestria = Array.isArray(d.skill_masteries) ? d.skill_masteries[0] : d.skill_masteries;
  return {
    parche,
    partidas,
    winrate: partidas ? victorias / partidas : null,           // tu winrate contra él
    ventaja: quien(d.lane_advantage_champion),                 // quién gana la línea
    solo_kills: quien(d.lane_solo_kill_advantage_champion),    // quién mata más en solitario
    estilo: d.recommended_play_style ? ESTILO[d.recommended_play_style] ?? d.recommended_play_style : null,
    consejo: typeof d.opponent_champion_tip === 'string' ? d.opponent_champion_tip : null,
    hechizos: grupos(d.summoner_spells).slice(0, 2),
    botas: grupos(d.boots).slice(0, 3),
    core: grupos(d.core_items).slice(0, 3),
    inicio: grupo(Array.isArray(d.starter_items) ? d.starter_items[0] : d.starter_items),
    runas: (Array.isArray(d.runes) ? d.runes : []).filter((r: any) => r?.primary_page_id).slice(0, 3).map(pagina),
    maximizar: maestria?.ids?.length ? { orden: maestria.ids, winrate: wr(maestria) } : null,
  };
}

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
    const rivalId = body?.rival_id == null ? null : Number(body.rival_id);
    if (rivalId !== null && !Number.isInteger(rivalId)) return json({ error: 'rival_id inválido' }, 400);
    const elo = rivalId === null ? ELO : `vs_${rivalId}`;

    // ── 2) Caché: vale 24 h y mientras no cambie el parche ──
    const [{ data: estado }, { data: guardada }] = await Promise.all([
      supabase.from('meta_estado').select('parche').eq('id', 1).maybeSingle(),
      supabase.from('meta_campeon').select('datos, parche, actualizado')
        .eq('champion_id', championId).eq('posicion', posicion).eq('elo', elo).maybeSingle(),
    ]);
    const parche = estado?.parche ?? null;
    const fresca = guardada && (!parche || guardada.parche === parche)
      && Date.now() - new Date(guardada.actualizado).getTime() < CACHE_MS;
    if (fresca) return json({ estado: 'ok', datos: guardada.datos, actualizado: guardada.actualizado });

    // ── 3) Pedirla a OP.GG ──
    try {
      let respuesta: any = null;
      let ultimoError: unknown = null;
      if (rivalId !== null) {
        // ── Enfrentamiento: se prueban las formas del nombre de los dos campeones ──
        const [mios, suyos] = await Promise.all([nombresOpgg(championId), nombresOpgg(rivalId)]);
        if (!mios.length || !suyos.length) throw new Error('Campeón que no está en DDragon');
        buscar: for (const m of mios) {
          for (const r of suyos) {
            try {
              respuesta = await llamarOpgg('lol_get_lane_matchup_guide', { lang: 'en_US', position: posicion, my_champion: m, opponent_champion: r });
              break buscar;
            } catch (e) { ultimoError = e; }
          }
        }
        if (!respuesta) throw ultimoError ?? new Error('OP.GG no tiene ese enfrentamiento');
        const datos: any = armarMatchup(respuesta, parche);
        datos.consejo = consejoValido(datos.consejo, [championId, rivalId]);
        datos.consejo_idioma = 'en';
        if (datos.consejo) {
          const es = await traducirConsejo(datos.consejo, campeones?.get(championId)?.name ?? '', campeones?.get(rivalId)?.name ?? '');
          if (es) { datos.consejo = es; datos.consejo_idioma = 'es'; }
        }
        const actualizado = new Date().toISOString();
        await supabase.from('meta_campeon').upsert({ champion_id: championId, posicion, elo, parche, datos, actualizado });
        return json({ estado: 'ok', datos, actualizado });
      }
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
