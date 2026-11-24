// Pack products in supplier receptions (2026-11-23). Run: node tests/pack.test.mjs
// Evals the FACTURA-PURE block of index.html, where packOf / packN / packPedido live next to the invoice comparison.
// The San Nicolás replay needs the gitignored fixtures/arca-2026-11-20-*.json (real business data); skipped when missing.
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const block = html.slice(html.indexOf('/* FACTURA-PURE:BEGIN'), html.indexOf('/* FACTURA-PURE:END */'));
assert.ok(block.length > 100, 'FACTURA-PURE block not found');
const { packOf, packN, packPedido, packDePiezas, facComparar, facInicio, facObjetivo, facCierre } =
  new Function(block + '\nreturn { packOf, packN, packPedido, packDePiezas, facComparar, facInicio, facObjetivo, facCierre };')();

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('packOf = Invoice Reader lean/match.ts (same cases as its tests)', () => {
  assert.deepEqual(packOf('Refresco Coca Cola Original 355ml (12-pack)'), { n: 12, kind: 'pack' });
  assert.deepEqual(packOf('Leche entera Alpura 1L (4 Pack)'), { n: 4, kind: 'pack' });
  assert.deepEqual(packOf('Jabón de barra azul Escudo 110g 3-pack'), { n: 3, kind: 'pack' });
  assert.deepEqual(packOf('Pack toallitas desinfectantes Clorox 30pz (4-pack)'), { n: 4, kind: 'pack' });
  assert.deepEqual(packOf('Huevo blanco San Juan caja 18pz'), { n: 18, kind: 'contenido' });
  assert.deepEqual(packOf('Flan vainilla LALA 100g / 6pz'), { n: 6, kind: 'contenido' });
  assert.deepEqual(packOf('Chocolates minis Snickers 8.5g (45pz)'), { n: 45, kind: 'contenido' });
  assert.deepEqual(packOf('Avena instantánea Granvita 8 sobres 35g c/u'), { n: 8, kind: 'contenido' });
  assert.equal(packOf('Plátano chiapas racimo (5-7 pz)'), null);
  assert.equal(packOf('Bisquet Nūbe 1pz'), null);
  assert.equal(packOf('Refresco lata Coca Cola 355ml'), null);
  assert.deepEqual(packOf('Bolsas de basura grandes Fácil Pack 20pz'), { n: 20, kind: 'contenido' });
});

test('packN: only N-pack lines change; Kg and contents never', () => {
  assert.equal(packN('Refresco Coca Cola Original 355ml (12-pack)', 'Pz'), 12);
  assert.equal(packN('Huevo blanco San Juan caja 18pz', 'Pz'), 0);
  assert.equal(packN('Refresco lata Coca Cola 355ml', 'Pz'), 0);
  assert.equal(packN('Salchicha (2-pack)', 'Kg'), 0);
});

test('packPedido: not a multiple of N = paquetes, no question', () => {
  assert.deepEqual(packPedido(61, 4), { P: 61, n: 4, en: 'paquetes', pregunta: false, falta: false }); // Alpura 61 on a 4-pack
  assert.deepEqual(packPedido(6, 12), { P: 6, n: 12, en: 'paquetes', pregunta: false, falta: false });
  assert.deepEqual(packPedido(8, 0), { P: 8, n: 0, en: null, pregunta: false, falta: false });       // single item: as before
});

test('packPedido: a multiple of N asks once; the answer sets P in paquetes', () => {
  assert.deepEqual(packPedido(36, 12), { P: null, n: 12, en: null, pregunta: true, falta: true });
  assert.equal(packPedido(36, 12, 'piezas').P, 3);
  assert.equal(packPedido(36, 12, 'paquetes').P, 36);
  assert.equal(packPedido(72, 12, 'piezas').P, 6);
});

test('packDePiezas: whole paquetes only', () => {
  assert.equal(packDePiezas(24, 12), 2);
  assert.equal(packDePiezas(0, 12), 0);
  assert.equal(packDePiezas(30, 12), null);
});

// The OC line and Invoice Reader's record row (contract 1, with the pack fields)
const coca = { rowIndex: 0, producto: 'Refresco Coca Cola Original 355ml (12-pack)', barcode: '7501055300785', sku_key: '7501055300785', kgpz: 'Pz', esperado: 36, sku_marca: '1192' };
const lata = { rowIndex: 1, producto: 'Refresco lata Coca Cola 355ml', barcode: '7501055300075', sku_key: '7501055300075', kgpz: 'Pz', esperado: 24, sku_marca: '59' };
const row = (sourceRow, l, piezas, extra = {}) => ({ sourceRow, matchKeys: [l.barcode, l.sku_marca], piezas, confident: true, quantityOk: true,
  productName: l.producto, printedDescription: l.producto.toUpperCase(), printedCodes: [], candidates: [], ...extra });
const cocaRow = row(1, coca, 3, { packKind: 'pack', packSize: 12, retoolUnit: 'paquete', piezasSueltas: 36 });
const lataRow = row(2, lata, 24, { packKind: null, packSize: null, retoolUnit: 'pieza', piezasSueltas: null });

