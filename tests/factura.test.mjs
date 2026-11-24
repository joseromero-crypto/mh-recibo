// Invoice vs OC vs recibido (facturaProveedor-plan §7). Run: node tests/factura.test.mjs
// Evals the FACTURA-PURE block of index.html (single-file app, no build). The Arca case needs the gitignored fixtures
// (fixtures/arca-*.json, real business data); it is skipped when they are missing.
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const block = html.slice(html.indexOf('/* FACTURA-PURE:BEGIN'), html.indexOf('/* FACTURA-PURE:END */'));
assert.ok(block.length > 100, 'FACTURA-PURE block not found');
const { facNormCode, facComparar, facMismoProveedor, facLigadas, facInicio, facObjetivo, facCierre, facFolios, facFacturas, facFilasDe, facFolioDe } =
  new Function(block + '\nreturn { facNormCode, facComparar, facMismoProveedor, facLigadas, facInicio, facObjetivo, facCierre, facFolios, facFacturas, facFilasDe, facFolioDe };')();

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('normCode = Invoice Reader lean/match.ts', () => {
  assert.equal(facNormCode('001177'), '1177');
  assert.equal(facNormCode('000'), '0');
  assert.equal(facNormCode('*138'), '138');
  assert.equal(facNormCode('ab-12 3'), 'AB123');
  assert.equal(facNormCode('0A12'), '0A12');   // not all digits: zeros stay
  assert.equal(facNormCode(null), '');
  assert.equal(facNormCode(7501055310487), '7501055310487');
});

test('supplier names', () => {
  assert.ok(facMismoProveedor('Arca Continental', 'DISTRIBUIDORA ARCA CONTINENTAL'));
  assert.ok(facMismoProveedor('LALA', 'Grupo Lala S.A.B. de C.V.'));
  assert.ok(!facMismoProveedor('Alpura', 'Arca Continental'));
});

const fx = f => join(root, 'fixtures', f);
if (['arca-C2642861-envio.json', 'arca-DNL-5695519398-record.json', 'arca-C2642861-cerrar.json'].every(f => existsSync(fx(f)))) {
  test('Arca DNL 5695519398 vs OC C2642861: zero flags', () => {
    const envio = JSON.parse(readFileSync(fx('arca-C2642861-envio.json'), 'utf8'));
    const rec = JSON.parse(readFileSync(fx('arca-DNL-5695519398-record.json'), 'utf8'));
    const { lineas_todas } = JSON.parse(readFileSync(fx('arca-C2642861-cerrar.json'), 'utf8'));
    assert.equal(rec.rows.length, 19);
    assert.ok(rec.rows.every(r => r.confident));
    const r = facComparar({ lines: envio.lines, todas: lineas_todas, rows: rec.rows });
    assert.equal(r.lineas.length, 19, 'every row linked to its own OC line');
    assert.ok(r.lineas.every(x => x.filas.length === 1));
    assert.ok(r.lineas.every(x => x.facturado === x.recibido), 'piezas = recibido on every line');
    assert.ok(r.lineas.every(x => x.facturado <= x.pedido), 'none billed over esperado');
    assert.equal(r.piezas.facturadas, 223);
    assert.equal(r.no_solicitados.length, 0);
    assert.equal(r.no_identificados.length, 0);
    assert.equal(r.flagged.length, 0);
    assert.ok(r.limpia);
    const billed = new Set(r.lineas.map(x => x.sku_key));
    const notBilled = envio.lines.filter(l => !billed.has(l.sku_key));
    assert.equal(notBilled.length, 6);
    const rcv = new Map(lineas_todas.map(t => [t.sku_key, t.recibido]));
    assert.ok(notBilled.every(l => rcv.get(l.sku_key) === 0), 'the 6 not billed were received 0: no flag');
  });
} else console.log('skip Arca (fixtures/arca-*.json missing)');

