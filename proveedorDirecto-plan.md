# MH Recibo — Proveedor Directo plan

Status: plan only, written 2026-11-12 from the MH Contry sheet ("Recepcion Contry") and Jose's answers. Nothing
built yet. Read `mhRecibo-v1-plan.md` and `CLAUDE.md` first: everything here reuses that app and only lists what
changes.

## 1. Why

- Some orders reach the micro hubs straight from the supplier, not from CH Guadalupe.
- Today each hub has its own Google Sheet ("Recepcion {Hub}"). The commercial team feeds it with the week's orders,
  and the receptor scans in the tab «Recepción diaria». The sheet shows how many pieces were ordered (or «PNS»,
  producto no solicitado), the minimum expiry date and the temperature.
- That sheet has no received count. Receptors count on the invoice by hand or not at all.
- Goal: the same blind reception as CH, as a second kind of reception in the same app. Commercial keeps working in
  their sheets; the app only reads them. At the end the hub gets a report with what was ordered, invoiced, received
  and rejected.

## 2. What the sheet holds (Contry, 2026-11-12)

| Tab | Columns | Use |
|---|---|---|
| **OC Con** (copy of **Base Oc**) | Comprador, Cedis (`Con`), Proveedor, Sku Marca, Item, Cod. Barras, Und. (Pz/Kg), **Pedido**, Cajas, **Fecha de entrega** (dd/mm/yyyy), **Fecha de Caducidad** (minimum expiry accepted), **Temp**, Imagen, Comercial, Nuevo | The order lines = the "envío" |
| **Inv Mty** | Cód. de barras, Producto, Proveedor, Kg/Pz, Source price, V Anaquel, Temp, Imagen | Catalog for PNS and "Sin código" (Monterrey) |
| **Encargados** | Proveedor → Comercial, Comercial (Nuevo) | Who to contact about a supplier |
| Recepción diaria | Scan lookup sheet | Replaced by the app |
| Productos Nuevos | New products, min days | Not needed in v1 |

Quirks the reader must handle:
- **Temp** is `1` (refrigerado), `-18` (congelado) or `Ambiente`. In OC Con the cell `1` is formatted as a date and
  reads «31 de diciembre de 1899»: a Date equal to 1899-12-31 means 1.
- **Fecha de Caducidad** reads as a long Spanish date in the UI; read the raw value (`getValues()` gives a Date).
- **Fecha de entrega** is dd/mm/yyyy text or a Date — normalize to YYYY-MM-DD.
- Base Oc is fed by a master file Jose can't open yet (§10, Q1).

## 3. Decisions (Jose, 2026-11-12)

1. **Blind count stays.** The receptor never sees Pedido while scanning (same as CH: only in Resumen y cierre and
   Recepciones).
2. **Supplier list comes from the orders**, not a hand-kept list.
3. **Early or late is fine.** Any open order for the supplier shows up whatever its date.
   - Date ≠ today → inline warning: «La orden de {Proveedor} está programada para el {fecha}. Puedes empezar la
     recepción; contacta a {Comercial} para confirmar que sea correcta.»
   - No order at all → «No hay orden cargada para {Proveedor}. Contacta a {Comercial}.» (Comercial from Encargados.)
4. **Temperature is shown only** (target temp on the card). The receptor checks the truck; nothing is typed.
5. **Nothing is written to the sheets.** The app's Recepciones + Slack message are the report.
6. **Rechazo instead of MNA.** Unlike CH, unfit pieces are **rejected** (go back on the truck) and are not received.
   CH rule 8 (everything that arrived is received, fecha corta → MNA) stays CH-only.
7. **The invoice is a separate number.** Suppliers sometimes deliver and invoice more than ordered on purpose.

## 4. Quantities per product

| Name | Who gives it | Meaning |
|---|---|---|
| **Pedido** | sheet | Ordered |
| **Entregado** | receptor's scan + count (blind) | Physically arrived |
| **Rechazado** | receptor, "Rechazar" button under the quantity (like Separar), with motivo | Returned to the truck |
| **Recibido** | computed: Entregado − Rechazado | Goes into stock |
| **Factura** | receptor, in Resumen y cierre | What the invoice bills |

