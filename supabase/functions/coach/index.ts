// Edge Function — Coach de macro por voz de la app de escritorio (experimental).
//
// La llama la app (con tu sesión de Discord) durante la partida, cuando su "cerebro"
// (app/src/coach-cerebro.js) detecta una situación que puede merecer un consejo:
//
// POST { accion: 'consejo', partida, situacion: { tipo, directo, motivo }, estado, dichos }
//   1. Filtro (Claude Haiku 5.5): ¿vale la pena decir algo? Responde sí/no y un motivo
//      breve. Los eventos claros (objetivo cerca, acabas de morir, cambio grande de la
//      partida) llegan con directo = true y se saltan el filtro.
//   2. Coach (Claude Sonnet 5.5): redacta el consejo, una o dos frases para leer en voz.
//   Devuelve { estado: 'ok', hablar, texto, uso: { entrada, salida, usd } }.
//
// POST { accion: 'uso' }
//   Gasto estimado del mes (tuyo y de todo el grupo), el de hoy y los límites.
//
// "Verify JWT" va ENCENDIDO (default): la llama un usuario con sesión, y además solo
// responde a cuentas vinculadas en SharkTracker, para que nadie de fuera gaste la key.
//
// La key de Claude vive en los Secrets de Edge Functions (ANTHROPIC_API_KEY), nunca en
// la app ni en el repo. Debe ser de un workspace propio de la Console de Anthropic con
// su límite de gasto mensual: ese límite es la barrera dura. Además, esta función
// lleva su propia cuenta (tabla coach_uso) y se detiene sola:
//   COACH_LIMITE_MES_USD (15 de fábrica)   → todo el grupo, por mes
//   COACH_LIMITE_DIA_USD (0.75 de fábrica) → cada persona, por día (UTC)
//
// Política de Riot: el modelo solo recibe datos de la partida del propio jugador que da
// la API local del juego, y del rival únicamente el marcador (kills, torres, dragones y
// cuántos están muertos). Aquí se vuelve a filtrar campo por campo lo que manda la app:
// lo que no está en esta lista no llega al modelo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim();
const limite = (nombre: string, fabrica: number) => {
  const n = Number(Deno.env.get(nombre));
  return Number.isFinite(n) && n > 0 ? n : fabrica;
};
const LIMITE_MES_USD = limite('COACH_LIMITE_MES_USD', 15);
const LIMITE_DIA_USD = limite('COACH_LIMITE_DIA_USD', 0.75);

const MODELO_FILTRO = 'claude-haiku-5-5';
const MODELO_COACH = 'claude-sonnet-5-5';
// US$ por millón de tokens, para el coste ESTIMADO que ve la usuaria. Si Anthropic
// cambia los precios, se ajusta aquí (lo que manda de verdad es la factura de la Console).
const PRECIOS: Record<string, { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }> = {
  [MODELO_FILTRO]: { entrada: 0.10, salida: 0.50, cacheLectura: 0.01, cacheEscritura: 0.125 },
  [MODELO_COACH]: { entrada: 2, salida: 10, cacheLectura: 0.10, cacheEscritura: 2.50 },
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// Sin reintentos y con poco margen: un consejo que llega tarde ya no sirve.
const claude = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 0 }) : null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Prompts (fijos, sin fechas ni datos de la partida: así el del coach se guarda en la caché de la API) ──
const JERGA = 'Usa la jerga de League of Legends como se habla en Latinoamérica: "jungla" (nunca "selva"), "línea" (no "carril"), "backear", "farmear", "rotar", "wards", "ward de control", y los objetivos por su nombre: Dragón, Vacuolarvas (o "Vacuos"), Heraldo, Barón, Dragón Ancestral.';

