-- Schemat MVP + bezpieczenstwo pod Supabase/PostgreSQL.
-- Produkt przechowuje tylko SKU i ilosc.

create extension if not exists pgcrypto;

create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  login text not null unique,
  role text not null check (role in ('ADMIN', 'OPERATOR')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists locations (
  id bigserial primary key,
  code text not null unique,
  name text not null,
  parent_zone text not null check (parent_zone in ('SKLEP', 'ZAPLECZE')),
  location_type text not null check (
    location_type in ('DISPLAY', 'BUFFER', 'RESERVED', 'BACKROOM_BOX', 'BACKROOM_SHELF', 'INACTIVE')
  ),
  is_active boolean not null default true,
  barcode_value text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  operator_id text not null,
  movement_type text not null check (
    movement_type in ('ADD', 'REMOVE', 'MOVE', 'MOVE_TO_TMP', 'RESTORE_FROM_TMP', 'MOVE_TO_SALE', 'SALE_FINALIZE')
  ),
  sku text not null check (char_length(trim(sku)) > 0),
  qty integer not null check (qty > 0),
  from_location_code text,
  to_location_code text,
  reference_type text,
  reference_no text,
  note text,
  session_id uuid
);

create index if not exists idx_stock_movements_sku_created_at
  on stock_movements (sku, created_at desc);
create index if not exists idx_stock_movements_to_location_sku
  on stock_movements (to_location_code, sku);
create index if not exists idx_stock_movements_from_location_sku
  on stock_movements (from_location_code, sku);

-- Poprzednie wersje skryptu uzywaly DROP MATERIALIZED VIEW; obecnie stock_current to VIEW.
-- DROP MATERIALIZED VIEW na zwyklym widoku konczy sie bledem 42809 — stad warunkowe usuniecie.
do $$
declare
  rk "char";
begin
  select c.relkind
  into rk
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'stock_current';

  if rk is null then
    return;
  elsif rk = 'm'::"char" then
    execute 'drop materialized view public.stock_current cascade';
  elsif rk = 'v'::"char" then
    execute 'drop view public.stock_current cascade';
  end if;
end
$$;

create view stock_current as
select
  location_code,
  sku,
  sum(qty) as qty
from (
  select to_location_code as location_code, upper(trim(sku)) as sku, qty
  from stock_movements
  where to_location_code is not null
  union all
  select from_location_code as location_code, upper(trim(sku)) as sku, -qty as qty
  from stock_movements
  where from_location_code is not null
) x
group by location_code, sku
having sum(qty) > 0;

alter table operators enable row level security;
alter table locations enable row level security;
alter table stock_movements enable row level security;

drop policy if exists operators_select_authenticated on operators;
create policy operators_select_authenticated
on operators for select
to authenticated
using (true);

drop policy if exists locations_select_authenticated on locations;
create policy locations_select_authenticated
on locations for select
to authenticated
using (true);

drop policy if exists locations_write_admin on locations;
create policy locations_write_admin
on locations for all
to authenticated
using (
  exists (
    select 1
    from operators o
    where o.auth_user_id = auth.uid()
      and o.role = 'ADMIN'
      and o.is_active = true
  )
)
with check (
  exists (
    select 1
    from operators o
    where o.auth_user_id = auth.uid()
      and o.role = 'ADMIN'
      and o.is_active = true
  )
);

drop policy if exists stock_movements_select_authenticated on stock_movements;
create policy stock_movements_select_authenticated
on stock_movements for select
to authenticated
using (true);

drop policy if exists stock_movements_insert_operator on stock_movements;
create policy stock_movements_insert_operator
on stock_movements for insert
to authenticated
with check (
  exists (
    select 1
    from operators o
    where o.auth_user_id = auth.uid()
      and o.role in ('ADMIN', 'OPERATOR')
      and o.is_active = true
  )
);

insert into locations (code, name, parent_zone, location_type, is_active, barcode_value)
values
  ('W1', 'Wieszak 1', 'SKLEP', 'DISPLAY', true, 'LOC-W1'),
  ('W2', 'Wieszak 2', 'SKLEP', 'DISPLAY', true, 'LOC-W2'),
  ('TMP', 'Tymczasowe', 'SKLEP', 'BUFFER', true, 'LOC-TMP'),
  ('SPRZEDAZ', 'Sprzedaz/Rezerwacja', 'SKLEP', 'RESERVED', true, 'LOC-SPRZEDAZ'),
  ('KARTON_1', 'Karton 1', 'ZAPLECZE', 'BACKROOM_BOX', true, 'LOC-KARTON-1')
on conflict (code) do nothing;
