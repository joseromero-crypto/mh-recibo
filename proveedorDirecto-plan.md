# MH Recibo — Proveedor Directo plan

Status: plan only. Written 2026-11-12 from the MH Contry sheet ("Recepcion Contry") and Jose's answers (two rounds,
same day). Nothing built yet. Read `mhRecibo-v1-plan.md` and `CLAUDE.md` first: everything here reuses that app and
only lists what changes.

## 1. Why

- Some orders reach the micro hubs straight from the supplier, not from CH Guadalupe.
- Today each hub has its own Google Sheet ("Recepcion {Hub}"). The commercial team feeds it with the week's orders,
  and the receptor scans in the tab «Recepción diaria». The sheet shows how many pieces were ordered (or «PNS»,
  producto no solicitado), the minimum expiry date and the temperature.
- That sheet has no received count. Today nothing is reported on Slack either: the hub shares a photo of the invoice.
- Goal: the same blind reception as CH, as a second kind of reception in the same app. Commercial keeps working in
  their sheets; the app only reads them. At the end the hub has a report with what was ordered, received and
  rejected, ready to type into Retool, plus a generated Slack message.

## 2. What the sheet holds (Contry, 2026-11-12)

| Tab | Columns | Use |
|---|---|---|
| **OC Con** (copy of **Base Oc**) | Comprador, Cedis (`Con`), Proveedor, Sku Marca, Item, Cod. Barras, Und. (Pz/Kg), **Pedido**, Cajas, **Fecha de entrega** (dd/mm/yyyy), **Fecha de Caducidad** (minimum expiry accepted), **Temp**, Imagen, Comercial, Nuevo | The order lines = the "envío" |
| **Inv Mty** | Cód. de barras, Producto, Proveedor, Kg/Pz, Source price, V Anaquel, Temp, Imagen | Supplier list for "otro proveedor"; names/units for products not in the order |
| **Encargados** | Proveedor → Comercial, Comercial (Nuevo); plus a contacts table (Área, Nombre, Teléfono) for Comercial and Compras | Who to contact (§3.3) |
| Recepción diaria | Scan lookup sheet | Replaced by the app |
| Productos Nuevos | New products, min days, Encargado, Comprador | Fallback for supplier → comprador |

Quirks the reader must handle:
- **Temp** is `1` (refrigerado), `-18` (congelado) or `Ambiente`. In OC Con the cell `1` is formatted as a date and
  reads «31 de diciembre de 1899»: a Date equal to 1899-12-31 means 1.
- **Fecha de Caducidad** reads as a long Spanish date in the UI; read the raw value (`getValues()` gives a Date).
- **Fecha de entrega** is dd/mm/yyyy text or a Date — normalize to YYYY-MM-DD.
- Base Oc is fed by a master file Jose can't open yet (§10, Q1).

## 3. Decisions (Jose, 2026-11-12)

1. **Blind count stays.** The receptor never sees Pedido while scanning — except in the one alert of §4 (recibido
   over pedido), which appears only after the count is typed.
2. **Supplier list comes from the orders**, not a hand-kept list.
3. **Contacts = Comercial and Compras.** Every warning names both: the Comercial from Encargados and the Comprador
   from the order lines (column Comprador; if the supplier has no lines, the last comprador seen for it in the
   sheet, then Productos Nuevos). Phones from the Encargados contacts table become a «Llamar» link (`tel:`), never
   copied into reports or Slack.
4. **Early or late is fine.** Any open order for the supplier shows up whatever its date. Date ≠ today → inline
   warning: «La orden de {Proveedor} está programada para el {fecha}. Puedes empezar la recepción; contacta a
   {Comercial} (comercial) o {Comprador} (compras) para confirmar que sea correcta.»
5. **No order → no reception.** «No hay orden cargada para {Proveedor}. Contacta a {Comercial} o {Comprador}.»
   The receptor can't start until the order shows up. A **«Volver a leer la orden»** button re-reads the sheet,
   because compras will be loading it by hand while the truck waits.