const SISTEMA_COACH = `Eres el coach de macro de League of Legends de SharkTracker. Le hablas por voz a una jugadora MIENTRAS juega su partida, así que cada consejo tiene que entenderse de una sola escucha.

Recibes un resumen de SU partida (su rol, su estado, su equipo, el marcador y los objetivos con su reloj) y la situación que disparó la consulta. Respondes con UN consejo.

FORMATO
- Una o dos frases, 30 palabras como máximo. Español latino, de tú.
- Estructura: la ventana de tiempo, qué hacer ella según su rol, y por qué importa.
- Se va a leer con un lector de voz: solo texto corrido. Sin saludos, sin su nombre, sin listas, sin comillas, sin paréntesis, sin emojis ni símbolos. Escribe "2 minutos" y "400 de oro", no "2:00" ni "400g".
- ${JERGA}

REGLAS
- Solo macro: preparar objetivos, visión, cuándo backear y qué comprar, rotaciones, qué hacer al reaparecer, cómo jugar con ventaja o desventaja. Nunca mecánicas ni reflejos.
- Nunca digas un dato a secas. Ella ya ve en pantalla los relojes de objetivos y sus números; tu trabajo es cruzarlos con su rol y su estado para darle una acción concreta.
- Usa solo los datos que recibes. NO sabes dónde está nadie en el mapa, cómo están las oleadas, qué campamentos de jungla están vivos ni dónde hay visión: no afirmes nada sobre eso. Si el consejo depende de algo que no ves, dilo en condicional ("si tu línea está empujada…").
- Del rival solo conoces el marcador y cuántos están muertos. Nunca menciones campeones rivales, sus objetos, niveles, hechizos, ultis ni dónde podrían estar.
- No repitas ni reformules lo que aparece en "Ya dijiste en esta partida".
- Es una sugerencia: la decisión es de ella. Tono directo y cercano, sin regaños.
- Si con estos datos no hay un consejo concreto y útil que dar AHORA, responde exactamente: NADA

GUÍA DE SOPORTE
- Unos 2 minutos antes de un objetivo: si tiene oro para gastar, poca vida o poco maná, conviene backear ya para volver a tiempo con un ward de control. Si no, ir yendo a la zona.
- Llegar alrededor de 1 minuto antes: visión en el río y las entradas de jungla del lado del objetivo, y limpiar la visión rival con la Lente del oráculo. El Dragón está en el río de abajo; Vacuolarvas, Heraldo y Barón, en el de arriba.
- A Vacuolarvas o Heraldo puede rotar si su línea de abajo está empujada o su ADC backeó; no dejar solo al ADC bajo presión.
- Llevar siempre un ward de control (75 de oro). Cuando el objeto de soporte ya da wards, la Lente del oráculo suele rendir más que el ward amarillo.
- Si su jungla está muerta cuando sale el objetivo: no forzarlo. Visión defensiva y ceder, o esperar a que reaparezca.
- Al reaparecer: comprar (ward de control si falta) e ir con el equipo hacia lo siguiente; no caminar sola por zonas sin visión.

GUÍA DE JUNGLA
- Unos 2 minutos antes de un objetivo: planear el reset. Si tiene oro para gastar o poca vida, backear ahora y no justo antes; después limpiar los campamentos del lado del objetivo de camino y llegar con vida alta y Castigo listo.
- Si su vida o maná están bajos a menos de 1 minuto del objetivo, es mejor llegar tarde y sana que puntual y a media vida.
- Dragones: el tercero deja a un equipo a uno del alma. Si el rival lleva 3, el siguiente se disputa con todo el equipo o se cambia por otro objetivo (Heraldo, torres, Barón) en vez de regalarlo sin nada a cambio.
- Farmeo por debajo de su referencia: priorizar limpiar campamentos entre jugadas antes que buscar peleas largas.
- Oro acumulado: backear entre limpiezas y antes del objetivo, no después.
- Al reaparecer: farmear de camino al siguiente objetivo; no ir sola a contestar uno que ya se perdió.

PARA LOS DOS ROLES
- Más rivales muertos que aliados: es la ventana para el objetivo disponible o, si no hay, para torres. Más aliados muertos: no pelear, visión y esperar.
- Con Barón o Ancestral de su equipo: agruparse y empujar con las oleadas mientras dure. Si lo tiene el rival: limpiar oleadas bajo torre y no pelear en campo abierto.
- Con ventaja en el marcador: jugar por objetivos y negar visión. Con desventaja: ceder lo que no se pueda disputar, farmear y defender en grupo.`;

