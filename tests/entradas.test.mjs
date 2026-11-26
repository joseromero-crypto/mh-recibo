// Closed supplier reception vs Retool «Entrada» (comercial-plan §1). Run: node tests/entradas.test.mjs
// Evals the ENTRADAS-PURE block of index.html. The 2026-11-24 replay needs the gitignored fixture
// fixtures/entradas-2026-11-24.json (real closes from prod + a «Resumen» rebuilt from the plan's dry run); skipped when missing.
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const block = html.slice(html.indexOf('/* ENTRADAS-PURE:BEGIN'), html.indexOf('/* ENTRADAS-PURE:END */'));
assert.ok(block.length > 100, 'ENTRADAS-PURE block not found');
const { entComparar, entCodigo, entRecibidoOC } = new Function(block + '\nreturn { entComparar, entCodigo, entRecibidoOC };')();

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const L = (sku_key, producto, recibido, o = {}) => Object.assign({ sku_key, producto, kgpz: 'Pz', pedido: recibido, recibido }, o);
const data = ocs => ({ ocs });

test('codes: leading zeros, spaces, .0', () => {
  assert.equal(entCodigo('0075010'), '75010');
  assert.equal(entCodigo('7501 055'), '7501055');
  assert.equal(entCodigo('7501055.0'), '7501055');
  assert.equal(entCodigo(''), '');
});

test('no OC number → sin_oc; no lines → sin_detalle', () => {
  assert.equal(entComparar({ num_oc: [], lineas_todas: [] }, null).estado, 'sin_oc');
  assert.equal(entComparar({ num_oc: ['C1'] }, null).estado, 'sin_detalle');
});

test('OC not in Resumen yet → amarillo', () => {
  const r = entComparar({ num_oc: ['C1'], lineas_todas: [L('7501', 'Leche', 5)] }, data({}));
  assert.equal(r.estado, 'amarillo'); assert.deepEqual(r.faltan, ['C1']);
  assert.equal(entComparar({ num_oc: ['C1'], lineas_todas: [L('7501', 'Leche', 5)] }, null).estado, 'amarillo');
});

test('every line equal → verde (barcode with leading zero, name fallback, faltante 0 = 0)', () => {
  const rec = { num_oc: ['C1'], lineas_todas: [L('7501', 'Leche', 5), L('name:pan dulce', 'Pan dulce', 3), L('7502', 'Queso', 0, { pedido: 4, faltante: 4 })] };
  const r = entComparar(rec, data({ C1: { l: [['07501', 'LECHE 1L', 5, 'Pz'], ['', 'Pan dulce', 3, 'Pz'], ['7502', 'Queso', 0, 'Pz']] } }));
  assert.equal(r.estado, 'verde', JSON.stringify(r.difs));
});

test('both directions of red', () => {
  const rec = { num_oc: ['C1'], lineas_todas: [L('1', 'A', 5), L('2', 'B', 0, { pedido: 3, faltante: 3 }), L('3', 'C', 2)] };
  const r = entComparar(rec, data({ C1: { l: [['1', 'A', 3, 'Pz'], ['2', 'B', 3, 'Pz'], ['4', 'D', 6, 'Pz']] } }));
  assert.equal(r.estado, 'rojo');
  const by = Object.fromEntries(r.difs.map(d => [d.producto, d]));
  assert.equal(by.A.dir, 'sin_entrada'); assert.equal(by.A.entrada, 3);
  assert.equal(by.B.dir, 'sin_recibir');
  assert.equal(by.C.dir, 'sin_entrada'); assert.equal(by.C.entrada, 0);   // received, not on the entry at all
  assert.equal(by.D.dir, 'sin_recibir');                                  // entered, not in our reception
});

