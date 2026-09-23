-- ============================================================
-- FASE 6 — Recompensas y tienda (🦷 Dientes)
--
-- · Los 🦷 se ganan jugando (misiones, victorias, retos, partida del mes…)
--   y se gastan en la tienda. Vuelven a 0 cada split: el saldo es la suma
--   de los movimientos del split actual. Lo comprado y las insignias son
--   permanentes.
-- · Nace APAGADO: no se reparte nada hasta que la admin lo activa en el
--   Admin Dashboard (solo cuenta lo que pase desde ese momento).
-- · compute_rewards() corre cada 5 min (pg_cron). Cada premio tiene una
--   "clave" única por jugador, así nunca se paga dos veces lo mismo.
-- ============================================================

-- ── Ajustes (interruptor + cantidades editables) ──
create table if not exists reward_settings (
  singleton  boolean primary key default true check (singleton),
  enabled    boolean not null default false,
  enabled_at timestamptz,
  amounts    jsonb not null default '{
    "mision_facil": 10, "mision_media": 20, "mision_dificil": 30,
    "grupal_top": 20, "grupal_resto": 20,
    "top1": 50, "top2": 30, "top3": 15,
    "victoria": 2, "primera_victoria": 5,
    "perfecta": 15, "pentakill": 25,
    "partida_mes": 100,
    "reto1": 150, "reto2": 75, "reto3": 40
  }'::jsonb
);
insert into reward_settings (singleton) values (true) on conflict do nothing;

create or replace function reward_amount(p_key text)
returns integer language sql stable set search_path = public as $$
  select coalesce((amounts->>p_key)::int, 0) from reward_settings
$$;

-- Split "actual" (si hay un hueco entre splits, el último que empezó).
create or replace function current_split_id()
returns bigint language sql stable set search_path = public as $$
  select coalesce(split_for(now()), (select id from splits where starts_at <= now() order by starts_at desc limit 1))
$$;

-- ── Movimientos de 🦷 ──
create table if not exists wallet_tx (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references players(id) on delete cascade,
  amount     integer not null,
  reason     text not null,           -- mision, grupal, top, victoria, primera_victoria, perfecta, pentakill, partida_mes, reto, compra, canje, reembolso, admin
  detail     text,
  source_key text not null,           -- evita pagar dos veces lo mismo
  split_id   bigint references splits(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (player_id, source_key)
);
create index if not exists wallet_tx_player_idx on wallet_tx (player_id, created_at desc);

create or replace view wallet_balances with (security_invoker = true) as
  select p.id as player_id, coalesce(sum(t.amount), 0)::int as balance
    from players p left join wallet_tx t on t.player_id = p.id and t.split_id is not distinct from current_split_id()
   group by p.id;

create or replace function wallet_balance(p_player uuid)
returns integer language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0)::int from wallet_tx
   where player_id = p_player and split_id is not distinct from current_split_id()
$$;