const SISTEMA_FILTRO = `Eres el filtro de un coach de macro de League of Legends que habla por voz durante la partida. Recibes un resumen de la partida de una jugadora (su rol, su estado, su equipo, el marcador, los objetivos con su reloj) y un motivo de consulta. Decides si AHORA vale la pena interrumpirla con un consejo hablado.

Responde hablar = true solo si se cumplen las tres cosas:
1. Hay una acción de macro concreta que ella puede hacer en el próximo minuto o dos (backear y comprar algo que le alcanza, comprar un ward de control, preparar un objetivo que viene, aprovechar que hay más rivales muertos que aliados, cambiar cómo juega por el marcador).
2. Esa acción se deduce de los datos del resumen, sin suponer posiciones en el mapa, estado de las oleadas ni campamentos de jungla, que no se conocen.
3. No se le dijo ya algo parecido (mira "Ya dijiste en esta partida").

Responde hablar = false si solo habría un dato a secas que ella ya ve en pantalla (un reloj, su oro, su farmeo), si el consejo sería genérico, o si está en una situación en la que no puede actuar. Ante la duda, false: es mejor callar que hacer ruido. En un "Repaso general" lo normal es false.

Devuelve hablar y un motivo de 12 palabras como máximo.`;

const ESQUEMA_FILTRO = {
  type: 'object',
  properties: { hablar: { type: 'boolean' }, motivo: { type: 'string' } },
  required: ['hablar', 'motivo'],
  additionalProperties: false,
};

