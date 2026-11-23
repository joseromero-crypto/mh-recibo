-- MH Recibo — Proveedor directo: saved copy of the supplier orders (one row per hub), refreshed every minute by the
-- Apps Script (proveedor/apps-script.gs, refrescarTodo). The app reads this row instead of waiting ~8 s for the script.
-- Run once in the Supabase SQL editor (Armado CH project, uuqqtksxlgkztenojufm). Touches only rec_* objects.
--
-- anon can only SELECT the copy. The only way in is rec_pd_snapshot_put, which needs the secret in rec_pd_secret
-- (no grants: anon can't read it). The last statement prints the secret: paste it into the Apps Script's
-- Script properties as SB_SECRET. It never goes into git or the app.

create table if not exists public.rec_pd_snapshot (
  hub       text primary key,          -- app slug (mh-contry …)
  data      jsonb not null,            -- the bridge's answer for the hub, catalogo included
  hash      text not null,             -- of data without `leido`: unchanged → only `revisado` moves
  leido     timestamptz not null,      -- when data last changed (server clock)
  revisado  timestamptz not null,      -- last run that confirmed it (server clock): what the app checks
  ms        integer                    -- how long that run took (to watch the Apps Script quota)
);
alter table public.rec_pd_snapshot enable row level security;
drop policy if exists rec_pd_snapshot_read on public.rec_pd_snapshot;
create policy rec_pd_snapshot_read on public.rec_pd_snapshot for select to anon, authenticated using (true);
revoke all on public.rec_pd_snapshot from anon, authenticated;
grant select on public.rec_pd_snapshot to anon, authenticated;

create table if not exists public.rec_pd_secret (
  id      integer primary key default 1 check (id = 1),
  secret  text not null
);
alter table public.rec_pd_secret enable row level security;   -- no policies: nobody but security definer code reads it
revoke all on public.rec_pd_secret from anon, authenticated;

-- p_rows: [{ hub, hash, data? }, …]. With data → upsert (leido = revisado = now). Without → only revisado = now.
-- Returns the hubs that had no row (the script sends their data again in the same run).
create or replace function public.rec_pd_snapshot_put(p_secret text, p_rows jsonb, p_ms integer default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; v_missing text[] := '{}';
begin
  if p_secret is null or not exists (select 1 from public.rec_pd_secret where secret = p_secret) then
    raise exception 'secreto inválido';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'hub', '') = '' then continue; end if;
    if r ? 'data' then
      insert into public.rec_pd_snapshot (hub, data, hash, leido, revisado, ms)
      values (r->>'hub', r->'data', r->>'hash', now(), now(), p_ms)
      on conflict (hub) do update set data = excluded.data, hash = excluded.hash, leido = now(), revisado = now(), ms = p_ms;
    else
      update public.rec_pd_snapshot set revisado = now(), ms = p_ms where hub = r->>'hub' and hash = r->>'hash';
      if not found then v_missing := v_missing || (r->>'hub'); end if;
    end if;
  end loop;
  return v_missing;
end;
$$;
revoke all on function public.rec_pd_snapshot_put(text, jsonb, integer) from public;
grant execute on function public.rec_pd_snapshot_put(text, jsonb, integer) to anon;

-- The secret (made once; running the file again keeps it). Copy the value into the Apps Script as SB_SECRET.
insert into public.rec_pd_secret (id, secret) values (1, encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (id) do nothing;
select secret as "SB_SECRET (pégalo en Script properties)" from public.rec_pd_secret;
