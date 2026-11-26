# MH Recibo — notes for Claude Code

Reception app for Calii micro hubs: receive the inter-hub shipments assembled at CH Guadalupe. Replaces the
"Calii | MH {hub} | Recepción … Scanner" Google Sheets.

**Read `mhRecibo-v1-plan.md` before building anything.** It is the spec; build it phase by phase (§10).

## Shape
- Single `index.html` (HTML + CSS + vanilla JS). No framework, no build step, no package.json. `sw.js`
  network-first. Spanish UI. Netlify publish dir `.`, no build command.
- **Calii Theme v1** (2026-11-02): rules in `~/Desktop/sorting-hub/Claude outputs/THEME.md` (Sorting Hub is the
  reference). White page, Plus Jakarta Sans, `--c-*` tokens at the top of the `<style>`; the app's old token names
  (`--green`, `--orange`, `--red`, `--gray-*`) are aliases so JS inline styles follow. Teal = the one primary action or
  key value (the basket on the product card; Registrar and modal confirms are ink); attention = ink; `--c-danger` only
  for errors/deletes. No emoji in buttons/labels (inline SVG icons for keyboard/camera/torch/close). No new hues.
- Helpers are copied once from `~/Desktop/armado-CH/index.html` (read-only). Never edit the armado-CH or
  sorting-hub repos from here.

