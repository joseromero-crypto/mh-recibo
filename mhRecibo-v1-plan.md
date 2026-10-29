# MH Recibo — v1 plan

Web app for Calii micro hubs (MH) to **receive the inter-hub shipments assembled at CH Guadalupe**.
Replaces the per-hub Google Sheets "Calii | MH {hub} | Recepción … Scanner" (tabs MV → Envío →
Recepción → Confirmación → Final). Same job, fewer human errors.

Written 2026-10-29. Build with Claude Code, phase by phase (§10). Read §2 and §11 before coding.

---

## 1. Why

Today, per hub:
1. Someone downloads the shipment ("Envío") export from the system and pastes it into the sheet's **Envío** tab.
2. Receivers scan into the **Recepción** tab: barcode (col A), quantity typed by hand (col C), item name
   looked up (D), "¿Se envió?" TRUE/FALSE (E). No barcode → pick the product from a dropdown.
3. **Confirmación / Final** show `Producto · Envío (nro. de unidades) · Recepción · Delta`.
4. That summary is typed by hand into the system (Retool). No automated writes exist or are possible.

Errors this app must kill (all reception-side, today misattributed to assembly):
- **Wrong presentation from the dropdown** — "Almendras enchiladas 100g" picked when the box has the 200g.
- **Mixed presentations counted as one** — scan one 100g, count 10 pieces, type 10; really 7×100g + 3×200g.
  The registration then shows +3 / −3 and assembly gets blamed.
- **Not-in-shipment** items only turn a cell red, which is easy to ignore.

Extras a web app gives that a sheet can't:
- Product **photo** and **sorting position** (Pasillo-Estante-Nivel of *this* hub) on every scan, so
  receivers pre-sort into **one basket per aisle** while receiving — shelving afterwards is faster.
- Blocking confirmations at the moment of the mistake, not a red cell found later.
- Every scan stored server-side → resumable on another phone, and auditable.

---

## 2. Ground rules (carried over from Armado CH / Sorting Hub)

