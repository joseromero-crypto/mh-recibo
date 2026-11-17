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
const { facNormCode, facComparar, facMismoProveedor } = new Function(block + '\nreturn { facNormCode, facComparar, facMismoProveedor };')();

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
  assert.deepEqual(r.conteo, { no_solicitado: 1, de_mas: 1, no_fisico: 1, por_revisar: 2, no_identificado: 2 });
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

console.log(`${n} tests passed`);
