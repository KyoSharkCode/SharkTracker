// Edge Function — Consejo de IA del perfil (botón "IA" de perfil.html).
//
// La llama el navegador con { player_id }. Arma un resumen de las
// últimas 10 partidas de SoloQ del jugador + sus badges, y le pide a
// Gemini (mismo modelo gratuito que usaba el sitio viejo) una valoración:
// estilo de juego, mejores campeones, mejor rol probable y 3+ consejos.
//
// CACHÉ: el resultado se guarda en profile_ai_advice junto con el
// match_id de la partida más reciente usada. Si el jugador no jugó nada
// nuevo desde entonces, se devuelve lo guardado sin llamar a Gemini —
// por más clicks que haga cualquiera, solo se gasta 1 llamada por
// partida nueva.
//
// Los datos se calculan ACÁ (con service_role), no se aceptan del
// navegador, para que nadie pueda mandar números inventados.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = (Deno.env.get('GEMINI_API_KEY') ?? '').trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MIN_PARTIDAS = 3;

// Si cambia el prompt o el formato, subir este número: los consejos
// guardados con otra versión se regeneran solos (perfil.html usa el mismo).
const ADVICE_VERSION = 3;

// Nombres de rol oficiales del sitio: TOP / JUNGLE / MID / ADC / SUPPORT.
// Acepta códigos de Riot y los nombres viejos de players.primary_role.
const ROLE_NORMALIZE: Record<string, string> = {
  TOP: 'TOP', JUNGLE: 'JUNGLE', JUNGLA: 'JUNGLE', MIDDLE: 'MID', MID: 'MID',
  BOTTOM: 'ADC', ADC: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT',
};
const roleLabel = (r: string | null | undefined) =>
  r ? (ROLE_NORMALIZE[String(r).trim().toUpperCase()] ?? String(r).toUpperCase()) : null;

