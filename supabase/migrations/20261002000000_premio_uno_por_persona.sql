-- ============================================================
-- Tienda: premios "uno por persona"
--
-- Un premio real con uno_por_persona = true se puede canjear varias veces en
-- total (lo que diga su stock, o sin límite), pero cada jugador solo una vez.
-- Si la admin rechaza su canje (le devuelve los dientes), puede volver a canjearlo.
-- ============================================================

alter table shop_items add column if not exists uno_por_persona boolean not null default false;

-- Canjear / comprar: igual que antes + la comprobación de "uno por persona".
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
    -- "Uno por persona": se puede canjear varias veces en total, pero solo una vez cada jugador
    -- (un canje rechazado no cuenta: le devolvieron los dientes).
    if it.uno_por_persona and exists (select 1 from prize_claims where player_id = v_player and item_id = it.id and status <> 'rechazado') then
      raise exception 'Ya canjeaste este premio: es uno por persona.';
    end if;
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

-- Crear o editar un artículo: nuevo parámetro p_uno_por_persona (null = no cambiar).
drop function if exists admin_save_item(text, text, text, integer, boolean, integer, text);
create or replace function admin_save_item(p_id text, p_name text, p_description text, p_price integer,
                                           p_active boolean, p_stock integer, p_icon text,
                                           p_uno_por_persona boolean default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not is_admin() then raise exception 'Solo una administradora puede editar la tienda.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Ponle un nombre.'; end if;
  if p_price is null or p_price < 0 then raise exception 'Precio inválido.'; end if;
  if p_id is null then
    v_id := 'premio-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into shop_items (id, kind, name, description, collection, price, active, stock, icon, sort, uno_por_persona)
    values (v_id, 'premio', trim(p_name), p_description, 'Premios', p_price, coalesce(p_active, true), p_stock, coalesce(p_icon, 'sorpresa'), 200,
            coalesce(p_uno_por_persona, false));
  else
    update shop_items set name = trim(p_name), description = p_description, price = p_price, active = coalesce(p_active, active),
           stock = case when kind = 'premio' then p_stock else stock end,
           icon  = case when kind = 'premio' then coalesce(p_icon, icon) else icon end,
           uno_por_persona = case when kind = 'premio' then coalesce(p_uno_por_persona, uno_por_persona) else uno_por_persona end
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Ese artículo no existe.'; end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function admin_save_item(text, text, text, integer, boolean, integer, text, boolean) from public, anon;
grant execute on function admin_save_item(text, text, text, integer, boolean, integer, text, boolean) to authenticated;