1. **Single `index.html`**, vanilla HTML/CSS/JS, no framework, no build step, no package.json. `sw.js` network-first.
2. Spanish UI. Phone first (Android Chrome + iPhone Safari), Bluetooth scanner + phone camera.
3. **Receiver inputs are barcode + quantity** (+ a product pick only when there's no barcode). Everything else is displayed.
4. **No cheap exits.** No bulk "accept all", no one-tap "mark everything received". Closing with
   discrepancies requires reviewing each one.
5. **Never write to Retool.** The app produces a summary that makes the manual typing fast and exact.
6. **Dates/times** via `serverNow()` + `America/Monterrey` helpers copied from Armado CH (§9.1 of its handoff).
   Never `new Date().toISOString().slice(0,10)`.
7. **Safety invariant:** once a reception has ≥1 scan, it can always be resumed or rebuilt (§6.3). Nothing
   deletes scan history.
8. Helpers are **copied once** from `~/Desktop/armado-CH/index.html` (read-only reference): `cleanBC`, `bcKey`,
   `bcMatch`, `normHeader`/`pickCol`, `sbReq` (8 in flight + 429 backoff), `serverNow`/TZ, image DB lookup.
   Never edit the armado-CH or sorting-hub repos from here.
9. Real business exports go in `fixtures/` (gitignored). The GitHub repo may be public.
10. **Jose pushes with GitHub Desktop.** Commit locally and stop; never `git push` from the terminal.

---

## 3. Supabase — shared with Armado CH (no new project)

Use the **Armado CH project** (`uuqqtksxlgkztenojufm`). Reasons: no extra compute charge, and the reception
app can read what was actually assembled (`picks`, `reports/`) and the shared image DB without uploads.

```js
SB_URL = 'https://uuqqtksxlgkztenojufm.supabase.co'
SB_KEY = <same anon/publishable key as armado-CH index.html>
BUCKET = 'recibo'                         // NEW bucket — keep armado's 'solcitudesarmado' untouched
ARMADO_BUCKET = 'solcitudesarmado'        // read-only from this app
```

**Isolation rules (both apps share one database):**
- Reception owns: bucket `recibo`, tables prefixed `rec_`. It **only reads** `picks`, `solcitudesarmado/imagedb/*`,
  `solcitudesarmado/reports/*`. It never writes, renames or alters anything of Armado's.
- Any SQL for this app touches only `rec_*` objects.

### 3.1 SQL to run once (Supabase SQL editor, Armado CH project)

> Since 2026-10-30 Supabase no longer auto-grants Data API access to new `public` tables — the `grant`s
> below are required or every call returns `permission denied`.

```sql
-- Append-only event log: one row per scan / correction / lifecycle event
create table public.rec_events (
  id          bigserial primary key,
  session_id  text not null,          -- '{slug}__{fecha}__{epochMs}' created on the phone
  hub         text not null,          -- slug, e.g. 'mh-contry'
  fecha       date not null,          -- reception day (America/Monterrey)
  tipo        text not null,          -- 'abrir'|'scan'|'ajuste'|'confirmacion'|'cerrar'
  sku_key     text,                   -- bcKey(barcode) or 'name:'+normalized name when no barcode
  producto    text,
  cantidad    numeric,                -- signed for 'ajuste' (−2 = removed 2)
  metodo      text,                   -- 'scanner'|'camara'|'manual'
  detalle     jsonb,                  -- e.g. {"esperado":false,"hermano":"...","respuesta":"..."}
  receptor    text,
  device_id   text,
  ts          timestamptz not null default now()
);
create index on public.rec_events (hub, fecha);
create index on public.rec_events (session_id);
alter table public.rec_events enable row level security;
create policy rec_events_insert on public.rec_events for insert to anon with check (true);
create policy rec_events_select on public.rec_events for select to anon using (true);
grant select, insert on public.rec_events to anon;
grant usage, select on sequence public.rec_events_id_seq to anon;

-- Storage bucket for envío files and final reports
insert into storage.buckets (id, name, public) values ('recibo','recibo', true);
create policy recibo_select on storage.objects for select to anon using (bucket_id = 'recibo');
create policy recibo_insert on storage.objects for insert to anon with check (bucket_id = 'recibo');
create policy recibo_update on storage.objects for update to anon using (bucket_id = 'recibo');
create policy recibo_delete on storage.objects for delete to anon using (bucket_id = 'recibo');
```
No UPDATE on `rec_events` — corrections are new `ajuste` rows. The bucket gets UPDATE so upsert works
(no delete-then-insert gap like armado's bucket).

### 3.2 Sorting positions — read from Sorting Hub's public bucket (cross-project)
`https://lcxlfhnvukakzybqxacq.supabase.co/storage/v1/object/public/sorting-hub/sorting/{slug}/version.txt`
then `…/latest.json` (shape: `items: [[producto, barcode, pasillo, estante, nivel, posDentro, temp], …]`).
Public GET, no key. Cache per hub like Sorting Hub does (`version.txt` first).
**Later (not v1):** move Sorting Hub into this same project to retire one more Supabase project; when that
happens only this URL constant changes.

### 3.3 Image DB
Read Armado's `solcitudesarmado/imagedb/version.txt` + `latest.json`; fall back to a bundled `imagedb.json`
(copy from armado-CH). Lookup identical to Armado (bcKey → exact name → first word → prefix ≥5 chars).
Read with `imgUrl()`/`imgName()` helpers that accept both the `{url,name}` and plain-string shapes.

---

## 4. Storage map (bucket `recibo`)

| Path | Written by | Read by |
|---|---|---|
| `envios/{slug}/{fecha}__{epochMs}.csv` | upload of the Envío export (raw, verbatim) | session load, audit |
| `envios/{slug}/{fecha}__{epochMs}.json` | same upload, projected rows (§5.2) | phones joining the session |
| `reportes/{slug}/{fecha}_{HH-MM}_{receptor}.csv` | cerrar recepción | coordinator / Jose |

`{slug}`: `mh-contry`, `mh-cumbres`, `mh-guadalupe`, `mh-san-nicolas`, `mh-avicola`, `mh-zapopan`, `mh-condesa`
(same as Armado CH and Sorting Hub). CH Guadalupe is not a receiving hub in v1.

---

## 5. Input: the Envío export

### 5.1 File
The same system export pasted today into the sheet's **Envío** tab. Observed columns (MH Contry, 2026-10-28):
`Producto, Proveedor, Código de barras, SKU proveedor, Temp, Posición inventario, Tiers, Vida anaquel
proveedores (min. días/fecha), Vida anaquel usuarios (min. días/fecha), Categoría, Kg/Pz, Actualización
recepción, Registrado por, Nro. de unidades, Notas, Posición armado, Unidad, Peso neto o piezas por unidad,
Envío (nro. de unidades), Actualización envío, Envío (peso neto o piezas por unidad), Solicitud, Compra,
Envío registrado por, Recepción (kg o pz), Recepción - Envío (#), Recepción - Envío (%), Envío (kg o pz),
Requiere confirmar, …`

### 5.2 Parsing
- PapaParse `header:true, dynamicTyping:false`; strip BOM; headers matched with `normHeader`/`pickCol`.
- **Required:** `Producto`, `Código de barras`, `Kg/Pz`, `Envío (kg o pz)` (fallback `Envío (nro. de unidades)`).
  Missing → block upload with a clear message.
- **Expected lines** = rows with `Envío (kg o pz) > 0` (⚠ open question Q1: or `Requiere confirmar = TRUE`?).
- Keep per line: `producto, barcode (cleanBC), sku_key, kgpz, esperado, envio_ts, envio_por`.
- Sanity: 0 expected lines → block ("¿Es el archivo de envío correcto?"). `Actualización envío` dates
  older than 3 days → warning (stale file).
- Wrong-hub guard: none possible from the file alone; the hub is chosen on screen and stamped on the file name.

### 5.3 Optional enrichment from Armado CH (v1 = display only)
If `picks` has rows for this hub with `order_date` in the last 3 days, show per line **Armado** (sum of
`cantidad`, latest ronda) next to **Enviado**. Three numbers on the final summary:
`Armado (app) · Enviado (sistema) · Recibido`. When they disagree it says *where* the error happened:
- Armado ≠ Enviado → typing error registering the salida at CH.
- Enviado ≠ Recibido and Armado = Recibido → registration error, not a physical one.
- Armado = Enviado ≠ Recibido → physical loss or reception error.
Missing armado data → the column just shows "—" (Armado CH may not be in use every day).

---

## 6. Screens & flows

### 6.1 Inicio
Hub picker (remembered in `localStorage` `mr_hub`), receiver name (remembered `mr_receptor`, free text v1).
Card per open reception for this hub today (from `rec_events` `abrir` without `cerrar`): "Continuar".

### 6.2 Cargar envío
Upload the Envío CSV → validate (§5.2) → store raw + projected in `recibo/envios/…` → write `abrir` event →
open Recibir. A second phone on the same hub sees the open session and can join it (shared `session_id`).

### 6.3 Recibir (main screen)
Top: progress `líneas completas / esperadas`, `piezas recibidas / enviadas`, offline badge.
Scan field (`inputmode="none"`, scanner types + Enter or 300 ms pause auto-submit as in Sorting Hub) + 📷 camera
+ "Sin código" (manual search).

On scan → resolve to a product:
1. **In the envío** → product card: big photo, name, **presentation highlighted**, Kg/Pz,
   **basket/aisle letter in huge type** (Pasillo from this hub's sorting; full `B-4-6` below),
   enviado / recibido so far, quantity field (empty, required; Kg with decimals, Pz integers).
2. **Not in the envío** → blocking modal (§7.1).
3. **Unknown barcode** (not in envío, sorting or image DB) → modal: "Código no reconocido — vuelve a escanear
   o búscalo por nombre". Option "Recibir como no identificado" requires a photo-less note (name typed).

Confirm → `scan` event (sku, qty, method) → local state + outbox. Each confirm re-checks the guards in §7.

Below the scan field: **last 10 scans** with "Corregir" (opens an `ajuste` with a reason; never deletes).

### 6.4 Canastas (pre-sort view)
Received items grouped by aisle letter: `B — 14 productos / 52 pz` … tap → list with photos and full positions.
Purpose: shelve basket by basket. Read-only.

### 6.5 Revisar y cerrar
Table of every expected line + every unexpected item, status:
`Completo · Faltante · Parcial (menos) · Sobrante (más) · No esperado`.
- Discrepancies listed first. Each one must be acknowledged individually: "Recontar" (goes back to Recibir
  filtered to that product) or "Confirmo la diferencia". No "confirmar todas".
- Then "Cerrar recepción" → `cerrar` event + report CSV to `recibo/reportes/…`.

### 6.6 Resumen para registrar
After closing: the list in the **same order as the system's reception screen** (⚠ Q3), big numbers, tick boxes
(`localStorage` per report, like Armado's registration copilot), filters (solo diferencias / todos), copy-to-clipboard.
Download CSV with BOM.

---

## 7. Error guards (the point of the app)

### 7.1 Not in the envío
Modal: "**Este producto no viene en el envío.**" + photo of what was scanned + **up to 3 look-alikes that ARE in
the envío** (same product family, §7.2) with photos and positions.
- "Era este otro" → re-attributes this scan to the chosen line (event detalle records the switch).
- "Volver a escanear".
- "Sí, llegó este producto" → recorded as **No esperado**, requires the quantity like any scan.

### 7.2 Sibling presentations ("hermanos")
Family key = normalized name with size/weight/count tokens removed (`100g`, `1kg`, `500ml`, `12pz`, `(4pz de …)`),
lowercase, accents stripped. Precompute families over envío + image DB names.
- When the scanned/picked product has a sibling **in the same envío**: the card shows a yellow banner with both
  photos: "**Ojo: también vienen {hermano}. Cuenta por separado.**"
- If the receiver types qty > 1 for a product with an in-envío sibling: confirm modal
  "**¿Revisaste pieza por pieza que las {n} son {presentación}?**" → "Sí, todas" / "Voy a revisar".
  (Not shown for products without siblings — no friction where there's no risk.)

### 7.3 Manual entry (no barcode)
Search box. Results show **envío products first** (with photo + "viene en el envío"), then the rest of the
catalog greyed. Picking a non-envío product → modal 7.1. Picking a product with a sibling → banner 7.2.

### 7.4 Quantity sanity
- Received total for a line would exceed enviado → confirm "Vas a recibir {x} y se enviaron {y}. ¿Contaste bien?".
- Qty > 3× enviado or > 200 pz → second confirm (typo guard: 120 instead of 12).
- Kg lines: decimals allowed; Pz lines: integers only.

### 7.5 Advisory vs blocking
Blocking modals are allowed **only** in 7.1, 7.2-qty, 7.4 — they stop a wrong number from being stored. They
never auto-skip, auto-fill or reorder anything.

---

## 8. Persistence, offline, multi-device

- **Source of truth = `rec_events`.** Session state is rebuilt by folding events (`scan` + `ajuste`).
  Lesson from Armado's Sept 2026 partial loss: never depend on a single saved snapshot.
- Local mirror in `localStorage` `mr_session_{slug}_{fecha}` (events + envío projection), wrapped in try/catch.
- **Outbox** `mr_outbox` for events that didn't land; flush on reconnect/foreground; badge with pending count.
- Multi-device: phones on the same session poll `rec_events?session_id=eq…&id=gt.{last}` every 15 s while
  Recibir is open. Totals = everyone's scans.
- Resume across days allowed (a reception can stay open overnight); Inicio flags it "abierta desde {fecha}".
- Service worker network-first; bump `CACHE_NAME` on every deploy that changes `index.html`.

---

## 9. Report CSV (`reportes/…csv`)
```
Hub, Fecha, Receptor(es), Producto, Código de barras, Kg/Pz, Posición, Armado, Enviado, Recibido,
Diferencia, Estado, Notas (correcciones / confirmaciones)
```
All cells quoted, CRLF, BOM only on browser download.

---

## 10. Build phases (each ends with a localhost check; push only when the phase works)

- **Phase 0 — Scaffold.** `index.html` shell, `sw.js`, `manifest.webmanifest`, `netlify.toml` (copy headers
  from sorting-hub), helpers copied from armado-CH. Run §3.1 SQL (Jose, in the dashboard). Verify: anon can
  insert/select `rec_events`; GET sorting-hub `version.txt` cross-project works; image DB loads.
- **Phase 1 — Envío + scan.** Inicio, Cargar envío, Recibir with in-envío cards, photo, position/basket letter,
  qty, events + outbox.
- **Phase 2 — Guards.** §7.1–7.4, manual search, families.
- **Phase 3 — Close.** Revisar y cerrar, report CSV, Resumen para registrar.
- **Phase 4 — Multi-device & resume.** Join session, polling, rebuild from events, overnight sessions.
- **Phase 5 — Canastas + Armado enrichment** (§6.4, §5.3).
- **Phase 6 — Real-device QA** at one hub (MH Contry suggested) side by side with the Google Sheet for a few days;
  compare deltas.

**Local testing writes to prod Supabase** (shared with Armado). Use `rec_events` rows with
`hub='test-hub'`, or stub `sbUpload`/`pgInsert` in the browser. Never touch armado tables/bucket.

---

## 11. Open questions (defaults in bold until Jose answers)

- **Q1 Expected quantity column:** **`Envío (kg o pz)` > 0** vs `Requiere confirmar = TRUE`. Need a real export
  in `fixtures/` to confirm.
- **Q2 Scope:** the sheets also exist for **Carnes** and **Proveedores Directos**. v1 = **Abarrotes (inter-hub
  from CH) only**; Carnes probably reuses the same flow; Proveedores Directos (compra vs recepción) later.
- **Q3 Registration order:** what order does the system's reception screen list products in? Default
  **Posición armado**, as in Armado CH.
- **Q4 One envío per day per hub, or several?** Default **several allowed** (each upload = its own session).
- **Q5 Receiver list:** free text (v1 default) vs a managed list like Armado's `assemblers.json`.
- **Q6 Kg products** (meat, bulk): weighed on reception or trusted as sent? Default **typed weight, decimals**.

---

## 12. Not in v1
Metrics dashboard (scans/min, error rate per hub/receiver), photo evidence on discrepancies, expiry checks,
sorting edits, Retool anything, CH Guadalupe as receiver, migrating Sorting Hub into this project.
