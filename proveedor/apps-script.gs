/**
 * MH Recibo — Proveedor Directo bridge (proveedorDirecto-plan.md §5). Reference copy: paste into script.google.com
 * from Jose's Calii account. READ-ONLY: it never writes to any sheet.
 *
 * Sources (all read with the deploying account's access):
 *   - MASTER «Fill Rate Oc Nacional» (feeds every hub's «Base Oc» / «OC {hub}» tab):
 *       «Base datos Compras»  open orders (Status Programado) of every hub: Comprador, Hub, Num Oc, Proveedor, Sku,
 *                             Item, Cod. Barras, Ud, Pedido, Cajas, Fecha, Entrada, Status. An order closed in
 *                             Retool leaves this tab (it moves to «Resumen» as Cerrado).
 *       «Catalogo2»           per-city catalog: Ciudad, Cód. de barras, Producto, Proveedor, Kg/Pz, V Anaquel.
 *                             Caducidad mínima = Fecha de entrega + V Anaquel (the hub files compute it the same way).
 *       «Proveedores»         Proveedor Retool → Comprador (fallback when a supplier has no lines).
 *   - REFERENCIA per city (CIUDADES): one hub file holding «Encargados» (supplier → Comercial) and «Inv {city}» (Temp).
 *     The master has neither. The phones in Encargados are NOT read: the token sits in the public app, so the answer
 *     carries no personal data (decision 2026-11-13).
 *
 * Setup (once):
 *   1. script.google.com → New project → name it "MH Recibo · Órdenes proveedor" → paste this file → Save.
 *   2. Project Settings → tick «Show appsscript.json» → paste proveedor/appsscript.json into it → Save. It limits the
 *      script to spreadsheets.readonly (Google itself rejects any write) and turns on the Sheets API service, which is
 *      how the tabs are read: SpreadsheetApp.openById needs edit rights and won't run with the read-only scope.
 *   2b. Project Settings → Script properties → add TOKEN = a long random string (shared with the app).
 *   3. Run `probar` once: asks for «See your spreadsheets» only, and logs a summary of mh-contry (check it against the sheet).
 *   4. Deploy → New deployment → type "Web app" → Execute as: Me · Who has access: Anyone → Deploy.
 *      Copy the /exec URL. (Every code change: Deploy → Manage deployments → edit → Version: New version,
 *      so the URL stays the same.)
 *   5. Saved copy (2026-11-23): run sql/pd-snapshot.sql in Supabase, paste the secret it prints into Script properties
 *      as SB_SECRET, then run `instalarTimer` once (asks for «Connect to an external service» and «Run when you're not
 *      present»). From then on `refrescarTodo` writes every hub to rec_pd_snapshot every minute (05:00–22:59), and the
 *      app reads that row in a fraction of a second; this web app stays as its fallback. `quitarTimer` turns it off.
 *      Executions → refrescarTodo shows each run's time; rec_pd_snapshot.ms holds the latest one.
 *   6. Entradas (comercial-plan §1, 2026-11-25): run sql/pd-entradas.sql in Supabase (same SB_SECRET), paste this file,
 *      run `probarEntradas` once (logs what «Resumen» holds per hub, writes nothing), then `refrescarEntradas` once. From
 *      then on refrescarTodo also reads «Resumen» when ≥ 60 min have passed (07:00–22:59) and writes rec_pd_entradas.
 *      A failed read never stops the orders: it is logged and retried 10 minutes later.
 *
 * Call:  GET {exec}?token=…&hub=mh-contry[&proveedor=LALA][&fresh=1]
 *   → { leido, ordenes:[{num_oc, proveedor, fecha_entrega, comercial, comprador, lineas:[…]}], contactos,
 *       proveedores[, catalogo], avisos }   or   { error }
 *   - One orden per Num Oc (two Bimbo OCs on the same day are two órdenes). Rows without Num Oc («-») are grouped by
 *     supplier + date. Window: Fecha de entrega from today − 14 to today + 14 (America/Monterrey).
 *   - &proveedor narrows ordenes/contactos to one supplier and adds `catalogo` (that supplier's Catalogo2 rows for the
 *     hub's city: names/units for products not in the order).
 *   - The parsed answer is cached 30 s per hub; &fresh=1 skips the cache (compras may have just edited the sheet).
 *
 * No phone numbers are returned (names only).
 */
