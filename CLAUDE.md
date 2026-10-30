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

## Workflow
- Local: `python3 -m http.server 8080` → http://localhost:8080 (not `file://`).
- Real exports go in `fixtures/` (gitignored). Never commit business data.
- Bump `CACHE_NAME` in `sw.js` on every deploy that changes `index.html`.
- **Never `git push` from the terminal.** Commit locally and stop — Jose pushes with GitHub Desktop.
  Netlify auto-deploys `main`.
