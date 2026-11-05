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
- It only **reads** Armado's `picks` table and `solcitudesarmado/imagedb/*`, `solcitudesarmado/reports/*`.
  Never write, alter or delete anything outside `recibo` / `rec_*`.
- Sorting positions: read-only from bucket `sorting-hub` in this same project (Sorting Hub migrated here 2026-10-29).
- Product photos (Masterview image map): read-only from `solcitudesarmado/imagedb/` **and** `sorting-hub/imagedb/`;
  `loadImageDB` compares both `version.txt` and uses the newest upload, then the bundled `imagedb.json`.
- New tables need explicit `grant`s in the same SQL that creates them (Supabase change, 2026-10-30).
- **Local runs write to prod.** Use `hub='test-hub'` or stub write helpers before testing write flows.

## Rules that must survive any change
1. Receiver inputs: barcode + quantity (product pick only when there's no barcode).
2. No cheap exits: no bulk accept / confirm-all. Discrepancies acknowledged one by one.
7. Nothing remembered between visits: always open on Inicio (no saved hub/área/name/page).
3. Blocking modals only where plan §7.5 allows them.
4. `rec_events` is append-only and the source of truth; corrections are `ajuste` rows.
5. Dates via `serverNow()` + America/Monterrey helpers — never the device clock.
6. Never write to Retool.
8. Everything that physically arrived is received, whatever its date or state. Fecha corta never lowers Recibido or
   changes the estado: those pieces are received, then registered as merma (MNA) and separated.

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

## How the code is laid out (index.html)
- Helpers copied from armado-CH sit at the top, each block labelled. Our additions: `codeKey` (cleanBC + strip
  inner spaces + bcKey — one export has `083078 003623`), `skuKeyOf`, `presentacion`/`nameHtml`, `familyKey` (§7.2).
- `test-hub` appears **only on localhost**, borrows MH Contry's sorting (`SORTING_SLUG`) and Armado picks (`ARMADO_HUB`).
- Envío upload writes `envios/{slug}/{area}/{fecha}__{epochMs}.csv` (raw) then `.json` (projection: `lines`,
  `catalogo` = non-envío rows for "Sin código", `session_id`, `session_fecha`, `stats`). JSON is written last;
  **active envío = newest `.json` in the folder**. "Empezar sin archivo" writes a placeholder JSON
  (`sinArchivo:true`, no lines, catalog copied from the previous file); the real upload reuses its session and
  opens "Revisar ahora" (`revisarItems()`: scans with `detalle.esperado===null`).
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
- Armado enrichment (`loadArmado`): Abarrotes only; picks of the newest `order_date` within 3 days ≤ reception
  date; latest row per (sku, ronda), rondas summed. picks.hub is the display name ("MH Contry"), sku_key is
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
- Admin (§6.8/6.9): PIN in memory only; writes `rec_events` (admin), `config/receptores.json`, `config/slack.json`, envío copies
  (restore), `rec_alert_config` (upsert via `pgUpsert`, `on_conflict=hub,area`). Alerts are written only by the
  Apps Script through the RPCs.
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
- **Never `git push` from the terminal.** Commit locally and stop — Jose pushes with GitHub Desktop.
  Netlify (site `mh-recibo`, https://mh-recibo.joseromero.co) auto-deploys `main`.
