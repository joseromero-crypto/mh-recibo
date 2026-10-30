# MH Recibo — notes for Claude Code

Reception app for Calii micro hubs: receive the inter-hub shipments assembled at CH Guadalupe. Replaces the
"Calii | MH {hub} | Recepción … Scanner" Google Sheets.

**Read `mhRecibo-v1-plan.md` before building anything.** It is the spec; build it phase by phase (§10).

## Shape
- Single `index.html` (HTML + CSS + vanilla JS). No framework, no build step, no package.json. `sw.js`
  network-first. Spanish UI. Netlify publish dir `.`, no build command.
- Helpers are copied once from `~/Desktop/armado-CH/index.html` (read-only). Never edit the armado-CH or
  sorting-hub repos from here.

## Supabase — SHARED with Armado CH (production)
- Project `uuqqtksxlgkztenojufm` (Armado CH's). This app owns only bucket `recibo` and tables `rec_*`.
- It only **reads** Armado's `picks` table and `solcitudesarmado/imagedb/*`, `solcitudesarmado/reports/*`.
  Never write, alter or delete anything outside `recibo` / `rec_*`.
- Sorting positions: read-only from bucket `sorting-hub` in this same project (Sorting Hub migrated here 2026-10-29).
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

## Status (2026-10-29)
- **Phase 0 + 1 built and tested on test-hub.** Next: Phase 2 (§7 guards). Not deployed to real hubs yet.
- Verified with the anon key: insert/select `rec_events`, select `rec_alert_config` / `rec_alerts`, list/upsert/read
  bucket `recibo`, read `sorting-hub/sorting/*` and Armado's image DB. Supabase answers **HTTP 400** (not 404)
  for a missing storage object.
- Sorting Hub files exist only for `mh-contry` and `mh-condesa` so far; other hubs show "sin canasta".
- `recibo/config/receptores.json` does **not exist yet** → Inicio falls back to a free-text name (temporary).
  Shape the app expects: `{ "mh-contry": ["Nombre", …], … }` (Admin → Receptores will write it, §6.8).
- Test data in prod: `rec_events` rows with `hub='test-hub'`, files under `recibo/envios/test-hub/` and
  `recibo/test/`. Harmless; nothing reads them outside test-hub.

## How the code is laid out (index.html)
- Helpers copied from armado-CH sit at the top, each block labelled. Our additions: `codeKey` (cleanBC + strip
  inner spaces + bcKey — one export has `083078 003623`), `skuKeyOf`, `presentacion`/`nameHtml`.
- `test-hub` appears **only on localhost** and borrows MH Contry's sorting (`SORTING_SLUG`).
- Envío upload writes `envios/{slug}/{area}/{fecha}__{epochMs}.csv` (raw) then `.json` (projection: `lines`,
  `catalogo` = non-envío rows for "Sin código", `session_id`, `session_fecha`, `stats`). JSON is written last;
  **active envío = newest `.json` in the folder**.
- Session reuse (§6.7): open reception with scans → modal "Reemplazar y conservar" (same `session_id`,
  `reemplazo` event); open + no scans + same day → silent replace; otherwise new session + `abrir`.
- Every event has a client `detalle.uid`; `addEvents` dedupes by it, so a retried insert or the local mirror
  can't double-count. Outbox `mr_outbox` (rows the server rejects go to `mr_outbox_failed`), mirror
  `mr_session_{slug}_{area}_{fecha}`. `fold()` sums `scan` + `ajuste` per `sku_key`.
- Corregir = `ajuste` with `detalle.ref` = the scan's uid, `antes`/`despues`/`motivo`.
- Blind count: `esperado` is never rendered on Recibir, Sin código or Pendientes (Subir shows line counts only).
- Slots left for later phases: `guardQty()` (§7.2-qty, §7.4), `notInEnvio()` look-alikes (§7.1),
  `#sibling-slot` in the card (§7.2), `S.noEsperados` + `sessionClosedAt()` (Phase 3 close),
  `syncServerEvents()` (Phase 4 adds the 15 s `id=gt.` poll). "Primero cerrar la recepción actual" currently just
  opens Recibir; the stale-file modal (§6.7) and "Empezar sin archivo" (§6.2b) are not built yet.
- Judgement calls in Phase 1: upload warnings (§5.2) are inline "Sí, es el archivo correcto" buttons, not modals;
  Corregir is an inline editor; Sin código / Pendientes are dismissable sheets; scans shorter than 4 chars are
  ignored with a toast; a scanner burst (≥8 digits) that lands in the quantity field becomes a new scan.

## Workflow
- Local: `python3 -m http.server 8080` → http://localhost:8080 (not `file://`). Port 8080 is often already taken
  by an armado-CH server on this Mac — use 8081 then. Claude's preview launcher can't read ~/Desktop; start the
  server from the shell and point the browser pane at the URL.
- Real exports go in `fixtures/` (gitignored). Never commit business data.
- Bump `CACHE_NAME` in `sw.js` on every deploy that changes `index.html`.
- **Never `git push` from the terminal.** Commit locally and stop — Jose pushes with GitHub Desktop.
  Netlify auto-deploys `main`.
