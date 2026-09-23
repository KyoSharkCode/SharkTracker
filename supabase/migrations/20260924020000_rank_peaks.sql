-- ============================================================
-- PICOS DE RANGO (para el futuro "Historial de rangos por split")
--
-- rank_snapshots se limpia a los 30 días, así que sin esto el pico de
-- cada split se perdería. Acá se guarda, POR MES (hora de Madrid), por
-- jugador y por cola:
--   · el rango más alto que tocó ese mes (peak_*)
--   · el último rango con el que cerró ese mes (last_*)
-- Por mes y no por split porque las fechas de cada split las pone Riot:
-- cuando se arme la vista, los meses se agrupan en splits sin perder nada.
--
-- Se llena SOLO: cada vez que sync-riot-data guarda un rango nuevo,
-- un trigger actualiza la fila del mes. Nunca se borra.
-- ============================================================

create table if not exists rank_peaks (
  player_id     uuid not null references players(id) on delete cascade,
  queue_type    text not null,
  period        text not null,                -- 'YYYY-MM' (hora de Madrid)
  peak_tier     text,
  peak_division text,
  peak_lp       integer,
  peak_elo      integer,
  peak_at       timestamptz,
  last_tier     text,
  last_division text,
  last_lp       integer,
  last_elo      integer,
  last_wins     integer,
  last_losses   integer,
  last_at       timestamptz,
  primary key (player_id, queue_type, period)
);

alter table rank_peaks enable row level security;
drop policy if exists "lectura publica" on rank_peaks;
create policy "lectura publica" on rank_peaks for select using (true);
revoke all on rank_peaks from anon, authenticated;
grant select on rank_peaks to anon, authenticated;
grant select, insert, update, delete on rank_peaks to service_role;

create or replace function track_rank_peak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char(new.recorded_at at time zone 'Europe/Madrid', 'YYYY-MM');
begin
  if new.elo_score is null then return new; end if;
  insert into rank_peaks as rp (
    player_id, queue_type, period,
    peak_tier, peak_division, peak_lp, peak_elo, peak_at,
    last_tier, last_division, last_lp, last_elo, last_wins, last_losses, last_at)
  values (
    new.player_id, new.queue_type, v_period,
    new.tier, new.division, new.lp, new.elo_score, new.recorded_at,
    new.tier, new.division, new.lp, new.elo_score, new.wins, new.losses, new.recorded_at)
  on conflict (player_id, queue_type, period) do update set
    peak_tier     = case when excluded.peak_elo > rp.peak_elo then excluded.peak_tier     else rp.peak_tier     end,
    peak_division = case when excluded.peak_elo > rp.peak_elo then excluded.peak_division else rp.peak_division end,
    peak_lp       = case when excluded.peak_elo > rp.peak_elo then excluded.peak_lp       else rp.peak_lp       end,
    peak_at       = case when excluded.peak_elo > rp.peak_elo then excluded.peak_at       else rp.peak_at       end,
    peak_elo      = greatest(rp.peak_elo, excluded.peak_elo),
    last_tier     = case when excluded.last_at >= rp.last_at then excluded.last_tier     else rp.last_tier     end,
    last_division = case when excluded.last_at >= rp.last_at then excluded.last_division else rp.last_division end,
    last_lp       = case when excluded.last_at >= rp.last_at then excluded.last_lp       else rp.last_lp       end,
    last_elo      = case when excluded.last_at >= rp.last_at then excluded.last_elo      else rp.last_elo      end,
    last_wins     = case when excluded.last_at >= rp.last_at then excluded.last_wins     else rp.last_wins     end,
    last_losses   = case when excluded.last_at >= rp.last_at then excluded.last_losses   else rp.last_losses   end,
    last_at       = greatest(rp.last_at, excluded.last_at);
  return new;
end;
$$;
revoke execute on function track_rank_peak() from public, anon, authenticated;

drop trigger if exists rank_snapshots_track_peak on rank_snapshots;
create trigger rank_snapshots_track_peak after insert on rank_snapshots
  for each row execute function track_rank_peak();

-- Relleno con lo que ya hay (últimos 30 días), en orden, pasando por la misma lógica.
do $$
declare r rank_snapshots;
begin
  for r in select * from rank_snapshots where elo_score is not null order by recorded_at loop
    insert into rank_peaks as rp (
      player_id, queue_type, period,
      peak_tier, peak_division, peak_lp, peak_elo, peak_at,
      last_tier, last_division, last_lp, last_elo, last_wins, last_losses, last_at)
    values (
      r.player_id, r.queue_type, to_char(r.recorded_at at time zone 'Europe/Madrid', 'YYYY-MM'),
      r.tier, r.division, r.lp, r.elo_score, r.recorded_at,
      r.tier, r.division, r.lp, r.elo_score, r.wins, r.losses, r.recorded_at)
    on conflict (player_id, queue_type, period) do update set
      peak_tier     = case when excluded.peak_elo > rp.peak_elo then excluded.peak_tier     else rp.peak_tier     end,
      peak_division = case when excluded.peak_elo > rp.peak_elo then excluded.peak_division else rp.peak_division end,
      peak_lp       = case when excluded.peak_elo > rp.peak_elo then excluded.peak_lp       else rp.peak_lp       end,
      peak_at       = case when excluded.peak_elo > rp.peak_elo then excluded.peak_at       else rp.peak_at       end,
      peak_elo      = greatest(rp.peak_elo, excluded.peak_elo),
      last_tier = excluded.last_tier, last_division = excluded.last_division, last_lp = excluded.last_lp,
      last_elo = excluded.last_elo, last_wins = excluded.last_wins, last_losses = excluded.last_losses,
      last_at = excluded.last_at;
  end loop;
end $$;
