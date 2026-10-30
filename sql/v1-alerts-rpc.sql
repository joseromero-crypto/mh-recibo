-- MH Recibo — Phase 5b (plan §6.9): the RPCs the Apps Script uses to write rec_alerts.
-- Run once in the Supabase SQL editor (Armado CH project, uuqqtksxlgkztenojufm), AFTER sql/v1-setup.sql.
-- Touches only rec_* objects. anon keeps SELECT-only on rec_alerts; these two functions are the only way in.

-- Records an alert once per (hub, area, fecha, tipo). Returns the new id, or NULL if it already existed
-- (so the script emails each alert only once).
create or replace function public.rec_alert_record(p_hub text, p_area text, p_fecha date, p_tipo text, p_mensaje text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if p_tipo not in ('sin_recepcion', 'sin_cerrar', 'digest') then
    raise exception 'tipo de alerta inválido: %', p_tipo;
  end if;
  insert into public.rec_alerts (hub, area, fecha, tipo, mensaje)
  values (p_hub, p_area, p_fecha, p_tipo, left(p_mensaje, 4000))
  on conflict (hub, area, fecha, tipo) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Marks an alert as emailed.
create or replace function public.rec_alert_mark_sent(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rec_alerts set enviado_email = true where id = p_id;
$$;

revoke all on function public.rec_alert_record(text, text, date, text, text) from public;
revoke all on function public.rec_alert_mark_sent(bigint) from public;
grant execute on function public.rec_alert_record(text, text, date, text, text) to anon;
grant execute on function public.rec_alert_mark_sent(bigint) to anon;
