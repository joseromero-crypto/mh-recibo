/**
 * MH Recibo — Proveedor Directo bridge (proveedorDirecto-plan.md §5). Reference copy: paste into script.google.com
 * from Jose's Calii account. READ-ONLY: it never writes to any sheet.
 *
 * Setup (once):
 *   1. script.google.com → New project → name it "MH Recibo · Órdenes proveedor" → paste this file → Save.
 *   2. Project Settings → Script properties → add TOKEN = a long random string (shared with the app).
 *   3. Run `probar` once: authorizes SpreadsheetApp and logs a summary of mh-contry (check it against the sheet).
 *   4. Deploy → New deployment → type "Web app" → Execute as: Me · Who has access: Anyone → Deploy.
 *      Copy the /exec URL. (Every code change: Deploy → Manage deployments → edit → Version: New version,
 *      so the URL stays the same.)
 *
 * Call:  GET {exec}?token=…&hub=mh-contry[&proveedor=LALA][&fresh=1]
 *   → { leido, ordenes:[{proveedor, fecha_entrega, comercial, comprador, lineas:[…]}], contactos, telefonos, proveedores
 *       [, catalogo] }   or   { error }
 *   - Window: Fecha de entrega from today − 14 to today + 14 (America/Monterrey). Which were received is the app's job.
 *   - &proveedor narrows ordenes/contactos to one supplier and adds `catalogo` (its Inv Mty rows: names/units for
 *     products not in the order).
 *   - The parsed answer is cached 30 s per hub; &fresh=1 skips the cache (compras may have just edited the sheet).
 *
 * Phones (Encargados contacts table) are returned only for the app's «Llamar» links; the app never copies them into
 * reports or Slack.
 */
