-- ============================================================
-- Caché de Data Dragon ligera.
--
-- sync-riot-data y sync-live-status leen ddragon_cache cada minuto y
-- solo usan key, id y name de cada campeón, pero la tabla guardaba el
-- champion.json completo (descripciones, stats, imágenes…), más de
-- 100 KB por lectura. Eso era la mayor parte del egress del proyecto.
--
-- Ahora cada campeón guarda solo { key, id, name } (unos 8 KB en total)
-- y un trigger lo recorta en cada escritura, así que aunque una versión
-- antigua de una Edge Function guarde el JSON completo, se queda ligero.
-- Los lectores (sync-*, pantalla-carga, Discord) no cambian.
-- Se puede ejecutar más de una vez.
-- ============================================================

create or replace function ddragon_champions_slim(p jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(k, jsonb_build_object('key', v->'key', 'id', v->'id', 'name', v->'name')),
    '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb)) as e(k, v)
  where jsonb_typeof(v) = 'object';
$$;

create or replace function ddragon_cache_slim_trg()
returns trigger
language plpgsql
as $$
begin
  new.champions := ddragon_champions_slim(new.champions);
  return new;
end;
$$;

drop trigger if exists ddragon_cache_slim on ddragon_cache;
create trigger ddragon_cache_slim
  before insert or update of champions on ddragon_cache
  for each row execute function ddragon_cache_slim_trg();

-- Recorta lo que ya está guardado.
update ddragon_cache set champions = champions;

revoke execute on function ddragon_champions_slim(jsonb), ddragon_cache_slim_trg() from public, anon, authenticated;

-- Comprobación: lo que se descarga en cada lectura (debería rondar los 11 KB).
select pg_size_pretty(length(champions::text)::bigint) as tamano_campeones,
       (select count(*) from jsonb_object_keys(champions)) as campeones
from ddragon_cache;
