// Edge Function TEMPORAL — prueba del MCP de OP.GG para el Bloque 3 (guía de
// enfrentamiento de línea y páginas de runas alternativas). Se borra al terminar.
//
// "Verify JWT" APAGADO + x-cron-secret (se llama a mano desde el SQL Editor).
// Body opcional: { champion: "AHRI", rival: "ZED", posicion: "mid" }.
// Devuelve el texto CRUDO de OP.GG (sin traducir) para ver qué campos trae.

const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const MCP_URL = 'https://mcp-api.op.gg/mcp';

async function sesionOpgg() {
  let sesion: string | null = null;
  let id = 1;
  async function rpc(method: string, params?: unknown, notificacion = false) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (sesion) headers['Mcp-Session-Id'] = sesion;
    const cuerpo = notificacion ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: id++, method, params };
    const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(25_000) });
    sesion = res.headers.get('Mcp-Session-Id') ?? sesion;
    const texto = await res.text();
    if (notificacion) return null;
    if (!res.ok) return { error: `${res.status}: ${texto.slice(0, 500)}` };
    const json = (res.headers.get('Content-Type') ?? '').includes('text/event-stream')
      ? texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).pop()
      : JSON.parse(texto);
    return json?.error ? { error: json.error } : json?.result;
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sharktracker', version: '1.0' } });
  await rpc('notifications/initialized', undefined, true);
  return rpc;
}

const texto = (r: any, max = 6000) => r?.error ? { error: r.error } : String(r?.content?.[0]?.text ?? JSON.stringify(r)).slice(0, max);

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  const body = await req.json().catch(() => ({}));
  const champion = String(body?.champion ?? 'AHRI');
  const rival = String(body?.rival ?? 'ZED');
  const posicion = String(body?.posicion ?? 'mid');
  const salida: Record<string, unknown> = {};
  try {
    const rpc = await sesionOpgg();
    // 1) Qué parámetros piden las dos herramientas.
    const lista: any = await rpc('tools/list', {});
    const herramientas = (lista?.tools ?? []).filter((t: any) => ['lol_get_lane_matchup_guide', 'lol_get_champion_analysis'].includes(t.name));
    salida.herramientas_nombres = herramientas.map((t: any) => t.name);

    // 2) Guía de enfrentamiento: se rellenan los parámetros obligatorios según su nombre.
    const guia = herramientas.find((t: any) => t.name === 'lol_get_lane_matchup_guide');
    if (guia) {
      const props = guia.inputSchema?.properties ?? {};
      const args: Record<string, unknown> = {};
      let campeones = 0;
      for (const [k, v] of Object.entries<any>(props)) {
        const n = k.toLowerCase();
        if (/opponent|enemy|target|versus|vs|rival/.test(n)) args[k] = rival;
        else if (/champion/.test(n)) args[k] = campeones++ === 0 ? champion : rival;
        else if (/position|lane|role/.test(n)) args[k] = posicion;
        else if (/game_mode|mode/.test(n)) args[k] = 'ranked';
        else if (/tier/.test(n)) args[k] = 'emerald_plus';
        else if (/lang|locale/.test(n)) args[k] = 'en_US'; // OP.GG solo acepta en_US o ko_KR aquí
        else if (/desired_output_fields/.test(n)) args[k] = ['data'];
      }
      salida.guia_args = args;
      // Responde JSON: se resume cada campo (claves + inicio del valor) para verlo entero.
      const crudo: any = await rpc('tools/call', { name: 'lol_get_lane_matchup_guide', arguments: args });
      const t = String(crudo?.content?.[0]?.text ?? '');
      try {
        const g = JSON.parse(t);
        salida.guia_claves = Object.keys(g);
        salida.guia_data = Object.fromEntries(Object.entries(g.data ?? {}).map(([k, v]) => [k, JSON.stringify(Array.isArray(v) ? v.slice(0, 2) : v).slice(0, 700)]));
      } catch { salida.guia = crudo?.error ? crudo : t.slice(0, 4000); }
    }

  } catch (e) {
    salida.error = e instanceof Error ? e.message : String(e);
  }
  return new Response(JSON.stringify(salida, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