const BADGE_LABEL: Record<string, string> = {
  top_asesino: 'Top Asesino', top_observador: 'Top Observador', sin_rendirse: 'Sin Rendirse',
  otp_del_torneo: 'OTP del Torneo', escalador: 'El Escalador', horas_en_la_grieta: 'Horas en la Grieta',
  agresivo: 'Agresivo', kda_player: 'KDA Player', pentakills: 'Pentakills', tortuga: 'El Tortuga',
  asistente: 'El Asistente', duo_dinamico: 'Dúo Dinámico', farmeador: 'El Farmeador', defensor: 'El Defensor',
  ladron: 'El Ladrón', destructor: 'El Destructor', stop: 'Stop', champion_pool: 'Maestro del Champion Pool',
  rey_temporada: 'Rey de la Temporada',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let playerId: string | undefined;
  try { playerId = (await req.json())?.player_id; } catch { /* body vacío */ }
  if (!playerId || !/^[0-9a-f-]{36}$/i.test(playerId)) return json({ error: 'player_id inválido' }, 400);

  try {
    const { data: player } = await supabase
      .from('players').select('id, riot_game_name, primary_role').eq('id', playerId).maybeSingle();
    if (!player) return json({ error: 'Jugador no encontrado' }, 404);

    // Últimas 10 de SoloQ (las mismas que muestra el perfil), sin remakes.
    const { data: partsRaw } = await supabase
      .from('match_participants')
      .select('match_id, champion, role, win, kills, deaths, assists, cs, vision_score, damage_to_champions, extra_stats, matches!inner(duration_seconds, ended_at, queue_id)')
      .eq('player_id', playerId)
      .eq('matches.queue_id', 420)
      .limit(100);
    const partidas = (partsRaw ?? [])
      .filter((m: any) => m.matches && !(!m.win && (m.matches.duration_seconds ?? 0) < 300))
      .sort((a: any, b: any) => new Date(b.matches.ended_at).getTime() - new Date(a.matches.ended_at).getTime())
      .slice(0, 10);

    if (partidas.length < MIN_PARTIDAS) {
      return json({ status: 'sin_datos', minimo: MIN_PARTIDAS, partidas: partidas.length });
    }

    const lastMatchId = partidas[0].match_id;

    // ── ¿Ya hay consejo para esta misma última partida? → se devuelve tal cual.
    const { data: cached } = await supabase
      .from('profile_ai_advice').select('*').eq('player_id', playerId).maybeSingle();
    if (cached && cached.last_match_id === lastMatchId && cached.advice?.v === ADVICE_VERSION) {
      return json({ status: 'ok', cached: true, advice: cached.advice, generated_at: cached.generated_at, last_match_id: lastMatchId });
    }

    if (!GEMINI_API_KEY) {
      return json({ error: 'Falta configurar GEMINI_API_KEY en los Secrets de Edge Functions.' }, 500);
    }

    // ── Resumen de datos para el prompt ──
    const wins = partidas.filter((m: any) => m.win).length;
    const winrate = Math.round((wins / partidas.length) * 100);

    const porCampeon = new Map<string, { n: number; w: number; k: number; d: number; a: number }>();
    const porRol = new Map<string, { n: number; w: number }>();
    let totalMin = 0, totalCs = 0, totalVision = 0, sinWardControl = 0, conDatoWard = 0;
    for (const m of partidas as any[]) {
      const c = porCampeon.get(m.champion) ?? { n: 0, w: 0, k: 0, d: 0, a: 0 };
      c.n++; if (m.win) c.w++; c.k += m.kills ?? 0; c.d += m.deaths ?? 0; c.a += m.assists ?? 0;
      porCampeon.set(m.champion, c);
      const rolNombre = roleLabel(m.role);
      if (rolNombre) {
        const r = porRol.get(rolNombre) ?? { n: 0, w: 0 };
        r.n++; if (m.win) r.w++;
        porRol.set(rolNombre, r);
      }
      totalMin += (m.matches.duration_seconds ?? 0) / 60;
      totalCs += m.cs ?? 0;
      totalVision += m.vision_score ?? 0;
      if (typeof m.extra_stats?.wards_control === 'number') {
        conDatoWard++;
        if (m.extra_stats.wards_control === 0) sinWardControl++;
      }
    }
    const kdaTxt = (k: number, d: number, a: number) => d === 0 ? 'perfecto' : ((k + a) / d).toFixed(2);

    const campeonesTxt = [...porCampeon.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([champ, s]) => `- ${champ}: ${s.n} partida(s), ${s.w}V/${s.n - s.w}D, KDA ${kdaTxt(s.k, s.d, s.a)}`)
      .join('\n');
    const rolesTxt = [...porRol.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([rol, s]) => `- ${rol}: ${s.n} partida(s), ${s.w}V/${s.n - s.w}D`)
      .join('\n') || '- (sin datos de rol)';
    // ¿Autofill? — mismo criterio que perfil.html/index.html: rol distinto al principal.
    const rolPrincipal: string | null = roleLabel(player.primary_role);
    const esAutofill = (m: any) => !!rolPrincipal && !!roleLabel(m.role) && roleLabel(m.role) !== rolPrincipal;
    const nAutofill = (partidas as any[]).filter(esAutofill).length;
    const partidasTxt = (partidas as any[]).map((m, i) =>
      `${i + 1}. ${m.win ? 'Victoria' : 'Derrota'} con ${m.champion} (${roleLabel(m.role) ?? 'rol N/A'})` +
      `${esAutofill(m) ? ' [POSIBLE AUTOFILL]' : ''}${m.extra_stats?.posible_egida ? ' [posible Égida de Valor]' : ''} — ` +
      `KDA ${m.kills}/${m.deaths}/${m.assists}, ${(m.cs / Math.max((m.matches.duration_seconds ?? 60) / 60, 1)).toFixed(1)} CS/min, ` +
      `visión ${m.vision_score ?? 0}, daño a campeones ${m.damage_to_champions ?? 0}`
    ).join('\n');

    const { data: badges } = await supabase.from('weekly_badges').select('category, player_id, player_ids, detail');
    const misBadges = (badges ?? [])
      .filter((b: any) => (b.player_ids?.length ? b.player_ids : [b.player_id]).includes(playerId))
      .map((b: any) => `- ${BADGE_LABEL[b.category] ?? b.category}: ${b.detail ?? ''}`);
    if (conDatoWard > 0 && sinWardControl >= 6) misBadges.push(`- Ciego: ${sinWardControl}/${conDatoWard} partidas sin ward de control`);

    const prompt = `Eres un coach amistoso dentro de un tracker de estadísticas de League of Legends para un grupo pequeño de amigos que juega SoloQ.

Analiza el PERFIL de este jugador a partir de sus últimas ${partidas.length} partidas de SoloQ y sus insignias. Escribe en español, tono cercano y motivador, sin tecnicismos exagerados. No puedes ver las partidas (ni video ni replay), solo estos números: no inventes jugadas ni datos que no te doy. Sé honesto pero nunca cruel.

Jugador: ${player.riot_game_name}
Rol principal (el que más juega): ${rolPrincipal ?? 'desconocido'}
Partidas marcadas como posible autofill: ${nAutofill}
Winrate en estas partidas: ${winrate}% (${wins}V / ${partidas.length - wins}D)
Promedios: ${(totalCs / Math.max(totalMin, 1)).toFixed(1)} CS/min, ${(totalVision / partidas.length).toFixed(1)} de visión por partida

Campeones jugados:
${campeonesTxt}

Roles jugados:
${rolesTxt}

Insignias actuales:
${misBadges.length ? misBadges.join('\n') : '- (ninguna)'}

Partidas (más reciente primero):
${partidasTxt}

Reglas importantes:
- Los roles se llaman TOP, JUNGLE, MID, ADC y SUPPORT, escritos exactamente así. Usa SOLO esos nombres (nunca "UTILITY", "BOTTOM", "MIDDLE", "Jungla" ni "Support").
- En SoloQ a veces el juego asigna un rol que el jugador no eligió (autofill). Las partidas marcadas [POSIBLE AUTOFILL] fueron en un rol distinto a su principal: probablemente no lo eligió. No le recomiendes cambiar a ese rol ni evitarlo solo por esas partidas, y tenlas en cuenta al juzgar malos resultados (pueden explicarse por el autofill). Una [posible Égida de Valor] también indica autofill.
- El "mejor_rol" debe basarse sobre todo en su rol principal y en resultados reales, no en partidas de autofill sueltas.

Responde SOLO con un objeto JSON con esta forma exacta:
{
  "estilo": "2-3 frases resumiendo su estilo de juego",
  "mejores_campeones": [{"campeon": "Nombre", "motivo": "1 frase basada en sus resultados"}],
  "mejor_rol": {"rol": "ROL", "motivo": "1 frase"},
  "consejos": ["consejo 1", "consejo 2", "consejo 3"]
}
"mejores_campeones" tiene de 1 a 3 elementos. "consejos" tiene de 3 a 5 elementos, cada uno de 1-2 frases, concretos y basados en los números.`;

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
    const res = await fetch(`${url}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 900, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      return json({ error: `Gemini -> ${res.status}`, detalle: detalle.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const texto: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let advice: any;
    try {
      advice = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      advice = null;
    }
    if (!advice || typeof advice.estilo !== 'string' || !Array.isArray(advice.consejos)) {
      return json({ error: 'La IA devolvió un formato inesperado, probá de nuevo en un rato.' }, 502);
    }
    // Se guardan también los datos base, para mostrarlos al lado del texto.
    advice.base = { partidas: partidas.length, wins, winrate };
    advice.v = ADVICE_VERSION;

    const generatedAt = new Date().toISOString();
    await supabase.from('profile_ai_advice').upsert({
      player_id: playerId, advice, last_match_id: lastMatchId, generated_at: generatedAt,
    });

    return json({ status: 'ok', cached: false, advice, generated_at: generatedAt, last_match_id: lastMatchId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