const TZ = 'America/Monterrey';
const VENTANA_DIAS = 14;
const CACHE_SEG = 30;
const MASTER = '14-Wt08IJuNc7e5nKA0R_omBHc0JY2olSxu_FCCVHOLQ';
const TABS = { ordenes: 'Base datos Compras', catalogo: 'Catalogo2', proveedores: 'Proveedores',
               encargados: 'Encargados', nuevos: 'Productos Nuevos', resumen: 'Resumen' };
// City → reference hub file (Encargados + Inv {city} + Productos Nuevos). A city without one still gets orders,
// caducidad and comprador from the master; comercial/temp stay empty and the app shows «Contacta al equipo
// comercial en el canal de abastecimiento en Slack».
const CIUDADES = {
  Mty:  { file: '1C8Vb9OE8uVZVidNRs7D7aDbwdPK56U2OW0nYFJ3eKoE', inv: 'Inv Mty' },    // Recepcion Contry
  CDMX: { file: '1MbGG8sIkwOozaqJEcl_JJgNP4h1DRFuyjt4Aq4KXGzU', inv: 'Inv CDMX' },   // Recepcion Condesa
  Gdl:  { file: '19uMqhehFei1rH2jNlr9O4vICa4yW3JGTqithg9-EjuE', inv: 'Inv Gdl' },    // Recepcion Zap
  Sal:  { file: '1KqHhWeY8RpnlSYOejegtldqmekKcx6tcf3H-uYC4UbE', inv: 'Inv Sal' },    // Recepcion Saltillo
};
// App slug → Hub code in «Base datos Compras» and its Catalogo2 city.
const HUBS = {
  'mh-contry':      { hub: 'Con', ciudad: 'Mty' },
  'mh-cumbres':     { hub: 'Cu',  ciudad: 'Mty' },
  'mh-guadalupe':   { hub: 'Gpe', ciudad: 'Mty' },
  'mh-san-nicolas': { hub: 'SNG', ciudad: 'Mty' },
  'mh-zapopan':     { hub: 'Zap', ciudad: 'Gdl' },
  'mh-condesa':     { hub: 'Csa', ciudad: 'CDMX' },
  'mh-avicola':     { hub: 'Sal', ciudad: 'Sal' },
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || p.token !== token) return json_({ error: 'token' });
    const hub = String(p.hub || '');
    if (!HUBS[hub]) return json_({ error: 'hub', hubs: Object.keys(HUBS) });
    const data = leerHub_(hub, p.fresh === '1');
    return json_(p.proveedor ? soloProveedor_(data, String(p.proveedor)) : sinCatalogo_(data));
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function probar() {
  const t0 = Date.now();
  const d = leerHub_('mh-contry', true);
  Logger.log('leido %s en %s ms · %s órdenes · %s proveedores · %s catálogo', d.leido, Date.now() - t0,
    d.ordenes.length, d.proveedores.length, d.catalogo.length);
  d.ordenes.forEach(o => Logger.log('  %s · %s · %s · %s líneas · comercial %s · compras %s',
    o.fecha_entrega, o.num_oc || '—', o.proveedor, o.lineas.length, o.comercial || '—', o.comprador || '—'));
  if (d.ordenes.length) Logger.log('Primera línea: %s', JSON.stringify(d.ordenes[0].lineas[0]));
  if (d.avisos.length) Logger.log('Avisos: %s', d.avisos.join(' | '));
}

/* ── Output ── */
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function sinCatalogo_(d) {
  const o = Object.assign({}, d); delete o.catalogo; return o;
}
function soloProveedor_(d, prov) {
  const k = provKey_(prov);
  const contactos = {};
  Object.keys(d.contactos).forEach(n => { if (provKey_(n) === k) contactos[n] = d.contactos[n]; });
  return {
    leido: d.leido,
    ordenes: d.ordenes.filter(o => provKey_(o.proveedor) === k),
    contactos: contactos,
    proveedores: d.proveedores,
    catalogo: (d.catalogo || []).filter(c => provKey_(c.proveedor) === k),
    avisos: d.avisos,
  };
}