-- Da 🦷 (una sola vez por clave). Devuelve true si era nuevo.
create or replace function reward_give(p_player uuid, p_amount integer, p_reason text, p_detail text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if p_amount is null or p_amount = 0 then return false; end if;
  insert into wallet_tx (player_id, amount, reason, detail, source_key, split_id)
  values (p_player, p_amount, p_reason, p_detail, p_key, current_split_id())
  on conflict (player_id, source_key) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- ── Tienda ──
create table if not exists shop_items (
  id          text primary key,
  kind        text not null check (kind in ('marco', 'fila', 'banner', 'nombre', 'emoji', 'premio')),
  name        text not null,
  description text,
  collection  text,
  price       integer not null check (price >= 0),
  active      boolean not null default true,
  stock       integer check (stock is null or stock >= 0),   -- solo premios (null = sin límite)
  icon        text,                                          -- solo premios: moneda, juego, skin, regalo, suscripcion, pase, merch, sorpresa
  image_url   text,                                          -- artículos de imagen (PNG) — opcional
  image_anim  text,                                          -- animación para artículos de imagen
  sort        integer not null default 100,
  created_at  timestamptz not null default now()
);
insert into shop_items (id, kind, name, description, collection, price, sort) values
  ('emoji',            'emoji',  'Emoji junto al nombre', 'Elige un emoji que va al lado de tu nombre.',            'Básicos',    80, 10),
  ('nombre-color',     'nombre', 'Color de nombre',       'Tu nombre en uno de 8 colores (lo cambias cuando quieras).', 'Básicos', 150, 11),
  ('nombre-degradado', 'nombre', 'Nombre en degradado',   'Tu nombre con un degradado de colores que se mueve.',   'Básicos',   600, 12),
  ('marco-bronce',     'marco',  'Marco Bronce',          'Aro metálico de bronce.',                               'Básicos',   150, 20),
  ('marco-plata',      'marco',  'Marco Plata',           'Aro de plata con destello.',                            'Básicos',   300, 21),
  ('marco-oro',        'marco',  'Marco Oro',             'Aro dorado que brilla, con gema.',                      'Básicos',   500, 22),
  ('marco-arcoiris',   'marco',  'Marco Arcoíris',        'Aro de colores que gira.',                              'Básicos',  1000, 23),
  ('marco-neon',       'marco',  'Neón grafiti',          'Garabatos neón, pintura que gotea, spray y conejito.',  'Neón',      900, 30),
  ('marco-tiburon',    'marco',  'Océano tiburón',        'Dientes que giran, aleta, olas y burbujas.',            'Neón',     1500, 31),
  ('marco-sakura',     'marco',  'Sakura kawaii',         'Pétalos que caen, corazones y estrellitas.',            'Neón',      900, 32),
  ('marco-galaxia',    'marco',  'Galaxia',               'Planetita, órbita, cometa y estrellas.',                'Neón',     1100, 33),
  ('marco-demonio',    'marco',  'Demonio neón',          'Cuernitos, colita, llamitas y chispas.',                'Neón',     1100, 34),
  ('idol-corazon',     'marco',  'Corazón de cristal',    'Corazón facetado que late y aro cromado.',              'Idol Stage', 900, 40),
  ('idol-lightsticks', 'marco',  'Lightsticks',           'Barras de luz que se agitan y notas que suben.',        'Idol Stage', 1100, 41),
  ('idol-escenario',   'marco',  'En el escenario',       'Focos, ecualizador y corazones.',                       'Idol Stage', 1500, 42),
  ('fila-brillo',      'fila',   'Brillo',                'Tu fila del ranking brilla suavemente.',                'Básicos',   400, 50),
  ('fila-burbujas',    'fila',   'Burbujas',              'Burbujas que suben por tu fila.',                       'Neón',      800, 51),
  ('fila-aleta',       'fila',   'Aleta nadando',         'Una aleta cruza tu fila sobre las olas.',               'Neón',     1200, 52),
  ('idol-cromo',       'fila',   'Cromo brillante',       'Borde degradado y destello metálico.',                  'Idol Stage', 450, 53),
  ('idol-focos',       'fila',   'Focos de escenario',    'Tres focos barren tu fila.',                            'Idol Stage', 900, 54),
  ('idol-eq',          'fila',   'Ecualizador',           'Barras de música y corazones que suben.',               'Idol Stage', 1200, 55),
  ('banner-animado',   'banner', 'Borde animado',         'Borde de colores que gira alrededor del banner.',       'Básicos',   450, 60),
  ('banner-tiburon',   'banner', 'Borde tiburón',         'Dientes arriba y esquinas decoradas.',                  'Neón',      800, 61),
  ('idol-marquesina',  'banner', 'Marquesina',            'Bombillas de cartel de concierto.',                     'Idol Stage', 700, 62),
  ('idol-final',       'banner', 'Gran final',            'Borde que gira, confeti y corazones de cristal.',       'Idol Stage', 1000, 63)
on conflict (id) do nothing;

create table if not exists inventory (
  player_id   uuid not null references players(id) on delete cascade,
  item_id     text not null references shop_items(id) on delete cascade,
  price_paid  integer not null,
  acquired_at timestamptz not null default now(),
  primary key (player_id, item_id)
);

-- Lo que cada jugador lleva puesto
create table if not exists player_cosmetics (
  player_id    uuid primary key references players(id) on delete cascade,
  marco        text references shop_items(id) on delete set null,
  fila         text references shop_items(id) on delete set null,
  banner       text references shop_items(id) on delete set null,
  nombre       text references shop_items(id) on delete set null,
  nombre_valor text,     -- color elegido (nombre-color)
  emoji        text,     -- emoji elegido
  updated_at   timestamptz not null default now()
);

-- Opciones válidas (iguales a las de assets/cosmetics.js)
create or replace function cosmetic_colors() returns text[] language sql immutable as $$
  select array['#ff8a6b', '#facc15', '#4ade80', '#60a5fa', '#c084fc', '#ff5fa8', '#00e5c7', '#ffffff']
$$;
create or replace function cosmetic_emojis() returns text[] language sql immutable as $$
  select array['🦈', '👑', '🔥', '🌙', '⚡', '💜', '⭐', '🎮', '🐰', '🍀', '💀', '🌸']
$$;

-- ── Premios reales ──
create table if not exists prize_claims (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references players(id) on delete cascade,
  item_id     text not null references shop_items(id) on delete cascade,
  item_name   text not null,
  price       integer not null,
  status      text not null default 'pendiente' check (status in ('pendiente', 'entregado', 'rechazado')),
  note        text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- ── Insignias ──
create table if not exists badges (
  code        text primary key,
  name        text not null,
  description text not null,
  icon        text not null,
  sort        integer not null default 100
);
insert into badges (code, name, description, icon, sort) values
  ('reto_ganador', 'Campeón de reto',       'Ganó un reto.',                                  '🏆', 10),
  ('reto_podio',   'Podio',                 'Quedó en el top 3 de un reto.',                  '🥉', 11),
  ('partida_mes',  'Partida del mes',       'Tuvo la mejor partida del grupo en un mes.',     '⭐', 20),
  ('pentakill',    'Pentakill',             'Hizo una pentakill.',                            '🖐️', 21),
  ('racha5',       'Imparable',             'Ganó 5 partidas seguidas.',                      '🔥', 22),
  ('top1_semana',  'Rey de la semana',      'Fue el 1º en la tabla de misiones de una semana.', '👑', 30),
  ('misiones10',   'Cumplidor',             'Completó 10 misiones.',                          '🎯', 31),
  ('misiones50',   'Leyenda de las misiones', 'Completó 50 misiones.',                        '🏹', 32),
  ('dificiles25',  'Sin miedo',             'Completó 25 misiones difíciles.',                '💀', 33),
  ('subio_liga',   'Ascenso',               'Subió de liga en SoloQ.',                        '📈', 40),
  ('split_oro',    'Split en Oro+',         'Terminó un split en Oro o más (SoloQ).',         '🥇', 41)
on conflict (code) do nothing;

create table if not exists player_badges (
  player_id uuid not null references players(id) on delete cascade,
  badge     text not null references badges(code) on delete cascade,
  detail    text,
  earned_at timestamptz not null default now(),
  primary key (player_id, badge)
);

create or replace function award_badge(p_player uuid, p_badge text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_new boolean;
begin
  insert into player_badges (player_id, badge, detail) values (p_player, p_badge, p_detail)
  on conflict do nothing
  returning true into v_new;
  if v_new then
    select name into v_name from badges where code = p_badge;
    insert into events (type, icon, category, player_id, detail) values ('insignia', '🏅', p_badge, p_player, v_name);
  end if;
end;
$$;

-- Aportes de cada jugador a la misión grupal de una semana
create or replace function reward_group_contrib(p_code text, p_since timestamptz, p_until timestamptz)
returns table (player_id uuid, contrib numeric)
language sql stable
security definer
set search_path = public
as $$
  with g as (
    select mp.player_id, mp.win, mt.duration_seconds dur, mp.extra_stats
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= p_since and mt.ended_at < p_until
       and not (not mp.win and mt.duration_seconds < 300))
  select player_id,
         case p_code
           when 'g_wins25'  then count(*) filter (where win)::numeric
           when 'g_hours20' then sum(dur) / 3600.0
           when 'g_fb8'     then count(*) filter (where coalesce((extra_stats->>'primera_sangre')::boolean, false))::numeric
           else 0 end
    from g group by player_id
$$;

-- ============================================================
-- Motor: se corre cada 5 minutos
-- ============================================================
create or replace function compute_rewards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s reward_settings;
  v_since timestamptz;
  v_mis_since timestamptz;
  r record;
  w record;
  v_top numeric;
  v_rest numeric;
  v_amt integer;
  v_end timestamptz;
begin
  select * into s from reward_settings;
  if not s.enabled or s.enabled_at is null then return; end if;
  v_since := s.enabled_at;
  select coalesce(enabled_at, v_since) into v_mis_since from mission_settings;

  -- 1) Misiones completadas
  for r in
    select pm.id, pm.player_id, pm.tier, c.title from player_missions pm join mission_catalog c on c.code = pm.code
     where pm.completed_at >= v_since
  loop
    perform reward_give(r.player_id,
      reward_amount(case r.tier when 'easy' then 'mision_facil' when 'medium' then 'mision_media' else 'mision_dificil' end),
      'mision', r.title, 'mision:' || r.id);
  end loop;

  -- 2) Misión grupal completada: el que más aportó se lleva el premio entero;
  --    otro premio se reparte entre el resto según lo que aportó cada uno.
  for w in
    select mw.week_start, mw.group_code, c.title from mission_weeks mw join mission_catalog c on c.code = mw.group_code
     where mw.group_completed_at >= v_since
  loop
    create temp table if not exists _gc (player_id uuid, contrib numeric) on commit drop;
    truncate _gc;
    insert into _gc select * from reward_group_contrib(w.group_code, greatest(w.week_start, v_mis_since), w.week_start + interval '7 days') x where x.contrib > 0;
    select max(contrib) into v_top from _gc;
    select coalesce(sum(contrib), 0) into v_rest from _gc where contrib < v_top;
    for r in select * from _gc loop
      if r.contrib = v_top then
        v_amt := reward_amount('grupal_top');
      else
        v_amt := greatest(1, round(reward_amount('grupal_resto') * r.contrib / nullif(v_rest, 0)))::int;
      end if;
      perform reward_give(r.player_id, v_amt, 'grupal', w.title, 'grupal:' || to_char(w.week_start, 'YYYY-MM-DD'));
    end loop;
  end loop;

  -- 3) Top 3 de la tabla semanal (cuando la semana ya terminó)
  for w in
    select mw.week_start, mw.group_completed_at is not null as gdone, coalesce(c.points, 2) gpts
      from mission_weeks mw left join mission_catalog c on c.code = mw.group_code
     where mw.week_start + interval '7 days' <= now() and mw.week_start + interval '7 days' >= v_since
  loop
    for r in
      with pts as (
        select pm.player_id,
               sum(case when pm.completed_at is not null then c.points else 0 end)
               + case when w.gdone and exists (
                   select 1 from match_participants mp join matches mt on mt.match_id = mp.match_id
                    where mp.player_id = pm.player_id and mt.ended_at >= greatest(w.week_start, v_mis_since)
                      and mt.ended_at < w.week_start + interval '7 days'
                      and not (not mp.win and mt.duration_seconds < 300)) then w.gpts else 0 end as p
          from player_missions pm join mission_catalog c on c.code = pm.code
         where pm.week_start = w.week_start
         group by pm.player_id)
      select player_id, p, dense_rank() over (order by p desc) pos from pts where p > 0
    loop
      if r.pos <= 3 then
        perform reward_give(r.player_id, reward_amount('top' || r.pos), 'top', 'Top ' || r.pos || ' de la semana',
                            'top:' || to_char(w.week_start, 'YYYY-MM-DD'));
        if r.pos = 1 then perform award_badge(r.player_id, 'top1_semana', to_char(w.week_start, 'DD/MM/YYYY')); end if;
      end if;
    end loop;
  end loop;

  -- 4) Victorias (todas las colas, sin remakes) + primera victoria del día de cada jugador (día = 6:00 Madrid)
  for r in
    select mp.player_id, mp.match_id, mp.champion, mt.ended_at
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mp.win and mt.ended_at >= v_since
  loop
    perform reward_give(r.player_id, reward_amount('victoria'), 'victoria', r.champion, 'win:' || r.match_id);
  end loop;
  for r in
    select distinct on (mp.player_id, ((mt.ended_at at time zone 'Europe/Madrid') - interval '6 hours')::date)
           mp.player_id, mp.champion, ((mt.ended_at at time zone 'Europe/Madrid') - interval '6 hours')::date as dia
      from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mp.win and mt.ended_at >= v_since
     order by mp.player_id, ((mt.ended_at at time zone 'Europe/Madrid') - interval '6 hours')::date, mt.ended_at
  loop
    perform reward_give(r.player_id, reward_amount('primera_victoria'), 'primera_victoria', r.champion, 'pvd:' || r.dia);
  end loop;

  -- 5) Pentakill y Partida Perfecta
  for r in
    select mp.player_id, mp.match_id, mp.champion from match_participants mp join matches mt on mt.match_id = mp.match_id
     where mt.ended_at >= v_since and coalesce((mp.extra_stats->>'pentakills')::int, 0) > 0
  loop
    perform reward_give(r.player_id, reward_amount('pentakill'), 'pentakill', r.champion, 'penta:' || r.match_id);
    perform award_badge(r.player_id, 'pentakill', r.champion);
  end loop;
  for r in
    select player_id, split_part(category, ':', 2) as match_id, detail from events
     where category like 'perfecta:%' and occurred_at >= v_since and player_id is not null
  loop
    perform reward_give(r.player_id, reward_amount('perfecta'), 'perfecta', r.detail, 'perfecta:' || r.match_id);
  end loop;

  -- 6) Partida del mes del grupo (cuando el mes ya terminó)
  for r in
    select distinct on (period) period, player_id, champion, score from best_matches
     order by period, score desc
  loop
    v_end := ((r.period || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Madrid';
    if v_end <= now() and v_end >= v_since then
      if reward_give(r.player_id, reward_amount('partida_mes'), 'partida_mes', r.champion || ' · ' || round(r.score) || ' pts', 'pmes:' || r.period) then null; end if;
      perform award_badge(r.player_id, 'partida_mes', r.period);
    end if;
  end loop;

  -- 7) Retos: 1º / 2º / 3º
  for r in
    select cr.player_id, cr.position, ch.id, ch.name from challenge_results cr join challenges ch on ch.id = cr.challenge_id
     where ch.finished_at >= v_since and cr.position <= 3 and cr.player_id is not null
  loop
    perform reward_give(r.player_id, reward_amount('reto' || r.position), 'reto', r.name || ' · ' || r.position || 'º', 'reto:' || r.id);
    perform award_badge(r.player_id, 'reto_podio', r.name);
    if r.position = 1 then perform award_badge(r.player_id, 'reto_ganador', r.name); end if;
  end loop;

  -- 8) Insignias por acumulado
  for r in
    select pm.player_id, count(*) n, count(*) filter (where pm.tier = 'hard') h
      from player_missions pm where pm.completed_at >= v_since group by pm.player_id
  loop
    if r.n >= 10 then perform award_badge(r.player_id, 'misiones10', null); end if;
    if r.n >= 50 then perform award_badge(r.player_id, 'misiones50', null); end if;
    if r.h >= 25 then perform award_badge(r.player_id, 'dificiles25', null); end if;
  end loop;
  -- Racha de 5 victorias seguidas (todas las colas, sin remakes)
  for r in
    with g as (
      select mp.player_id, mp.win, mt.ended_at from match_participants mp join matches mt on mt.match_id = mp.match_id
       where mt.ended_at >= v_since and not (not mp.win and mt.duration_seconds < 300)),
    s as (select player_id, win, sum(case when win then 0 else 1 end) over (partition by player_id order by ended_at) grp from g)
    select player_id from s where win group by player_id, grp having count(*) >= 5
  loop
    perform award_badge(r.player_id, 'racha5', null);
  end loop;
  -- Subida de liga (SoloQ)
  for r in
    with x as (
      select player_id, tier, recorded_at,
             lag(tier) over (partition by player_id order by recorded_at) prev
        from rank_snapshots where queue_type = 'RANKED_SOLO_5x5' and tier is not null)
    select distinct on (player_id) player_id, tier from x
     where recorded_at >= v_since and prev is not null
       and array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], tier)
         > array_position(array['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'], prev)
     order by player_id, recorded_at
  loop
    perform award_badge(r.player_id, 'subio_liga', r.tier);
  end loop;
  -- Terminó un split en Oro o más (SoloQ)
  for r in
    select sr.player_id, sp.name from split_ranks sr join splits sp on sp.id = sr.split_id
     where sr.queue_type = 'RANKED_SOLO_5x5' and sp.ends_at is not null and sp.ends_at <= now() and sp.ends_at >= v_since
       and sr.last_tier in ('GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER')
  loop
    perform award_badge(r.player_id, 'split_oro', r.name);
  end loop;