const TZ = 'America/Monterrey';
const VENTANA_DIAS = 14;
const CACHE_SEG = 30;
// One file per hub until there is access to the master behind Base Oc (plan §10 Q1). `cedis` (optional) keeps only
// rows of that Cedis code, for when several hubs share one tab.
const HUBS = {
  'mh-contry': { file: '1C8Vb9OE8uVZVidNRs7D7aDbwdPK56U2OW0nYFJ3eKoE', tab: 'OC Con', cedis: 'Con' },
};
const TABS = { encargados: 'Encargados', inventario: 'Inv Mty', nuevos: 'Productos Nuevos' };

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
  const d = leerHub_('mh-contry', true);
  Logger.log('leido %s · %s órdenes · %s proveedores · %s teléfonos', d.leido, d.ordenes.length, d.proveedores.length,
    Object.keys(d.telefonos).length);
  d.ordenes.forEach(o => Logger.log('  %s · %s · %s líneas · comercial %s · compras %s',
    o.fecha_entrega, o.proveedor, o.lineas.length, o.comercial || '—', o.comprador || '—'));
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
    telefonos: d.telefonos,
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
function cachePut_(cache, key, obj) {
  try {
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
    const size = 90000, parts = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += size) parts[key + '_' + (n++)] = b64.slice(i, i + size);
    parts[key] = String(n);
    cache.putAll(parts, CACHE_SEG);
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

/* ── Parsing ── */
function parsearHub_(hub) {
  const cfg = HUBS[hub];
  const ss = SpreadsheetApp.openById(cfg.file);
  const tz = ss.getSpreadsheetTimeZone() || TZ;
  const hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const desde = addDays_(hoy, -VENTANA_DIAS), hasta = addDays_(hoy, VENTANA_DIAS);
  const avisos = [];

  // Order lines (OC {Cedis}) — every row is read: rows outside the window still feed proveedores and compradores.
  const oc = tabla_(ss, cfg.tab, ['proveedor', 'item', 'pedido']);
  const C = oc.col;
  const grupos = {};            // provKey|fecha → orden
  const provNombre = {};        // provKey → display name (first seen)
  const ultimoComprador = {};   // provKey → last comprador seen in the sheet
  oc.rows.forEach((r, i) => {
    const prov = txt_(r.v[C.proveedor]);
    if (!prov) return;
    if (cfg.cedis && C.cedis != null && txt_(r.v[C.cedis]) && txt_(r.v[C.cedis]) !== cfg.cedis) return;
    const pk = provKey_(prov);
    if (!provNombre[pk]) provNombre[pk] = prov;
    const comprador = C.comprador != null ? txt_(r.v[C.comprador]) : '';
    if (comprador) ultimoComprador[pk] = comprador;
    const fecha = fecha_(r.v[C.fecha_de_entrega], r.d[C.fecha_de_entrega], tz);
    if (!fecha) { if (txt_(r.d[C.fecha_de_entrega])) avisos.push('Fila ' + r.n + ': fecha de entrega «' + r.d[C.fecha_de_entrega] + '»'); return; }
    if (fecha < desde || fecha > hasta) return;
    const pedido = num_(r.v[C.pedido]);
    if (!(pedido > 0)) return;
    const gk = pk + '|' + fecha;
    if (!grupos[gk]) grupos[gk] = { proveedor: provNombre[pk], fecha_entrega: fecha, comercial: '', comprador: '', lineas: [],
                                    _comerciales: {}, _compradores: {} };
    const g = grupos[gk];
    if (comprador) g._compradores[comprador] = (g._compradores[comprador] || 0) + 1;
    const comLinea = C.comercial != null ? txt_(r.v[C.comercial]) : '';
    if (comLinea) g._comerciales[comLinea] = (g._comerciales[comLinea] || 0) + 1;
    g.lineas.push({
      codigo: codigo_(r.d[C.cod_barras]),
      sku_marca: C.sku_marca != null ? txt_(r.d[C.sku_marca]) : '',
      producto: txt_(r.v[C.item]),
      kgpz: /^kg/i.test(txt_(r.v[C.und])) ? 'Kg' : 'Pz',
      pedido: pedido,
      caducidad_min: C.fecha_de_caducidad != null ? fecha_(r.v[C.fecha_de_caducidad], r.d[C.fecha_de_caducidad], tz) : '',
      temp: C.temp != null ? temp_(r.v[C.temp], tz) : '',
      nuevo: C.nuevo != null ? /^(s|si|sí|x|1|true|nuevo)$/i.test(txt_(r.v[C.nuevo])) : false,
    });
  });

  // Encargados: supplier → Comercial; contacts table → phones (only for «Llamar»).
  const enc = tabla_(ss, TABS.encargados, ['proveedor', 'comercial']);
  const comercialDe = {};
  enc.rows.forEach(r => {
    const prov = txt_(r.v[enc.col.proveedor]), com = txt_(r.v[enc.col.comercial]);
    if (prov && com) comercialDe[provKey_(prov)] = com;
  });
  const telefonos = {};
  if (enc.col.nombre != null && enc.col.telefono != null) {
    enc.rows.forEach(r => {
      const nombre = txt_(r.v[enc.col.nombre]), tel = txt_(r.d[enc.col.telefono]);
      if (nombre && tel) telefonos[nombre] = tel;
    });
  }

  // Productos Nuevos: last-resort comprador per supplier.
  const compradorNuevos = {};
  try {
    const pn = tabla_(ss, TABS.nuevos, ['proveedor', 'comprador']);
    pn.rows.forEach(r => {
      const prov = txt_(r.v[pn.col.proveedor]), comp = txt_(r.v[pn.col.comprador]);
      if (prov && comp) compradorNuevos[provKey_(prov)] = comp;
    });
  } catch (e) { avisos.push(String(e.message || e)); }

  // Inv Mty: catalog rows (names/units of products not in the order); only sent with &proveedor.
  const catalogo = [];
  try {
    const inv = tabla_(ss, TABS.inventario, ['proveedor', 'producto']);
    const I = inv.col;
    inv.rows.forEach(r => {
      const prov = txt_(r.v[I.proveedor]), prod = txt_(r.v[I.producto]);
      if (!prov || !prod) return;
      catalogo.push({
        proveedor: prov,
        codigo: I.cod_de_barras != null ? codigo_(r.d[I.cod_de_barras]) : '',
        producto: prod,
        kgpz: I.kg_pz != null && /^kg/i.test(txt_(r.v[I.kg_pz])) ? 'Kg' : 'Pz',
        temp: I.temp != null ? temp_(r.v[I.temp], tz) : '',
      });
    });
  } catch (e) { avisos.push(String(e.message || e)); }

  const compradorDe = pk => ultimoComprador[pk] || compradorNuevos[pk] || '';
  const ordenes = Object.keys(grupos).map(k => {
    const g = grupos[k], pk = provKey_(g.proveedor);
    g.comercial = comercialDe[pk] || masVotado_(g._comerciales);
    g.comprador = masVotado_(g._compradores) || compradorDe(pk);
    delete g._comerciales; delete g._compradores;
    return g;
  }).sort((a, b) => a.fecha_entrega < b.fecha_entrega ? -1 : a.fecha_entrega > b.fecha_entrega ? 1 :
                    a.proveedor.localeCompare(b.proveedor, 'es'));

  // Supplier list = the orders (plan §3.2), every row of the tab, not just the window.
  const proveedores = Object.keys(provNombre).map(k => provNombre[k]).sort((a, b) => a.localeCompare(b, 'es'));
  const contactos = {};
  proveedores.forEach(p => {
    const pk = provKey_(p);
    contactos[p] = { comercial: comercialDe[pk] || '', comprador: compradorDe(pk) };
  });

  return { leido: new Date().toISOString(), ordenes: ordenes, contactos: contactos, telefonos: telefonos,
           proveedores: proveedores, catalogo: catalogo, avisos: avisos };
}

/* Reads a tab; finds the header row (first of the top 6 rows that holds every `need` header) and maps columns by
 * normalized name: «Cod. Barras» → cod_barras, «Fecha de entrega» → fecha_de_entrega, «Und.» → und. When a header
 * repeats (Encargados has «Comercial» and «Comercial (Nuevo)»), the first one wins. */
function tabla_(ss, nombre, need) {
  const sh = ss.getSheetByName(nombre);
  if (!sh) throw new Error('No existe la pestaña «' + nombre + '»');
  const range = sh.getDataRange();
  const v = range.getValues(), d = range.getDisplayValues();
  let h = -1;
  for (let i = 0; i < Math.min(6, v.length); i++) {
    const names = d[i].map(colKey_);
    if (need.every(n => names.indexOf(n) >= 0)) { h = i; break; }
  }
  if (h < 0) throw new Error('«' + nombre + '»: no encontré los encabezados ' + need.join(', '));
  const col = {};
  d[h].forEach((name, j) => { const k = colKey_(name); if (k && col[k] == null) col[k] = j; });
  const rows = [];
  for (let i = h + 1; i < v.length; i++) rows.push({ n: i + 1, v: v[i], d: d[i] });
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
/* Date cell → YYYY-MM-DD in the sheet's zone; text «12/11/2026» (dd/mm/yyyy), «2026-11-12» or
 * «martes, 9 de diciembre de 2026» → YYYY-MM-DD; anything else → ''. */
function fecha_(v, disp, tz) {
  if (v instanceof Date && !isNaN(v)) {
    const y = Number(Utilities.formatDate(v, tz, 'yyyy'));
    return y > 1900 ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : '';
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
/* Temp: «Ambiente» stays; a number stays as text ("1", "-18"). A Date is a number formatted as a date
 * (1 → «31 de diciembre de 1899»): its serial day number is the value. */
function temp_(v, tz) {
  if (v instanceof Date && !isNaN(v)) {
    const ymd = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    const serial = Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
    return String(serial);
  }
  const s = txt_(v);
  if (!s) return '';
  if (/^amb/i.test(s)) return 'Ambiente';
  const n = Number(s.replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return s.match(/\d/) && isFinite(n) ? String(n) : s;
}
