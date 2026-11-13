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
 *   - REFERENCIA per city (CIUDADES): one hub file holding «Encargados» (supplier → Comercial; contacts table Área/Nombre/
 *     Teléfono) and «Inv {city}» (Temp). The master has neither.
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
 *   → { leido, ordenes:[{num_oc, proveedor, fecha_entrega, comercial, comprador, lineas:[…]}], contactos, telefonos,
 *       proveedores[, catalogo], avisos }   or   { error }
 *   - One orden per Num Oc (two Bimbo OCs on the same day are two órdenes). Rows without Num Oc («-») are grouped by
 *     supplier + date. Window: Fecha de entrega from today − 14 to today + 14 (America/Monterrey).
 *   - &proveedor narrows ordenes/contactos to one supplier and adds `catalogo` (that supplier's Catalogo2 rows for the
 *     hub's city: names/units for products not in the order).
 *   - The parsed answer is cached 30 s per hub; &fresh=1 skips the cache (compras may have just edited the sheet).
 *
 * Phones (Encargados contacts table) are returned only for the app's «Llamar» links; the app never copies them into
 * reports or Slack.
 */
const TZ = 'America/Monterrey';
const VENTANA_DIAS = 14;
const CACHE_SEG = 30;
const MASTER = '14-Wt08IJuNc7e5nKA0R_omBHc0JY2olSxu_FCCVHOLQ';
const TABS = { ordenes: 'Base datos Compras', catalogo: 'Catalogo2', proveedores: 'Proveedores',
               encargados: 'Encargados', nuevos: 'Productos Nuevos' };
// City → reference hub file (Encargados + Inv {city} + Productos Nuevos). A city without one still gets orders,
// caducidad and comprador from the master; comercial/telefonos/temp stay empty and the app shows «Contacta al equipo
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
  Logger.log('leido %s en %s ms · %s órdenes · %s proveedores · %s teléfonos · %s catálogo', d.leido, Date.now() - t0,
    d.ordenes.length, d.proveedores.length, Object.keys(d.telefonos).length, d.catalogo.length);
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
function parsearHub_(slug) {
  const cfg = HUBS[slug];
  const master = SpreadsheetApp.openById(MASTER);
  const tz = master.getSpreadsheetTimeZone() || TZ;
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

  // Reference hub file for the city: Encargados (Comercial, phones) + Inv {city} (Temp).
  const comercialDe = {}, telefonos = {}, tempDe = {};
  const ref = CIUDADES[cfg.ciudad];
  if (ref) {
    const rs = SpreadsheetApp.openById(ref.file);
    const rtz = rs.getSpreadsheetTimeZone() || TZ;
    try {
      const enc = tabla_(rs, TABS.encargados, ['proveedor', 'comercial']);
      enc.rows.forEach(r => {
        const prov = txt_(r.v[enc.col.proveedor]), com = txt_(r.v[enc.col.comercial]);
        if (prov && com) comercialDe[provKey_(prov)] = com;
        if (enc.col.nombre != null && enc.col.telefono != null) {
          const nombre = txt_(r.v[enc.col.nombre]), tel = txt_(r.d[enc.col.telefono]);
          if (nombre && tel) telefonos[nombre] = tel;
        }
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
    avisos.push('Sin archivo de referencia para ' + cfg.ciudad + ': sin comercial, teléfonos ni temperatura');
  }

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
  return s.match(/\d/) && isFinite(n) ? String(n) : '';   // anything else («Abarrotes» in one Productos Nuevos row) → no temp
}
