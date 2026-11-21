// Edge Function — Coach de macro por voz de la app de escritorio (experimental).
//
// La llama la app (con tu sesión de Discord) durante la partida, cuando su "cerebro"
// (app/src/coach-cerebro.js) detecta una situación que puede merecer un consejo:
//
// POST { accion: 'consejo', partida, situacion: { tipo, directo, motivo }, estado, bitacora }
//   estado   = resumen de SU partida ahora mismo + qué viene haciendo (actividad).
//   bitacora = la historia de la partida: muertes, compras, objetivos, controles cada
//              5 min y lo que el coach ya le dijo. Es la memoria del coach.
//   1. Filtro (Claude Haiku 5.5), solo para lo que no es un momento claro (oro
//      acumulado): ¿vale la pena decir algo? Responde sí/no y un motivo breve.
//   2. Coach (Claude Sonnet 5.5): lee la bitácora y redacta el consejo para leer en voz.
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
const claude = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 11500, maxRetries: 0 }) : null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Prompts (fijos, sin fechas ni datos de la partida: así el del coach se guarda en la caché de la API) ──
const JERGA = 'Usa la jerga de League of Legends como se habla en Latinoamérica: "jungla" (nunca "selva"), "línea" (no "carril"), "backear", "farmear", "rotar", "wards", "ward de control", y los objetivos por su nombre: Dragón, Vacuolarvas (o "Vacuos"), Heraldo, Barón, Dragón Ancestral.';

const SISTEMA_COACH = `Eres coach de macro de League of Legends dentro de SharkTracker. Acompañas por voz a una jugadora durante SU partida, como alguien que la está viendo jugar y la conoce: no eres un sistema de avisos.

QUÉ RECIBES
- "Ahora": su estado en este momento (rol, vida, oro, objetos, visión), su equipo, el marcador y los objetivos con su reloj.
- "Lo último": lo que se puede deducir de los últimos segundos (si acaba de comprar, cuánto farmeó, si su vida viene cayendo).
- "Bitácora": la historia de la partida en orden: sus muertes con su contexto, sus compras, los objetivos de cada equipo, un control cada 5 minutos y, marcado como COACH, lo que tú ya le dijiste.
- "Momento": por qué se te consulta ahora.

CÓMO PIENSA UN COACH
- Analiza, no narres. Un dato suelto (un reloj, su oro, su farmeo) ella ya lo ve en pantalla. Lo tuyo es unir dos o más hechos en una conclusión y de ahí sacar qué hacer: "tus tres muertes fueron con más rivales vivos que aliados: espera a tu equipo antes de entrar al río".
- Usa la bitácora. Busca patrones (muertes seguidas, muertes con oro sin gastar, objetivos que se escapan después de que ella muere) y dile lo que ves en SU partida, no teoría general.
- Dale seguimiento a lo que dijiste. Si una compra o un cambio posterior muestra que te hizo caso, puedes reconocerlo en pocas palabras. Si el mismo problema sigue, no repitas la frase: di que sigue y qué le está costando.
- No le digas que haga lo que probablemente ya está haciendo. Si compró hace unos segundos, está en base: no le digas que backee ni que compre. Si su CS subió en el último minuto, ya está farmeando.
- Lo que NO sabes: dónde está nadie en el mapa, cómo están las oleadas, qué campamentos están vivos, dónde hay visión, ni si está volviendo a base ahora mismo. No afirmes nada de eso. Si tu consejo depende de algo así, dilo en condicional o elige otro consejo.
- Backear: no lo recomiendes con menos de unos 400 de oro, salvo que tenga poca vida o maná. Llegar tarde y sana a un objetivo suele ser mejor que puntual y a media vida.
- Sin muletillas. No cierres siempre igual ni metas el ward de control o el Castigo en cada consejo: solo cuando ese sea de verdad el punto.
- Si no hay algo concreto que valga la pena decir AHORA, responde exactamente: NADA. Callar es mejor que hacer ruido.

SEGÚN EL MOMENTO
- Acaba de morir (puede escuchar con calma): una lectura breve de por qué le está pasando, si la bitácora lo deja ver, y qué hacer al reaparecer. Hasta 3 frases, 50 palabras.
- Acaba de comprar (está saliendo de base): hacia dónde conviene que vayan sus próximos 2 minutos según lo que viene y cómo va la partida. Hasta 2 frases, 40 palabras.
- Pidió tu lectura: lo más importante de su partida ahora mismo y por qué; puede incluir algo que está haciendo bien. Hasta 3 frases, 50 palabras.
- Objetivo con un problema detectado: resuelve ESE problema. Una o dos frases, 28 palabras.
- Cambio grande de la partida (Barón, alma, inhibidor): cómo cambia lo que le conviene hacer. Una o dos frases, 28 palabras.
- Oro acumulado: solo si de verdad le conviene volver ahora. Una frase.

FORMATO
- Español latino, de tú, tono cercano y directo, sin regaños. Es una sugerencia: la decisión es de ella.
- Se va a leer con un lector de voz: solo texto corrido. Sin saludos, sin su nombre, sin listas, sin comillas, sin paréntesis, sin emojis ni símbolos. Escribe "2 minutos" y "400 de oro", no "2:00" ni "400g".
- ${JERGA}
- Solo macro, nunca mecánicas ni reflejos.
- Del rival solo conoces el marcador y cuántos están muertos. Nunca menciones campeones rivales, sus objetos, niveles, hechizos, ultis ni dónde podrían estar.

CRITERIOS DE MACRO (referencia, no un guion)
- El Dragón está en el río de abajo; Vacuolarvas, Heraldo y Barón, en el de arriba.
- El tercer dragón deja a un equipo a uno del alma: ese siguiente dragón se disputa con todo el equipo o se cambia por otro objetivo, no se regala sin nada a cambio.
- Más rivales muertos que aliados: ventana para el objetivo disponible o para torres. Más aliados muertos: no pelear, visión y esperar.
- Con Barón o Ancestral de su equipo: agruparse y empujar con las oleadas mientras dure. Si lo tiene el rival: limpiar oleadas bajo torre y no pelear en campo abierto.
- Con ventaja: jugar por objetivos y negar visión. Con desventaja: ceder lo que no se pueda disputar, farmear y defender en grupo.
- Soporte: la visión se pone antes de que salga el objetivo, no cuando ya empezó; si su jungla está muerta, no se fuerza el objetivo; a Vacuolarvas o Heraldo puede rotar si su ADC no queda vendido.
- Jungla: el reset se planea antes del objetivo, no encima; con el farmeo por debajo de su referencia, los campamentos entre jugadas pesan más que las peleas largas; no ir sola a contestar un objetivo que ya se perdió.`;

