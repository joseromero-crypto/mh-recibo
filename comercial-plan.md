# Comercial view — plan (draft 2026-11-25)

Comercial gets its own view in MH Recibo: **Calendario**, **Proveedores** and **Códigos**, the same three views as Admin,
with changes that apply to both. v1 has no PIN. A small «Comercial» button sits in the top corner of Inicio.

Status: draft. Items marked **[?]** wait on Jose or comercial.

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

### Source
The master «Fill Rate Oc Nacional» (the same file the bridge already reads) has a tab **«Resumen»**. Compras pastes the
Retool «recibo» page there every day. The bridge's notes already say an OC closed in Retool leaves «Base datos Compras»
and moves to «Resumen» as Cerrado. **[?] Column list of «Resumen»**: I'm assuming Num Oc, Hub, Sku / Cod. Barras,
Pedido, Entrada (= captured into Retool), Status, Fecha. A screenshot or 10 rows is enough.

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

- Match key: `num_oc` (a pd reception stores its OCs in `cerrar.detalle.ocs`). OCs without a number (`{prov}|{fecha}`)
  can't be matched → they stay yellow with «sin número de OC».
- Two OCs in one reception: green only if both are green; any red → red.
- Compared against our **Recibido** (what should be invoiced and entered), not against Pedido.
- **[?] CH receptions** (Abarrotes/Carnes, transfers from CH Guadalupe) have no OC. Do they appear in «Resumen»? If not,
  their bars keep today's colours and the legend says so.

### What comercial does with it
- Tap a red bar → the lines that differ: Producto · Recibido en app · Entrada en sistema.
- Above the calendar, a list for **all hubs** (the morning view): «Por dar entrada» (yellow, oldest first) and «Entrada con
  diferencias» (red), each with «Copiar mensaje para el hub».
- **[?] «Pings hub»**: v1 = a copied Slack message (like «Mensaje para Slack»), tagging the hub with `config/slack.json`.
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
- **[?]** Retool holds one barcode per item? If yes, pasting replaces the old one. If the old barcode is also valid (two
  versions of the package), replacing it breaks the other. v1 lists both codes so comercial decides.

### 3b. Supplier codes the invoice couldn't match
Unmatched invoice rows mean incomplete reads until Retool knows that supplier code.
- **Our own data, with the answer included:** when a receptor picks the product for an unidentified invoice row
  («Es otro de la orden», `picks`), we know `supplier code → our product → SKU Calii`. That's the fix itself. Today
  `factura.detalle.picks` stores `sourceRow → sku_key` only, so the printed code isn't kept: from now on each pick
  also saves the row's code and description (small change; old picks can be re-read from Invoice Reader by read_id).
- **Invoice Reader's CSV** (no-match rows, no answer): two options —
  - (a) comercial uploads that CSV in this view (stored in `recibo/comercial/`) and it's listed under 3a/3b;
  - (b) Invoice Reader adds an `unmatched` action to its API and we read it like `list` (change in the Invoice Reader
    repo, not here).
  **[?] Send a sample of that CSV.** Recommendation: our picks first (they carry the SKU); (b) next, (a) only if (b) waits.
- **[?] Retool field name** for the supplier code (the second column of that bulk upload).

---

## Phases
1. Shell + the three views shared with Admin (view only). No data changes.
2. Códigos: SKU Calii + «Copiar para Retool»; picks save the printed code; list 3b from our picks.
3. Proveedores: date per error on screen + «Detalle por recepción» CSV. Comercial's list after that.
4. Calendario: Apps Script → `rec_pd_entradas` (needs the Resumen columns; Jose runs the SQL and deploys) → colours,
   morning list, copied message.
5. Invoice Reader's no-match list (after its CSV sample / API).

Every phase gets a planted case in Modo prueba (`demoGenerar`) and is tested there; no prod writes.