## Supabase — SHARED with Armado CH (production)
- Project `uuqqtksxlgkztenojufm` (Armado CH's). This app owns only bucket `recibo` and tables `rec_*`.
- It only **reads** Armado's `picks` table, `solcitudesarmado/reports/*` and the public `masterview` bucket.
  Never write, alter or delete anything outside `recibo` / `rec_*`.
- Sorting positions: read-only from bucket `sorting-hub` in this same project (Sorting Hub migrated here 2026-10-29).
- Product photos (Masterview): read-only from the public bucket `masterview` (`latest.json`, `version.txt`), uploaded only
  in Invoice Reader. `loadImageDB`: `masterview/`, then the last cached copy whatever its version, then the bundled
  `imagedb.json` (a full copy of `latest.json`). Cached in Cache Storage `calii-masterview`, not localStorage; `sw.js`
  keeps that cache on activate. The stored version is version.txt + `MV_SHAPE`: bump it when the app reads a new field
  (Invoice Reader added `skuByName` on 2026-11-25 without moving version.txt, so phones kept a copy without it). Read entries through `imgUrl`/`imgName`/`pickEntry(key, hubCity())`: `map` first, then `alt`. `getImgUrl`: barcode → exact name →
  none, never a guess; a barcode whose Masterview name shares no word with the product's is skipped (`nameClash`).
- New tables need explicit `grant`s in the same SQL that creates them (Supabase change, 2026-10-30).
- **Local runs write to prod.** Use `hub='test-hub'` or stub write helpers before testing write flows.

## Rules that must survive any change
1. Receiver inputs: barcode + quantity (product pick only when there's no barcode). **Except proveedor directo in modo botones**
   (proveedorDirecto-plan §6.6): the order is shown and each line is answered with a tap.
2. No cheap exits: no bulk accept / confirm-all. Discrepancies acknowledged one by one.
7. Nothing remembered between visits: always open on Inicio (no saved hub/área/name/page).
3. Blocking modals only where plan §7.5 allows them.
4. `rec_events` is append-only and the source of truth; corrections are `ajuste` rows.
5. Dates via `serverNow()` + America/Monterrey helpers — never the device clock.
6. Never write to Retool.
8. Everything that physically arrived is received, whatever its date or state. Fecha corta never lowers Recibido or
   changes the estado: those pieces are received, then registered as merma (MNA) and separated.
   **CH only.** Proveedor directo rejects instead: unfit pieces are set aside, never counted, and go back on the truck
   (proveedorDirecto-plan §3.9, §4).

## Status (2026-10-30)
- **Phases 0–5b built; full QA run with both real files passed (see HANDOFF.md)**. "Empezar sin archivo" is
  switched off (`SIN_ARCHIVO_ENABLED`) on Jose's request: receptors must upload before scanning.
- Phases 0–5b were tested on test-hub (localhost, phone width). Phase 6 (real-device QA at MH Contry next to
  the Google Sheet) is the next step and needs people + phones. See `HANDOFF.md` for the overnight session log.
- Supabase answers **HTTP 400** (not 404) for a missing storage object.
- Sorting Hub files exist only for `mh-contry` and `mh-condesa`; other hubs show "sin posición".
- Until `receptores.json` exists, Inicio falls back to a free-text name. Shape: `{ "mh-contry": ["Nombre", …] }`.
- **Prod is clean (2026-10-30):** all test data was deleted before launch (`rec_events`, `rec_alert_config`, every
  file except `recibo/config/`). The app is live at https://mh-recibo.joseromero.co; Receptores are filled in,
  PIN file exists, `v1-alerts-rpc.sql` is run. Alert schedules and the Apps Script wait for the real launch. Any
  new local test writes to prod again: use test-hub and tell Jose what to clean up.

## Proveedor directo (proveedorDirecto-plan.md — phases 1–5 built 2026-11-13)
- Supplier deliveries straight to the hub. Orders come read-only from an Apps Script web app
  (`proveedor/apps-script.gs`, reference copy; Jose deploys it). It reads the master «Fill Rate Oc Nacional» («Base
  datos Compras» = open orders of every hub, one orden per Num Oc; «Catalogo2» V Anaquel → caducidad) plus one hub file
  per city for Temp and Comercial. Deployed 2026-11-13 (Jose's account): `PD_URL`/`PD_TOKEN` in index.html. The token is
  public by design (no login), so the bridge is locked down instead: `proveedor/appsscript.json` limits it to
  `spreadsheets.readonly` (tabs read through the Sheets API advanced service, `libro_`; SpreadsheetApp needs edit rights)
  and it returns **no phone numbers** (names only; no «Llamar» links). Code change → Jose pastes it and deploys a New
  version of the same deployment (URL stays). Live read ~8 s fresh, ~2 s cached (30 s).
  **Saved copy (2026-11-23):** a 1-minute timer in the same script (`refrescarTodo`, 05:00–22:59 Mty; set up with
  `instalarTimer`) builds every hub at once (master read once, reference files cached 30 min) and writes
  `rec_pd_snapshot` (one row per hub: data, hash, leido, revisado = server time, ms) through `rec_pd_snapshot_put`, which
  needs `SB_SECRET` (kept in the private table `rec_pd_secret`, never in git; `sql/pd-snapshot.sql`). Unchanged hubs only
  get `revisado` moved. `pdFetch` reads the copy first (`pdSnapshot`): `fresh` reads (Empezar, Cerrar) accept it ≤ 2.5 min
  old, lists ≤ 10 min; older, missing or unreachable → the script live. `live:true` skips it: «Volver a leer la orden» in
  Inicio and Recibir and «Agregar a esta recepción» (compras may have just fixed the sheet). Demo answers the copy from
  the fake bridge. Localhost reads
  `fixtures/proveedor_mh-contry.json` (gitignored); `?pdlive=1` uses the live URL. test-hub borrows mh-contry.
- Each supplier is an internal área `pd-{provSlug}` (§6.0): same folders, sessions, closing, deleting. `areaName()`
  shows the supplier name (`PD_NAMES`); never show `pd-…` to a receptor.
- Inicio: ¿De dónde viene? CH Guadalupe | Proveedor directo → Hub → ¿Quién recibe? → ¿Qué proveedor llegó?
  (`pdStepHtml`). One query (`pdSesiones`) finds open pd receptions and which OCs a closed one covered
  (`abrir`/`cerrar` `detalle.ocs` = pdKey list: num_oc, or `{provSlug}|{fecha}`). No order → no reception (§3.5).
- Empezar recepción (`pdEmpezar`) re-reads the supplier with `&fresh=1`, sums the ticked OCs per sku_key and writes
  `envios/{slug}/pd-{prov}/{fecha}__{epochMs}.json` with `origen:'proveedor'`, `orden:{proveedor, ocs, num_oc,
  fechas_entrega, leido, comercial, comprador}`; lines carry `caducidad_min`, `temp`, `sku_marca`. No CSV. No phones anywhere. The CH stale-file modal skips these.
- Recibir (`isPd()`): the receptor types only the pieces they accept (unfit ones are set aside, not counted). Card
  shows a Temp chip (`tempLabel`) and Caducidad mínima from the order line (`caducidadMin` reads `caducidad_min`).
  No Fecha corta / Dañadas buttons, no recent-list Separar (that is CH's MNA). `guardQty`: typo guard, then count >
  Pedido (Kg: CH tolerance) → `c.exc` renders «Separa {n} para rechazo» on the card (`pdExcHtml`) with «Ya separé»
  (`detalle.excedente_ok` = n) or «Corregir la cantidad»; n = min(this scan, total − Pedido). Not in the order →
  `notInEnvio` opens the card as «No solicitado · se rechaza» (no modal), same alert with Pedido 0, `detalle.pns`.
- `pdOrdenDudosa` (3 of the first 5 products not in the order) → advisory banner with contacts + «Volver a leer la
  orden». `pdReleerRecepcion(extraKey)` re-reads the same OCs (`&fresh=1`); a change (or «Agregar a esta recepción»
  for another open OC of the supplier, `S.pdOtras`) writes a new snapshot in the same session + `reemplazo`
  {orden_releida:true}. `pdBuildEnvio` is shared with Empezar. `tempLabel`: ≥15 °C = Ambiente (the sheet says 24 for bread).
- `pdLeerOrden(extraKey)` (re-read → `{data, cambio}` or `{gone}`) + `pdAplicarOrden` (snapshot + `reemplazo`) are shared by
  «Volver a leer la orden» and Cerrar. No «Cerrar entrega parcial» on pd receptions.
- Resumen y cierre (`renderResumen`/`cerrarRecepcion` hand off to `pdRenderResumen`/`pdCerrar` when `isPd()`). `pdRows()` →
  `pdRow`: count = fold; within Kg tolerance → Recibido = min(count, Pedido); above → Recibido = Pedido, `exc`; below →
  `gap`, answered one by one (order frozen by `pdFreezeOrder`): «No llegaron» / «Rechacé piezas» (1..gap + motivo
  fecha_corta|danada) = `confirmacion {faltante:true, recibido, pedido, rechazadas, motivo}`; rest of gap = Faltante.
  An excess not covered by the scans' `excedente_ok` (Recontar/Corregir skip the card alert) asks «Ya separé» here =
  `confirmacion {excedente:true, recibido, separar}`. Answers are valid only while the count is unchanged (`pdAck`).
  Recibido/Excedente/Faltante are never stored. Then «Antes de que se vaya el camión»: Devolver / Faltan / Facturar.
  PD recount skips CH's over-enviado modal.
- `pdCerrar` re-reads the order (`&fresh=1`): changed → modal «Usar la orden nueva» (back to Resumen) or «Cerrar con la
  orden que tengo» (`orden_cambio_ignorado`); gone or unreachable → closes with the copy. Report
  `reportes/{hub}/pd-{prov}/{session_fecha}_{HH-MM}_{receptor}.csv`, columns `PD_REPORT_COLS`. `cerrar` detalle: `origen:
  'proveedor'`, proveedor, `ocs` (pdKeys — what greys orders in Inicio), num_oc, fechas_entrega, excedente / rechazadas /
  faltantes / no_solicitados (line counts), `lineas_dif` (per line; not `errores`, which Armado CH reads).
  `cerrar` also stores comercial/comprador (names only).
- Recepciones: Inicio step 4 «Recepciones de proveedor cerradas» → `openRecepciones(true)` (`_recepPd`; `listCerradas(hub,'pd')`
  = `area=like.pd-*`). `openRecepcion` spots a PD report by its `Pedido` column (`RV.pd`): rows carry exc/rech/motivo/falt/fac/
  pns; `pdRecepcionHead`; `rvDistinto` for PD = Recibido ≠ Pedido (Recibido is what's registered and invoiced); No
  solicitado lines sit in their own section, never ticked. Default order = the OC's; no pasillo.
- Slack (`pdSlackMensaje`): «{Hub} · {Proveedor} · entrega {fecha}», the §4 line per product with a difference, then
  «Comercial @x · Compras @y» from `config/slack.json` `personas` (`personaTag`, `sameName`; else the plain name). Old
  closes read the names from the envío snapshot. Admin → Slack edits `personas` as «Nombre = @usuario» lines and
  saves `{tags, personas}` together.
- Calendario: group «Proveedores» after Abarrotes/Carnes (`.cal-bar.pd` teal-light, dashed white when open), label = supplier
  even on one-day bars; shown only when the month has one. Admin → Recepciones names pd sessions «Proveedor {name}».
- Alerts (`alertas/apps-script.gs`): no schedule for suppliers; from 21:00, for every hub with an active alert row, an open
  pd reception → `sin_cerrar` (área = pd-…), and the digest adds a line per supplier reception of the day.

- **Modo botones (2026-11-13, plan §6.6)** — `pdBotones()` = `isPd()` && envío `modo:'botones'` (set by `pdEmpezar`,
  carried by re-reads). No blind count. Recibir is scan-first (`S.pdTab='scan'`): a scan opens that line alone (`S.pdFoco`) + «Últimos
  revisados»; «Pendientes» / «Todos» open the order as a list with a search (`pdBListRender`, `pdBLineHtml`). Each line gets
  Completo / Faltante (llegaron) / Excedente (flag, Recibido = Pedido) / Rechazo (motivo + n). Answers are `confirmacion`
  `detalle.marca`, latest wins while `pedido` is unchanged (`pdMarcas`, `pdBRows` → same row shape as `pdRow`, so `pdRows`,
  cerrar, report, Slack, Recepciones serve both modes). Scan → `pdBScan` (jump to the line, or flag `no_solicitado`).
  `pdBRenderResumen`; «Copiar lista para el sistema» (`pdCopiarFacturar`). Report Excedente = «Sí». Receptions opened
  before keep the count flow.
- **Live test fixes (Danone at MH Contry, 2026-11-18)** — modo botones: Recibir keeps Completo / Faltante / Excedente / Rechazo; Resumen («Por revisar», lines never scanned) shows **No llegó** (= faltante 0) + Completo
  big, then Llegaron menos / Excedente / Rechazo; Caducidad mínima is a big `.pdb-cad` row; no input autofocus (pdb-n, pd-q,
  pd-rech-n: the receptor taps the field). A scan not in the order focuses a «No viene en la orden» card with «Siguiente»
  (`pdBSiguiente`). **Buscar por nombre** (2026-11-20): scan tab button opens the Sin código sheet; a scanned line (in the order
  or flagged no solicitado) shows «¿No es este producto? Código incorrecto en sistema» (`S.pdCod`, `pdBCodMal`); an unknown code
  opens that search directly. `pickSearch` → `pdBPick`: order line → focused like a scan; outside the order → no solicitado
  (a wrong pns flag is removed). The wrong code rides on the next marca of that line (`detalle.codigo_incorrecto`, metodo
  `codigo_incorrecto`); Admin → Códigos reads `tipo=in.(scan,confirmacion)`. Buttons: «Terminar revisión física» (Recibir) and «Cerrar y comparar contra factura» (Resumen).
  Closed PD view: tabs **Llegó** (default, Recibido > 0) / Completo / Con diferencia / Faltante / Todos; «Terminar e ir al menú
  principal» at the bottom. **Corregir lo recibido** (`rvCorr*`, modo botones, ≤24 h from the session id, not from Admin):
  `pdCargarSesion` reloads the session, a new marca with `detalle.post_cierre`, the report rewritten at the same path and a
  new `cerrar` with `detalle.correccion` (built by `pdCerrarDetalle`, shared with `pdCerrar`); `openRecepcion(info, from,
  {recomparar, csv})` takes the fresh CSV (the storage CDN serves the old one for a while) and `facBoxLoad` compares the
  same invoice read again (`FACV.recomparar`). Invoice result = big `.fac-act` blocks: Regresar (no en OC) / Reportar:
  cobradas que no llegaron / Reportar: más de lo pedido, then Revisar a mano; «Comparando…» loader ≥ `FAC_COMP_MS`.
- **Supplier insights (2026-11-13)** — every pd `cerrar` stores `detalle.lineas_todas` (`pdLineasTodas`): one object per
  order line + no solicitados {sku_key, producto, kgpz, pedido, contado, recibido, excedente (pieces, or `true` in modo
  botones), rechazadas, motivo, faltante, no_solicitado}; zero fields omitted. `lineas_dif` stays for old readers. No motivo
  for separated excess (it would cost the receptor a step in both modes). Admin → **Proveedores** (`admProveedores`, view
  only, state `ADM.pvDesde/pvHasta/pvHub/pvSel`, data `PV`): closed `pd-*` sessions by session fecha (latest cerrar; reabrir/
  borrar hide it); closes without `lineas_todas` read their report CSV (`pvLinesFromCsv`, cached in `PV.csv`), else «sin
  detalle» (counted in recepciones/puntualidad only). UI says «producto», never «línea» (one order line of one reception).
  KPIs (`pvKpis`, 2026-11-18, Jose): fill rate por pieza (Σ min(recibido, pedido) ÷ Σ pedido, Pz lines only; Kg lines get
  their own muted line; a Kg-only supplier shows kilos), fill rate por producto (products with no faltante/rechazo ÷
  ordered), rechazo fecha corta por pieza and por producto (÷ pedido, so fill rate + rechazo + faltante = 100 %), and
  incident counts: producto no solicitado, exceso sobre la OC, cobrado y no entregado (latest `factura` event per session,
  `lineas[].no_fisico>0`; shown with how many receptions had the invoice checked). Puntualidad = session fecha vs the
  closest `fechas_entrega`, one muted line in the detail only. Supplier list (worst fill rate first) → detail
  (`pvDetalle`: KPIs, weekly trend Monday-first, receptions, products with per-reception history) and CSVs
  `pvCsv('prov'|'prod'[, provIdx])` with the same KPI columns first.

- **FDR · Formato de devolución (2026-11-23, comercial's form)** — printable return form for supplier receptions only
  (CH never returns: merma MNA). `fdrAbrir` builds it from the closed report (`RV.rows`) + the latest `factura` event
  (`fdrPrep` → `RV.fdrFac`). **Global rule (Jose, 2026-11-24):
  everything charged and not into our system goes on it, whatever the reason.** Per billed OC line `fdrPartes` splits
  facturado − recibido: rechazo (≤ billed; Fecha corta with «Caducidad mínima aceptada», Producto dañado) + «No llegó» + de
  más above the OC (arrived: rejected as «Más de lo pedido»; not arrived: «No solicitado», same as a product outside the
  OC). «No llegó» = ordered, charged, never arrived. Plus every billed product outside the OC, scanned or
  not (full billed quantity). Kg / unread quantity (`a_mano`): nothing received → «No llegó» with Cantidad blank; something
  received → on-screen note to check by hand. Never what the invoice doesn't charge (driver's mistake, no form). No review
  yet → rejections only + a note; a review saved later updates the button (`fdrBtn`, counts products). SKU Proveedor = the OC line's `sku_marca` read from
  the envío snapshot (`info.envio`); folio from the report's «Folio factura». Letterhead `FDR_EMPRESA` + `FDR_LOGO` (inline
  PNG taken from the form), 15 rows minimum like the paper, signatures Calii (receptores printed) / Proveedor. Opens by itself
  after `pdCerrar` (`openRecepcion(…, {fdr:true})`) when something goes back; «Formato de devolución · n» next to
  «Mensaje para Slack» (always shown, off when nothing goes back) reprints it. Overlay `#fdr`; «Imprimir» adds `body.fdr-print` so `@media print` shows only the sheet.

## Factura del proveedor (facturaProveedor-plan.md — built 2026-11-17)
- Flags per supplier reception what the invoice charges that we shouldn't pay (we pay only what was ordered AND received,
  in pieces): no solicitado en OC, piezas de más, cobradas no en físico, cantidad por revisar (unsure piezas or Kg line).
- Invoice Reader reads the photos; we only call `POST IR_URL` (`irPost`: start → `irPut` each page → submit → read; list).
  Never its tables or database. CORS admits only the prod origin: **localhost uses `irStub`** (`IR_LOCAL`, fed by gitignored
  `fixtures/factura_stub.json`, the record shape); `?irlive=1` calls the real one (refused by CORS from localhost).
- List names (2026-11-17): `facNombre` shows Invoice Reader's `label` (supplier · folio · day · time · who scanned; `list`
  now includes its default «captura» scans too), with a local fallback for an older reader. «Ver foto cargada»
  (`facVerFoto`) asks IR `photos {sessionId, readId}` for 10-minute links on every tap (receptions up to 7 days old);
  shown on each listed scan and on the saved review. Photos are never cached here.
- Expected use: invoice scanned on the phone in Invoice Reader, count on the laptop here, scan picked from the list at the
  close. The Recibir/Resumen strip is a one-line «Foto de factura» link (`fac-mini`, `facAbrir`) until opened or sent.
- Recibir + Resumen (`pd-*`): status strip `facStripHtml(sid)` (`.fac-strip[data-sid]`, re-rendered by `facRender`), photos ≤8,
  downscaled to 2576 px JPEG q85 (`facReduce`). Status only, never the invoice's content (blind count). State `FAC[sid]`;
  `facEstado` derives subiendo/pendiente/error/fotos/leyendo/lista/fallo/vencida; polls read every 4 s (`facPoll`).
  Unsent photos live in IndexedDB `mr_factura` until submit succeeds (`facSave`/`facDrop`; `enviar` flag = the auxiliar
  pressed send → retried by `facRetryAll` on `online` and app start). 24 h window from the session id's epoch (`facVigente`).
- Closed view (`#fac-box` under `pdRecepcionHead`, only when the close has `lineas_todas`): `facBoxLoad(info)` → state
  `FACV`; `facBoxInner` walks saved → photos → read (page warning when `totals_ok===false` or warnings; picks for no
  identificados) → leyendo/fallo (Comparar a mano from the 2nd failure) → `list` filtered by `facMismoProveedor`, minus reads
  another reception linked (`facLigadas`), a single match as a «Sí, es esta factura» card + photos + Comparar a mano. Saved automatically when nothing is asked. `pdCerrar` is untouched: closing never waits for the invoice.
- Comparison `facComparar` + `facNormCode` (identical to Invoice Reader's lean/match.ts `normCode`) live in the
  `/* FACTURA-PURE:BEGIN … END */` block, no globals: `node tests/factura.test.mjs` evals it (Arca real fixtures, gitignored,
  skipped when missing; synthetic cases always).
- Picker of unidentified rows (2026-11-25, Jose; `fid-*`): one card per row (`facIdHtml`): «En la factura» (text, code, quantity) →
  up to 3 suggestions to tap (photo, name, OC), «Buscar en la orden» / «Es otro de la orden» (sheet `facIdAbrir` with search:
  Sugeridos / Aún sin cobrar en la factura / Ya están en otro renglón) or «No está en la orden». Picked → teal row with Cambiar.
  Nothing is preselected. No native `<select>` here. Planted case: «Lácteos Prueba» LP-0778.
- Repeated pick (2026-11-25): `facRepetidos` finds an OC line where a hand pick joined invoice rows with different codes;
  the picks screen shows both rows and won't save until the pick changes or «Sí, son el mismo producto» (`FACV.repOk`, per
  read and set of rows). A warning, not a ban: one product can come under two codes. Automatic re-comparisons never ask.
- Unsure quantity (2026-11-25, Avícola Bachoco Huevo: «40» under «Pieza/Caja», Invoice Reader `quantityOk:false` because its
  catalog buys by the case → the line was «Cantidad por revisar» with no way to enter it). On a Pz line that isn't an N-pack
  (`facComparar`): the read number, or the case reading from the row's note («(= 800 pz)», `facAltPz`), that makes the line
  add up to the OC settles it (`cantidad_oc`); otherwise, or with no number read, it's a `duda` and the picks screen asks
  «¿Cuántas piezas cobra la factura?» (`facDudaHtml`: Son n piezas | Son n cajas de c = m piezas | type it). The answer is
  `FACV.picks['q'+sourceRow]` (saved in `detalle.picks`, line `cantidad_mano`); saving waits for every duda. Kg and pack
  lines keep «revisar a mano». Planted in «Lácteos Prueba» (one settled by the case reading, one asked).
- Event `factura` (latest wins; `facGuardarDetalle`, through the outbox): read_id, origen, reference, totals_ok, conteo,
  piezas, `lineas` (every billed OC line), no_solicitados, picks — or `{manual:true, motivo}`. Every other reader filters
  on explicit tipos, so it's ignored there. `facReporte` rewrites the report CSV with «Folio factura», «Facturado»,
  «Revisión factura» + rows Estado «Facturado sin pedir» (skipped by `openRecepcion` and `pvLinesFromCsv`).

- **Factura primero (2026-11-23, Jose; facturaProveedor-plan §3b)** — new pd receptions (`envío.factura_primero`, set by
  `pdEmpezar`, carried by re-reads) open Recibir on the invoice step (`pdFacPaso`: scan row hidden, scans refused) with the
  same box as the closed view (`FACV.inicio`, element `#fac-ini`, `facIniEnsure`): pick the Invoice Reader scan or take
  photos → compared against the OC only → event `factura` with `detalle.fase:'inicio'` (`facInicio`: no no_fisico, no
  report) → result + «Empezar revisión física» (`S.facOk`; reopening goes straight to scanning). The physical check then
  looks for `facObjetivo`: min(facturado, OC); Kg / unread quantity → OC; not billed → `autoNofac` row = faltante with no
  question (a scan opens its buttons: received + reported, `sinFac`). Marcas store `objetivo` (+ `nofac`) and hold only
  while it's unchanged. Faltante stays vs the OC (fill rate); `faltFis` = billed but missing. Billed products not in the OC
  are listed on Recibir and a scan of one (`pdFacNs`, by `no_solicitados[].codigos`) is flagged `facturado_sin_pedir` →
  «regrésalo». Camión card «Corregir la factura». `pdCerrar` writes the final `factura` (`pdFacFinal` → `facCierre`,
  `desde_inicio:true`) and the report's invoice columns (`facReporteCsv`) in one upload; `facBoxLoad` ignores `fase:'inicio'`.
  An order re-read that changes lines re-compares the same read (`recomparar`). «Empezar sin factura» (manual inicio) = the
  old check against the OC and the invoice picked at the close. `sin_facturar` (received, not billed) is in every comparison.

- **Paquetes (2026-11-23, Jose; San Nicolás Arca 2026-11-20: OC 36 «Pz» of a 12-pack, 3 paquetes arrived, «33 cobradas que
  no llegaron»)** — Retool counts the Masterview item; the pack size is only in its name. `packOf` (FACTURA-PURE, a copy of
  Invoice Reader's lean/match.ts: keep the regexes identical): `pack` = «(12-pack)», «4 Pack» → `packN` = N; `contenido`
  («caja 18pz», «6pz», «8 sobres») and Kg → 0, shown as before. On a pack line (modo botones) every quantity is paquetes:
  `pkTxt`/`pkH`/`pkPlano` («3 paquetes» + muted `.pk-nota` «= 36 piezas», `--c-muted`). `packPedido(esperado, N, en)`: not a
  multiple of N → paquetes (Alpura 61 on a 4-pack). A multiple is settled without asking about the order (the receptor
  didn't place it, Jose): first the invoice compared at the start, only when its rows say paquetes (`pack_retool`; `pdPackFactura` → `packEnDe`: billed paquetes nearer oc/N
  → piezas, nearer oc → paquetes; Arca billed 3 on 36 → piezas), else the line shows «¿Qué llegó?» instead of the buttons:
  «3 paquetes (36 piezas)» | «36 paquetes (432 piezas)» (= Completo, `pdBLlego`) | «Otra cantidad» (count with the switch →
  `packEnDe` → Completo / Faltante / Excedente) | «Rechazo» (`pdBRechQ`, `S.pdPackRech`: the same question counting
  what is rejected, then the rechazo form; a count is stored as `llegaron` and `pdBRows` rejects out of min(llegaron, P)) |
  «No llegó» in Resumen. The decision rides on the marca: `pedido` stays the
  OC's number (validity), `pack_n`, `pedido_en` ('piezas'|'paquetes'), `pedido_ret`, `pack_pregunta` (the number was
  ambiguous), `pack_fuente` ('factura'|'llego'|'conteo'|'supuesto'), `pack_dudoso` (not an exact match). `pdPackInfo(l)` → P
  in paquetes (used by `pdBRows`, `pdObjOf`/`pdObjDe`); a line nobody settles (autoNofac) borrows this reception's other
  answer, else piezas (`pdPackHeredado`, `pack_dudoso`). Faltante/Rechazo forms: switch Paquetes (default) | Piezas (`S.pdForm.pz`); piezas must
  be whole paquetes (`packDePiezas`), stored converted + `capturado_pz`. `lineas_todas` adds pack_n, pedido_en, pedido_oc
  (OC number when written in piezas), pack_pregunta, pack_fuente → Admin → Proveedores can list «orden en piezas para producto en paquete».
  Report: Und «Paquete», columns «Paquete de», «Pedido en OC» (read by `openRecepcion`, `pvLinesFromCsv`). Invoice: Invoice
  Reader's rows carry `packKind/packSize/retoolUnit/piezasSueltas` and `piezas` in Retool units; `facComparar` adds
  `pack_n`/`piezas_sueltas` per line and marks a newer-shape row without `retoolUnit:'paquete'` on a pack line «por revisar»
  (old-shape rows compare as before). The start's comparison uses the OC number; `facObjetivo`/`facCierre` redo it with
  the paquetes Pedido. The blind count flow (receptions before 2026-11-14) is unchanged. After-close correction of a line
  nobody settled (off the invoice): the corrected count decides paquetes vs piezas (`rvCorrGuardar`; Contry Alpura, 2026-11-24). Tests: `node tests/pack.test.mjs`
  (San Nicolás replay from gitignored `fixtures/arca-2026-11-20-*.json`); Modo prueba «Refrescos Prueba».

- **Bimbo / Marinela (2026-11-24, Jose)** — compras writes both under «Bimbo», each with its own OC and invoice, so they are
  received apart. `PD_SEPARAR` + `pdSepararOrdenes` (in `pdFetch`): an OC ≥80 % Marinela products becomes supplier «Marinela»
  (área `pd-marinela`); an OC mixing both (Zapopan, Condesa) stays «Bimbo». The bridge, its catalog and contactos only know
  `pdBase(name)`; re-reads use `grupo:true` (OCs looked up by key). Invoice list puts first the reads billing something of this
  order; `facAjena` (no row on the order) asks «Esta factura parece de otra orden» before comparing (any supplier).
  Receptions before this stay under `pd-bimbo`. Modo prueba: «Bimbo» and «Marinela».

- **Two invoices in one read (2026-11-24, Cumbres Qualtia RK 262247 + RK 262246: 30 + 30 = «60 facturadas»)** — when
  `reference` lists 2+ folios (`facFolios`) and the rows come from 2+ photos (`row.photo`, Invoice Reader ≥ 2026-11-24), the
  box asks which photos are of this order (`facFacturas`, `facFacturasHtml`, `FACV.fact`; nothing preselected; one invoice
  of several pages = all). Only those rows are compared (`facFilas`); `factura` saves `fotos` + `folios_leidos`, and
  `reference` = the chosen folios. A folio is put on a photo by order, only when the counts match. A read used with some
  photos only isn't hidden from other receptions. «Cambiar qué folios son de esta orden» asks again. Rows without `photo`
  (older reader) → compared whole as before. Planted case: «Refrescos Prueba».

- **Retake / re-upload always (2026-11-24, Jose)** — `facOtraFotoHtml` («Tomar o subir otra foto») at every step of the
  box (reading, failed, questions, saved review, list), for 24 h (Invoice Reader's limit; then scan it there and pick it).
  `facNuevaFoto`: the saved review stays until the new read replaces it; «Descartar estas fotos» / «Dejar la revisión
  guardada» go back. `facLectura` never compares an older read by itself while a newer one is being read or failed; the
  list shows this reception's own reads so a retake can be undone. Invoice Reader allows 10 reads per reception.

- **Terminar = pop-up, no review page (2026-11-25, Jose)** — modo botones: «Terminar revisión física» (`openResumen` →
  `pdFinAbrir`) opens a sheet over Recibir (`#pd-fin`, `pdFinRender`): «Sin escanear» (No llegó | Sí llegó per line, one by one,
  answered lines stay in place), «Antes de finalizar, regresa al proveedor» (`pdRegresar`: rechazo, de más, no solicitados
  scanned), «Si llegó, también regrésalo» (billed, not on the OC or above it) and the close button. Replaces `pdBRenderResumen`
  wherever older notes say Resumen for modo botones; the blind-count flow keeps `pdRenderResumen`. The closed view repeats the
  return list on top (`pdRecepcionHead`) and has «Copiar lista para el sistema». While it's open `pdBListRender` draws nothing (same input ids).

## Comercial view (comercial-plan.md — phase 1 built 2026-11-25)
- «Comercial» pill top-right of Inicio (`.com-btn`) → `screen-comercial` (`renderComercial`, body `#com-body`, tabs into
  `#com-tab`): Calendario (default) / Proveedores / Códigos. No PIN. State `COM`, reset by `openComercial()` every time it's
  opened from Inicio (rule 7); «← Comercial» from a reception (`backComercial`) keeps it. Admin keeps its own `ADM`.
- The Admin renderers are shared: `admCalendario(el, modo)`, `admProveedores(el, modo)`, `admCodigos(el, modo)` with
  `modo` 'admin' | 'comercial'. `VST(modo)` = state, `vRender(modo)` = re-render, `vEl(modo)` = target. Every handler they
  print passes `'${m}'` (admCalMes, admCalVer, admCodigosCsv, pvFecha, pvRango, pvVer, pvVolver, pvCsv); `pvLoad(st)`/
  `pvDefaults(st)` take the state. `PV`, `_admCal`, `_admCod` stay shared (one screen shows at a time).
- **View only**, except Códigos (the «Sin coincidencia» upload in `recibo/comercial/`): nothing else in comercial mode writes. «Ver» opens `openRecepcion(info, 'comercial')`: `rvSoloVer()` → no
  «Corregir lo recibido» (`rvEditable`), no «Terminar», and the invoice box is `facBoxSoloVer` (latest non-inicio `factura`
  review rendered, no list / photos / picks / auto-save; FACV stays null). Slack copy, FDR, CSV and «Copiar lista» stay.
  CSV downloads (Proveedores, Códigos) stay: they are what comercial uses. A new write control in the closed view must
  check `rvSoloVer()`.

- **Códigos (phase 2, 2026-11-25; comercial-plan §3a)** — same in Admin and Comercial (`admCodigos` → `codRender`). Each
  row (product + scanned code) proposes the Retool fix **SKU Calii → código del producto físico**. `skuCalii`: Masterview
  `sku` through `codigo_sistema` → `pickEntry` (hub's city; skipped on `nameClash`), else `skuPorNombre`: Masterview's
  top-level `skuByName` (normName → SKU; asked of Invoice Reader 2026-11-25 for products with no barcode, read as
  `S.skuByName`, empty until it ships), then the exact name of a barcode entry. No SKU → «sin SKU» (most Carnes today):
  never exported. **No confirm / discard (Jose, 2026-11-26):** «Descargar CSV para Retool» = every row with a SKU, header
  «SKU Calii», «Código de barras», no BOM (`downloadText(…, true)`); a scanned «code» that isn't ≥6 digits was typed text («smoo»,
  «costilla») → «No es un código de barras», never exported (`codValido`, `codEnCsv`). Under a warning (`codAvisoHtml`: unconfirmed, review the
  file, n sin SKU left out, one scanned code on 2+ SKUs). «CSV completo (para revisar)» keeps every row. The table
  `rec_codigos_fix` (`sql/codigos-fix.sql`) still exists but nothing reads or writes it now. Modo prueba: planted once per test (`DEMO.st.codPlantado`), panel tab «Códigos» lists what to expect.

- **Proveedores · fecha de cada error (phase 3, 2026-11-25; comercial-plan §2)** — shared by Admin and Comercial.
  `pvConDif(l, cob)` = faltante, rechazo, excedente, no solicitado or cobrado y no entregado. Product cards in a supplier's
  detail show «Con diferencia: 24 nov · MH Contry, …» (`pvDifHist`) without opening them; history rows with nothing to
  report are muted (`.pv-hist.ok`). `pvCsv('rec', provIdx|null, m)` = «CSV detalle por recepción» (list and supplier
  detail): one row per product per reception — Fecha, Hub, Proveedor, OC (the reception's, not per line), Código, SKU
  Calii (`skuCalii`), Producto, Und («Paquete» on pack lines), Paquete de, Pedido, Recibido, Faltante, Rechazadas, Motivo
  rechazo, Excedente («Sí» in modo botones), No solicitado, Cobrado y no entregado, Con diferencia; a reception without
  detail gets one row saying so. The by-product CSV adds «Fechas con diferencia». Tested on real data (Modo prueba has no
  closed supplier receptions). Comercial's list of extra columns is still pending.

- **Calendario · entradas en el sistema (phase 4, 2026-11-25; comercial-plan §1)** — whether what a supplier reception
  received was entered in Retool. **The Apps Script only copies**: `refrescarTodo` also reads the master's «Resumen» tab
  when ≥ 60 min passed (07:00–22:59; `entradas_ts`; a failure is logged and retried in 10 min, never stops the orders),
  `parsearEntradas_` keeps the last 30 days per hub `{ desde, ocs:{ "<Num Oc>":{ p, f, l:[[codigo, item, entrada, ud]] } } }`
  (no money, rows without Num Oc skipped, repeated codes summed) and writes `rec_pd_entradas` (one row per hub) through
  `rec_pd_entradas_put` with the same SB_SECRET (`sql/pd-entradas.sql`; `ehash_` props). `probarEntradas` logs,
  `refrescarEntradas` forces a write. Jose runs the SQL and deploys a new version. **The app compares**:
  `entComparar(cerrarDetalle, data)` in `/* ENTRADAS-PURE */` (`node tests/entradas.test.mjs`; fixture
  `fixtures/entradas-2026-11-24.json` = real closes + a «Resumen» rebuilt from the plan's dry run: 4 green, 3 red): Num Oc
  = `num_oc`, line by barcode (`entCodigo`, leading zeros off) else exact name; against **Recibido** in the OC's unit
  (`entRecibidoOC`: pack ordered in piezas → × pack_n); Kg CH tolerance; no solicitado ignored. Estados verde / rojo
  (`difs` dir `sin_entrada` app > Retool, `sin_recibir` Retool > app, incl. Retool lines we don't have) / amarillo (an OC
  not in Resumen; with 2 OCs a line not found isn't flagged while one is missing) / sin_oc (`{prov}|{fecha}` keys) /
  sin_detalle. Calendar bars: `.pd.ok` teal, `.pd.mal` danger, `.pd.esp` `--c-pend` yellow (the one added hue, because the
  plan asks yellow; only these bars and their tag); legend says CH isn't checked. Bar detail lists the differences in two
  groups. **Nothing before Monday 2026-11-23 is checked** (`ENT_DESDE`, Jose: `entDe` returns null → plain bar, not listed).
  Calendar first (hub = one button per hub, `.hub-btns`, wrapping), then below it (Admin and Comercial) `entMananaHtml`:
  every hub, closes with session fecha in the range «Recibidas del … al …» (`st.entDesde/entHasta`, default last 21 days
  but never before ENT_DESDE, `entRango`; repainted alone by `entMananaPintar`), «Por dar entrada» (today included, Jose
  2026-11-25; oldest first) and «Entrada con diferencias», per hub with
  «Copiar mensaje para el hub» (`entCopiar`, header carries the date range, tag from `config/slack.json` `hubs` {slug: '@x'}, edited in Admin → Slack as
  «Hub = @usuario»). Cache 60 s (`ENT`). Table missing → a setup note, bars as before. Modo prueba: planted once
  (`DEMO.st.entPlantado`: Cremería verde, Botanas rojo, Panadería amarillo at Contry, Botanas sin OC at Cumbres); panel
  tab «Comercial» lists what to expect. CH receptions: pending another source.

- **Códigos · SKU proveedor (phase 5, 2026-11-25; comercial-plan §3b)** — second list in Códigos (`codTabsHtml`, `st.codTipo`
  'barcode' | 'spv'; Admin and Comercial). Invoice rows Invoice Reader couldn't match → Retool needs the supplier code
  under «SKU Proveedor». Source: `spvDesdeApi` = `irPost({action:'sinCoincidencia'})` → `{ rows:[{ proveedor, ciudad, clave,
  codigo_barras, descripcion, motivo, facturas, ultima_vez, hubs:[], articulo_recibo, sku_recibo, sugerencia, sku_sugerido }],
  generado? }` (live since 2026-11-25: 60 rows → 35 with a SKU + 24 sin clave; any error → null → the uploaded file), else the CSV comercial downloads from
  Invoice Reader and uploads here (`spvSubir`, checks Proveedor + Clave proveedor columns, .xlsx refused) to
  `recibo/comercial/sin-coincidencia/{fecha}__{epochMs}.csv`, newest wins. `spvNorm` reads either shape (file column names in
  `SPV_COLS`). `spvAgrupar`: one row per normName(proveedor)|clave, clave without leading «*» (`spvClave`), invoices added,
  hubs joined minus «Pruebas de facturas»; rows without clave → «Sin clave en la factura» (reader problem, no buttons).
  SKU (`spvSku`): pick here (`st.spvPick`, «Buscar producto»/«Cambiar producto» sheet over Masterview by SKU, `mvPorSku`) >
  «SKU Calii elegido» (recibo) > «SKU sugerido» (reader); the pick lives only in this visit. No confirm / discard:
  «Descargar CSV para Retool» (SKU Calii, SKU Proveedor, no BOM) = every row with a SKU, same warning (one SKU with 2+ claves). Modo
  prueba: a planted «Sin coincidencia» CSV (`DEMO.st.spvPlantado`): *796 + 796 merged, sugerencia, sin producto, two claves on
  one SKU, sin clave.

## Modo prueba (2026-11-18)
- `?demo={semilla}` runs the whole app unchanged on fake data; Admin → **Modo prueba** opens it in a new tab (no PIN
  inside a test tab). Nothing reaches production: `demoFetch` (top of the script) replaces `window.fetch` and answers
  `rec_*` tables (small PostgREST emulator `demoPgSelect`), the `recibo` bucket (upload/list/delete/public read), Armado
  `picks`, `PD_URL` (`demoOrdenes`) and `IR_URL` (`demoIr`, signed PUTs to `demo:`) from memory. Read-only catalogs still come
  from prod (Masterview, Sorting Hub, `recibo/config/*` when not written in the test). Any other write to Supabase or the
  bridges gets 403. `localStorage` is replaced by an in-memory `MemStorage` (refuses to start if the browser won't allow it);
  IndexedDB uses `mr_factura_demo`. State survives a reload in this tab's sessionStorage (`mr_demo_{seed}`), dies with the tab.
- `demoGenerar` (near BOOT) builds five deliveries from the seed + Masterview (products sold in every city): CH Abarrotes
  (CSV + picks: menos/más/no llegó/fecha corta/dañada/sin código/no en envío/código desconocido), CH Carnes (Kg within and out
  of tolerance), «Lácteos Prueba» (1 OC + invoice: de más, no llegó, rechazos, no solicitado, renglón sin identificar, Kg),
  «Abarrotes Prueba» (2 OCs, one late, shared product) and «Refrescos Prueba» (paquetes: 12-pack OC 36 settled by the invoice, 4-pack
  61, a 12-pack short in piezas, a 6-pack off the invoice that asks «¿Qué llegó?», «caja 18pz», single cans). Same seed = same data on any device.
- Panel (`PRUEBA` tab on the left edge, `demoRender`): Qué llegó (Escanear → `processScan` like the scanner + a chip with the
  quantity), what the app should flag, Archivos (envío CSV into `#envio-file`, invoice image into `facAddFiles`), printable
  list with Code 128 barcodes (`demoC128`, checked with BarcodeDetector), Ajustes (reiniciar / otra semilla / salir).
- **Keeping it working:** any new network call must go through `fetch` (no XHR/sendBeacon); a new `rec_*` table goes in
  `DEMO.st.tables`, a new bucket or bridge needs a branch in `demoFetch`; new IndexedDB names need a demo variant. New
  features are tested by adding a planted case to `demoGenerar` and its `espera` line.

## How the code is laid out (index.html)
- Helpers copied from armado-CH sit at the top, each block labelled. Our additions: `codeKey` (cleanBC + strip
  inner spaces + bcKey — one export has `083078 003623`), `skuKeyOf`, `presentacion`/`nameHtml`, `familyKey` (§7.2).
- `test-hub` appears **only on localhost**, borrows MH Contry's sorting and city (`SORTING_SLUG`) and Armado picks (`ARMADO_HUB`).
- City: `hubCity()` reads `hubCities` from the JSON; without it, all city logic is skipped. A code Masterview knows never reaches
  "Código no reconocido" (`resolveCode` makes it a product), so "Este producto no se vende en {Ciudad}" (`noSeVendeEn`) lives in
  the not-in-envío modal. Advisory only.
- Envío upload writes `envios/{slug}/{area}/{fecha}__{epochMs}.csv` (raw) then `.json` (projection: `lines`,
  `catalogo` = non-envío rows for "Sin código", `session_id`, `session_fecha`, `stats`). JSON is written last;
  **active envío = newest `.json` in the folder**. "Empezar sin archivo" writes a placeholder JSON
  (`sinArchivo:true`, no lines, catalog copied from the previous file); the real upload reuses its session and
  opens "Revisar ahora" (`revisarItems()`: scans with `detalle.esperado===null`).
- Upload warning `sin_salida` (2026-11-24, San Nicolás): units in «Envío (nro. de unidades)» but «Envío (peso neto o piezas por
  unidad)» and «Envío (kg o pz)» blank = Retool never computed the salida. Lists the products (no quantities, blind count) and
  copies a message for CH (`copiarSinSalida`). Message only: the line stays out of the envío, nothing is filled in. «Continuar
  sin corregir» lets the upload go on.
- Session reuse (§6.7): sin-archivo reception → always reused; open reception with scans → modal "Reemplazar y
  conservar" (same `session_id`, `reemplazo` event) or "Primero cerrar" (→ Resumen); open + no scans + same day →
  silent replace; otherwise new session + `abrir`.
- Every event has a client `detalle.uid`; `addEvents` dedupes by it. Outbox `mr_outbox` (server-rejected rows →
  `mr_outbox_failed`), mirror `mr_session_{slug}_{area}_{fecha}`. `fold()` sums `scan` + `ajuste` per `sku_key`.
- Event kinds: `scan` (detalle: esperado true/false/null, kgpz, reatribuido_de, sobrante, hermano_revisado),
  `ajuste` (Corregir: `ref`=scan uid; Recontar: `recuento:true`, `origen`, antes/despues = totals),
  `confirmacion` (`diferencia:true` + `recibido` — valid only while recibido is unchanged; `revisar`;
  `kg_sin_variacion`), `cerrar` (detalle: reporte path, lineas, diferencias, badges, receptores), `admin`
  (`accion`: `reabrir` | `restaurar`), `parcial` (entrega parcial: `entrega` n, `reporte`, `productos`,
  `recibidas_total`, `fecha_entrega`). Closed = latest of cerrar vs admin reabrir (`closedState`, `sessionClosedAt`,
  `listCerradas` all apply the same rule).
- Guards live in `guardQty(card, qty)`, in this order: typo (>3× enviado, or >200 pz / >50 kg AND >1.5× enviado;
  Corregir is primary); over-enviado (Kg: beyond ±max(5%, 0.10 kg)) → "Vuelve a contar" once, then stored with
  `sobrante`; sibling qty>1 confirm (Pz only). Hermanos = `isSibling`: same familyKey, or same first word and
  (one name contains the other | one word swapped). Resumen order is frozen in `S.resumenOrder` on open (rule 2).
- Entregas parciales (any hub; built for Condesa/Zapopan, which get a big shipment tarima by tarima): "Cerrar
  entrega parcial" writes `reportes/{hub}/{area}/{session_fecha}_parcial-{n}_{hoy}_{HH-MM}_{receptor}.csv` + a
  `parcial` event; the session stays open. An event's entrega = 1 + parciales with an earlier ts (`entregaDe`).
  Totals keep adding up (a 5/9 line has 4 left; the over-enviado guard uses the running total). Scans of a closed
  entrega can't use Corregir (final Resumen Recontar still can). With parciales the stale-file modal is skipped,
  Inicio shows "Recepción parcial", Recepciones/Admin list each entrega, the final report adds `Entrega 1..n`
  columns, and the Apps Script only alerts `sin_cerrar` once the last entrega is older than `dias_gracia`.
- Código incorrecto en sistema: link on the card (scanned code → another product), button on the not-in-envío and
  unknown-code modals. Opens the name search (`openSinCodigo(mal)`, `S.codigoMal`); the pick is counted as that
  product with `metodo:'codigo_incorrecto'` and `detalle.codigo_incorrecto` = { escaneado, codigo_sistema (envío/
  Retool barcode), sistema_dice, sistema_dice_codigo }. Admin → Códigos groups them (7 / 30 days) with a CSV for
  comercial. Plain "Sin código" searches are not flagged.
- Borrar envío (Inicio, open reception only): typed "borrar" confirms. Appends `admin` {accion:'borrar', escaneos}
  (events stay — append-only), then deletes that envío's .json/.csv (`sbDeleteEnvio` only accepts `envios/…`).
  `findActiveEnvio` returns none when a `borrar` is newer than the newest file, so an older file never reappears. closedState/sessionClosedAt/listCerradas/Admin/Apps Script treat it as ended.
- Separar (fecha corta + dañadas): the card's quantity is ALWAYS the total that arrived; the "Fecha corta" / "Dañadas"
  buttons below it ask how many OF THAT TOTAL go to merma (MNA) (sum ≤ total, else blocked). Scan detalle: `fecha_corta`
  + `fecha_corta_pz`, `danadas`; old scans with `fecha_corta` alone = the whole scan. Recent list "Separar" edits it
  after the scan: `ajuste` with `cantidad:0` + `detalle.separar` (latest wins, `S.sepByRef`). Read through
  `separadasDe(ev)`, `fechaCortaDe`, `danadasDe`, `separarDe`. Resumen hints at Recontar when recibido + separadas
  covers enviado (4 + 1 when 5 arrived). Report/parcial CSV column `Dañadas`, `cerrar.danadas`, Slack cause `danadas`.
- Caducidad mínima: `parseEnvio` keeps «Vida anaquel usuarios (min. días)» as `vida_dias` (lines and catalogo[3]; files
  uploaded before 2026-11-02 don't have it → no box). Card shows `todayStr()` + días = minimum expiry accepted (no button here: the quantity field stays above the keyboard). Every scan stores `detalle.caducidad_min`; flagged pieces still count as received. `fechaCortaDe(sku)` sums flagged scans (after Corregir). Shown in the recent list,
  Resumen (row note + count), report/parcial CSV columns `Fecha corta`, `Caducidad mínima` + a note, `cerrar.fecha_corta`,
  Recepciones ("Solo fecha corta" filter).
- Blind count: `esperado` is never rendered on Recibir, Sin código, Pendientes, Canastas or Revisar ahora; it
  appears only in Resumen y cierre and Recepciones.
- Multi-device: `syncServerEvents()` reads `id=gt.S.lastId` every 15 s while Recibir/Resumen is visible;
  `onRemoteEvents` reloads a file replaced elsewhere and locks scanning when another phone closed it.
- Armado enrichment (`loadArmado`): Abarrotes only. Abarrotes is assembled one day and received the next morning, and that
  day's assembly starts before the reception closes, so only `order_date` < reception date, within 10 days (`ARMADO_DIAS`),
  and of those the order covering the most envío lines, at least 80 % (`ARMADO_MIN_COINCIDE`; else no Armado data). Latest
  row per (sku, ronda), rondas summed. Receptions closed before 2026-11-06 can hold A from the wrong assembly in
  `cerrar.errores`; Armado CH recomputes it. picks.hub is the display name ("MH Contry"), sku_key is
  cleanBC or `norm:`+name.
- Origen de la diferencia (`clasificarDiferencias`, replaces `origenDif`): A=armado, E=enviado, R=recibido.
  A=R≠E → `captura`; A=E, R>E → `sobrante_armado`; A=E, R<E → `faltante` (armado or traslado, can't tell);
  all differ → `revisar`; no Armado → `sin_armado`. Then an exact −n/+n pair of the same family (`mixUpScore`:
  isSibling, or same first word + ≥2 shared words) becomes one `cruce_armado` / `cruce_captura` / `cruce` with a
  nota. Shown in Resumen, CSV column `Origen de la diferencia`, `cerrar.origenes` (counts) + `cerrar.errores`
  (per delta: armado/enviado/recibido/origen/par) for tracking. "Mensaje para Slack" (closed reception view,
  not parciales) rebuilds it from the report CSV (old reports too) in a fixed format and copies it.
  Two paragraphs: items (A/E/R + cause tag, then fecha corta products), then the CH diagnosis (counts per cause,
  fecha corta included as a cause; weakest step; wrong barcodes stay out, those live in Admin → Códigos) opening with
  the tags from `config/slack.json` `{ tags:[…] }` (Admin → Slack; default `@alberto`; the aux adds the hub
  coordinator and Jose by hand). Tags
  must be Slack @usernames: a pasted "@Alberto Mendoza" mentions @alberto and leaves "Mendoza" as text.
- Admin → Calendario (view only): one hub, one month; each reception is a bar from session `fecha` to the Monterrey date
  of its `cerrar` (teal Abarrotes, ink Carnes; dashed = sin cerrar, reaching today only for that área's newest session;
  `borrar` sessions hidden). Legend counts the days of the month each área had a reception. An open bar (Admin only, not Comercial) has
  «Cerrar recepción» (`admCalCerrar`, 2026-11-26): loads the session's latest envío snapshot (`abrir`/`reemplazo`
  `detalle.envio`) as receptor «Admin» and opens its normal Resumen / Terminar sheet — never a forced close (rule 2).
- Admin (§6.8/6.9): PIN in memory only; writes `rec_events` (admin), `config/receptores.json`, `config/slack.json`, envío copies
  (restore), `rec_alert_config` (upsert via `pgUpsert`, `on_conflict=hub,area`). Alerts are written only by the
  Apps Script through the RPCs.
- Recepciones (closed view): tabs Diferencias (default) / Sin diferencia / Todos (`RV.f.vista`, `rvDistinto`), not on
  parciales. Diferencias = Recibido ≠ Enviado, so scale variances count (unlike `isDelta`): they must be typed, not
  approved with the rest. A search, or the fecha corta/dañadas and estado filters, look at all products.
- Judgement calls: upload warnings (§5.2) are inline buttons, not modals; Corregir is inline; Sin código /
  Pendientes / Canastas / Revisar ahora are dismissable sheets; scans shorter than 4 chars are ignored; a scanner
  burst (≥8 digits) in the quantity field becomes a new scan; without a file an unknown code can be registered as
  "Código {n}" and the unit is picked on the card.

## Workflow
- Local: `python3 -m http.server 8080` → http://localhost:8080 (not `file://`). Port 8080 is often already taken
  by an armado-CH server on this Mac — use 8081 then. Claude's preview launcher can't read ~/Desktop; start the
  server from the shell and point the browser pane at the URL.
- Real exports go in `fixtures/` (gitignored). Never commit business data.
- Bump `CACHE_NAME` in `sw.js` on every deploy that changes `index.html`.
- Netlify publishes the repo root: any new `.md` doc needs its own 404 rule in `netlify.toml` (no wildcard for it).
- **Never `git push` from the terminal.** Commit locally and stop — Jose pushes with GitHub Desktop.
  Netlify (site `mh-recibo`, https://mh-recibo.joseromero.co) auto-deploys `main`.