// Synthetic order: every case of §7 in one invoice.
const L = (sku_key, producto, esperado, extra = {}) => ({ sku_key, barcode: sku_key, producto, kgpz: 'Pz', esperado, sku_marca: '', ...extra });
const lines = [
  L('7500000000011', 'Yoghurt fresa 1L', 10, { sku_marca: '001177' }),
  L('7500000000028', 'Yoghurt durazno 1L', 6),
  L('7500000000035', 'Queso panela 400g', 4),
  L('7500000000042', 'Jamón pavo', 2, { kgpz: 'Kg' }),
  L('7500000000059', 'Leche entera 1L', 12, { sku_marca: 'X9' }),
  L('7500000000066', 'Leche light 1L', 12, { sku_marca: 'X9' }),   // shares sku_marca with the line above
  L('7500000000073', 'Crema 200ml', 8),
  L('name:mantequilla', 'Mantequilla', 5),
];
const T = (sku_key, pedido, recibido, kgpz = 'Pz') => ({ sku_key, pedido, recibido, kgpz });
const todas = [T('7500000000011', 10, 6), T('7500000000028', 6, 6), T('7500000000035', 4, 4), T('7500000000042', 2, 1.8, 'Kg'),
  T('7500000000059', 12, 12), T('7500000000066', 12, 12), T('7500000000073', 8, 8), T('name:mantequilla', 5, 0)];
const R = (sourceRow, matchKeys, piezas, extra = {}) => ({ sourceRow, matchKeys, piezas, confident: true, quantityOk: true, productName: 'P' + sourceRow,
  printedDescription: 'DESC ' + sourceRow, printedCodes: [], candidates: [], ...extra });
const rows = [
  R(1, ['1177'], 12),                                   // leading zeros: OC '001177' → billed 12, pedido 10, recibido 6
  R(2, ['7500000000097'], 6, { productName: 'Yoghurt mango 1L' }), // wrong flavor, confident, not on the OC
  R(3, ['ZZ123'], 3, { confident: false, productName: null, candidates: [{ sku: 'ABC', name: 'Crema', score: 0.6, barcodes: ['7500000000073'], supplierSku: null }] }),
  R(4, ['7500000000035'], null, { quantityOk: false }),  // quantity unreadable
  R(5, ['7500000000042'], 2),                           // Kg line
  R(6, ['X9'], 12),                                     // matches two OC lines → ambiguous
  R(7, ['7500000000028'], 4),                           // 4 of 6, all fine
  R(8, ['7500000000028'], 2),                           // second row billing the same line: 6 total
];

test('synthetic: every case', () => {
  const r = facComparar({ lines, todas, rows });
  const by = Object.fromEntries(r.lineas.map(x => [x.sku_key, x]));
  const y = by['7500000000011'];
  assert.deepEqual([y.facturado, y.pedido, y.recibido, y.de_mas, y.no_fisico], [12, 10, 6, 2, 4]);
  assert.equal(r.no_solicitados.length, 1);
  assert.equal(r.no_solicitados[0].producto, 'Yoghurt mango 1L');
  assert.equal(r.no_identificados.length, 2);
  const [u, amb] = r.no_identificados;
  assert.equal(u.sourceRow, 3); assert.equal(u.ambiguo, false); assert.deepEqual(u.sugeridas, ['7500000000073']);
  assert.equal(amb.sourceRow, 6); assert.equal(amb.ambiguo, true); assert.deepEqual(amb.sugeridas, ['7500000000059', '7500000000066']);
  assert.equal(by['7500000000035'].revisar, 'cantidad'); assert.equal(by['7500000000035'].de_mas, undefined);
  assert.equal(by['7500000000042'].revisar, 'kg'); assert.equal(by['7500000000042'].no_fisico, undefined);
  const d = by['7500000000028'];
  assert.deepEqual([d.facturado, d.de_mas, d.no_fisico, d.filas.join()], [6, 0, 0, '7,8']);
  assert.ok(!by['name:mantequilla'], 'missing and not billed: not a flag');
  // received but not billed: the ambiguous pair (row 6 unresolved) and the crema (row 3 unresolved)
  assert.deepEqual(r.sin_facturar.map(x => x.sku_key), ['7500000000059', '7500000000066', '7500000000073']);
  assert.deepEqual(r.conteo, { no_solicitado: 1, de_mas: 1, no_fisico: 1, por_revisar: 2, no_identificado: 2, sin_facturar: 3 });
  assert.deepEqual(r.flagged.map(x => x.sku_key), ['7500000000011', '7500000000035', '7500000000042']);
  assert.equal(r.piezas.de_mas, 2); assert.equal(r.piezas.no_fisico, 4);
  assert.equal(r.piezas.facturadas, 12 + 6 + 3 + 12 + 4 + 2, 'pieces only: the Kg row and the unread quantity are out');
  assert.ok(!r.limpia);
});

