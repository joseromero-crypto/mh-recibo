-- MH Recibo v1 — one-time setup. Run in the Supabase SQL editor of the SHARED project (uuqqtksxlgkztenojufm).
-- Touches only rec_* tables and the 'recibo' bucket. Safe for Armado CH and Sorting Hub.
-- Grants are explicit because Supabase stopped auto-granting new public tables on 2026-10-30.

-- Append-only event log: one row per scan / correction / lifecycle event
create table public.rec_events (
  id          bigserial primary key,
  session_id  text not null,          -- '{slug}__{area}__{fecha}__{epochMs}' created on the phone
  hub         text not null,          -- slug, e.g. 'mh-contry'
  area        text not null,          -- 'abarrotes' | 'carnes'
  fecha       date not null,          -- reception day (America/Monterrey)
  tipo        text not null,          -- 'abrir'|'scan'|'ajuste'|'confirmacion'|'reemplazo'|'cerrar'|'admin'
  sku_key     text,                   -- bcKey(barcode) or 'name:'+normalized name when no barcode
  producto    text,
  cantidad    numeric,                -- signed for 'ajuste' (−2 = removed 2)
  metodo      text,                   -- 'scanner'|'camara'|'manual'
  detalle     jsonb,                  -- e.g. {"esperado":false,"hermano":"...","respuesta":"..."}
  receptor    text,
  device_id   text,
  ts          timestamptz not null default now()
);
create index on public.rec_events (hub, area, fecha);
create index on public.rec_events (session_id);
alter table public.rec_events enable row level security;
create policy rec_events_insert on public.rec_events for insert to anon with check (true);
create policy rec_events_select on public.rec_events for select to anon using (true);
grant select, insert on public.rec_events to anon;
grant usage, select on sequence public.rec_events_id_seq to anon;

-- Storage bucket for envío files and final reports
insert into storage.buckets (id, name, public) values ('recibo','recibo', true);
create policy recibo_select on storage.objects for select to anon using (bucket_id = 'recibo');
create policy recibo_insert on storage.objects for insert to anon with check (bucket_id = 'recibo');
create policy recibo_update on storage.objects for update to anon using (bucket_id = 'recibo');
create policy recibo_delete on storage.objects for delete to anon using (bucket_id = 'recibo');

create table public.rec_alert_config (
  hub text not null, area text not null, activo boolean not null default false,
  email boolean not null default true, dias int[] not null default '{}', -- 0=Sun
  hora_limite time, pausado_hasta date,
  modo text not null default 'diario',  -- 'diario' | 'tras_armado'
  dias_gracia int not null default 3,
  updated_at timestamptz not null default now(), primary key (hub, area)
);
create table public.rec_alerts (
  id bigserial primary key, hub text not null, area text not null, fecha date not null,
  tipo text not null,            -- 'sin_recepcion'|'sin_cerrar'|'digest'
  mensaje text, enviado_email boolean default false, ts timestamptz not null default now(),
  unique (hub, area, fecha, tipo)
);
alter table public.rec_alert_config enable row level security;
alter table public.rec_alerts enable row level security;
create policy rac_all on public.rec_alert_config for all to anon using (true) with check (true);
create policy ra_select on public.rec_alerts for select to anon using (true);
grant select, insert, update on public.rec_alert_config to anon;
grant select on public.rec_alerts to anon;
grant select, insert, update on public.rec_alerts, public.rec_alert_config to service_role;
grant usage, select on sequence public.rec_alerts_id_seq to service_role;