/* ── Cache: 30 s per hub. CacheService holds ≤100 KB per key, so the gzipped answer is split in chunks. ── */
function leerHub_(hub, fresh) {
  const cache = CacheService.getScriptCache();
  const key = 'pd_' + hub;
  if (!fresh) {
    const hit = cacheGet_(cache, key);
    if (hit) return hit;
  }
  const data = parsearHub_(hub);
  cachePut_(cache, key, data);
  return data;
}
function cachePut_(cache, key, obj, seg) {
  try {
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
    const size = 90000, parts = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += size) parts[key + '_' + (n++)] = b64.slice(i, i + size);
    parts[key] = String(n);
    cache.putAll(parts, seg || CACHE_SEG);
  } catch (e) { /* cache is a nicety */ }
}
function cacheGet_(cache, key) {
  try {
    const n = Number(cache.get(key));
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    if (keys.some(k => !got[k])) return null;
    const bytes = Utilities.base64Decode(keys.map(k => got[k]).join(''));
    return JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString());
  } catch (e) { return null; }
}

/* ── Saved copy for the app (sql/pd-snapshot.sql): refrescarTodo runs every minute from a timer ──
 * Reads the master once and each city's reference file at most every REF_MIN minutes, builds every hub, and sends
 * Supabase only what changed (hash of the answer without `leido`); unchanged hubs just get revisado = now, which is what
 * the app checks before trusting the copy. Outside HORAS it does nothing (the app then reads this script live). */
const SB_URL = 'https://uuqqtksxlgkztenojufm.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1cXF0a3N4bGdrenRlbm9qdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxODc0NDIsImV4cCI6MjA5Mzc2MzQ0Mn0.Ifj0QKO4oTcIz3IgSD3fMWwdQz_QG_561d4sQAgWG2U'; // public anon key (same as the app)
const TIMER_MIN = 1;          // Apps Script's shortest timer
const HORAS = [5, 23];        // Monterrey hours it runs: from 05:00 to 22:59
const REF_MIN = 30;           // Encargados / Inv {city} change rarely: re-read every 30 min

function refrescarTodo() {
  const h = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  if (h < HORAS[0] || h > HORAS[1] - 1) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;                 // the previous run is still going
  try {
    const t0 = Date.now();
    const secret = PropertiesService.getScriptProperties().getProperty('SB_SECRET');
    if (!secret) throw new Error('Falta SB_SECRET en Script properties');
    const ctx = { master: libro_(MASTER, [TABS.catalogo, TABS.proveedores, TABS.ordenes]), refs: {} };
    const cache = CacheService.getScriptCache();
    Object.keys(CIUDADES).forEach(c => {
      let r = cacheGet_(cache, 'ref_' + c);
      if (!r) { r = referencia_(c); cachePut_(cache, 'ref_' + c, r, REF_MIN * 60); }
      ctx.refs[c] = r;
    });
    const props = PropertiesService.getScriptProperties();
    const datos = {}, filas = [];
    Object.keys(HUBS).forEach(slug => {
      const d = parsearHub_(slug, ctx);
      cachePut_(cache, 'pd_' + slug, d);           // the live doGet gets it too
      const sinLeido = Object.assign({}, d); delete sinLeido.leido;
      const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(sinLeido), Utilities.Charset.UTF_8));
      datos[slug] = { data: d, hash: hash };
      const fila = { hub: slug, hash: hash };
      if (props.getProperty('hash_' + slug) !== hash) fila.data = d;
      filas.push(fila);
    });
    // A heartbeat whose row is missing or holds another hash comes back in `faltan`: send that hub in full now.
    const faltan = snapshotPut_(secret, filas, Date.now() - t0);
    if (faltan.length) snapshotPut_(secret, faltan.map(s => ({ hub: s, hash: datos[s].hash, data: datos[s].data })), Date.now() - t0);
    filas.forEach(f => { if (f.data) props.setProperty('hash_' + f.hub, datos[f.hub].hash); });
    // «Resumen» (what Retool shows as entered): once an hour at most, never at the cost of the orders above
    const ultima = Number(props.getProperty('entradas_ts') || 0);
    if (h >= ENTRADAS_HORAS[0] && Date.now() - ultima >= ENTRADAS_MIN * 60000) {
      try { entradasTodo_(secret); props.setProperty('entradas_ts', String(Date.now())); }
      catch (e) { console.error('Entradas: ' + (e.message || e)); props.setProperty('entradas_ts', String(Date.now() - (ENTRADAS_MIN - 10) * 60000)); }
    }
  } finally {
    lock.releaseLock();
  }
}
function snapshotPut_(secret, filas, ms) {
  const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/rec_pd_snapshot_put', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
    payload: JSON.stringify({ p_secret: secret, p_rows: filas, p_ms: ms }),
  });
  if (r.getResponseCode() >= 300) throw new Error('rec_pd_snapshot_put → ' + r.getResponseCode() + ' ' + r.getContentText());
  return JSON.parse(r.getContentText() || '[]') || [];
}
// Run once (and again after changing TIMER_MIN): replaces the timer. A full first run follows right away.
function instalarTimer() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'refrescarTodo').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refrescarTodo').timeBased().everyMinutes(TIMER_MIN).create();
  const props = PropertiesService.getScriptProperties();
  Object.keys(HUBS).forEach(s => { props.deleteProperty('hash_' + s); props.deleteProperty('ehash_' + s); });   // send everything once
  props.deleteProperty('entradas_ts');
  refrescarTodo();
}
function quitarTimer() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'refrescarTodo').forEach(t => ScriptApp.deleteTrigger(t));
}