test('invoice in paquetes: CAJAS 3 / PIEZAS 36 vs OC 36 answered «3 paquetes (36 piezas)» → nothing to report', () => {
  const ini = facInicio(facComparar({ lines: [coca, lata], todas: [], rows: [cocaRow, lataRow] }));
  const x = ini.lineas.find(l => l.sku_key === coca.sku_key);
  assert.equal(x.facturado, 3);
  assert.equal(x.pack_n, 12);
  assert.equal(x.piezas_sueltas, 36);
  const P = packPedido(coca.esperado, packN(coca.producto, coca.kgpz), 'piezas').P;
  assert.deepEqual(facObjetivo(x, P), { obj: 3, fac: 3, de_mas: 0 });
  const c = facCierre(ini, [{ sku_key: coca.sku_key, pedido: 3, recibido: 3, kgpz: 'Pz', pack_n: 12 }, { sku_key: lata.sku_key, pedido: 24, recibido: 24, kgpz: 'Pz' }]);
  assert.equal(c.flagged.length, 0, 'no «cobradas que no llegaron»');
  assert.ok(c.limpia);
});

test('the same invoice against «36 paquetes»: 33 paquetes not billed, nothing billed above the OC', () => {
  const ini = facInicio(facComparar({ lines: [coca], todas: [], rows: [cocaRow] }));
  const x = ini.lineas[0];
  assert.deepEqual(facObjetivo(x, 36), { obj: 3, fac: 3, de_mas: 0 });
});

test('a pack row nobody is sure of (picked by hand, no paquete unit) is «cantidad por revisar»', () => {
  const picked = row(1, coca, 36, { matchKeys: [], confident: false, packKind: null, packSize: null, retoolUnit: null, piezasSueltas: null });
  const c = facComparar({ lines: [coca], todas: [{ sku_key: coca.sku_key, pedido: 3, recibido: 3 }], rows: [picked], picks: { 1: coca.sku_key } });
  assert.equal(c.lineas[0].revisar, 'cantidad');
  assert.equal(c.no_fisico, undefined);
});

test('old record rows (no packKind) are compared as before', () => {
  const old = row(1, coca, 36);
  const c = facComparar({ lines: [coca], todas: [{ sku_key: coca.sku_key, pedido: 36, recibido: 36 }], rows: [old] });
  assert.equal(c.lineas[0].revisar, undefined);
  assert.equal(c.flagged.length, 0);
});

test('single items: no pack fields anywhere', () => {
  const c = facComparar({ lines: [lata], todas: [{ sku_key: lata.sku_key, pedido: 24, recibido: 24 }], rows: [lataRow] });
  assert.equal(c.lineas[0].pack_n, undefined);
  assert.equal(c.lineas[0].piezas_sueltas, undefined);
  assert.ok(c.limpia);
});

// Replay of the incident: MH San Nicolás, Arca, 2026-11-20 (session …__1795194586816). The OC asked 36 «Pz» of the 12-pack,
// 3 paquetes arrived and the receptor marked «llegaron 3»: the app said 33 faltan and «33 cobradas que no llegaron».
const fx = f => join(root, 'fixtures', f);
if (['arca-2026-11-20-envio.json', 'arca-2026-11-20-events.json'].every(f => existsSync(fx(f)))) {
  test('San Nicolás 2026-11-20 replay: Completo with 3 paquetes · 36 piezas, no «cobradas que no llegaron»', () => {
    const envio = JSON.parse(readFileSync(fx('arca-2026-11-20-envio.json'), 'utf8'));
    const events = JSON.parse(readFileSync(fx('arca-2026-11-20-events.json'), 'utf8'));
    const l = envio.lines.find(x => /Coca Cola Original 355ml \(12-pack\)/.test(x.producto));
    assert.equal(l.esperado, 36);
    const old = events.filter(e => e.tipo === 'factura').pop().detalle.lineas.find(x => x.sku_key === l.sku_key);
    assert.equal(old.no_fisico, 33, 'what the app said that day');
    const N = packN(l.producto, l.kgpz);
    assert.equal(N, 12);
    const pk = packPedido(l.esperado, N);
    assert.ok(pk.falta, '36 on a 12-pack asks paquetes or piezas');
    const P = packPedido(l.esperado, N, 'piezas').P;                     // «3 paquetes (36 piezas)»
    assert.equal(P, 3);
    // Invoice Reader's rebuilt record: CAJAS 3 / PIEZAS 36 → piezas 3, piezasSueltas 36
    const rows = [row(1, l, 3, { packKind: 'pack', packSize: 12, retoolUnit: 'paquete', piezasSueltas: 36 })];
    const ini = facInicio(facComparar({ lines: envio.lines, todas: [], rows }));
    const o = facObjetivo(ini.lineas[0], P);
    assert.equal(o.obj, 3, 'Completo means 3 paquetes');
    const recibido = o.obj;                                             // Completo
    assert.equal(recibido * N, 36, '3 paquetes · 36 piezas');
    const fin = facCierre(ini, [{ sku_key: l.sku_key, pedido: P, recibido, kgpz: 'Pz', pack_n: N }]);
    assert.equal(fin.lineas[0].no_fisico, 0);
    assert.equal(fin.conteo.no_fisico, 0, 'no «cobradas que no llegaron»');
    // The other 12-pack of that order (vidrio, 72 = 6 × 12) asks too; the single cans don't
    const vidrio = envio.lines.find(x => /vidrio Coca Cola 235ml \(12-pack\)/.test(x.producto));
    assert.ok(packPedido(vidrio.esperado, packN(vidrio.producto, vidrio.kgpz)).falta);
    for (const x of envio.lines.filter(x => !/pack/i.test(x.producto))) assert.equal(packN(x.producto, x.kgpz), 0, x.producto);
  });
} else console.log('skip San Nicolás replay (fixtures/arca-2026-11-20-*.json missing)');

console.log(`${n} tests passed`);