- Rechazar motivos: **Fecha corta** (below Fecha de Caducidad), **Dañada**, **Excedente** (more than ordered),
  **No solicitado** (PNS), **Temperatura**, **Otro**.
- Excess: when Entregado > Pedido, the card says «Llegó más de lo pedido» and asks *aceptar* or *rechazar el
  excedente* (default: rechazar unless commercial approved — §10, Q3). This is the one place the count stops being
  fully blind, and only after the count is typed.
- Factura: in Resumen y cierre, every line where Entregado ≠ Pedido asks «¿Cuántas dice la factura?» (typed, no
  prefill — rule 2). Before closing, one more number: **total de piezas en la factura**. If it differs from the
  sum of the lines, the receptor checks lines where the invoice may bill more than what matched (catches over-billing
  on lines that looked fine).
- Slack line per product with a difference:
  `Queso panela LALA 400g — Pedido 10 · Factura 15 · Entregado 15 · Recibido 10 · Rechazado 5 (excedente)`

## 5. The bridge: Apps Script web app

A standalone Apps Script owned by Jose (`proveedor/apps-script.gs` in this repo, like `alertas/`), deployed as a
web app, *execute as me*, access *anyone* + a shared token checked on every call (the URL alone must not expose
orders). Read-only: it never writes to any sheet.

`GET ?token=…&hub=mh-contry` returns, for that hub:

```json
{
  "leido": "2026-11-12T15:02:11Z",
  "ordenes": [ { "proveedor": "LALA", "fecha_entrega": "2026-11-12", "comercial": "…",
                 "lineas": [ { "codigo": "7501020513134", "sku_marca": "1271", "producto": "Crema ácida entera LALA 200ml",
                               "kgpz": "Pz", "pedido": 10, "caducidad_min": "2026-12-09", "temp": "1", "nuevo": false } ] } ],
  "encargados": { "LALA": "…" },
  "proveedores": [ "2 Villas", "Absormex", "…" ]
}
```

- Config inside the script: `{ "mh-contry": { "file": "<id>", "tab": "OC Con" }, … }` — or, once there is access to
  the master, `{ "master": "<id>", "cedis": { "mh-contry": "Con", … } }` (one file instead of seven).
- Window: lines with Fecha de entrega from today − 14 to today + 14. Which of them were already received is the
  app's job (§6.4), not the script's.
- Inv Mty (4.9k rows) is not sent on every call: the app uses Masterview for PNS and "Sin código" names/photos, and
  the script sends only `proveedores` (for the "otro proveedor" list) and, per supplier on demand
  (`&catalogo=LALA`), that supplier's Inv Mty rows (Kg/Pz, Temp, V Anaquel).
- `CacheService` keeps the parsed answer 2 minutes per hub so several phones starting at once don't re-read.

## 6. App changes

### 6.1 Inicio
- New first step: **CH Guadalupe** | **Proveedor directo**. CH continues exactly as today.
- Proveedor directo: Hub → ¿Quién recibe? → **¿Qué proveedor llegó?**
  - On reaching this step the app calls the script (this is "the read on start").
  - List: suppliers with open orders, newest delivery date first: «LALA · 14 productos · entrega hoy», «Peñafiel ·
    6 productos · programada jue 14». Already-received orders appear greyed with «recibida {fecha}».
  - «Otro proveedor» → search in `proveedores` → no order → the §3.3 warning; the reception can still start with an
    empty order (everything is PNS) (§10, Q2).
  - Picking a supplier shows the date warning when needed (inline, not a modal) and **Empezar recepción**.
- Open supplier receptions of this hub are listed at the top with «Continuar».

### 6.2 Snapshot = envío
- Empezar recepción writes `envios/{slug}/pd-{prov}/{fecha}__{epochMs}.json` with the lines, the supplier's catalog,
  `orden: { proveedor, fechas_entrega:[…], leido }` and `origen:'proveedor'`. From then on the reception checks
  against this copy, even if commercial edits the sheet.
- **Área id = `pd-{provSlug}`** (e.g. `pd-lala`). Every hub+área keyed thing (folders, mirrors, `rec_events.area`,
  closedState, borrar, parciales, alerts) then works per supplier without new plumbing. `areaName('pd-lala')` →
  «LALA». Several orders of the same supplier (e.g. Tue + Thu) in the window: the receptor picks which ones arrived
  (default: the nearest date) and their lines are summed.

