# MH Recibo — Factura del proveedor plan

Status: **v4, built 2026-11-17** (§1–§8). Supersedes the v3 draft (Invoice Reader pushing reads matched by hub +
supplier name): Invoice Reader now exposes one endpoint and reads are tied to the reception's `session_id`.
First step towards §9 of `proveedorDirecto-plan.md` (invoice vs Facturar).

## 0. Who does what

- **Invoice Reader** (repo `calii-invoice-reader`, same Supabase project) is the only reader: photos → rows with
  pieces and codes. It never compares against an OC. Its CLAUDE.md «mh-recibo bridge», `netlify/functions/recepcion.ts`,
  `server/recepcion.ts` and `lean/reception.ts` hold the contract.
- **MH Recibo** takes the photos, sends them, reads the result, and does the whole comparison invoice vs OC vs
  recibido. It never writes Invoice Reader tables and never calls its database: only `POST /api/recepcion`.

## 1. Goal

Per supplier reception, flag what the invoice charges that we shouldn't pay. **We pay only what was ordered AND
received.** Pieces only (the read has no prices).

- **Producto no solicitado en OC** — billed, not on the order.
- **Piezas de más** — billed above the OC: `max(0, facturado − pedido)`.
- **Cobradas, no en físico** — billed within the OC but not received: `max(0, min(facturado, pedido) − recibido)`.
- **Cantidad por revisar** — the read isn't sure of the pieces, or the line is in Kg.
- Missing items that weren't billed are not a flag (the supplier short-shipped and didn't charge).

## 2. The endpoint

`POST https://invoicereader.joseromero.co/api/recepcion`, JSON. CORS allows only `https://mh-recibo.joseromero.co`
(any other or missing Origin → 403), so **localhost uses a stub** (§6). Errors come as `{error}` in Spanish, shown as is.

| action | body | answer |
|---|---|---|
| start | `{sessionId, photoCount 1–8}` | `{documentId, uploads:[{page, signedUrl, token, path}]}`. 404 unknown hub / no `abrir`; 410 `abrir` older than 24 h or the session was borrada; 429 after 10 reads. |
| (upload) | `PUT signedUrl`, `Content-Type: image/jpeg`, each page in order | |
| submit | `{sessionId, documentId}` | 202 `{status:'queued'}`. Again on the same documentId re-reads the same photos. |
| read | `{sessionId}` | `{reads:[…]}` newest first: `read_id, status (processing/done/failed), error, supplier, printed_supplier, reference, invoice_date, totals_ok, warnings[], rows[], external_ref`. ~15 s. |
| list | `{hubSlug, since?}` | the hub's reads scanned in Invoice Reader (no external_ref), last 7 days, every supplier. |

Row fields used: `sourceRow, sku, productName, confident, piezas, quantityOk, printedCodes, printedDescription,
candidates[{sku, name, score, barcodes[], supplierSku}], notes[], matchKeys[]` (already normalized).

## 3. Foto de factura (Recibir and Resumen, `pd-*` only)

- Expected flow: the receptor scans the invoice on the phone **in Invoice Reader** and counts on the laptop in MH Recibo;
  at the close they pick that scan from the list (§4.5). Photos from MH Recibo stay available for whoever prefers them.
- While nothing was sent, the strip is a single «Foto de factura» link (`fac-mini`); tapping it opens the box (`f.abierto`).
- The open box (`facStripHtml`): **Tomar foto** (camera) / **Elegir archivos**, up to 8 pages,
  thumbnails with ×, **Enviar a leer**. Photos are downscaled in the browser to ≤2576 px on the long edge, JPEG q85
  (`facReduce`).
- Send (`facEnviar`): flush the outbox first (start needs the `abrir` on the server) → start → PUT each page → submit.
- Status only, never the invoice's content (the count stays blind): subiendo · pendiente · no se envió · leyendo ·
  lista · falló (**Leer otra vez** = submit on the same documentId, or **Fotos nuevas** = a new start). Polls read every
  4 s while visible, stops on done/failed (or after 3 min).
- Never lost: photos sit in IndexedDB `mr_factura` (key = session_id) from the moment they're taken until submit
  succeeds. Network error → «pendiente», retried on `online`, on app start, and when the session is opened again.
  Photos taken but never sent wait for the auxiliar (they're not sent on their own). A 410 drops them (they can't be
  read any more) and says so. Other refusals keep them with the message and **Reintentar**.