// ── Lo que manda la app, campo por campo (lo demás se descarta) ──
const TIPOS = ['objetivo', 'muerte', 'ritmo', 'compra', 'vision', 'revision'];
const ROLES = ['jungla', 'soporte'];
const txt = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>{}`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n)));
};
const reloj = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function comparada(m: any, unidad: string): string {
  const valor = txt(m?.valor, 8);
  const ref = txt(m?.referencia, 8);
  return valor && ref ? ` (${valor} ${unidad}; referencia de la división de arriba: ${ref}${m?.bajo === true ? ', por debajo' : ''})` : '';
}

// Resumen de la partida en texto para el modelo. Devuelve null si falta lo básico.
function redactarEstado(e: any, situacion: any, dichos: any): string | null {
  const rol = ROLES.includes(e?.rol) ? e.rol : null;
  const t = num(e?.t, 0, 7200);
  if (!rol || t === null) return null;
  const lineas: string[] = [];
  lineas.push(`Minuto ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} · Rol: ${rol} · Campeón: ${txt(e.campeon, 30) || 'desconocido'} (nivel ${num(e.nivel, 1, 18) ?? '?'})`);

  const vida = num(e.vida, 0, 100);
  const mana = num(e.mana, 0, 100);
  const muerta = e.muerta === true;
  lineas.push('Tú: ' + [
    muerta ? `MUERTA, reapareces en ${num(e.reaparece, 0, 120) ?? '?'} s` : 'viva',
    vida !== null && !muerta ? `vida ${vida} %` : '',
    mana !== null && !muerta ? `maná ${mana} %` : '',
    `oro sin gastar ${num(e.oro, 0, 99999) ?? 0}`,
    `KDA ${txt(e.kda, 12) || '?'}`,
  ].filter(Boolean).join(', '));

  const v = e.vision ?? {};
  lineas.push(`Visión: ${num(v.puntos, 0, 999) ?? 0} puntos${comparada(v.comparada, 'por minuto')}, wards de control en el inventario: ${num(v.wardsControl, 0, 5) ?? 0}, trinket: ${txt(v.trinket, 40) || 'desconocido'}`);
  if (rol === 'jungla') lineas.push(`Farmeo: ${num(e.cs, 0, 999) ?? 0} de CS${comparada(e.farmeo, 'por minuto')}`);

  const objetos = (Array.isArray(e.objetos) ? e.objetos : []).slice(0, 6).map((o: unknown) => txt(o, 40)).filter(Boolean);
  lineas.push(`Objetos: ${objetos.join(', ') || 'ninguno'}`);
  const c = e.siguienteCompra;
  if (c && txt(c.nombre, 40)) {
    const falta = num(c.falta, 0, 9999) ?? 0;
    const comp = c.componente && txt(c.componente.nombre, 40)
      ? `; componente que sigue: ${txt(c.componente.nombre, 40)} (${(num(c.componente.falta, 0, 9999) ?? 0) === 0 ? 'ya le alcanza' : `le faltan ${num(c.componente.falta, 0, 9999)} de oro`})` : '';
    lineas.push(`Siguiente compra de su build: ${txt(c.nombre, 40)} (${falta === 0 ? 'ya le alcanza' : `le faltan ${falta} de oro`}${comp})`);
  }

  const eq = e.equipo ?? {};
  const jungla = eq.jungla ? (eq.jungla.viva === false ? `, su jungla MUERTA (reaparece en ${num(eq.jungla.reaparece, 0, 120) ?? '?'} s)` : ', su jungla viva') : '';
  lineas.push(`Su equipo: ${plural(num(eq.kills, 0, 200) ?? 0, 'kill', 'kills')}, ${plural(num(eq.torres, 0, 11) ?? 0, 'torre tirada', 'torres tiradas')}, ${plural(num(eq.dragones, 0, 10) ?? 0, 'dragón', 'dragones')}, ${plural(num(eq.muertos, 0, 5) ?? 0, 'aliado muerto', 'aliados muertos')}${rol === 'jungla' ? '' : jungla}`);
  const rv = e.rival ?? {};
  lineas.push(`Rival (solo marcador): ${plural(num(rv.kills, 0, 200) ?? 0, 'kill', 'kills')}, ${plural(num(rv.torres, 0, 11) ?? 0, 'torre tirada', 'torres tiradas')}, ${plural(num(rv.dragones, 0, 10) ?? 0, 'dragón', 'dragones')}, ${plural(num(rv.muertos, 0, 5) ?? 0, 'rival muerto', 'rivales muertos')}`);
  if (e.alma === 'tu equipo' || e.alma === 'rival') lineas.push(`Alma del dragón: la tiene ${e.alma === 'rival' ? 'el rival' : 'su equipo'}`);

  const objetivos = (Array.isArray(e.objetivos) ? e.objetivos : []).slice(0, 5).map((o: any) => {
    const nombre = txt(o?.nombre, 24);
    const en = num(o?.en, -3600, 3600);
    return nombre && en !== null ? (en > 0 ? `${nombre} aparece en ${reloj(en)}` : `${nombre} ya está disponible`) : '';
  }).filter(Boolean);
  if (objetivos.length) lineas.push(`Objetivos: ${objetivos.join('; ')}`);
  const buffs = (Array.isArray(e.buffs) ? e.buffs : []).slice(0, 2).map((b: any) => {
    const nombre = txt(b?.nombre, 24);
    return nombre ? `${nombre} (${b?.de === 'rival' ? 'del rival' : 'de su equipo'}, quedan ${num(b?.quedan, 0, 300) ?? '?'} s)` : '';
  }).filter(Boolean);
  if (buffs.length) lineas.push(`Buffs activos: ${buffs.join('; ')}`);

  const ya = (Array.isArray(dichos) ? dichos : []).slice(-5).map((d: any) => {
    const texto = txt(d?.texto, 260);
    return texto ? `- [${txt(d?.minuto, 6)}] ${texto}` : '';
  }).filter(Boolean);
  lineas.push(ya.length ? `Ya dijiste en esta partida:\n${ya.join('\n')}` : 'Ya dijiste en esta partida: nada todavía');
  lineas.push(`Motivo de la consulta: ${txt(situacion?.motivo, 160) || 'repaso general'}`);
  return lineas.join('\n');
}

// Lo que se va a leer en voz: una o dos frases limpias, o nada.
function pulir(texto: string): string {
  let t = texto.replace(/\s+/g, ' ').replace(/^["'«“]+|["'»”]+$/g, '').trim();
  if (!t || /^nada\b/i.test(t)) return '';
  t = t.replace(/[*_#`]/g, '').replace(/\bselv[aá]tic[oa]s?\b/gi, 'de la jungla').replace(/\bselva\b/gi, 'jungla');
  if (t.length > 260) {
    const corte = t.slice(0, 260);
    const fin = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf(': '));
    t = fin > 80 ? corte.slice(0, fin + 1) : corte;
  }
  return t.trim();
}

// ── Coste estimado ──
type Uso = { entrada: number; salida: number; usd: number };
function sumarUso(total: Uso, modelo: string, u: any) {
  const p = PRECIOS[modelo];
  const normal = Number(u?.input_tokens) || 0;
  const lectura = Number(u?.cache_read_input_tokens) || 0;
  const escritura = Number(u?.cache_creation_input_tokens) || 0;
  const salida = Number(u?.output_tokens) || 0;
  total.entrada += normal + lectura + escritura;
  total.salida += salida;
  total.usd += (normal * p.entrada + lectura * p.cacheLectura + escritura * p.cacheEscritura + salida * p.salida) / 1e6;
}

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

