# Comercial view — plan (draft 2026-11-25)

Comercial gets its own view in MH Recibo: **Calendario**, **Proveedores** and **Códigos**, the same three views as Admin,
with changes that apply to both. v1 has no PIN. A small «Comercial» button sits in the top corner of Inicio.

Status: draft. Items marked **[?]** wait on Jose or comercial (only the Proveedores list is open).

---

## 0. Shell (phase 1)

- Button «Comercial» in the top-right corner of Inicio → `screen-comercial` with 3 tabs. No PIN, nothing remembered
  (rule 7: always opens on Inicio, Calendario tab by default).
- Reuses the Admin renderers: `admCalendario`, `admProveedores`, `admCodigos` take a target element and a `modo`
  ('admin' | 'comercial'), so both views keep the same code. Comercial is **view only**: no Reabrir, no Descargar
  respaldo, no restore. «Ver» on a reception opens the closed view read-only (no «Corregir lo recibido»).
- Proveedores and Códigos are read-only views today, so exposing them without a PIN changes nothing in the data.

## 1. Calendario — «¿Ya tiene entrada en el sistema?»

Scanning it in the app isn't the same as entering it in Retool. Comercial checks every morning that what was received is
now in the system, so the OC can be closed.

### Source (confirmed with a sample, 2026-11-25)
The master «Fill Rate Oc Nacional» (the file the bridge already reads) has a tab **«Resumen»**: compras pastes the
Retool «recibo» page there every day. Same first 13 columns as «Base datos Compras» (the bridge's parser and hub codes
`Con`/`Cu`/`SNG`/`Gpe`/`Zap`/… already handle them): Comprador, Hub, Num Oc, Proveedor, Sku, Item, Cod. Barras, Ud,
Pedido, Cajas, Fecha, **Entrada** (= what was entered in Retool), Status (`Cerrado`), plus Mes, Semana, Ciudad, Costo$,
Pedido$, Entrada$, Facturado$, UUID, Saldo$, Validacion Oc/Factura, Contar Oc (not needed; no money is copied).
- Match: **Num Oc** = our `cerrar.detalle.ocs` (same `C26…` numbers), then the line by **Cod. Barras** = `sku_key`
  (Sku is empty on 1 row in 5, so it isn't used), fallback exact Item name.
- Units: Retool's units, like the OC. Pack lines (`pack_n`) compare Entrada against our Recibido in the OC's unit
  (`pedido_en`).

**Dry run on the sample (7 OCs closed in the app on 2026-11-24, 222 lines, all matched by barcode):**
| OC | Hub · Proveedor | Result |
|---|---|---|
| C2613794 | Cumbres · LALA | green (39 lines, incl. 2 pack lines) |
| C2613780 | Cumbres · Qualtia | green (33) |
| C2613793 | San Nicolás · LALA | green (34) |
| C2642935 | Cumbres · Bimbo | green (29) |
| C2613766 | Contry · Alpura | **red**: «Leche deslactosada Alpura 1L (4 Pack)»: app 0 received (3 paquetes ordered), Retool Entrada 12 |
| C2642932 | Contry · Bimbo | **red**: «Pan cuernitos Tía Rosa 100g»: app 2 received, Retool Entrada 0 |
| C2642940 + C2642941 | San Nicolás · Bimbo + Marinela | **red**: one reception (before the Marinela split) recorded every Marinela product as 0; Retool entered 9 of the 15 (e.g. Barritas de piña 16, Príncipe chocolate 16) |

### Who compares
- **The Apps Script only copies.** `refrescarTodo` already reads the master once per run. It also reads «Resumen»
  (last 30 days, per hub) and writes it to a new table `rec_pd_entradas` (one row per hub: data, hash, leido) through an
  RPC, same pattern and same `SB_SECRET` as `rec_pd_snapshot`. Hash unchanged → only `revisado` moves.
- **The app compares**, where `lineas_todas` and the Kg tolerance already live (testable, works in Modo prueba).
- Frequency: Resumen is pasted once a day and comercial looks in the morning, so **every hour** (07:00–22:00) is plenty.
  The 1-minute timer stays for orders; Resumen runs in it only when ≥ 60 min have passed since the last read.

### Colours (proveedor directo bars)
| State | Meaning |
|---|---|
| dashed (as today) | Reception still open in the app |
| **yellow** | Physical check closed in the app; the OC isn't in «Resumen» yet (no entry in Retool) |
| **green** | OC in «Resumen» and every line: Entrada = our Recibido (Kg: CH tolerance) |
| **red** | OC in «Resumen» but at least one line differs: missing from the entry, quantity different, or entered and not received |

- OCs without a number (`{prov}|{fecha}`) can't be matched → they stay yellow with «sin número de OC».
- Two OCs in one reception: green only if both are green; any red → red.
- Compared against our **Recibido** (what should be invoiced and entered), not against Pedido.
- **CH receptions** (Abarrotes/Carnes) are not in «Resumen» (Jose, 2026-11-25): their bars keep today's colours, and the
  legend says the check is only for suppliers. **Pending:** another source to check CH entries.
- Two directions of red, shown apart: **«Recibido sin entrada»** (app > Entrada: stock that isn't in the system) and
  **«Entrada sin recibir»** (Entrada > app: entered, maybe paid, never received).

### What comercial does with it
- Tap a red bar → the lines that differ: Producto · Recibido en app · Entrada en sistema.
- Above the calendar, a list for **all hubs** (the morning view): «Por dar entrada» (yellow, oldest first) and «Entrada con
  diferencias» (red), each with «Copiar mensaje para el hub».
- «Pings hub»: v1 = a copied Slack message (like «Mensaje para Slack»), tagging the hub with `config/slack.json`.
  Posting to Slack automatically is a later step.

## 2. Proveedores

Same view as Admin. Comercial will look at the CSVs and say what to add or remove. **[?] Waiting for their list.**

Confirmed now: **the date each error happened, in the by-product view.**
- Per-product history on screen already lists each reception; it gets the date + hub on every row with a difference.
- New CSV «Detalle por recepción»: one row per product per reception → Fecha, Hub, Proveedor, OC, Código, SKU Calii,
  Producto, Pedido, Recibido, Faltante, Rechazadas (motivo), Excedente, No solicitado, Cobrado y no entregado.
- The aggregated by-product CSV gets a «Fechas con diferencia» column (e.g. `2026-11-18, 2026-11-21`).

## 3. Códigos — what needs fixing in Retool

Output for both lists: **2 columns ready to paste** into the Retool bulk upload: `SKU Calii` first, then the field to
change. One «Copiar para Retool» button per list (tab-separated, pastes as 2 columns) + the full CSV for context.

### 3a. Barcodes (exists: «Código incorrecto en sistema»)
- SKU Calii: Masterview already has it (`sku` on each entry, e.g. `BGH760`), read through the product's system barcode
  (`codigo_sistema`) → `pickEntry`; fallback by exact name. No SKU found → row marked «sin SKU», left out of the copy.
- Second column: the **scanned** barcode (the one on the physical product).
- Retool holds **one barcode per item** (Jose): pasting replaces the old one. If a package change leaves old and new
  pieces in circulation, the old ones stop scanning. That's a rare case, fixed by hand when it happens; v1 has no guard
  (Jose, 2026-11-25).

### 3b. Supplier codes the invoice couldn't match → Retool «SKU Proveedor»
Unmatched invoice rows mean incomplete reads until Retool has that supplier code under «SKU Proveedor».
- **Source: Invoice Reader's «Sin coincidencia» list.** The sample (2026-11-25, 60 rows) already includes the receptor's
  pick from recibo, so no change is needed on our side. Columns: Proveedor, Ciudad, Clave proveedor, Código de barras,
  Descripción en factura, Motivo, Facturas, Última vez, Hubs, Artículo elegido en recibo, SKU Calii elegido, Sugerencia
  sin confirmar, SKU sugerido.
- How we read it: (b) an action in Invoice Reader's API that returns these rows (we call it like `list`; the change is
  in that repo). Until then, (a) comercial uploads the downloaded file in this view (`recibo/comercial/`).
- Rows, by how sure we are. Nothing counts as 100 % right: a receptor can pick the wrong product. On 2026-11-17 Contry
  matched `*1469` «CIEL AGUA PURIF 600 ML NR PET 6 MPK» to the single bottle (EFC370) while the reader suggested the
  6-pack (ZPR323).
  - **Elegido en recibo** (20 rows): proposal SKU Calii + Clave proveedor, with the invoice description, our product's
    photo and name side by side.
  - **Solo sugerencia** (15): the same, marked «sugerencia del lector».
  - **Sin clave en la factura** (21, «Sin código en la factura»): nothing to load into SKU Proveedor. Listed apart as a
    reader problem (all Arca, Cumbres, 2026-11-11).
  - Rest (4): no product yet → «Buscar producto» (name search) so comercial can choose.
  - «Pruebas de facturas» is left out of Hubs.
- **Comercial confirms each row** (rule 2: no confirm-all). Only confirmed rows go into «Copiar para Retool» (SKU Calii ⇥
  SKU Proveedor). After the paste, «Ya lo cargué en Retool» hides them. Shared state across devices: a new table
  `rec_codigos_fix` (tipo barcode|sku_proveedor, clave, sku, estado confirmado|cargado|descartado, quien, ts), append-only
  (latest per clave wins), with its grants in the same SQL. Barcodes (3a) use the same confirmation.
- Clave proveedor: Retool stores it **without the leading `*`** (Jose, 2026-11-25; e.g. Arca `*796` = `796`). Strip it
  before grouping and in «Copiar para Retool», so `*796` and `796` are one row.

---

## Phases
1. Shell + the three views shared with Admin (view only). No data changes.
2. Códigos 3a: SKU Calii + confirm per row + «Copiar para Retool» (`rec_codigos_fix`).
3. Proveedores: date per error on screen + «Detalle por recepción» CSV. Comercial's list after that.
4. Calendario: Apps Script → `rec_pd_entradas` (Jose runs the SQL and deploys a new version) → colours, morning list,
   copied message. Test: the 2026-11-24 sample above (4 green, 3 red) as a fixture.
5. Códigos 3b: upload of the «Sin coincidencia» file first, then the Invoice Reader API action.

Every phase gets a planted case in Modo prueba (`demoGenerar`) and is tested there; no prod writes.