### 6.3 Recibir
- Same screen, scan, count, guards (typo, hermanos, Kg), Sin código, Pendientes. Canastas/sorting positions: same as
  today where the hub has them.
- Card extras: **Temp** chip (Ambiente / Refrigerado 1 °C / Congelado −18 °C), **Caducidad mínima {fecha}** from the
  sheet (no `vida_dias` math), **Rechazar** button (§4) instead of Fecha corta / Dañadas.
- Not in the order → «Producto no solicitado (PNS)» (the existing not-in-envío modal, reworded) with *Recibir* or
  *Rechazar*.
- The over-pedido guard becomes the Excedente question (§4).
- No Armado enrichment, no origen-de-la-diferencia classification.

### 6.4 Resumen y cierre, Recepciones, Slack
- Resumen: Pedido / Entregado / Rechazado / Recibido, Factura asked per §4, then total de piezas en factura, then
  Cerrar. Discrepancies acknowledged one by one (rule 2) as today.
- Report CSV `reportes/{hub}/pd-{prov}/…csv`: Código, Producto, Und, Pedido, Factura, Entregado, Rechazado, Motivo,
  Recibido, Caducidad mínima, Temp.
- `cerrar` detalle adds `proveedor`, `fechas_entrega`, `factura_total`, `rechazadas`.
- An order counts as received once a closed `pd-*` session lists its `fecha_entrega` (that greys it in §6.1).
- Slack message: header «{Hub} · {Proveedor} · entrega {fecha}», the §4 lines, then the tags of the supplier's
  Comercial (Slack username map in `config/slack.json`, new key `comerciales`).

### 6.5 Calendario and Admin
- Calendario: a third bar style for Proveedor directo (teal-light fill, teal-dark text, label = supplier). No new hue.
- Admin → Recepciones lists `pd-*` sessions like the others. Alerts (`sin_cerrar`) apply as today.

## 7. Events

- New in `scan` detalle: `rechazado`, `motivo_rechazo`, `excedente:'aceptado'|'rechazado'`, `pns:true`.
- Rechazar after the scan: `ajuste` with `cantidad:0` + `detalle.rechazar` (latest wins), like Separar.
- New `confirmacion` with `factura` (per sku) and `factura_total`.
- `fold()` unchanged: Entregado = scans + ajustes. Recibido = Entregado − rechazado, computed where shown.

## 8. Build phases (each ends with a localhost check on `test-hub`)

0. Jose: access to the master file or the 7 hub file ids; token; who owns the script (§10).
1. Apps Script: read one hub, normalize dates/temp, JSON shape of §5. Tested with the Contry file.
2. Inicio flow (CH / Proveedor directo, supplier list, warnings) + snapshot to storage.
3. Recibir: temp chip, caducidad from the sheet, Rechazar, PNS, Excedente.
4. Resumen: Pedido/Entregado/Rechazado/Recibido, Factura, total factura, report CSV, cerrar.
5. Recepciones, Slack message, Calendario, Admin.
6. Real-device QA at MH Contry next to the Google Sheet, with one supplier delivery.

## 9. Not in v1

- Writing anything back to the sheets or Retool.
- Measured temperature, photos of rejected goods.
- Reading the invoice automatically (Invoice Reader could fill Factura later).
- Prices / invoice money totals.

## 10. Open questions (defaults in bold until Jose answers)

1. **Source**: ask commercial for **read (Viewer) access to the master file** behind Base Oc → one file instead of
   seven, and we need each hub's Cedis code (`Con` = Contry; others?). Until then, the 7 hub file ids.
2. Supplier without an order: **can still be received (all PNS), flagged in the report** — or blocked until commercial
   loads the order?
3. Excedente default: **rechazar**, unless the receptor taps *aceptar* (commercial agreed on the phone)?
4. Factura per line: **only lines where Entregado ≠ Pedido + one invoice total** — or every line?
5. Does commercial need the report somewhere other than Slack (email, a shared folder)? Default **Slack only**.
