/**
 * MH Recibo — Alertas (plan §6.9). Reference copy: paste into script.google.com from Jose's Calii account.
 *
 * Setup (once):
 *   1. Run sql/v1-alerts-rpc.sql in Supabase (creates rec_alert_record / rec_alert_mark_sent).
 *   2. script.google.com → New project → paste this file → Save.
 *   3. Run `probar` once (authorize UrlFetch + Gmail) and check the log.
 *   4. Run `instalar` once: creates the 15-minute trigger. (`desinstalar` removes it.)
 *
 * What it does every 15 min (America/Monterrey):
 *   - Reads rec_alert_config (set in the app: Admin → Alertas). Nothing is hard-coded; rows start off.
 *   - diario: on an expected day, after hora_limite, no 'abrir' and no 'scan' today → "sin_recepcion".
 *     Abarrotes guard: no assembly in Armado CH (picks) on the previous working day (or today) → no alert
 *     (the digest says "sin envío").
 *   - tras_armado (Condesa, Zapopan): last assembly in Armado + dias_gracia days without a reception → alert.
 *   - From 21:00: a reception opened but not closed → "sin_cerrar". A reception with an entrega parcial closed
 *     (big shipments received tarima by tarima) only alerts once its last entrega is older than dias_gracia days.
 *   - From 21:00: one digest email for every configured hub+área.
 *   - Proveedor directo (área pd-{proveedor}, no schedule): from 21:00, for every hub with an active row, a supplier
 *     reception still open → "sin_cerrar" (área = pd-…); the digest adds a line per supplier reception of the day.
 * Each alert is recorded once in rec_alerts (unique hub+área+fecha+tipo) through the RPC, and emailed once.
 * The anon key is the same public key the web app ships; this script only reads tables and calls the RPCs.
 */
const SB_URL = 'https://uuqqtksxlgkztenojufm.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1cXF0a3N4bGdrenRlbm9qdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxODc0NDIsImV4cCI6MjA5Mzc2MzQ0Mn0.Ifj0QKO4oTcIz3IgSD3fMWwdQz_QG_561d4sQAgWG2U';
const EMAIL = 'jose.romero@calii.com';
const TZ = 'America/Monterrey';
const HORA_CIERRE = '21:00';   // from here: "abierta sin cerrar" + daily digest
const HUBS = { 'mh-contry':'MH Contry', 'mh-cumbres':'MH Cumbres', 'mh-guadalupe':'MH Guadalupe', 'mh-san-nicolas':'MH San Nicolás',
               'mh-avicola':'MH Avícola', 'mh-zapopan':'MH Zapopan', 'mh-condesa':'MH Condesa' }; // picks.hub uses these names
const AREAS = { abarrotes:'Abarrotes', carnes:'Carnes' };
const APP_URL = 'https://mh-recibo.joseromero.co';

function instalar(){
  desinstalar();
  ScriptApp.newTrigger('revisarAlertas').timeBased().everyMinutes(15).create();
}
function desinstalar(){
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction()==='revisarAlertas').forEach(t => ScriptApp.deleteTrigger(t));
}
function probar(){ revisarAlertas(true); }

/* ── Supabase helpers ── */
function sb_(path){
  const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/' + path, { headers:{ apikey:SB_KEY, Authorization:'Bearer '+SB_KEY }, muteHttpExceptions:true });
  if (r.getResponseCode() >= 300) throw new Error(path + ' → ' + r.getResponseCode() + ' ' + r.getContentText());
  return JSON.parse(r.getContentText());
}
function rpc_(name, args){
  const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + name, { method:'post', contentType:'application/json', payload:JSON.stringify(args),
    headers:{ apikey:SB_KEY, Authorization:'Bearer '+SB_KEY }, muteHttpExceptions:true });
  if (r.getResponseCode() >= 300) throw new Error('rpc ' + name + ' → ' + r.getResponseCode() + ' ' + r.getContentText());
  const t = r.getContentText();
  return t ? JSON.parse(t) : null;
}
const enc_ = s => encodeURIComponent(s);

/* ── Dates (all America/Monterrey) ── */
function fmt_(d, f){ return Utilities.formatDate(d, TZ, f); }
function addDays_(ymd, n){ const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); }
function dow_(ymd){ return new Date(ymd + 'T12:00:00Z').getUTCDay(); } // 0 = domingo
function daysBetween_(a, b){ return Math.round((Date.parse(b+'T00:00:00Z') - Date.parse(a+'T00:00:00Z')) / 86400000); }
function prevWorkingDay_(ymd){ let d = addDays_(ymd, -1); if (dow_(d) === 0) d = addDays_(d, -1); return d; } // Monday → Saturday
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fechaLarga_(ymd){ const p = ymd.split('-').map(Number); return p[2] + ' de ' + MESES[p[1]-1]; }