/* ── Entradas (comercial-plan §1): «Resumen» = compras pastes Retool's «recibo» page there every day. Same first columns as
 * «Base datos Compras»; Entrada = what was entered in Retool. Only Num Oc, Cod. Barras, Item, Ud, Entrada, Proveedor,
 * Fecha are kept (no money). Rows without Num Oc can't be matched and are skipped. Last ENTRADAS_DIAS days by Fecha.
 * data per hub: { desde, ocs: { "<Num Oc>": { p: proveedor, f: fecha, l: [[codigo, item, entrada, 'Kg'|'Pz'], …] } } };
 * repeated codes (or names, when there's no code) inside one OC are summed. ── */
const ENTRADAS_MIN = 60;
const ENTRADAS_DIAS = 30;
const ENTRADAS_HORAS = [7, 23];   // from 07:00; refrescarTodo itself stops at 22:59

function entradasTodo_(secret) {
  const t0 = Date.now();
  const porHub = parsearEntradas_(libro_(MASTER, [TABS.resumen]));
  const props = PropertiesService.getScriptProperties();
  const datos = {}, filas = [];
  Object.keys(HUBS).forEach(slug => {
    const d = porHub[slug];
    const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(d), Utilities.Charset.UTF_8));
    datos[slug] = { data: d, hash: hash };
    const fila = { hub: slug, hash: hash };
    if (props.getProperty('ehash_' + slug) !== hash) fila.data = d;
    filas.push(fila);
  });
  const faltan = rpcPut_('rec_pd_entradas_put', secret, filas, Date.now() - t0);
  if (faltan.length) rpcPut_('rec_pd_entradas_put', secret, faltan.map(s => ({ hub: s, hash: datos[s].hash, data: datos[s].data })), Date.now() - t0);
  filas.forEach(f => { if (f.data) props.setProperty('ehash_' + f.hub, datos[f.hub].hash); });
}
function parsearEntradas_(libro) {
  const t = tabla_(libro, TABS.resumen, ['hub', 'num_oc', 'item', 'entrada']);
  const C = t.col, porCodigo = {};
  Object.keys(HUBS).forEach(slug => { porCodigo[HUBS[slug].hub] = slug; });
  const hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), desde = addDays_(hoy, -ENTRADAS_DIAS);
  const out = {}, idx = {};
  Object.keys(HUBS).forEach(slug => { out[slug] = { desde: desde, ocs: {} }; });
  t.rows.forEach(r => {
    const slug = porCodigo[txt_(r.v[C.hub])];
    if (!slug) return;
    const numOc = txt_(r.v[C.num_oc]).replace(/^-$/, '');
    if (!numOc) return;
    const fecha = C.fecha != null ? fecha_(r.v[C.fecha], r.d[C.fecha], TZ) : '';
    if (fecha && fecha < desde) return;
    const codigo = C.cod_barras != null ? codigo_(r.d[C.cod_barras]) : '', item = txt_(r.v[C.item]);
    if (!codigo && !item) return;
    const ocs = out[slug].ocs;
    if (!ocs[numOc]) ocs[numOc] = { p: C.proveedor != null ? txt_(r.v[C.proveedor]) : '', f: fecha, l: [] };
    const o = ocs[numOc];
    if (fecha && (!o.f || fecha < o.f)) o.f = fecha;
    const k = slug + '|' + numOc + '|' + (codigo || 'n:' + provKey_(item));
    const entrada = num_(r.v[C.entrada]);
    if (idx[k]) { idx[k][2] = Math.round((idx[k][2] + entrada) * 1000) / 1000; return; }
    const linea = [codigo, item, entrada, C.ud != null && /^kg/i.test(txt_(r.v[C.ud])) ? 'Kg' : 'Pz'];
    idx[k] = linea; o.l.push(linea);
  });
  return out;
}
// Manual runs from the editor
function refrescarEntradas() {
  const secret = PropertiesService.getScriptProperties().getProperty('SB_SECRET');
  if (!secret) throw new Error('Falta SB_SECRET en Script properties');
  entradasTodo_(secret);
  PropertiesService.getScriptProperties().setProperty('entradas_ts', String(Date.now()));
}
function probarEntradas() {
  const d = parsearEntradas_(libro_(MASTER, [TABS.resumen]));
  Object.keys(d).forEach(slug => {
    const ocs = d[slug].ocs, ks = Object.keys(ocs);
    console.log(slug + ': ' + ks.length + ' OCs, ' + ks.reduce((n, k) => n + ocs[k].l.length, 0) + ' renglones, ' +
                JSON.stringify(JSON.stringify(d[slug]).length) + ' bytes' + (ks.length ? ' · ej. ' + ks[0] + ' ' + JSON.stringify(ocs[ks[0]]).slice(0, 200) : ''));
  });
}
function rpcPut_(fn, secret, filas, ms) {
  const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
    payload: JSON.stringify({ p_secret: secret, p_rows: filas, p_ms: ms }),
  });
  if (r.getResponseCode() >= 300) throw new Error(fn + ' → ' + r.getResponseCode() + ' ' + r.getContentText());
  return JSON.parse(r.getContentText() || '[]') || [];
}

