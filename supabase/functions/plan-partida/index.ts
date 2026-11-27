// Edge Function — Plan de partida con IA (En Vivo, selección de campeones de la app).
//
// POST { accion: 'plan', pedido }
//   pedido = las OPCIONES reales que arma la app (app/src/plan.js): tu campeón y rol,
//   los campeones de la selección, la build y las runas de OP.GG, la guía del
//   enfrentamiento y lo que sugiere la build adaptada.
//   Aquí se le suma TU ESTILO (últimos 30 días del historial de SharkTracker, calculado
//   en el servidor: no se acepta de la app) y Claude Sonnet 5.5 devuelve:
//     - el plan en tres líneas (línea, composición, qué evitar),
//     - qué página de runas, qué botas y qué situacionales elegir ENTRE las opciones, y por qué.
//   La IA elige, no inventa: lo que nombre fuera de las opciones se descarta (aquí y en la app).
//   Devuelve { estado: 'ok', plan, estilo, uso: { entrada, salida, usd }, gasto }.
//
// POST { accion: 'uso' } → gasto estimado del mes y de hoy, y los límites.
//
// "Verify JWT" va ENCENDIDO: solo usuarios con sesión y cuenta de LoL vinculada.
// La key de Claude vive en los Secrets (ANTHROPIC_API_KEY), en un workspace propio de la
// Console con límite mensual. Además se lleva la cuenta en la tabla coach_uso (contadores
// por persona y día) y se corta al llegar a:
//   IA_LIMITE_MES_USD (50 de fábrica) → todo el grupo, por mes
//   IA_LIMITE_DIA_USD (3 de fábrica)  → cada persona, por día (UTC)
//
// Política de Riot: solo datos previos a la partida (lo que se ve en la selección de
// campeones y estadísticas del propio jugador), y la decisión sigue siendo del jugador:
// el plan da una recomendación con su motivo y una alternativa, y nada se importa solo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim();
const limite = (nombre: string, fabrica: number) => {
  const n = Number(Deno.env.get(nombre));
  return Number.isFinite(n) && n > 0 ? n : fabrica;
};
const LIMITE_MES_USD = limite('IA_LIMITE_MES_USD', 50);
const LIMITE_DIA_USD = limite('IA_LIMITE_DIA_USD', 3);