/* ── Reads ── */
// Any reception activity (abrir / scan) for hub+área from `desde` on
function huboRecepcion_(hub, area, desde, hasta){
  return sb_(`rec_events?hub=eq.${enc_(hub)}&area=eq.${area}&fecha=gte.${desde}${hasta?`&fecha=lte.${hasta}`:''}&tipo=in.(abrir,scan)&select=id&limit=1`).length > 0;
}
// Armado CH assembled something for this hub between two dates (picks.fecha = assembly day)
function huboArmado_(hub, desde, hasta){
  return sb_(`picks?hub=eq.${enc_(HUBS[hub])}&fecha=gte.${desde}&fecha=lte.${hasta}&select=id&limit=1`).length > 0;
}
function ultimoArmado_(hub, hoy){
  const r = sb_(`picks?hub=eq.${enc_(HUBS[hub])}&fecha=gte.${addDays_(hoy,-14)}&select=fecha&order=fecha.desc&limit=1`);
  return r.length ? r[0].fecha : null;
}
// Sessions of the last 7 days with their latest state: open / closed (cerrar) — an admin 'reabrir' reopens
function sesiones_(hub, area, hoy){
  const evs = sb_(`rec_events?hub=eq.${enc_(hub)}&area=eq.${area}&fecha=gte.${addDays_(hoy,-7)}&tipo=in.(abrir,reemplazo,cerrar,admin,parcial)&select=session_id,fecha,tipo,detalle,ts&order=id.asc`);
  const by = {};
  evs.forEach(e => {
    const s = by[e.session_id] || (by[e.session_id] = { fecha:e.fecha, cerrada:null, parciales:0, ultimaParcial:null });
    if (e.tipo === 'parcial') { s.parciales++; s.ultimaParcial = fmt_(new Date(e.ts), 'yyyy-MM-dd'); }
    if (e.tipo === 'cerrar') s.cerrada = e.detalle || {};
    if (e.tipo === 'admin' && e.detalle && e.detalle.accion === 'reabrir') s.cerrada = null;
    if (e.tipo === 'admin' && e.detalle && e.detalle.accion === 'borrar') s.borrada = true; // envío uploaded by mistake
  });
  return Object.keys(by).map(k => by[k]).filter(s => !s.borrada);
}

// Supplier receptions (área pd-*) of the last 7 days, one per session, with the supplier's name
function sesionesPd_(hub, hoy){
  const evs = sb_(`rec_events?hub=eq.${enc_(hub)}&area=like.pd-*&fecha=gte.${addDays_(hoy,-7)}&tipo=in.(abrir,reemplazo,cerrar,admin)&select=session_id,area,fecha,tipo,detalle,ts&order=id.asc`);
  const by = {};
  evs.forEach(e => {
    const s = by[e.session_id] || (by[e.session_id] = { area:e.area, fecha:e.fecha, proveedor:e.area.slice(3), cerrada:null });
    const d = e.detalle || {};
    if (d.proveedor) s.proveedor = d.proveedor;
    if (e.tipo === 'cerrar') s.cerrada = d;
    if (e.tipo === 'admin' && d.accion === 'reabrir') s.cerrada = null;
    if (e.tipo === 'admin' && d.accion === 'borrar') s.borrada = true;
  });
  return Object.keys(by).map(k => by[k]).filter(s => !s.borrada);
}