/* ── Parsing ── */
// ctx (optional, from refrescarTodo): { master, refs: { city → referencia_() } } so one run reads each file once.
function parsearHub_(slug, ctx) {
  const cfg = HUBS[slug];
  const master = (ctx && ctx.master) || libro_(MASTER, [TABS.catalogo, TABS.proveedores, TABS.ordenes]);
  const tz = TZ;
  const hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const desde = addDays_(hoy, -VENTANA_DIAS), hasta = addDays_(hoy, VENTANA_DIAS);
  const avisos = [];
  const ciudadKey = provKey_(cfg.ciudad);

  // Catalogo2 (this city): barcode → V Anaquel / name / unit; also the catalog for products not in the order.
  const cat = tabla_(master, TABS.catalogo, ['ciudad', 'cod_de_barras', 'producto', 'proveedor']);
  const K = cat.col;
  const vidaDe = {}, catalogo = [];
  cat.rows.forEach(r => {
    if (provKey_(txt_(r.v[K.ciudad])) !== ciudadKey) return;
    const codigo = codigo_(r.d[K.cod_de_barras]), prod = txt_(r.v[K.producto]), prov = txt_(r.v[K.proveedor]);
    if (!prod) return;
    const vida = K.v_anaquel != null ? num_(r.v[K.v_anaquel]) : 0;
    if (codigo && vida > 0) vidaDe[codigo] = vida;
    if (vida > 0) vidaDe['n:' + provKey_(prod)] = vida;
    if (prov) catalogo.push({ proveedor: prov, codigo: codigo, producto: prod,
                              kgpz: K.kg_pz != null && /^kg/i.test(txt_(r.v[K.kg_pz])) ? 'Kg' : 'Pz' });
  });

  // Proveedores: supplier → Comprador (full name), last-resort fallback.
  const compradorProv = {};
  try {
    const pv = tabla_(master, TABS.proveedores, ['proveedor_retool', 'comprador']);
    pv.rows.forEach(r => {
      const comp = txt_(r.v[pv.col.comprador]);
      [pv.col.proveedor_retool, pv.col.nombre_corto].forEach(j => {
        if (j != null && txt_(r.v[j]) && comp) compradorProv[provKey_(r.v[j])] = comp;
      });
    });
  } catch (e) { avisos.push(String(e.message || e)); }

  // Reference hub file for the city: Encargados (Comercial; phones are never read) + Inv {city} (Temp).
  const ref = (ctx && ctx.refs && ctx.refs[cfg.ciudad]) || referencia_(cfg.ciudad);
  const comercialDe = ref.comercialDe, tempDe = ref.tempDe;
  ref.avisos.forEach(a => avisos.push(a));

  // Order lines: «Base datos Compras», this hub's rows.
  const oc = tabla_(master, TABS.ordenes, ['hub', 'proveedor', 'item', 'pedido', 'fecha']);
  const C = oc.col;
  const grupos = {};            // Num Oc (or provKey|fecha) → orden
  const provNombre = {};        // provKey → display name (first seen)
  const ultimoComprador = {};   // provKey → last comprador seen for this hub
  oc.rows.forEach(r => {
    if (txt_(r.v[C.hub]) !== cfg.hub) return;
    const prov = txt_(r.v[C.proveedor]);
    if (!prov) return;
    const pk = provKey_(prov);
    if (!provNombre[pk]) provNombre[pk] = prov;
    const comprador = C.comprador != null ? txt_(r.v[C.comprador]) : '';
    if (comprador) ultimoComprador[pk] = comprador;
    if (C.status != null && txt_(r.v[C.status]) && !/^programad/i.test(txt_(r.v[C.status]))) return;
    const fecha = fecha_(r.v[C.fecha], r.d[C.fecha], tz);
    if (!fecha) { if (txt_(r.d[C.fecha])) avisos.push('Fila ' + r.n + ': fecha «' + r.d[C.fecha] + '»'); return; }
    if (fecha < desde || fecha > hasta) return;
    const pedido = num_(r.v[C.pedido]);
    if (!(pedido > 0)) return;
    const numOc = C.num_oc != null ? txt_(r.v[C.num_oc]).replace(/^-$/, '') : '';
    const gk = numOc || (pk + '|' + fecha);
    if (!grupos[gk]) grupos[gk] = { num_oc: numOc, proveedor: provNombre[pk], fecha_entrega: fecha, comercial: '',
                                    comprador: '', lineas: [], _compradores: {} };
    const g = grupos[gk];
    if (fecha < g.fecha_entrega) g.fecha_entrega = fecha;
    if (comprador) g._compradores[comprador] = (g._compradores[comprador] || 0) + 1;
    const codigo = codigo_(r.d[C.cod_barras]), producto = txt_(r.v[C.item]);
    const vida = vidaDe[codigo] || vidaDe['n:' + provKey_(producto)] || 0;
    g.lineas.push({
      codigo: codigo,
      sku_marca: C.sku != null ? txt_(r.d[C.sku]) : '',
      producto: producto,
      kgpz: /^kg/i.test(txt_(r.v[C.ud])) ? 'Kg' : 'Pz',
      pedido: pedido,
      caducidad_min: vida ? addDays_(fecha, vida) : '',
      temp: tempDe[codigo] || tempDe['n:' + provKey_(producto)] || '',
    });
  });

  const compradorDe = pk => ultimoComprador[pk] || compradorProv[pk] || '';
  const ordenes = Object.keys(grupos).map(k => {
    const g = grupos[k], pk = provKey_(g.proveedor);
    g.comercial = comercialDe[pk] || '';
    g.comprador = masVotado_(g._compradores) || compradorDe(pk);
    delete g._compradores;
    return g;
  }).sort((a, b) => a.fecha_entrega < b.fecha_entrega ? -1 : a.fecha_entrega > b.fecha_entrega ? 1 :
                    a.proveedor.localeCompare(b.proveedor, 'es') || (a.num_oc < b.num_oc ? -1 : 1));

  // Supplier list = the orders (plan §3.2): every supplier with rows for this hub in the master, any date or status,
  // plus the city's catalog suppliers (so «Otro proveedor» finds a supplier whose order hasn't been loaded yet).
  catalogo.forEach(c => { const k = provKey_(c.proveedor); if (!provNombre[k]) provNombre[k] = c.proveedor; });
  const proveedores = Object.keys(provNombre).map(k => provNombre[k]).sort((a, b) => a.localeCompare(b, 'es'));
  const contactos = {};
  proveedores.forEach(p => {
    const pk = provKey_(p);
    contactos[p] = { comercial: comercialDe[pk] || '', comprador: compradorDe(pk) };
  });

  return { leido: new Date().toISOString(), ordenes: ordenes, contactos: contactos,
           proveedores: proveedores, catalogo: catalogo, avisos: avisos };
}