const MODELO = 'claude-sonnet-5-5';
// US$ por millón de tokens, para el coste ESTIMADO (lo que manda es la factura de la Console).
const PRECIO = { entrada: 2, salida: 10, cacheLectura: 0.10, cacheEscritura: 2.50 };

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const claude = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 0 }) : null;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Prompt (fijo, sin datos de la partida: así se guarda en la caché de la API) ──
const SISTEMA = `Eres analista de League of Legends dentro de SharkTracker, una app de un grupo de amigos. En la selección de campeones preparas el PLAN DE PARTIDA de una jugadora: lo va a leer en unos segundos antes de que empiece.

QUÉ RECIBES
- PARTIDA: su campeón y rol, su rival de línea si se conoce, y los campeones de los dos equipos que ya eligieron (puede faltar alguno).
- ENFRENTAMIENTO: datos de OP.GG de su campeón contra su rival de línea (quién suele ganar la línea, estilo recomendado, un consejo).
- SU ESTILO: sus números reales de los últimos 30 días, en ese rol y con ese campeón, a veces junto a la referencia de la división de arriba de la suya. Son estadísticas, no sabes cómo se mueve en el mapa.
- OPCIONES: los objetos de inicio y core (fijos), y las botas, los objetos situacionales y las páginas de runas entre los que puedes elegir. Algunas traen su winrate en OP.GG y lo que sugiere la app por la composición rival.

QUÉ ENTREGAS
- linea: cómo jugar los primeros minutos contra ESE rival con ESE campeón. Una o dos frases.
- composicion: cómo gana su equipo con estas dos composiciones y cuál es su papel. Una o dos frases.
- evita: el error que más le puede costar esta partida. Una o dos frases.
- runas: la opción de página que elegirías y por qué, en una frase.
- botas: el id de las botas que elegirías entre las opciones y por qué, en una frase.
- objetos: hasta 3 situacionales de las opciones, en el orden en que los compraría, cada uno con su motivo en una frase.
- alternativa: una frase con el cambio que haría si la partida va distinta a lo esperado (por ejemplo, si va por delante o si un rival concreto se dispara).

CÓMO DECIDIR
- La IA elige, no inventa: usa SOLO ids y opciones de la lista. No nombres objetos, runas ni hechizos que no estén en OPCIONES. Tu conocimiento del parche puede estar desactualizado; los datos que recibes mandan.
- Personaliza con SU ESTILO cuando un número lo justifique, y di cuál: si muere mucho, prioriza lo defensivo y dilo; si su farmeo va por debajo de la referencia, que el plan de línea lo tenga en cuenta; si participa mucho en kills, apóyate en eso. Si tiene pocas partidas con el campeón, dilo en una palabra y apóyate en su estilo del rol. No halagues ni regañes.
- Cruza la composición rival: tipo de daño, control, asesinos, tanques, curaciones. Si la app ya sugiere un objeto por eso, puedes seguirla o no, pero explica por qué.
- Entre opciones parecidas, el winrate y el número de partidas de OP.GG desempatan; con pocas partidas, pesa poco.
- No des por hecho lo que no sabes: no conoces a los jugadores, solo los campeones. Si faltan rivales por elegir, haz el plan con los que hay.
- Es una recomendación: la decisión es de ella. Frases directas, concretas y cortas.

FORMATO
- Español latino, de tú. Jerga de League of Legends como se habla en Latinoamérica: "jungla" (nunca "selva"), "línea" (no "carril"), "farmear", "rotar", "wards", "backear".
- Cada campo es texto corrido, sin listas, sin markdown, sin emojis. Los nombres de campeones y objetos, tal como vienen.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    linea: { type: 'string' }, composicion: { type: 'string' }, evita: { type: 'string' },
    runas: { type: 'object', properties: { opcion: { type: 'integer' }, motivo: { type: 'string' } }, required: ['opcion', 'motivo'], additionalProperties: false },
    botas: { type: 'object', properties: { id: { type: 'integer' }, motivo: { type: 'string' } }, required: ['id', 'motivo'], additionalProperties: false },
    objetos: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, motivo: { type: 'string' } }, required: ['id', 'motivo'], additionalProperties: false } },
    alternativa: { type: 'string' },
  },
  required: ['linea', 'composicion', 'evita', 'runas', 'botas', 'objetos', 'alternativa'],
  additionalProperties: false,
};

// ── Lo que manda la app, campo por campo ──
const ROLES: Record<string, { nombre: string; api: string }> = {
  top: { nombre: 'top', api: 'TOP' }, jungle: { nombre: 'jungla', api: 'JUNGLE' }, mid: { nombre: 'mid', api: 'MIDDLE' },
  adc: { nombre: 'ADC', api: 'BOTTOM' }, support: { nombre: 'soporte', api: 'UTILITY' },
};
const txt = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>{}`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n)));
};
const lista = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);
const campeon = (c: any) => {
  const nombre = txt(c?.nombre, 30);
  return nombre ? { id: num(c?.id, 1, 99999), nombre, clave: txt(c?.clave, 30).replace(/[^A-Za-z]/g, '') } : null;
};
const objeto = (o: any) => {
  const id = num(o?.id, 1, 999999);
  const nombre = txt(o?.nombre, 50);
  return id && nombre ? { id, nombre, puesto: txt(o?.puesto, 4), winrate: num(o?.winrate, 0, 100), partidas: num(o?.partidas, 0, 9999999) ?? 0, motivo: txt(o?.motivo, 140) } : null;
};