6. **We trust the order 100 %.** If the order exists and a product isn't in it, that product is **rejected
   automatically** — nobody is called. Comercial/Compras are contacted only when the whole order is missing or
   clearly the wrong one (§6.3). (The compras agreement — no answer in 10 minutes → reject — applies to that call.)
7. **Temperature is shown only** (target temp on the card). The receptor checks the truck; nothing is typed.
8. **Nothing is written to the sheets or Retool.** Report = Recepciones view (to type into Retool by hand) + a
   generated Slack message (copy button; may or may not be used).
9. **Rechazo instead of MNA.** Unlike CH, unfit pieces are **rejected** (go back on the truck) and are not received.
   CH rule 8 (everything that arrived is received, fecha corta → MNA) stays CH-only.
10. **The receptor counts physical pieces, never the invoice.** Suppliers deliver less than they invoice and more
    than was ordered. The app tells the receptor, before the truck leaves, what to reject and what to have corrected
    on the invoice, so Calii is never charged for more than it received nor more than it ordered. A typed invoice
    count (or merging Invoice Reader in here) is a later phase (§9).

## 4. Counting: three cases, one number typed

**The one rule the receptor learns:** *count the pieces you accept and type that number.* While counting, anything
unfit (fecha corta, dañada) is set aside and **not counted**. There is no Rechazar button on the card and no second
number to type while scanning.

The app compares the count with Pedido and there are only three outcomes:

| Case | What happens | Recorded |
|---|---|---|
| **Count = Pedido** | Nothing. | Recibido = count |
| **Count > Pedido** | At once, on the card: «Solo se solicitaron 8 piezas. Separa 4 para rechazo.» The only ways on are **«Ya separé las 4»** or correcting the count. Not in the order (Pedido 0): «No se solicitó: separa las {n} para rechazo». | Recibido = Pedido, **Excedente** = count − Pedido |
| **Count < Pedido** | In Resumen y cierre, line by line (rule 2): «Se pidieron 8, contaste 6. ¿Qué pasó con las 2?» → **«No llegaron»** or **«Rechacé piezas»** → how many + motivo (Fecha corta / Dañada). The rest of the gap is Faltante. | Recibido = count, **Rechazadas** (+ motivo), **Faltante** |

- Excedente and Rechazadas never appear on the same line: excess exists only above Pedido, rejections are asked only
  below it. A broken piece in an over-delivery is just part of what gets separated.
- The shortfall question waits for Resumen (not the card) because a product can arrive in several boxes / scans;
  the over-Pedido alert can't wait because the excess must be physically separated while counting.
- Rechazadas asked in Resumen: 1 up to the gap (Pedido − count) per line. Pieces rejected beyond the gap would have
  been excedente anyway.
- Kg: CH's over-enviado tolerance (±max(5 %, 0.10 kg)) before anything counts as excedente or short.
- Typo guard (as CH) runs before the over-Pedido alert.
- Both alerts reveal Pedido for that one product, only after the count is typed. Everything else stays blind.

**Before the truck leaves** (Resumen y cierre), the list to settle with the driver:
- **Devolver**: excedente and rechazadas per product, with the motivo.
- **Faltan {n}: que no se facture.**
- **Facturar: {Recibido}** per product — never more than received, never more than ordered.

Report / Slack line per product with a difference (one of the two shapes):
- `Queso panela LALA 400g — Pedido 8 · Recibido 8 · Excedente 4 (devuelto) · Facturar 8`
- `Crema ácida LALA 200ml — Pedido 10 · Recibido 6 · Rechazadas 1 (dañada) · Faltan 3 · Facturar 6`

## 5. The bridge: Apps Script web app

A standalone Apps Script owned by Jose (`proveedor/apps-script.gs` in this repo, like `alertas/`), deployed as a
web app, *execute as me*, access *anyone* + a shared token checked on every call (the URL alone must not expose
orders). Read-only: it never writes to any sheet.

`GET ?token=…&hub=mh-contry` returns, for that hub:

```json
{
  "leido": "2026-11-12T15:02:11Z",
  "ordenes": [ { "proveedor": "LALA", "fecha_entrega": "2026-11-12", "comercial": "…", "comprador": "…",
                 "lineas": [ { "codigo": "7501020513134", "sku_marca": "1271", "producto": "Crema ácida entera LALA 200ml",
                               "kgpz": "Pz", "pedido": 10, "caducidad_min": "2026-12-09", "temp": "1", "nuevo": false } ] } ],
  "contactos": { "LALA": { "comercial": "…", "comprador": "…" } },
  "telefonos": { "<nombre>": "<tel>" },
  "proveedores": [ "2 Villas", "Absormex", "…" ]
}
```

- Config inside the script: `{ "mh-contry": { "file": "<id>", "tab": "OC Con" }, … }` — or, once there is access to
  the master, `{ "master": "<id>", "cedis": { "mh-contry": "Con", … } }` (one file instead of seven).
- Window: lines with Fecha de entrega from today − 14 to today + 14. Which were already received is the app's job.
- `&proveedor=LALA` narrows the answer to one supplier (used by «Volver a leer la orden» and mid-reception
  refreshes — small and fast).
- `CacheService` keeps the parsed answer **30 seconds** per hub (several phones starting together), and a refresh
  passes `&fresh=1` to skip it, since compras may have just edited the sheet.

## 6. App changes

### 6.0 How a supplier delivery is stored (the "área" trick)
The app identifies every reception by **hub + área**, and today área is Abarrotes or Carnes. Folders, the session
id, closing, deleting, entregas parciales, alerts and the calendar are all keyed by that pair. A supplier delivery
gets an internal área named after the supplier (`pd-lala`, `pd-penafiel`): the receptor only ever sees «LALA». A
LALA and a Peñafiel truck on the same morning at Contry are then two separate receptions, each with its own file,
closing and report, and all the existing machinery works for them without new code.

### 6.1 Inicio
- New first step: **CH Guadalupe** | **Proveedor directo**. CH continues exactly as today.
- Proveedor directo: Hub → ¿Quién recibe? → **¿Qué proveedor llegó?**
  - Reaching this step calls the script (the read on start).
  - Open supplier receptions of this hub on top with «Continuar».
  - Then suppliers with open orders, nearest delivery date first: «LALA · 14 productos · entrega hoy», «Peñafiel ·
    6 productos · programada jue 14». Already-received orders greyed with «recibida {fecha}».
  - «Otro proveedor» → search `proveedores` → no order → §3.5 message with Llamar links and «Volver a leer la orden».
  - Picking a supplier shows the date warning when needed (inline, not a modal) and **Empezar recepción**.
  - Several orders of the same supplier in the window (e.g. Tue + Thu): the receptor ticks which arrived (default:
    the nearest date); their lines are summed.

### 6.2 Snapshot = envío
- Empezar recepción writes `envios/{slug}/pd-{prov}/{fecha}__{epochMs}.json` with the lines,
  `orden: { proveedor, fechas_entrega:[…], leido }`, contacts and `origen:'proveedor'`. The reception checks against
  this copy, so a sheet edit doesn't move it — until the receptor re-reads (§6.3), which writes a new copy in the
  same session (like Reemplazar y conservar, `reemplazo` event) and recomputes every line.

### 6.3 Recibir
- Same screen, scan, count, guards (typo, hermanos, Kg), Sin código (searches the order lines), Pendientes.
  Canastas/sorting positions as today where the hub has them.
- Card extras: **Temp** chip (Ambiente / Refrigerado 1 °C / Congelado −18 °C), **Caducidad mínima {fecha}** from the
  sheet. No Rechazar button: unfit pieces are set aside and not counted (§4).
- **Not in the order** (the order exists, this code has no line) → card «No solicitado · se rechaza» with the count
  field. Pedido = 0, so everything counted is Excedente and goes on the report as rejected. No call, no timer, no
  confirmation beyond the count: the order is trusted 100 %.
- **Whole order wrong**: if most of the first scans aren't in the order (e.g. 3 of the first 5 products), a banner
  says «Parece que la orden no corresponde a esta entrega. Contacta a {Comercial} o {Comprador}» with Llamar links
  and **«Volver a leer la orden»**. Advisory, not blocking. A re-read writes a new snapshot (§6.2) and every line is
  recomputed, so pieces already counted move from Excedente to Recibido if the corrected order includes them.
