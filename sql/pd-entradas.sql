-- MH Recibo — Comercial → Calendario (comercial-plan §1, phase 4): what Retool shows as entered («Entrada») for each closed
-- supplier OC, copied from the «Resumen» tab of the master «Fill Rate Oc Nacional» by the Apps Script
-- (proveedor/apps-script.gs, refrescarTodo, at most once an hour 07:00–22:59). One row per hub. The app compares it with
-- what was received and colours the supplier bars of the calendar.
-- Run once in the Supabase SQL editor (Armado CH project, uuqqtksxlgkztenojufm), AFTER sql/pd-snapshot.sql: it reuses
-- that file's secret (rec_pd_secret, the Apps Script's SB_SECRET). Touches only rec_* objects. Grants are explicit.
--
-- anon can only SELECT. The only way in is rec_pd_entradas_put, which needs the secret.

create table if not exists public.rec_pd_entradas (
  hub       text primary key,          -- app slug (mh-contry …)
  data      jsonb not null,            -- { desde, ocs: { "<Num Oc>": { p: proveedor, f: fecha, l: [[codigo, item, entrada, ud], …] } } }
  hash      text not null,             -- of data: unchanged → only `revisado` moves
  leido     timestamptz not null,      -- when data last changed (server clock)
  revisado  timestamptz not null,      -- last run that read «Resumen» (server clock)
  ms        integer                    -- how long that run took
);
alter table public.rec_pd_entradas enable row level security;
drop policy if exists rec_pd_entradas_read on public.rec_pd_entradas;
create policy rec_pd_entradas_read on public.rec_pd_entradas for select to anon, authenticated using (true);
revoke all on public.rec_pd_entradas from anon, authenticated;
grant select on public.rec_pd_entradas to anon, authenticated;

-- p_rows: [{ hub, hash, data? }, …]. With data → upsert (leido = revisado = now). Without → only revisado = now.
-- Returns the hubs that had no row or another hash (the script sends their data again in the same run).
create or replace function public.rec_pd_entradas_put(p_secret text, p_rows jsonb, p_ms integer default null)
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
      insert into public.rec_pd_entradas (hub, data, hash, leido, revisado, ms)
      values (r->>'hub', r->'data', r->>'hash', now(), now(), p_ms)
      on conflict (hub) do update set data = excluded.data, hash = excluded.hash, leido = now(), revisado = now(), ms = p_ms;
    else
      update public.rec_pd_entradas set revisado = now(), ms = p_ms where hub = r->>'hub' and hash = r->>'hash';
      if not found then v_missing := v_missing || (r->>'hub'); end if;
    end if;
  end loop;
  return v_missing;
end;
$$;
revoke all on function public.rec_pd_entradas_put(text, jsonb, integer) from public;
grant execute on function public.rec_pd_entradas_put(text, jsonb, integer) to anon;