function limpiarPedido(p: any) {
  const rol = ROLES[p?.rol];
  const yo = campeon(p?.campeon);
  if (!rol || !yo) return null;
  const e = p.enfrentamiento;
  return {
    rol, yo,
    rivalLinea: campeon(p.rivalLinea),
    rivales: lista(p.rivales, 5).map(campeon).filter(Boolean) as any[],
    aliados: lista(p.aliados, 4).map(campeon).filter(Boolean) as any[],
    perfilRival: txt(p.perfilRival, 200),
    enfrentamiento: e ? {
      winrate: num(e.winrate, 0, 100), partidas: num(e.partidas, 0, 9999999) ?? 0,
      ventaja: ['tu', 'rival'].includes(e.ventaja) ? e.ventaja : null, soloKills: ['tu', 'rival'].includes(e.soloKills) ? e.soloKills : null,
      estilo: txt(e.estilo, 20), consejo: txt(e.consejo, 600),
    } : null,
    inicio: lista(p.inicio, 4).map(objeto).filter(Boolean) as any[],
    core: lista(p.core, 4).map(objeto).filter(Boolean) as any[],
    botas: lista(p.botas, 6).map(objeto).filter(Boolean) as any[],
    situacionales: lista(p.situacionales, 14).map(objeto).filter(Boolean) as any[],
    runas: lista(p.runas, 4).map((r: any, i: number) => ({
      opcion: i + 1, clave: txt(r?.clave, 40), principal: txt(r?.principal, 30), secundaria: txt(r?.secundaria, 30),
      resto: lista(r?.resto, 6).map((x) => txt(x, 40)).filter(Boolean),
      fuente: r?.fuente === 'enfrentamiento' ? 'enfrentamiento' : 'general', winrate: num(r?.winrate, 0, 100), partidas: num(r?.partidas, 0, 9999999) ?? 0,
    })).filter((r) => r.clave),
  };
}
type Pedido = NonNullable<ReturnType<typeof limpiarPedido>>;