- The §4 big alert («Separa {n} piezas para rechazo») replaces CH's over-enviado "Vuelve a contar".
- No Armado enrichment, no origen-de-la-diferencia classification.

### 6.4 Resumen y cierre, Recepciones, Slack
- Resumen (done while the truck is still there): Pedido / Recibido / Excedente / Rechazadas (+ motivo) / Faltante
  per product. Every line below Pedido gets the §4 question, one by one (rule 2); then the «Devolver / Faltan /
  Facturar» list; then Cerrar. Cerrar re-reads the order one last time and warns if it changed.
- **Recepciones (for Retool)**: same view as CH — big **Recibido**, tick boxes, search, CSV — sorted the way Retool
  asks for it. Rejected lines in their own section.
- Report CSV `reportes/{hub}/pd-{prov}/…csv`: Código, Producto, Und, Pedido, Recibido, Excedente,
  Rechazadas, Motivo, Faltante, Facturar, Caducidad mínima, Temp.
- `cerrar` detalle adds `proveedor`, `fechas_entrega`, `rechazadas`, `excedente`, `no_solicitados`.
- An order counts as received once a closed `pd-*` session lists its `fecha_entrega` (that greys it in §6.1).
- Slack message (copy button): header «{Hub} · {Proveedor} · entrega {fecha}», §4 lines, then the Slack tags of the
  supplier's Comercial and Comprador (`config/slack.json`, new key `personas: { "<nombre>": "@usuario" }`, edited in
  Admin → Slack).

### 6.5 Calendario and Admin
- Calendario: a third bar style for Proveedor directo (teal-light fill, teal-dark text, label = supplier). No new hue.
- Admin → Recepciones lists `pd-*` sessions like the others. Alerts (`sin_cerrar`) apply as today.

## 7. Events

- `scan.cantidad` = the counted pieces. New in `scan` detalle: `pns:true` (code not in the order when scanned),
  `excedente_ok` (the receptor confirmed «Ya separé las {n}», with n).
- Resumen answer to a short line: `confirmacion` with `faltante:true`, `rechazadas` (n, may be 0) and `motivo`
  — valid only while the count is unchanged (like CH's `diferencia` confirmation).
- `reemplazo` with `orden_releida:true` when a re-read changes the order.
- Recibido, Excedente and Faltante are never stored: computed from the count (fold of scans + ajustes) and the
  current order snapshot, so a re-read recomputes them (and re-asks any changed line).

## 8. Build phases (each ends with a localhost check on `test-hub`)

0. Jose: access to the master file (or the 7 hub file ids), each hub's Cedis code, the shared token (§10).
1. Apps Script: read one hub, normalize dates/temp, contacts, JSON of §5, `&proveedor` + `&fresh`. Tested on Contry.
2. Inicio (CH / Proveedor directo, supplier list, date and no-order warnings, re-read) + snapshot to storage.
3. Recibir: temp chip, caducidad from the sheet, over-Pedido alert, No solicitado, wrong-order banner + re-read.
4. Resumen y cierre (short-line question, Devolver/Faltan/Facturar), report CSV, cerrar.
5. Recepciones (Retool view), Slack message, Calendario, Admin.
6. Real-device QA at MH Contry next to the Google Sheet, with one supplier delivery.

## 9. Not in v1

- A typed invoice count (invoice vs Facturar) — pending; maybe by bringing Invoice Reader into this flow.
- Writing anything back to the sheets or Retool.
- Measured temperature, photos of rejected goods, prices / money totals.

## 10. Open questions

1. **Source**: Jose asks commercial for **read (Viewer) access to the master file** behind Base Oc → one file
   instead of seven. Needed with it: each hub's Cedis code (`Con` = Contry; others?). Until then, the 7 hub file ids.
2. The Retool screen where the receptor types the reception: which columns, in which order? (Sets the Recepciones
   sort and CSV columns.)
3. Compras/Comercial Slack usernames for the tags (Admin → Slack can hold them once built).
