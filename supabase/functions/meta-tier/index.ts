// Cron: cada 6 h (ver cron job "meta-tier-cada-6h").
// Candado propio: esta función tiene "Verify JWT" APAGADO (la llama pg_cron,
// que no manda sesión) y en su lugar exige la cabecera x-cron-secret.
//
// Tier list de "Meta" (app de escritorio): pide a OP.GG (MCP público) la
// tier list de los 5 roles en UNA consulta y la guarda en meta_tier, con el
// id numérico de cada campeón (sacado de DDragon) para que la app ponga
// nombres e íconos en español. Anota el parche en meta_estado: si cambió,
// las fichas guardadas en meta_campeon dejan de valer solas.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const MCP_URL = 'https://mcp-api.op.gg/mcp';
const POSICIONES = ['top', 'jungle', 'mid', 'adc', 'support'];
const CAMPOS = 'ban_rate,champion,is_rip,kda,kill,pick_rate,play,rank,rank_prev,rank_prev_patch,role_rate,tier,win,win_rate';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

// Nombre de OP.GG ("Nunu & Willump", "Wukong") → id numérico de Riot, con DDragon.
const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
async function catalogoCampeones() {
  const versiones = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
  const version: string = versiones[0];
  const { data } = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)).json();
  const porNombre = new Map<string, number>();
  for (const c of Object.values<any>(data)) {
    porNombre.set(normal(c.name), Number(c.key));
    porNombre.set(normal(c.id), Number(c.key)); // "MonkeyKing"
  }
  return { parche: version.split('.').slice(0, 2).join('.'), porNombre };
}

async function actualizar() {
  const inicio = new Date().toISOString();
  const [{ parche, porNombre }, respuesta] = await Promise.all([
    catalogoCampeones(),
    llamarOpgg('lol_list_lane_meta_champions', {
      position: 'all',
      desired_output_fields: POSICIONES.map((pos) => `data.positions.${pos}[].{${CAMPOS}}`),
    }),
  ]);

  const filas: Record<string, unknown>[] = [];
  const sinId: string[] = [];
  for (const pos of POSICIONES) {
    for (const c of respuesta?.data?.positions?.[pos] ?? []) {
      const championId = porNombre.get(normal(String(c.champion)));
      if (!championId) { sinId.push(`${c.champion} (${pos})`); continue; }
      filas.push({
        posicion: pos, champion_id: championId, campeon: c.champion,
        tier: c.tier, rank: c.rank, rank_prev: c.rank_prev, rank_prev_patch: c.rank_prev_patch,
        partidas: c.play, victorias: c.win, pick_rate: c.pick_rate, ban_rate: c.ban_rate,
        role_rate: c.role_rate, kda: c.kda, is_rip: !!c.is_rip, actualizado: inicio,
      });
    }
  }
  if (filas.length < 50) throw new Error(`OP.GG devolvió muy pocos campeones (${filas.length}); no se toca la tier list`);

  const { error } = await supabase.from('meta_tier').upsert(filas);
  if (error) throw error;
  // Lo que ya no sale en la tier list (campeones que dejaron de jugarse en un rol).
  await supabase.from('meta_tier').delete().lt('actualizado', inicio);
  await supabase.from('meta_estado').update({ parche, actualizado: inicio, error: null }).eq('id', 1);

  console.log(`[meta-tier] parche ${parche}: ${filas.length} filas`);
  if (sinId.length) console.log(`[meta-tier] sin id en DDragon: ${sinId.join(', ')}`);
  return { parche, filas: filas.length, sinId };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const r = await actualizar();
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error('[meta-tier] ERROR:', mensaje);
    await supabase.from('meta_estado').update({ error: mensaje.slice(0, 500) }).eq('id', 1);
    return new Response(JSON.stringify({ ok: false, error: mensaje }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