// ── Tu estilo: últimos 30 días del historial (normales y ranked de la Grieta, sin remakes) ──
const COLAS = [420, 440, 400, 430, 490, 700];
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_ES: Record<string, string> = { BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Master+' };
function tierObjetivo(tier: string | null | undefined) {
  const i = TIERS.indexOf(String(tier ?? '').toUpperCase());
  return i === -1 ? 'GOLD' : TIERS[Math.min(i + 1, TIERS.indexOf('MASTER'))];
}
const uno = (n: number) => Math.round(n * 10) / 10;
function agrupar(filas: any[]) {
  if (!filas.length) return null;
  const s = { min: 0, w: 0, k: 0, d: 0, a: 0, cs: 0, vision: 0, kp: 0, nKp: 0, dano: 0, nDano: 0, control: 0, nControl: 0 };
  for (const f of filas) {
    s.min += f.minutos; s.w += f.win ? 1 : 0; s.k += f.kills ?? 0; s.d += f.deaths ?? 0; s.a += f.assists ?? 0;
    s.cs += f.cs ?? 0; s.vision += f.vision_score ?? 0;
    const x = f.extra_stats ?? {};
    // En la base, kp va de 0 a 1 y dmg_share en porcentaje (comprobado el 27/11/2026).
    if (typeof x.kp === 'number') { s.kp += x.kp; s.nKp++; }
    if (typeof x.dmg_share === 'number') { s.dano += x.dmg_share / 100; s.nDano++; }
    if (typeof x.wards_control === 'number') { s.control += x.wards_control; s.nControl++; }
  }
  const n = filas.length;
  return {
    partidas: n, winrate: Math.round((s.w / n) * 100),
    kda: `${uno(s.k / n)}/${uno(s.d / n)}/${uno(s.a / n)}`, muertes: uno(s.d / n),
    csMin: uno(s.cs / Math.max(s.min, 1)), visionMin: Math.round((s.vision / Math.max(s.min, 1)) * 100) / 100,
    kp: s.nKp ? Math.round((s.kp / s.nKp) * 100) : null, dano: s.nDano ? Math.round((s.dano / s.nDano) * 100) : null,
    control: s.nControl ? uno(s.control / s.nControl) : null,
  };
}
async function estiloDe(playerId: string, p: Pedido) {
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await supabase.from('matches')
    .select('duration_seconds, queue_id, ended_at, match_participants!inner(player_id, champion, role, win, kills, deaths, assists, cs, vision_score, extra_stats)')
    .eq('match_participants.player_id', playerId).in('queue_id', COLAS).gte('ended_at', desde)
    .order('ended_at', { ascending: false }).limit(120);
  if (error) throw error;
  const filas = (data ?? []).filter((m: any) => (m.duration_seconds ?? 0) >= 300)
    .map((m: any) => ({ ...m.match_participants[0], minutos: (m.duration_seconds ?? 0) / 60 }));
  const clave = p.yo.clave.toLowerCase();
  const enRol = agrupar(filas.filter((f: any) => String(f.role).toUpperCase() === p.rol.api));
  const conCampeon = agrupar(filas.filter((f: any) => String(f.champion ?? '').replace(/[^A-Za-z]/g, '').toLowerCase() === clave));
  // Referencia: promedios de la división de arriba de la suya en ese rol (como "Tu rendimiento").
  const { data: rango } = await supabase.from('rank_latest').select('tier').eq('player_id', playerId).eq('queue_type', 'RANKED_SOLO_5x5').maybeSingle();
  const tier = tierObjetivo(rango?.tier);
  const { data: ref } = await supabase.from('elo_referencias_promedio').select('muestras, cs_min, vision_min, kp').eq('tier', tier).eq('rol', p.rol.api).maybeSingle();
  const referencia = ref && Number(ref.muestras) >= 30
    ? { division: TIER_ES[tier] ?? tier, csMin: uno(Number(ref.cs_min)), visionMin: Math.round(Number(ref.vision_min) * 100) / 100, kp: Math.round(Number(ref.kp) * 100) } : null;
  return { enRol, conCampeon, referencia, total: filas.length };
}
type Estilo = Awaited<ReturnType<typeof estiloDe>>;

// ── El mensaje para el modelo ──
function lineaEstilo(titulo: string, g: NonNullable<Estilo['enRol']>, ref: Estilo['referencia'], conFarmeo: boolean) {
  const r = (v: unknown, unidad = '') => (ref && v !== null && v !== undefined ? ` (referencia de ${ref.division}: ${v}${unidad})` : '');
  return `${titulo}: ${g.partidas} partidas, ${g.winrate} % de victorias, KDA medio ${g.kda}`
    + (conFarmeo ? `, ${g.csMin} de CS por minuto${r(ref?.csMin)}` : '')
    + `, visión ${g.visionMin} por minuto${r(ref?.visionMin)}`
    + (g.kp !== null ? `, participa en el ${g.kp} % de las kills${r(ref?.kp, ' %')}` : '')
    + (g.dano !== null ? `, hace el ${g.dano} % del daño de su equipo` : '')
    + (g.control !== null ? `, wards de control por partida: ${g.control}` : '');
}
function redactar(p: Pedido, e: Estilo): string {
  const nombres = (l: any[]) => l.map((c) => c.nombre).join(', ') || 'todavía sin elegir';
  const L: string[] = ['PARTIDA'];
  L.push(`Ella juega ${p.yo.nombre}, de ${p.rol.nombre}. Rival de línea: ${p.rivalLinea?.nombre ?? 'todavía no se sabe'}.`);
  L.push(`Rivales: ${nombres(p.rivales)}. Aliados: ${nombres(p.aliados)}.`);
  if (p.perfilRival) L.push(`La app resume al equipo rival así: ${p.perfilRival}.`);
  if (p.enfrentamiento && p.rivalLinea) {
    const x = p.enfrentamiento;
    const quien = (v: string | null) => (v === 'tu' ? p.yo.nombre : v === 'rival' ? p.rivalLinea!.nombre : null);
    L.push('', `ENFRENTAMIENTO (${p.yo.nombre} contra ${p.rivalLinea.nombre}, OP.GG)`);
    L.push([
      x.winrate !== null ? `${p.yo.nombre} gana el ${x.winrate} % de ${x.partidas} partidas` : '',
      quien(x.ventaja) ? `suele ganar la línea: ${quien(x.ventaja)}` : '',
      quien(x.soloKills) ? `mata más en solitario: ${quien(x.soloKills)}` : '',
      x.estilo ? `estilo recomendado: ${x.estilo}` : '',
    ].filter(Boolean).join('; ') || 'sin datos');
    if (x.consejo) L.push(`Consejo de OP.GG: ${x.consejo}`);
  }
  L.push('', 'SU ESTILO (últimos 30 días)');
  const conFarmeo = p.rol.api !== 'UTILITY';
  if (e.enRol) L.push(lineaEstilo(`De ${p.rol.nombre}`, e.enRol, e.referencia, conFarmeo));
  if (e.conCampeon) L.push(lineaEstilo(`Con ${p.yo.nombre}`, e.conCampeon, null, conFarmeo));
  if (!e.enRol && !e.conCampeon) L.push(e.total ? `No tiene partidas recientes de ${p.rol.nombre} ni con ${p.yo.nombre}.` : 'No hay partidas recientes guardadas.');
  else if (!e.conCampeon) L.push(`No tiene partidas recientes con ${p.yo.nombre}.`);

  const dato = (o: any) => [o.puesto ? `${o.puesto} en OP.GG` : '', o.winrate !== null ? `${o.winrate} % de victorias en ${o.partidas} partidas` : '', o.motivo ? `la app sugiere: ${o.motivo}` : ''].filter(Boolean).join('; ');
  const item = (o: any) => `- [${o.id}] ${o.nombre}${dato(o) ? ` (${dato(o)})` : ''}`;
  L.push('', 'OPCIONES');
  L.push(`Inicio (fijo): ${p.inicio.map((o) => o.nombre).join(', ') || 'sin datos'}. Core (fijo): ${p.core.map((o) => o.nombre).join(', ') || 'sin datos'}.`);
  L.push('Botas (elige un id):', ...(p.botas.length ? p.botas.map(item) : ['- sin opciones']));
  L.push('Situacionales (elige hasta 3 ids, en orden de compra):', ...(p.situacionales.length ? p.situacionales.map(item) : ['- sin opciones']));
  L.push('Runas (elige una opción):', ...(p.runas.length ? p.runas.map((r) => `- Opción ${r.opcion}: ${r.clave} (${r.principal} + ${r.secundaria}${r.resto.length ? `; ${r.resto.join(', ')}` : ''}) · ${r.fuente === 'enfrentamiento' ? 'la más usada contra este rival' : 'la más usada en general'}${r.winrate !== null ? `, ${r.winrate} % de victorias en ${r.partidas} partidas` : ''}`) : ['- sin opciones']));
  return L.join('\n');
}

// ── Gasto ──
const hoy = () => new Date().toISOString().slice(0, 10);
async function gasto(userId: string) {
  const dia = hoy();
  const { data, error } = await supabase.from('coach_uso').select('user_id, dia, usd').gte('dia', `${dia.slice(0, 7)}-01`);
  if (error) throw error;
  let mesTotal = 0, mesMio = 0, diaMio = 0;
  for (const f of data ?? []) {
    const usd = Number(f.usd) || 0;
    mesTotal += usd;
    if (f.user_id === userId) { mesMio += usd; if (f.dia === dia) diaMio += usd; }
  }
  return { mes_total: mesTotal, mes_mio: mesMio, dia_mio: diaMio, limite_mes: LIMITE_MES_USD, limite_dia: LIMITE_DIA_USD };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let cuerpo: any = {};
  try { cuerpo = await req.json(); } catch { /* body vacío */ }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  const user = userData?.user;
  if (!user) return json({ estado: 'sin_sesion' });
  const { data: yo } = await supabase.from('players').select('id').eq('user_id', user.id).maybeSingle();
  if (!yo) return json({ estado: 'sin_cuenta' });

  try {
    const g = await gasto(user.id);
    if (cuerpo?.accion === 'uso') return json({ estado: 'ok', ...g });
    if (cuerpo?.accion !== 'plan') return json({ error: 'Acción desconocida' }, 400);
    if (!claude) return json({ estado: 'sin_key' });
    if (g.mes_total >= LIMITE_MES_USD) return json({ estado: 'limite_mes', gasto: g });
    if (g.dia_mio >= LIMITE_DIA_USD) return json({ estado: 'limite_dia', gasto: g });

    const pedido = limpiarPedido(cuerpo.pedido);
    if (!pedido) return json({ error: 'Pedido incompleto' }, 400);
    const estilo = await estiloDe(yo.id, pedido);

    let r;
    try {
      // Razona antes de responder (adaptive) y devuelve JSON con el esquema de arriba.
      // El razonamiento cuenta contra max_tokens: por eso el margen.
      r = await claude.messages.create({
        model: MODELO,
        max_tokens: 5000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: redactar(pedido, estilo) }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return json({ estado: 'sin_key' });
      if (e instanceof Anthropic.RateLimitError) return json({ estado: 'ocupado' });
      if (e instanceof Anthropic.APIError) { console.error(`plan-partida: Claude respondió ${e.status}: ${e.message}`); return json({ estado: 'error_ia' }); }
      throw e;
    }
    const u: any = r.usage ?? {};
    const entrada = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const salida = u.output_tokens ?? 0;
    const usd = ((u.input_tokens ?? 0) * PRECIO.entrada + (u.cache_read_input_tokens ?? 0) * PRECIO.cacheLectura
      + (u.cache_creation_input_tokens ?? 0) * PRECIO.cacheEscritura + salida * PRECIO.salida) / 1e6;
    const { error: errUso } = await supabase.rpc('coach_registrar_uso', { p_user: user.id, p_consejo: true, p_entrada: entrada, p_salida: salida, p_usd: usd });
    if (errUso) console.error('plan-partida: no se pudo anotar el uso:', errUso.message);

    // Sin respuesta completa (se negó o se quedó sin margen) no hay plan.
    let plan: any = null;
    if (r.stop_reason === 'end_turn') {
      try { plan = JSON.parse(r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')); } catch { plan = null; }
    }
    if (plan) {
      // La IA elige, no inventa: fuera lo que no estaba en las opciones (la app lo vuelve a comprobar).
      const ids = (l: any[]) => new Set(l.map((o) => o.id));
      const situ = ids(pedido.situacionales);
      plan.objetos = (Array.isArray(plan.objetos) ? plan.objetos : []).filter((o: any) => situ.has(Number(o?.id))).slice(0, 3);
      if (!ids(pedido.botas).has(Number(plan.botas?.id))) plan.botas = null;
      if (!pedido.runas.some((x) => x.opcion === Number(plan.runas?.opcion))) plan.runas = null;
    }
    const uso = { entrada, salida, usd: Math.round(usd * 1e6) / 1e6 };
    if (!plan) return json({ estado: 'sin_plan', uso });
    return json({
      estado: 'ok', plan, uso,
      estilo: { rol: estilo.enRol?.partidas ?? 0, campeon: estilo.conCampeon?.partidas ?? 0 },
      gasto: { mes_total: g.mes_total + usd, limite_mes: LIMITE_MES_USD },
    });
  } catch (e) {
    console.error('plan-partida:', e);
    return json({ estado: 'error' });
  }
});