test('synthetic: picks resolve no identificado', () => {
  const r = facComparar({ lines, todas, rows, picks: { 3: '7500000000073', 6: 'no_oc' } });
  assert.equal(r.no_identificados.length, 0);
  const c = r.lineas.find(x => x.sku_key === '7500000000073');
  assert.deepEqual([c.facturado, c.de_mas, c.no_fisico], [3, 0, 0]);
  assert.equal(r.no_solicitados.length, 2);
  assert.equal(r.no_solicitados[1].a_mano, true);
  // a pick pointing to a line that isn't in the order is ignored
  assert.equal(facComparar({ lines, todas, rows, picks: { 3: 'nope' } }).no_identificados.length, 2);
});

test('synthetic: billed for a line received 0', () => {
  const r = facComparar({ lines, todas, rows: [R(1, ['MANTEQUILLA'], 5)] });
  assert.equal(r.no_solicitados.length, 1, "a 'name:' sku_key is never a code");
  const r2 = facComparar({ lines: [L('123', 'A', 5)], todas: [T('123', 5, 0)], rows: [R(1, ['123'], 5)] });
  assert.deepEqual([r2.lineas[0].de_mas, r2.lineas[0].no_fisico], [0, 5]);
});

test('reads already linked to another reception', () => {
  const E = (session_id, detalle) => ({ session_id, detalle });
  const evs = [E('a', { read_id: 'r1' }), E('b', { read_id: 'r2' }), E('b', { read_id: 'r3' }), E('c', { read_id: 'r4' }), E('c', { manual: true, motivo: 'x' }), E('me', { read_id: 'r5' })];
  assert.deepEqual([...facLigadas(evs, 'me')].sort(), ['r1', 'r3'], "b moved to r3 (r2 free), c went manual (r4 free), my own r5 stays visible");
});