test('Kg within CH tolerance is equal; beyond it is red', () => {
  const rec = { num_oc: ['C1'], lineas_todas: [L('1', 'Pollo', 2.0, { kgpz: 'Kg' })] };
  assert.equal(entComparar(rec, data({ C1: { l: [['1', 'Pollo', 2.08, 'Kg']] } })).estado, 'verde');
  assert.equal(entComparar(rec, data({ C1: { l: [['1', 'Pollo', 2.4, 'Kg']] } })).estado, 'rojo');
});

test('pack line ordered in piezas compares recibido × pack_n; ordered in paquetes compares as is', () => {
  const pz = L('1', 'Leche (4 Pack)', 3, { pack_n: 4, pedido_en: 'piezas' }), pq = L('2', 'Light (4 Pack)', 61, { pack_n: 4, pedido_en: 'paquetes' });
  assert.equal(entRecibidoOC(pz), 12); assert.equal(entRecibidoOC(pq), 61);
  assert.equal(entComparar({ num_oc: ['C1'], lineas_todas: [pz, pq] }, data({ C1: { l: [['1', 'x', 12, 'Pz'], ['2', 'y', 61, 'Pz']] } })).estado, 'verde');
});

test('no solicitado is ignored; repeated code in Resumen is summed', () => {
  const rec = { num_oc: ['C1'], lineas_todas: [L('1', 'A', 6), L('9', 'Z', 0, { no_solicitado: true, pedido: 0 })] };
  assert.equal(entComparar(rec, data({ C1: { l: [['1', 'A', 4, 'Pz'], ['1', 'A', 2, 'Pz']] } })).estado, 'verde');
});

test('two OCs: one missing → amarillo unless a found line already differs', () => {
  const rec = { num_oc: ['C1', 'C2'], lineas_todas: [L('1', 'A', 5), L('2', 'B', 4)] };
  const r = entComparar(rec, data({ C1: { l: [['1', 'A', 5, 'Pz']] } }));
  assert.equal(r.estado, 'amarillo'); assert.deepEqual(r.faltan, ['C2']); assert.equal(r.difs.length, 0); // B may be on C2
  assert.equal(entComparar(rec, data({ C1: { l: [['1', 'A', 2, 'Pz']] } })).estado, 'rojo');
  assert.equal(entComparar(rec, data({ C1: { l: [['1', 'A', 5, 'Pz']] }, C2: { l: [['2', 'B', 4, 'Pz']] } })).estado, 'verde');
});

const fx = join(root, 'fixtures', 'entradas-2026-11-24.json');
if (existsSync(fx)) {
  test('2026-11-24 dry run: 4 green, 3 red (comercial-plan §1)', () => {
    const F = JSON.parse(readFileSync(fx, 'utf8'));
    const got = {};
    for (const c of F.closes) got[c.num_oc[0]] = entComparar(c, F.entradas[c.hub]);
    for (const [oc, want] of Object.entries(F.espera)) assert.equal(got[oc].estado, want, oc + ' ' + JSON.stringify(got[oc].difs));
    const d = (oc, p) => got[oc].difs.find(x => x.producto.includes(p));
    assert.deepEqual([d('C2613766', 'deslactosada Alpura 1L (4 Pack)').recibido, d('C2613766', 'deslactosada Alpura 1L (4 Pack)').entrada], [0, 12]);
    assert.equal(got.C2613766.difs.length, 1);
    assert.deepEqual([d('C2642932', 'cuernitos').recibido, d('C2642932', 'cuernitos').entrada, d('C2642932', 'cuernitos').dir], [2, 0, 'sin_entrada']);
    assert.equal(got.C2642932.difs.length, 1);
    assert.equal(got.C2642940.difs.length, 9);                         // 9 Marinela products entered, none received
    assert.ok(got.C2642940.difs.every(x => x.dir === 'sin_recibir' && x.recibido === 0));
    assert.equal(d('C2642940', 'Barritas de piña').entrada, 16);
  });
} else console.log('skip 2026-11-24 dry run (fixtures/entradas-2026-11-24.json missing)');

console.log(`${n} tests passed`);