- Only within 24 h of the session start (its id ends with the epoch ms; `facVigente`). After that the strip says to
  pick the invoice at the close.

## 3b. Factura primero (2026-11-23, Jose — replaces §3 for receptions started from today)

The invoice is read and compared against the OC **at the very beginning**, before anything physical; the physical check is
then made against what matched, so nobody looks for products that aren't even billed. Fill rate and faltante still count
against the OC.

- Empezar recepción → Recibir opens on «Primero: la factura» (the §4 box: Invoice Reader list or photos, page warnings,
  picks for unidentified rows). Saved as `factura` with `fase:'inicio'` (no no_fisico yet). The result lists: Regresar si
  llegan (billed, not on the OC), Cobra más de lo pedido, No vienen en la factura, Se revisan contra la OC (Kg, unread
  quantity) → **Empezar revisión física**. «Cambiar factura» stays available on Recibir.
- Per OC line the physical target is `min(facturado, pedido)`; Kg or unread quantity → pedido. Completo / Faltante /
  Excedente / Rechazo answer against that target.
- OC line **not billed** → faltante with no question («No llegó» is no longer asked for it). If it arrives anyway, a scan
  opens it against the OC: **received and reported** («Llegó sin facturar: que lo agreguen a la factura»).
- Billed and **not in the OC** → listed on Recibir; a scan of one says «Viene en la factura pero no en la OC: regrésalo».
- Billed lines that didn't arrive are still confirmed in Resumen («No llegó»): they are charged.
- Resumen «Antes de que se vaya el camión» adds **Corregir la factura**: cobra n que no llegaron / rechazadas / de más,
  llegaron sin facturar, no está en la OC.
- The close computes the final review from the start's comparison + what was received (`facCierre`, same numbers as §5)
  and writes it with the report — the closed view shows it at once. «Corregir lo recibido» re-compares as before.
- **Empezar sin factura** (No trajo factura / No se puede leer / Otro): the physical check runs against the OC as before
  and the invoice is picked at the close (§4).
- New in every comparison: `sin_facturar` (OC lines received but not billed) → «Reportar: llegaron sin facturar».

## 4. At close and after (closed view, `#fac-box` under the head, `facBoxLoad` / `facBoxInner`)

Shown on every closed `pd-*` reception that has `lineas_todas` (Inicio after closing, Recepciones, Admin). Order of checks:

1. A saved `factura` event (latest wins) → its result + «Cambiar factura». If a newer done read exists → «Comparar con la nueva».
2. Photos waiting / sending → the strip.
3. A done read (this session's newest, or one picked from the list) →
   - `totals_ok === false` or warnings → **«¿Falta una página de la factura?»** with the warnings: «Tomar todas las
     páginas» (new photos → new read) or «Está completa: comparar».
   - Rows nobody can link (no identificado) → one select per row: Sugeridos (ambiguous hits, then OC lines a
     candidate's barcodes / supplierSku point to), the rest of the order, «No está en la OC». **Guardar revisión**.
   - Nothing to ask → saved right away.
4. Reading → status, polling. Failed → Leer otra vez / Fotos nuevas; from the 2nd failure also **Comparar a mano**.
5. No read for the session → `list {hubSlug, since: session fecha 00:00 −06:00}` filtered to this supplier
   (`facMismoProveedor`: shared significant word, company suffixes out; the hub's other invoices under a fold), photos if
   still within 24 h, «Actualizar», **Comparar a mano (sin factura leída)**.
   - Reads another reception already linked are left out (`facLigadas`: each session's latest `factura` event of the hub,
     last 30 days, + the outbox; a later event or a bypass frees the read). The list says how many were hidden.
   - Exactly one read of this supplier → shown as a card «Sí, es esta factura» (still one tap, never linked on its own);
     the hub's other invoices stay folded under «No es esta: ver otras».

Comparar a mano: motivo «No trajo factura» / «La factura no se puede leer» / Otro (text) → `factura {manual:true, motivo}`.

`pdCerrar` itself is unchanged: the close never waits for the invoice.

## 5. Comparison (`facComparar`, pure, `/* FACTURA-PURE */` block)

- `facNormCode` = Invoice Reader's `normCode` (lean/match.ts): uppercase, keep 0-9A-Z, strip leading zeros of all-digit
  codes («000» → «0»). Keep them identical. Only the OC side is normalized (matchKeys come normalized).
- OC lines = the envío snapshot's `lines` (`cerrar.detalle.envio`). A line's keys: barcode, sku_key (not `name:…`),
  sku_marca. A row links to the line whose keys meet `row.matchKeys`. Two or more lines → ambiguous → no identificado.
- Unlinked + confident → no solicitado (named by productName). Unlinked + not confident → no identificado (pick).
- Per billed OC line: facturado = Σ linked rows' piezas; pedido = `lineas_todas.pedido` (else `esperado`); recibido =
  `lineas_todas.recibido`. A linked row with piezas null or quantityOk false → `revisar:'cantidad'`; a Kg line →
  `revisar:'kg'` (pieces aren't compared to kilos). Total «pz facturadas» leaves Kg rows out.

## 6. Data

- `rec_events` tipo **`factura`** (same session_id, hub, area, fecha; append-only, latest wins). detalle: `read_id,
  origen ('sesion'|'lista'), reference, supplier, printed_supplier, invoice_date, totals_ok, warnings?,
  avisos_aceptados?, filas, piezas {facturadas, de_mas, no_fisico, no_solicitado}, conteo {no_solicitado, de_mas,
  no_fisico, por_revisar, no_identificado}, limpia, lineas [every billed OC line: sku_key, producto, kgpz, pedido,
  recibido, facturado, de_mas, no_fisico, revisar?, filas], no_solicitados [{sourceRow, producto, piezas, sku,
  a_mano?}], picks? {sourceRow: sku_key|'no_oc'}` — or `{manual:true, motivo}`.
- Checked before adding the tipo: every reader filters on explicit tipos (closedState, listCerradas, syncServerEvents /
  onRemoteEvents, Inicio's pdSesiones, Admin, Calendario, Proveedores, the alerts Apps Script, Invoice Reader's
  checkSession which reads only abrir/admin). `rec_events.tipo` has no check constraint.
- Report CSV (`reportes/…csv`) is rewritten on each save (`facReporte`) with three more columns: **Folio factura,
  Facturado, Revisión factura** («OK», «Cobra n pz de más», «Cobra n pz no recibidas», «Cantidad por revisar»,
  «Kg: revisar a mano», «No facturado»; bypass → «Sin revisión de factura: motivo»), plus one row per invoice line not in
  the order (Estado **«Facturado sin pedir»**, Pedido/Recibido 0). The closed view and `pvLinesFromCsv` skip those rows.

## 7. Local runs

`IR_LOCAL` (localhost without `?irlive=1`) answers start/submit/read/list in memory from
`fixtures/factura_stub.json` (gitignored; the record shape `{supplier, printed_supplier, reference, totals_ok,
warnings, rows}`); a read turns done 6 s after submit. `?irlive=1` calls the real endpoint, which refuses localhost (CORS).

## 8. Tests

`node tests/factura.test.mjs` evals the FACTURA-PURE block of index.html.
- Arca: session `mh-san-nicolas__pd-arca-continental__2026-11-16__1794846172226`, OC C2642861 vs DNL 5695519398
  (`fixtures/arca-C2642861-envio.json`, `arca-DNL-5695519398-record.json`, `arca-C2642861-cerrar.json` = that session's
  `lineas_todas`; gitignored, skipped when missing): 19 rows confident and linked one to one, piezas = recibido, none over
  esperado, 223 pz, 6 OC lines not billed and received 0 → **zero flags**.
- Synthetic: wrong flavor → no solicitado; billed 12 / pedido 10 / recibido 6 → 2 de más + 4 no en físico; unknown code
  (not confident) → no identificado with the candidate's line suggested; quantityOk false → por revisar; Kg line; a code
  on two lines → ambiguous; «001177» vs «1177»; two rows billing one line; picks; a line billed but received 0;
  `facLigadas` (latest event per session wins, bypass frees, own link stays).

## 9. Later (not built)

- Slack: add the invoice flags to `pdSlackMensaje`.
- Admin → Proveedores: invoice flags per supplier over time.
- Recepciones list: a badge when a reception has invoice flags or no review.
