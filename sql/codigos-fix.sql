-- MH Recibo — Comercial → Códigos (comercial-plan §3, phase 2): what comercial confirmed, loaded into Retool or discarded
-- for each fix proposed in Códigos. Append-only: the latest row per (tipo, clave, sku) is the state. Nothing updates or
-- deletes; a change of mind is another row (estado 'pendiente' = undo).
-- Run once in the Supabase SQL editor (Armado CH project, uuqqtksxlgkztenojufm). Touches only rec_* objects.
-- Grants are explicit (Supabase stopped auto-granting new public tables on 2026-10-30).
--
--   tipo   'barcode'        clave = the barcode scanned on the physical product, sku = SKU Calii (3a)
--          'sku_proveedor'  clave = supplier code without the leading '*',          sku = SKU Calii (3b, later phase)
--   estado 'confirmado' | 'cargado' | 'descartado' | 'pendiente'
--   quien  the name typed in the view (comercial has no login)
--   detalle producto, codigo_sistema, modo ('comercial' | 'admin') … for context only

create table if not exists public.rec_codigos_fix (
  id       bigserial primary key,
  tipo     text not null check (tipo in ('barcode', 'sku_proveedor')),
  clave    text not null,
  sku      text not null default '',
  estado   text not null check (estado in ('confirmado', 'cargado', 'descartado', 'pendiente')),
  quien    text,
  detalle  jsonb not null default '{}'::jsonb,
  ts       timestamptz not null default now()
);
create index if not exists rec_codigos_fix_tipo_clave on public.rec_codigos_fix (tipo, clave);
alter table public.rec_codigos_fix enable row level security;
drop policy if exists rec_codigos_fix_select on public.rec_codigos_fix;
drop policy if exists rec_codigos_fix_insert on public.rec_codigos_fix;
create policy rec_codigos_fix_select on public.rec_codigos_fix for select to anon, authenticated using (true);
create policy rec_codigos_fix_insert on public.rec_codigos_fix for insert to anon, authenticated with check (true);
revoke all on public.rec_codigos_fix from anon, authenticated;
grant select, insert on public.rec_codigos_fix to anon, authenticated;
grant usage, select on sequence public.rec_codigos_fix_id_seq to anon, authenticated;