/* Reference hub file of a city → { comercialDe, tempDe, avisos }: Encargados (supplier → Comercial; phones are never
 * read), Inv {city} and Productos Nuevos (Temp). */
function referencia_(ciudad) {
  const comercialDe = {}, tempDe = {}, avisos = [];
  const ref = CIUDADES[ciudad];
  if (ref) {
    const rs = libro_(ref.file, [TABS.encargados, ref.inv, TABS.nuevos]);
    const rtz = TZ;
    try {
      const enc = tabla_(rs, TABS.encargados, ['proveedor', 'comercial']);
      enc.rows.forEach(r => {
        const prov = txt_(r.v[enc.col.proveedor]), com = txt_(r.v[enc.col.comercial]);
        if (prov && com) comercialDe[provKey_(prov)] = com;
      });
    } catch (e) { avisos.push(String(e.message || e)); }
    try {
      const inv = tabla_(rs, ref.inv, ['producto', 'temp']);
      inv.rows.forEach(r => {
        const t = temp_(r.v[inv.col.temp], rtz);
        if (!t) return;
        if (inv.col.cod_de_barras != null) { const c = codigo_(r.d[inv.col.cod_de_barras]); if (c) tempDe[c] = t; }
        tempDe['n:' + provKey_(r.v[inv.col.producto])] = t;
      });
    } catch (e) { avisos.push(String(e.message || e)); }
    try {   // new products may not be in Inv yet
      const pn = tabla_(rs, TABS.nuevos, ['proveedor', 'producto']);
      const tcol = Object.keys(pn.col).filter(k => /^temp/.test(k))[0];
      if (tcol) pn.rows.forEach(r => {
        const c = pn.col.codigo_de_barras != null ? codigo_(r.d[pn.col.codigo_de_barras]) : '';
        const t = temp_(r.v[pn.col[tcol]], rtz);
        if (c && t && !tempDe[c]) tempDe[c] = t;
      });
    } catch (e) { avisos.push(String(e.message || e)); }
  } else {
    avisos.push('Sin archivo de referencia para ' + ciudad + ': sin comercial ni temperatura');
  }
  return { comercialDe: comercialDe, tempDe: tempDe, avisos: avisos };
}