const SISTEMA_FILTRO = `Eres el filtro de un coach de macro de League of Legends que habla por voz durante la partida. Recibes el estado de la partida de una jugadora, lo que viene haciendo, la bitácora de su partida (incluye lo que el coach ya le dijo, marcado como COACH) y el momento por el que se consulta. Decides si AHORA vale la pena interrumpirla.

Responde hablar = true solo si se cumplen las tres cosas:
1. Hay una acción de macro concreta que le conviene hacer en el próximo minuto y que probablemente no está haciendo ya.
2. Esa acción se deduce de los datos, sin suponer posiciones en el mapa, oleadas ni campamentos, que no se conocen.
3. El coach no le dijo ya algo parecido hace poco.

Responde hablar = false si solo habría un dato que ella ya ve en pantalla, si el consejo sería genérico, si acaba de comprar, o si tiene poco oro para que volver a base valga la pena. Ante la duda, false: es mejor callar que hacer ruido.

Devuelve hablar y un motivo de 12 palabras como máximo.`;

const ESQUEMA_FILTRO = {
  type: 'object',
  properties: { hablar: { type: 'boolean' }, motivo: { type: 'string' } },
  required: ['hablar', 'motivo'],
  additionalProperties: false,
};

// ── Lo que manda la app, campo por campo (lo demás se descarta) ──
const TIPOS = ['objetivo', 'muerte', 'base', 'pedido', 'ritmo', 'compra'];
// Momentos en los que puede escuchar con calma: el consejo puede ser un poco más largo.
const PAUSAS = ['muerte', 'base', 'pedido'];
const ENTRADAS = ['muerte', 'compra', 'jugada', 'objetivo', 'control', 'coach'];
const ROLES = ['jungla', 'soporte'];
const txt = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>{}`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n)));
};
// Un plazo en palabras y en segundos, sin mezclar unidades (con "2 min 53 s" el modelo
// llegó a leer "53 segundos").
function plazo(s: number): string {
  if (s < 90) return `${s} segundos`;
  const medios = Math.round(s / 30);
  const min = Math.floor(medios / 2);
  return `unos ${min} minutos${medios % 2 ? ' y medio' : ''} (${s} segundos)`;
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function comparada(m: any, unidad: string): string {
  const valor = txt(m?.valor, 8);
  const ref = txt(m?.referencia, 8);
  return valor && ref ? ` (${valor} ${unidad}; referencia de la división de arriba: ${ref}${m?.bajo === true ? ', por debajo' : ''})` : '';
}

// Resumen de la partida en texto para el modelo. Devuelve null si falta lo básico.
function redactarEstado(e: any, situacion: any, bitacora: any): string | null {
  const rol = ROLES.includes(e?.rol) ? e.rol : null;
  const t = num(e?.t, 0, 7200);
  if (!rol || t === null) return null;
  const lineas: string[] = ['AHORA'];
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
    return nombre && en !== null ? (en > 0 ? `${nombre}: aparece en ${plazo(en)}` : `${nombre}: disponible ya`) : '';
  }).filter(Boolean);
  if (objetivos.length) lineas.push(`Objetivos: ${objetivos.join('; ')}`);
  const buffs = (Array.isArray(e.buffs) ? e.buffs : []).slice(0, 2).map((b: any) => {
    const nombre = txt(b?.nombre, 24);
    return nombre ? `${nombre} (${b?.de === 'rival' ? 'del rival' : 'de su equipo'}, quedan ${num(b?.quedan, 0, 300) ?? '?'} s)` : '';
  }).filter(Boolean);
  if (buffs.length) lineas.push(`Buffs activos: ${buffs.join('; ')}`);

  // Lo que se deduce de los últimos segundos.
  const act = e.actividad ?? {};
  const ultimo: string[] = [];
  const enBase = num(act.enBaseHace, 0, 600);
  if (enBase !== null) ultimo.push(enBase <= 20 ? `compró hace ${enBase} segundos: está en base o saliendo de ella` : `compró hace ${enBase} segundos: ya volvió de base`);
  const csMin = num(act.csUltimoMin, 0, 60);
  if (csMin !== null) ultimo.push(rol === 'jungla' ? `en el último minuto sumó ${csMin} de CS (un campamento da 4)` : `en el último minuto sumó ${csMin} de CS`);
  const vidaAntes = num(act.vidaHace10, 0, 100);
  if (vidaAntes !== null && vida !== null && !muerta && vidaAntes - vida >= 20) ultimo.push(`su vida bajó de ${vidaAntes} % a ${vida} % en 10 segundos`);
  lineas.push('', 'LO ÚLTIMO', ultimo.length ? ultimo.join('; ') : 'sin cambios que destacar');

  // La historia de la partida, incluido lo que el coach ya dijo.
  const historia = (Array.isArray(bitacora) ? bitacora : []).slice(-30).map((b: any) => {
    const detalle = txt(b?.detalle, b?.tipo === 'coach' ? 400 : 160);
    if (!detalle || !ENTRADAS.includes(b?.tipo)) return '';
    return `- [${txt(b?.minuto, 6)}] ${b.tipo === 'coach' ? 'COACH: ' : ''}${detalle}`;
  }).filter(Boolean);
  lineas.push('', 'BITÁCORA', historia.length ? historia.join('\n') : 'todavía no pasó nada que anotar');
  lineas.push('', `MOMENTO: ${txt(situacion?.motivo, 200) || 'sin detalle'}`);
  return lineas.join('\n');
}

// Lo que se va a leer en voz: frases limpias, o nada. En las pausas cabe algo más largo.
function pulir(texto: string, largo: number): string {
  let t = texto.replace(/\s+/g, ' ').replace(/^["'«“]+|["'»”]+$/g, '').trim();
  if (!t || /^nada\b/i.test(t)) return '';
  t = t.replace(/[*_#`]/g, '').replace(/\bselv[aá]tic[oa]s?\b/gi, 'de la jungla').replace(/\bselva\b/gi, 'jungla');
  if (t.length > largo) {
    const corte = t.slice(0, largo);
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
    // La app de la primera versión mandaba "dichos" en lugar de la bitácora.
    const historia = Array.isArray(cuerpo.bitacora) ? cuerpo.bitacora
      : (Array.isArray(cuerpo.dichos) ? cuerpo.dichos.map((d: any) => ({ minuto: d?.minuto, tipo: 'coach', detalle: d?.texto })) : []);
    const resumen = redactarEstado(cuerpo.estado, situacion, historia);
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
      // 2) Coach: Sonnet lee la bitácora y redacta. Razona un poco antes de hablar
      //    (adaptive + effort low): sin razonar, recitaba la guía y leía mal los plazos.
      //    El razonamiento cuenta contra max_tokens, por eso el margen. El system prompt
      //    va a la caché.
      if (hablar) {
        const c = await claude.messages.create({
          model: MODELO_COACH,
          max_tokens: 1000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: SISTEMA_COACH, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: resumen }],
        });
        sumarUso(uso, MODELO_COACH, c.usage);
        // Si el modelo se niega a responder (stop_reason "refusal"), simplemente no se habla.
        // Si se queda sin margen a media frase ("max_tokens"), tampoco: mejor callar que decir algo cortado.
        texto = c.stop_reason === 'end_turn' ? pulir(textoDe(c), PAUSAS.includes(situacion.tipo) ? 380 : 230) : '';
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
