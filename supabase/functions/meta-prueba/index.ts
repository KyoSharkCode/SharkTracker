// Edge Function TEMPORAL — prueba del MCP de OP.GG para el apartado "Meta".
//
// Solo sirve para ver qué herramientas ofrece OP.GG y qué datos devuelve,
// antes de construir Meta encima. Cuando Meta esté hecho, se borra.
//
// "Verify JWT" va ENCENDIDO (default). Se prueba desde Supabase → Edge Functions →
// meta-prueba → botón "Test" (arriba a la derecha):
//   - Sin nada en el body            → lista de herramientas (nombre, descripción, parámetros).
//   - Body {"tool":"NOMBRE","args":{…}} → llama a esa herramienta y devuelve lo que responde.
// No usa la key de Riot ni toca la base de datos.

const MCP_URL = 'https://mcp-api.op.gg/mcp';

let sesion: string | null = null;
let siguienteId = 1;

// Una petición JSON-RPC al MCP. Puede responder JSON o un stream SSE ("data: {…}").
async function rpc(method: string, params?: unknown, notificacion = false) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sesion) headers['Mcp-Session-Id'] = sesion;
  const cuerpo = notificacion
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: siguienteId++, method, params };
  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
  sesion = res.headers.get('Mcp-Session-Id') ?? sesion;
  const texto = await res.text();
  if (notificacion) return { status: res.status };
  if (!res.ok) throw new Error(`OP.GG ${method} → ${res.status}: ${texto.slice(0, 500)}`);
  const tipo = res.headers.get('Content-Type') ?? '';
  const json = tipo.includes('text/event-stream')
    ? texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).pop()
    : JSON.parse(texto);
  if (json?.error) throw new Error(`OP.GG ${method}: ${JSON.stringify(json.error)}`);
  return json?.result;
}

async function conectar() {
  const info = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'sharktracker', version: '0.1' },
  });
  await rpc('notifications/initialized', undefined, true);
  return info;
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const servidor = await conectar();

    let resultado: unknown;
    if (body?.tool) {
      resultado = await rpc('tools/call', { name: body.tool, arguments: body.args ?? {} });
    } else {
      const { tools } = await rpc('tools/list', {});
      resultado = (tools ?? []).map((t: any) => ({
        nombre: t.name,
        descripcion: t.description,
        parametros: t.inputSchema?.properties ?? {},
        obligatorios: t.inputSchema?.required ?? [],
      }));
    }

    return new Response(JSON.stringify({
      ok: true,
      ms: Date.now() - t0,
      servidor: servidor?.serverInfo ?? null,
      resultado,
    }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e),
    }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