// Factura primero (2026-11-23): the invoice is compared with the OC first; the physical check looks for facObjetivo.
test('factura primero: start → targets → close', () => {
  const oc = [L('A1', 'Leche', 10), L('B2', 'Queso', 6), L('C3', 'Crema', 4), L('D4', 'Jamón', 2, { kgpz: 'Kg' }), L('E5', 'Yoghurt', 5)];
  const inv = [R(1, ['A1'], 8), R(2, ['B2'], 9), R(3, ['D4'], 2), R(4, ['Z9'], 3, { productName: 'Mango' })];
  const c = facComparar({ lines: oc, todas: [], rows: inv });   // nothing received yet
  const ini = facInicio(c);
  assert.ok(ini.lineas.every(x => !('no_fisico' in x) && !('recibido' in x)), 'no no_fisico at the start');
  assert.equal(ini.conteo.no_fisico, undefined); assert.equal(ini.piezas.no_fisico, undefined);
  assert.deepEqual(ini.no_solicitados.map(x => [x.producto, x.codigos.join()]), [['Mango', 'Z9']]);
  assert.ok(!ini.limpia);
  const by = new Map(ini.lineas.map(x => [x.sku_key, x]));
  assert.deepEqual(facObjetivo(by.get('A1'), 10), { obj: 8, fac: 8, de_mas: 0 }, 'billed less: look for 8');
  assert.deepEqual(facObjetivo(by.get('B2'), 6), { obj: 6, fac: 9, de_mas: 3 }, 'billed more: never above the OC');
  assert.deepEqual(facObjetivo(by.get('D4'), 2), { obj: 2, revisar: 'kg', fac: 2 }, 'Kg: against the OC');
  assert.deepEqual(facObjetivo(undefined, 4), { obj: 0, nofac: true }, 'not billed: nothing to look for');
  // Close: A1 got 7 of 8 billed, B2 6, crema not billed but 4 arrived, jamón 1.9 kg, yoghurt not billed nor received
  const todas = [T('A1', 10, 7), T('B2', 6, 6), T('C3', 4, 4), T('D4', 2, 1.9, 'Kg'), T('E5', 5, 0)];
  const f = facCierre(ini, todas), fb = new Map(f.lineas.map(x => [x.sku_key, x]));
  assert.deepEqual([fb.get('A1').no_fisico, fb.get('A1').de_mas], [1, 0]);
  assert.deepEqual([fb.get('B2').no_fisico, fb.get('B2').de_mas], [0, 3]);
  assert.equal(fb.get('D4').revisar, 'kg'); assert.equal(fb.get('D4').no_fisico, undefined);
  assert.deepEqual(f.sin_facturar, [{ sku_key: 'C3', producto: 'C3', kgpz: 'Pz', recibido: 4 }]);
  assert.deepEqual(f.conteo, { no_solicitado: 1, de_mas: 1, no_fisico: 1, por_revisar: 1, no_identificado: 0, sin_facturar: 1 });
  assert.deepEqual([f.piezas.no_fisico, f.piezas.de_mas], [1, 3]);
  assert.ok(!f.limpia);
  // Same numbers as comparing at the close the old way
  const old = facComparar({ lines: oc, todas, rows: inv });
  assert.deepEqual(f.lineas, old.lineas); assert.deepEqual(f.conteo, old.conteo); assert.deepEqual(f.piezas, old.piezas);
});

test('two invoices in one upload: only the chosen photos are compared', () => {
  assert.deepEqual(facFolios('RK 262247 / RK 262246'), ['RK 262247', 'RK 262246']);
  assert.deepEqual(facFolios('RK/262247'), ['RK/262247']);
  assert.deepEqual(facFolios(null), []);
  const row = (sourceRow, photo, piezas) => ({ sourceRow, photo, piezas, quantityOk: true, confident: true, matchKeys: ['777'], productName: 'X', candidates: [], printedCodes: [] });
  const r = { reference: 'RK 262247 / RK 262246', rows: [row(1, 1, 30), row(2, 2, 30)] };
  const f = facFacturas(r);
  assert.deepEqual(f.grupos.map(g => [g.foto, g.folio, g.piezas]), [[1, 'RK 262247', 30], [2, 'RK 262246', 30]]);
  const lines = [{ sku_key: '777', barcode: '777', producto: 'X', kgpz: 'Pz', esperado: 30 }];
  assert.equal(facComparar({ lines, rows: facFilasDe(r, null) }).lineas[0].de_mas, 30);   // what Cumbres saw
  assert.equal(facComparar({ lines, rows: facFilasDe(r, [1]) }).lineas[0].de_mas, 0);
  assert.equal(facFolioDe(r, [1]), 'RK 262247');
  assert.equal(facFolioDe(r, null), 'RK 262247 / RK 262246');
  assert.equal(facFacturas({ reference: 'A 1', rows: r.rows }), null);                      // one folio, two pages
  assert.equal(facFacturas({ reference: r.reference, rows: [{ ...row(1, 1, 5), photo: undefined }] }), null); // older reader
  assert.equal(facFacturas({ reference: r.reference, rows: [...r.rows, row(3, 3, 1)] }).grupos[0].folio, null); // 2 folios, 3 photos
  const e = (d) => [{ session_id: 'a', detalle: { read_id: 'r1', ...d } }];
  assert.ok(facLigadas(e({}), 'b').has('r1'));
  assert.ok(!facLigadas(e({ fotos: [1] }), 'b').has('r1'));
});

console.log(`${n} tests passed`);