end;
$$;

-- ============================================================
-- Acciones de los jugadores
-- ============================================================
create or replace function my_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from players where user_id = auth.uid() limit 1
$$;

create or replace function buy_item(p_item text)
returns integer            -- saldo que queda
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := my_player_id();
  it shop_items;
  v_bal integer;
  v_claim bigint;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión.'; end if;
  if v_player is null then raise exception 'Primero vincula tu cuenta de LoL a tu perfil.'; end if;
  if not (select enabled from reward_settings) then raise exception 'La tienda todavía no está abierta.'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || v_player));
  select * into it from shop_items where id = p_item and active;
  if not found then raise exception 'Ese artículo no está disponible.'; end if;
  v_bal := wallet_balance(v_player);
  if v_bal < it.price then raise exception 'No te alcanzan los dientes (tienes %, cuesta %).', v_bal, it.price; end if;

  if it.kind = 'premio' then
    if it.stock is not null and it.stock <= 0 then raise exception 'Ese premio está agotado.'; end if;
    insert into prize_claims (player_id, item_id, item_name, price) values (v_player, it.id, it.name, it.price) returning id into v_claim;
    perform reward_give(v_player, -it.price, 'canje', it.name, 'canje:' || v_claim);
    update shop_items set stock = stock - 1 where id = it.id and stock is not null;
    insert into events (type, icon, category, player_id, detail) values ('canje', '🎁', 'premio', v_player, it.name);
  else
    if exists (select 1 from inventory where player_id = v_player and item_id = it.id) then raise exception 'Ya tienes ese artículo.'; end if;
    insert into inventory (player_id, item_id, price_paid) values (v_player, it.id, it.price);
    perform reward_give(v_player, -it.price, 'compra', it.name, 'compra:' || it.id);
    insert into events (type, icon, category, player_id, detail) values ('compra', '🛍️', it.kind, v_player, it.name);
  end if;
  return wallet_balance(v_player);