const textoDe = (r: any): string => (r?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let cuerpo: any = {};
  try { cuerpo = await req.json(); } catch { /* body vacío */ }

  // Solo usuarios con sesión y cuenta de LoL vinculada en SharkTracker.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  const user = userData?.user;
  if (!user) return json({ estado: 'sin_sesion' });
  const { data: yo } = await supabase.from('players').select('id').eq('user_id', user.id).maybeSingle();
  if (!yo) return json({ estado: 'sin_cuenta' });

  try {
    const g = await gasto(user.id);
    if (cuerpo?.accion === 'uso') return json({ estado: 'ok', ...g });
    if (cuerpo?.accion !== 'consejo') return json({ error: 'Acción desconocida' }, 400);

    if (!claude) return json({ estado: 'sin_key' });
    if (g.mes_total >= LIMITE_MES_USD) return json({ estado: 'limite_mes' });
    if (g.dia_mio >= LIMITE_DIA_USD) return json({ estado: 'limite_dia' });

    const situacion = cuerpo.situacion ?? {};
    if (!TIPOS.includes(situacion.tipo)) return json({ error: 'Situación desconocida' }, 400);
    const resumen = redactarEstado(cuerpo.estado, situacion, cuerpo.dichos);
    if (!resumen) return json({ estado: 'ok', hablar: false, motivo: 'rol sin coach', uso: { entrada: 0, salida: 0, usd: 0 } });

    const uso: Uso = { entrada: 0, salida: 0, usd: 0 };
    let hablar = situacion.directo === true;
    let motivo = '';
    let texto = '';
    try {
      // 1) Filtro: Haiku decide si hay algo que valga la pena decir. Sin razonamiento
      //    extendido (cuenta contra max_tokens) y con respuesta en JSON.
      if (!hablar) {
        const f = await claude.messages.create({
          model: MODELO_FILTRO,
          max_tokens: 120,
          thinking: { type: 'disabled' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_FILTRO } },
          // Sin cache_control: este prompt es más corto que el mínimo que la API guarda en caché.
          system: SISTEMA_FILTRO,
          messages: [{ role: 'user', content: resumen }],
        });
        sumarUso(uso, MODELO_FILTRO, f.usage);
        try {
          const d = f.stop_reason === 'end_turn' ? JSON.parse(textoDe(f)) : null;
          hablar = d?.hablar === true;
          motivo = txt(d?.motivo, 120);
        } catch { hablar = false; }
      }
      // 2) Coach: Sonnet redacta la frase. "between_tools" = sin razonamiento antes de
      //    responder (en Sonnet 5.5 "disabled" no existe); el system prompt va a la caché.
      if (hablar) {
        const c = await claude.messages.create({
          model: MODELO_COACH,
          max_tokens: 160,
          thinking: { type: 'between_tools' },
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: SISTEMA_COACH, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: resumen }],
        });
        sumarUso(uso, MODELO_COACH, c.usage);
        // Si el modelo se niega a responder (stop_reason "refusal"), simplemente no se habla.
        texto = c.stop_reason === 'refusal' ? '' : pulir(textoDe(c));
        hablar = !!texto;
      }
    } catch (e) {
      // Se anota lo que ya se gastó aunque el segundo paso falle.
      if (uso.usd > 0) await registrar(user.id, false, uso);
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return json({ estado: 'sin_key' });
      if (e instanceof Anthropic.RateLimitError) return json({ estado: 'ocupado' });
      if (e instanceof Anthropic.APIError) {
        console.error(`coach: Claude respondió ${e.status}: ${e.message}`);
        return json({ estado: 'error_ia' });
      }
      throw e;
    }

    await registrar(user.id, hablar, uso);
    return json({ estado: 'ok', hablar, texto, motivo, uso: { entrada: uso.entrada, salida: uso.salida, usd: Math.round(uso.usd * 1e6) / 1e6 } });
  } catch (e) {
    console.error('coach:', e);
    return json({ estado: 'error' });
  }
});

async function registrar(userId: string, consejo: boolean, uso: Uso) {
  const { error } = await supabase.rpc('coach_registrar_uso', {
    p_user: userId, p_consejo: consejo, p_entrada: uso.entrada, p_salida: uso.salida, p_usd: uso.usd,
  });
  if (error) console.error('coach: no se pudo anotar el uso:', error.message);
}