/* ── Main ── */
function revisarAlertas(verbose){
  const now = new Date(), hoy = fmt_(now, 'yyyy-MM-dd'), hm = fmt_(now, 'HH:mm'), dow = dow_(hoy);
  const cfgs = sb_('rec_alert_config?select=*').filter(c => HUBS[c.hub] && AREAS[c.area]); // test-hub never alerts
  const nuevas = [];
  const alerta = (c, tipo, fecha, msg) => {
    const id = rpc_('rec_alert_record', { p_hub:c.hub, p_area:c.area, p_fecha:fecha, p_tipo:tipo, p_mensaje:msg });
    if (id != null && c.email) nuevas.push({ id, msg });
    if (verbose) Logger.log((id != null ? 'NUEVA ' : 'ya existía ') + tipo + ' · ' + msg);
  };
  cfgs.forEach(c => {
    const nombre = HUBS[c.hub] + ' — ' + AREAS[c.area];
    const pausado = c.pausado_hasta && c.pausado_hasta >= hoy;
    if (!c.activo || pausado) return;
    if (c.modo === 'tras_armado') {
      const a = ultimoArmado_(c.hub, hoy);
      if (a && daysBetween_(a, hoy) > (c.dias_gracia || 3) && !huboRecepcion_(c.hub, c.area, a))
        alerta(c, 'sin_recepcion', a, `${nombre}: envío armado el ${fechaLarga_(a)} sin recepción.`);
    } else if ((c.dias || []).indexOf(dow) >= 0 && c.hora_limite && hm >= String(c.hora_limite).slice(0,5)) {
      if (!huboRecepcion_(c.hub, c.area, hoy, hoy)) {
        const sinEnvio = c.area === 'abarrotes' && !huboArmado_(c.hub, prevWorkingDay_(hoy), hoy);
        if (!sinEnvio) alerta(c, 'sin_recepcion', hoy, `${nombre}: no se ha subido ni escaneado la recepción de hoy.`);
        else if (verbose) Logger.log(nombre + ': sin envío armado → sin alerta');
      }
    }
    if (hm >= HORA_CIERRE) {
      // an entrega parcial means "the rest arrives later": only stale ones count
      const abiertas = sesiones_(c.hub, c.area, hoy).filter(s => !s.cerrada && (!s.parciales || daysBetween_(s.ultimaParcial, hoy) > (c.dias_gracia || 3)));
      if (abiertas.length) alerta(c, 'sin_cerrar', hoy, `${nombre}: recepción abierta sin cerrar (desde el ${fechaLarga_(abiertas[0].fecha)}).`);
    }
  });
  // Proveedor directo: the hubs with an active, unpaused row
  const hubsPd = [...new Set(cfgs.filter(c => c.activo && !(c.pausado_hasta && c.pausado_hasta >= hoy)).map(c => c.hub))];
  const pdSes = {};
  if (hm >= HORA_CIERRE) hubsPd.forEach(hub => {
    pdSes[hub] = sesionesPd_(hub, hoy);
    pdSes[hub].filter(s => !s.cerrada).forEach(s => alerta({ hub, area:s.area, email:cfgs.some(c => c.hub === hub && c.email) }, 'sin_cerrar', hoy,
      `${HUBS[hub]} — Proveedor ${s.proveedor}: recepción abierta sin cerrar (desde el ${fechaLarga_(s.fecha)}).`));
  });
  if (hm >= HORA_CIERRE && cfgs.length) {
    const lineas = cfgs.map(c => '• ' + estadoDelDia_(c, hoy, dow));
    hubsPd.forEach(hub => (pdSes[hub] || []).filter(s => s.fecha === hoy || !s.cerrada).forEach(s => {
      const d = s.cerrada, nombre = `${HUBS[hub]} — Proveedor ${s.proveedor}`;
      lineas.push('• ' + (d ? `✓ ${nombre}: recibido (${d.lineas || 0} productos, ${d.diferencias || 0} con diferencia)` : `⚠ ${nombre}: abierta sin cerrar`));
    }));
    const msg = `Recepciones del ${fechaLarga_(hoy)}\n\n` + lineas.join('\n');
    const id = rpc_('rec_alert_record', { p_hub:'todos', p_area:'todos', p_fecha:hoy, p_tipo:'digest', p_mensaje:msg });
    if (id != null && cfgs.some(c => c.email)) { enviar_('MH Recibo — resumen del ' + fechaLarga_(hoy), msg); rpc_('rec_alert_mark_sent', { p_id:id }); }
    if (verbose) Logger.log(msg);
  }
  if (nuevas.length) {
    enviar_(nuevas.length === 1 ? 'MH Recibo — ' + nuevas[0].msg : `MH Recibo — ${nuevas.length} alertas`, nuevas.map(n => '• ' + n.msg).join('\n'));
    nuevas.forEach(n => rpc_('rec_alert_mark_sent', { p_id:n.id }));
  }
}
function estadoDelDia_(c, hoy, dow){
  const nombre = HUBS[c.hub] + ' — ' + AREAS[c.area];
  if (c.pausado_hasta && c.pausado_hasta >= hoy) return `⏸ ${nombre}: pausado hasta el ${fechaLarga_(c.pausado_hasta)}`;
  const ses = sesiones_(c.hub, c.area, hoy), hoySes = ses.filter(s => s.fecha === hoy);
  const parcial = ses.find(s => !s.cerrada && s.parciales);
  if (parcial) return `◐ ${nombre}: parcial (${parcial.parciales} entrega${parcial.parciales === 1 ? '' : 's'}, la última el ${fechaLarga_(parcial.ultimaParcial)})`;
  const cerrada = hoySes.find(s => s.cerrada);
  if (cerrada) {
    const d = cerrada.cerrada, badges = (d.badges || []).length ? ' · ' + d.badges.join(' · ') : '';
    return `✓ ${nombre}: recibido (${d.lineas || 0} productos, ${d.diferencias || 0} con diferencia)${badges}`;
  }
  if (hoySes.length) return `⚠ ${nombre}: abierta sin cerrar`;
  if (!c.activo) return `· ${nombre}: alerta apagada, sin recepción`;
  if (c.modo !== 'tras_armado' && (c.dias || []).indexOf(dow) < 0) return `· ${nombre}: no tocaba hoy`;
  if (c.area === 'abarrotes' && !huboArmado_(c.hub, prevWorkingDay_(hoy), hoy)) return `· ${nombre}: sin envío`;
  return `✗ ${nombre}: sin recepción`;
}
function enviar_(asunto, cuerpo){
  GmailApp.sendEmail(EMAIL, asunto, cuerpo + '\n\n' + APP_URL);
}