end;
$$;

-- Ponerse / quitarse un cosmético. p_item null = quitar. p_value = color o emoji elegido.
create or replace function equip_item(p_kind text, p_item text, p_value text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_player uuid := my_player_id(); v_kind text;
begin
  if v_player is null then raise exception 'Primero vincula tu cuenta de LoL a tu perfil.'; end if;
  if p_kind not in ('marco', 'fila', 'banner', 'nombre', 'emoji') then raise exception 'Tipo inválido.'; end if;
  if p_item is not null then
    select kind into v_kind from shop_items where id = p_item;
    if v_kind is distinct from p_kind then raise exception 'Ese artículo no es de ese tipo.'; end if;
    if not exists (select 1 from inventory where player_id = v_player and item_id = p_item) then raise exception 'Todavía no tienes ese artículo.'; end if;
    if p_item = 'nombre-color' and not (p_value = any(cosmetic_colors())) then raise exception 'Color no válido.'; end if;
    if p_kind = 'emoji' and not (p_value = any(cosmetic_emojis())) then raise exception 'Emoji no válido.'; end if;
  end if;
  insert into player_cosmetics (player_id) values (v_player) on conflict do nothing;
  update player_cosmetics set
    marco        = case when p_kind = 'marco'  then p_item else marco end,
    fila         = case when p_kind = 'fila'   then p_item else fila end,
    banner       = case when p_kind = 'banner' then p_item else banner end,
    nombre       = case when p_kind = 'nombre' then p_item else nombre end,
    nombre_valor = case when p_kind = 'nombre' then (case when p_item = 'nombre-color' then p_value end) else nombre_valor end,
    emoji        = case when p_kind = 'emoji'  then (case when p_item is null then null else p_value end) else emoji end,
    updated_at   = now()
   where player_id = v_player;
end;
$$;

-- ============================================================
-- Admin
-- ============================================================
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

create or replace function admin_set_rewards_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede cambiar esto.'; end if;
  update reward_settings set enabled = p_enabled,
         enabled_at = case when p_enabled and not enabled then now() else enabled_at end
   where singleton;
  if p_enabled then perform compute_rewards(); end if;
end;
$$;

create or replace function admin_set_reward_amounts(p_amounts jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not is_admin() then raise exception 'Solo una administradora puede cambiar esto.'; end if;
  for k in select jsonb_object_keys(p_amounts) loop
    if not (select amounts ? k from reward_settings) then raise exception 'Cantidad desconocida: %', k; end if;
    if jsonb_typeof(p_amounts->k) <> 'number' or (p_amounts->>k)::numeric < 0 or (p_amounts->>k)::numeric > 100000 then
      raise exception 'Valor inválido para %', k; end if;
  end loop;
  update reward_settings set amounts = amounts || p_amounts where singleton;
end;
$$;

create or replace function admin_adjust_teeth(p_player uuid, p_amount integer, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede dar o quitar dientes.'; end if;
  if p_amount = 0 then raise exception 'La cantidad no puede ser 0.'; end if;
  perform reward_give(p_player, p_amount, 'admin', coalesce(nullif(trim(p_detail), ''), 'Ajuste de la admin'), 'admin:' || gen_random_uuid());
end;
$$;

-- Crear (p_id null → premio nuevo) o editar un artículo.
create or replace function admin_save_item(p_id text, p_name text, p_description text, p_price integer,
                                           p_active boolean, p_stock integer, p_icon text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar la tienda.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Ponle un nombre.'; end if;
  if p_price is null or p_price < 0 then raise exception 'Precio inválido.'; end if;
  if p_id is null then
    v_id := 'premio-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into shop_items (id, kind, name, description, collection, price, active, stock, icon, sort)
    values (v_id, 'premio', trim(p_name), p_description, 'Premios', p_price, coalesce(p_active, true), p_stock, coalesce(p_icon, 'sorpresa'), 200);
  else
    update shop_items set name = trim(p_name), description = p_description, price = p_price, active = coalesce(p_active, active),
           stock = case when kind = 'premio' then p_stock else stock end,
           icon  = case when kind = 'premio' then coalesce(p_icon, icon) else icon end
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Ese artículo no existe.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function admin_resolve_claim(p_id bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c prize_claims;
begin
  if not is_admin() then raise exception 'Solo una administradora puede gestionar premios.'; end if;
  if p_status not in ('entregado', 'rechazado') then raise exception 'Estado inválido.'; end if;
  select * into c from prize_claims where id = p_id for update;
  if not found then raise exception 'Ese canje no existe.'; end if;
  if c.status <> 'pendiente' then raise exception 'Ese canje ya está resuelto.'; end if;
  update prize_claims set status = p_status, note = nullif(trim(p_note), ''), resolved_at = now() where id = p_id;
  if p_status = 'rechazado' then
    perform reward_give(c.player_id, c.price, 'reembolso', c.item_name, 'reembolso:' || c.id);
    update shop_items set stock = stock + 1 where id = c.item_id and stock is not null;
  end if;
end;
$$;

-- Borra TODO lo de recompensas (lanzamiento) y deja la tienda cerrada.
create or replace function admin_reset_rewards()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo una administradora puede reiniciar las recompensas.'; end if;
  delete from wallet_tx where true;
  delete from inventory where true;
  delete from player_cosmetics where true;
  delete from prize_claims where true;
  delete from player_badges where true;
  delete from events where type in ('compra', 'canje', 'insignia');
  update reward_settings set enabled = false, enabled_at = null where singleton;
end;
$$;

-- ============================================================
-- Seguridad: lectura pública (menos los canjes: solo el dueño y la admin)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['reward_settings', 'wallet_tx', 'shop_items', 'inventory', 'player_cosmetics', 'prize_claims', 'badges', 'player_badges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura publica" on %I', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    if t <> 'prize_claims' then
      execute format('create policy "lectura publica" on %I for select using (true)', t);
    end if;
  end loop;
end $$;
drop policy if exists "mis canjes" on prize_claims;
create policy "mis canjes" on prize_claims for select using (player_id = my_player_id() or is_admin());
grant select on wallet_balances to anon, authenticated;

revoke execute on function reward_give(uuid, integer, text, text, text), award_badge(uuid, text, text), compute_rewards(),
                           reward_group_contrib(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function buy_item(text), equip_item(text, text, text), admin_set_rewards_enabled(boolean), admin_set_reward_amounts(jsonb),
                           admin_adjust_teeth(uuid, integer, text), admin_save_item(text, text, text, integer, boolean, integer, text),
                           admin_resolve_claim(bigint, text, text), admin_reset_rewards() from public, anon;
grant execute on function buy_item(text), equip_item(text, text, text), admin_set_rewards_enabled(boolean), admin_set_reward_amounts(jsonb),
                          admin_adjust_teeth(uuid, integer, text), admin_save_item(text, text, text, integer, boolean, integer, text),
                          admin_resolve_claim(bigint, text, text), admin_reset_rewards() to authenticated;

-- ── Realtime ──
do $$
declare tbl text;
begin
  for tbl in select unnest(array['reward_settings', 'wallet_tx', 'shop_items', 'inventory', 'player_cosmetics', 'prize_claims', 'player_badges']) loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;

-- ── Cron (SQL puro, cada 5 minutos) ──
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'recompensas';
    perform cron.schedule('recompensas', '*/5 * * * *', 'select public.compute_rewards()');
  end if;
end $$;