/* Reads a tab; finds the header row (first of the top 6 rows that holds every `need` header) and maps columns by
 * normalized name: «Cod. Barras» → cod_barras, «Fecha de entrega» → fecha_de_entrega, «Und.» → und. When a header
 * repeats (Encargados has «Comercial» and «Comercial (Nuevo)»), the first one wins. */
// Reads tabs through the Sheets API (advanced service «Sheets»): it works with the spreadsheets.readonly scope. Two batch
// reads per file: raw values (numbers; dates as serial day numbers) and the text shown in each cell (barcodes keep
// leading zeros). Missing tabs are skipped here and reported by tabla_.
function libro_(id, nombres) {
  const titulos = (Sheets.Spreadsheets.get(id, { fields: 'sheets.properties.title' }).sheets || []).map(x => x.properties.title);
  const hay = nombres.filter(n => titulos.indexOf(n) >= 0), tabs = {};
  if (hay.length) {
    const ranges = hay.map(n => "'" + n.replace(/'/g, "''") + "'");
    const v = Sheets.Spreadsheets.Values.batchGet(id, { ranges: ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).valueRanges;
    const d = Sheets.Spreadsheets.Values.batchGet(id, { ranges: ranges, valueRenderOption: 'FORMATTED_VALUE' }).valueRanges;
    hay.forEach((n, i) => { tabs[n] = { v: v[i].values || [], d: d[i].values || [] }; });
  }
  return { tabs: tabs };
}
function tabla_(libro, nombre, need) {
  const t = libro.tabs[nombre];
  if (!t) throw new Error('No existe la pestaña «' + nombre + '»');
  const v = t.v, d = t.d; // the API drops trailing empty cells, so rows can be shorter than the header
  let h = -1;
  for (let i = 0; i < Math.min(6, d.length); i++) {
    const names = (d[i] || []).map(colKey_);
    if (need.every(n => names.indexOf(n) >= 0)) { h = i; break; }
  }
  if (h < 0) throw new Error('«' + nombre + '»: no encontré los encabezados ' + need.join(', '));
  const col = {};
  d[h].forEach((name, j) => { const k = colKey_(name); if (k && col[k] == null) col[k] = j; });
  const rows = [];
  for (let i = h + 1; i < Math.max(v.length, d.length); i++) rows.push({ n: i + 1, v: v[i] || [], d: d[i] || [] });
  return { col: col, rows: rows };
}

/* ── Normalizers ── */
function sinAcentos_(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function colKey_(s) { return sinAcentos_(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function provKey_(s) { return sinAcentos_(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function txt_(x) { return x == null ? '' : String(x).trim(); }
function num_(x) {
  if (typeof x === 'number') return x;
  const n = Number(String(x || '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
// Barcodes from the display value (a number cell would lose leading zeros); strip spaces and a trailing ".0".
function codigo_(s) { return txt_(s).replace(/\s+/g, '').replace(/\.0+$/, ''); }
function masVotado_(m) {
  let best = '', n = 0; Object.keys(m).forEach(k => { if (m[k] > n) { best = k; n = m[k]; } }); return best;
}
function addDays_(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
                octubre: 10, noviembre: 11, diciembre: 12 };
const pad_ = n => (n < 10 ? '0' : '') + n;
/* Date cell (a serial day number from the API: days since 1899-12-30, no time zone involved) → YYYY-MM-DD; text «12/11/2026» (dd/mm/yyyy), «2026-11-12» or
 * «martes, 9 de diciembre de 2026» → YYYY-MM-DD; anything else → ''. */
function fecha_(v, disp, tz) {
  if (typeof v === 'number') {
    if (!(v > 1)) return '';
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = sinAcentos_(txt_(disp || v)).toLowerCase();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return y + '-' + pad_(Number(m[2])) + '-' + pad_(Number(m[1])); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return m[3] + '-' + pad_(MESES[m[2]]) + '-' + pad_(Number(m[1]));
  return '';
}
/* Temp: «Ambiente» stays; a number stays as text ("1", "-18"). A cell formatted as a date (1 → «31/12/1899») comes
 * from the API as its serial day number, which is the value. */
function temp_(v, tz) {
  if (typeof v === 'number') return String(v);
  const s = txt_(v);
  if (!s) return '';
  if (/^amb/i.test(s)) return 'Ambiente';
  const n = Number(s.replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return s.match(/\d/) && isFinite(n) ? String(n) : '';   // anything else («Abarrotes» in one Productos Nuevos row) → no temp
}
