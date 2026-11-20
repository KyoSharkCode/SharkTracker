-- ============================================================
-- COACH DE MACRO POR VOZ (app de escritorio, experimental)
--
-- coach_uso: cuánto gastó cada persona por día en la API de Claude
-- con el coach (llamadas, consejos hablados, tokens y coste estimado
-- en US$). La llena la Edge Function "coach", que antes de cada
-- consulta suma el mes de todo el grupo y el día de la persona para
-- cortar al llegar a sus límites (COACH_LIMITE_MES_USD y
-- COACH_LIMITE_DIA_USD en los Secrets de Edge Functions).
--
-- No guarda nada de las partidas ni de los consejos: solo contadores.
-- Cada quien puede leer su propio uso; escribir, solo la Edge Function.
--
-- Se puede ejecutar más de una vez.
-- ============================================================

create table if not exists coach_uso (
  user_id        uuid not null references auth.users(id) on delete cascade,
  dia            date not null,
  llamadas       integer not null default 0,
  consejos       integer not null default 0,
  tokens_entrada bigint  not null default 0,
  tokens_salida  bigint  not null default 0,
  usd            numeric(12, 6) not null default 0,
  primary key (user_id, dia)
);

alter table coach_uso enable row level security;
drop policy if exists "cada quien ve su uso" on coach_uso;
create policy "cada quien ve su uso" on coach_uso
  for select to authenticated using (auth.uid() = user_id);

revoke all on coach_uso from anon, authenticated;
grant select on coach_uso to authenticated;
grant select, insert, update, delete on coach_uso to service_role;

-- Suma una consulta al contador del día (UTC) de esa persona.
create or replace function public.coach_registrar_uso(
  p_user    uuid,
  p_consejo boolean,
  p_entrada integer,
  p_salida  integer,
  p_usd     numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into coach_uso (user_id, dia, llamadas, consejos, tokens_entrada, tokens_salida, usd)
  values (p_user, (now() at time zone 'utc')::date, 1, case when p_consejo then 1 else 0 end,
          greatest(p_entrada, 0), greatest(p_salida, 0), greatest(p_usd, 0))
  on conflict (user_id, dia) do update set
    llamadas       = coach_uso.llamadas + 1,
    consejos       = coach_uso.consejos + excluded.consejos,
    tokens_entrada = coach_uso.tokens_entrada + excluded.tokens_entrada,
    tokens_salida  = coach_uso.tokens_salida + excluded.tokens_salida,
    usd            = coach_uso.usd + excluded.usd;
$$;

revoke execute on function public.coach_registrar_uso(uuid, boolean, integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.coach_registrar_uso(uuid, boolean, integer, integer, numeric)
  to service_role;
