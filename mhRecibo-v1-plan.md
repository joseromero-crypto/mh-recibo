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
3. **Receptor inputs are barcode + quantity** (+ a product pick only when there's no barcode). Everything else is displayed.
   **Blind count:** the expected (enviado) quantity is never shown while receiving — only in the final summary.
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
10. **Nothing is remembered between visits.** No saved hub, área, name or last page in `localStorage`; the app
   always opens on Inicio. (State that protects work — outbox, local mirror of scans — is fine; it never decides
   which page opens.)
11. **Jose pushes with GitHub Desktop.** Commit locally and stop; never `git push` from the terminal.

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

**Isolation rules (three apps share one project: Armado CH, Sorting Hub, MH Recibo):**
- Reception owns: bucket `recibo`, tables prefixed `rec_`. It **only reads** `picks`, `solcitudesarmado/imagedb/*`,
  `solcitudesarmado/reports/*`. It never writes, renames or alters anything of Armado's.
- Any SQL for this app touches only `rec_*` objects.

### 3.1 SQL to run once (Supabase SQL editor, Armado CH project) — consolidated in `sql/v1-setup.sql`

> Since 2026-10-30 Supabase no longer auto-grants Data API access to new `public` tables — the `grant`s
> below are required or every call returns `permission denied`.

```sql
-- Append-only event log: one row per scan / correction / lifecycle event
create table public.rec_events (
  id          bigserial primary key,
  session_id  text not null,          -- '{slug}__{area}__{fecha}__{epochMs}' created on the phone
  hub         text not null,          -- slug, e.g. 'mh-contry'
  area        text not null,          -- 'abarrotes' | 'carnes'
  fecha       date not null,          -- reception day (America/Monterrey)
  tipo        text not null,          -- 'abrir'|'scan'|'ajuste'|'confirmacion'|'reemplazo'|'cerrar'|'admin'
  sku_key     text,                   -- bcKey(barcode) or 'name:'+normalized name when no barcode
  producto    text,
  cantidad    numeric,                -- signed for 'ajuste' (−2 = removed 2)
  metodo      text,                   -- 'scanner'|'camara'|'manual'
  detalle     jsonb,                  -- e.g. {"esperado":false,"hermano":"...","respuesta":"..."}
  receptor    text,
  device_id   text,
  ts          timestamptz not null default now()
);
create index on public.rec_events (hub, area, fecha);
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

### 3.2 Sorting positions — same project (Sorting Hub migrated 2026-10-29)
Sorting Hub now lives in this same project, bucket `sorting-hub` (public). Read
`sorting-hub/sorting/{slug}/version.txt` then `latest.json`
(shape: `items: [[producto, barcode, pasillo, estante, nivel, posDentro, temp], …]`). Read-only from here.
Cache per hub like Sorting Hub does (`version.txt` first). The old `sortinghub` project is retired.

### 3.3 Image DB
Read Armado's `solcitudesarmado/imagedb/version.txt` + `latest.json`; fall back to a bundled `imagedb.json`
(copy from armado-CH). Lookup identical to Armado (bcKey → exact name → none; first-word and prefix guesses removed 2026-11-05, see HANDOFF.md).
Read with `imgUrl()`/`imgName()` helpers that accept both the `{url,name}` and plain-string shapes.

---

## 4. Storage map (bucket `recibo`)

| Path | Written by | Read by |
|---|---|---|
| `envios/{slug}/{area}/{fecha}__{epochMs}.csv` | upload of the Envío export (raw, verbatim) | session load, audit |
| `envios/{slug}/{area}/{fecha}__{epochMs}.json` | same upload, projected rows (§5.2) | phones joining the session |
| `reportes/{slug}/{area}/{fecha}_{HH-MM}_{receptor}.csv` | cerrar recepción | Recepciones, Admin |
| `config/admin_pin.txt` | by hand in the dashboard | Admin login |
| `config/receptores.json` | Admin → Receptores | Inicio name picker |

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

### 5.2 Parsing (verified on two real files in `fixtures/`)
- `envio_mh-contry_abarrotes_2026-10-29.csv` — whole catalog (3,747 rows), 105 shipment lines, 732 pz, all Pz,
  1 line without barcode.
- `envio_carnes-congelados_2026-10-28.csv` — 987 rows, 132 shipment lines (all Temp −18: meat, fish, frozen
  bread, frozen fruit/veg), 26 Kg lines (19 with decimals, e.g. 24.6, 31.78), **26 lines without barcode (20%)**.

Rules:
- PapaParse `header:true, dynamicTyping:false`; strip BOM (first header arrives as `\ufeffProducto`);
  headers matched with `normHeader`/`pickCol`. Same 35 columns in both áreas.
- **Required:** `Producto`, `Código de barras`, `Kg/Pz`, `Envío (kg o pz)`. Missing → block the upload.
- **Expected lines = `Envío (kg o pz)` > 0.** Do NOT use `Requiere confirmar`: it matched exactly in the fresh
  Abarrotes file but is FALSE on every line of the day-old Carnes file (it seems to flip once the reception is
  registered in the system). Use it only as a hint: if every expected line has `Requiere confirmar = FALSE`, show
  at upload "**Este envío parece ya confirmado en el sistema.** ¿Es el archivo correcto?" (confirm, not block).
- **`Kg/Pz` comes in mixed case** (`Pz`, `PZ`, `Kg`, `kg`) → normalize to `Pz` / `Kg`.
- Expected amount = `Envío (kg o pz)`: pieces for Pz, **kilograms for Kg** (e.g. 24.6). `Envío (nro. de unidades)`
  holds the same number in both samples.
- Keep per line: `rowIndex` (file order), `producto`, `barcode` (cleanBC; may be empty), `sku_key`, `kgpz`,
  `esperado`, `temp`, `categoria`, `actualizacion_envio`, `envio_registrado_por`.
- Ignore `Recepción (kg o pz)` and the other Recepción columns (may hold values from other receptions).
- Sanity: 0 expected lines → block. Newest `Actualización envío` more than 2 days old → confirm.
- The file's `Posición armado` is CH's position; the hub position always comes from Sorting Hub.

### 5.3 Optional enrichment from Armado CH (v1 = display only)
If `picks` has rows for this hub with `order_date` in the last 3 days, the summary (§6.5/6.6) adds **Armado**
next to **Enviado**: `Armado (app) · Enviado (sistema) · Recibido`. When they disagree it says *where*:
- Armado ≠ Enviado → typing error registering the salida at CH.
- Enviado ≠ Recibido and Armado = Recibido → registration error, not a physical one.
- Armado = Enviado ≠ Recibido → physical loss or reception error.
Missing armado data → "—".

### 5.4 Áreas (scope)
- **Abarrotes** and **Carnes** are separate receptions: different downloads, trucks, times and receptors.
- **Carnes** = congelados (Mon/Wed/Fri, includes most Kg items, plus frozen bread and frozen fruit/veg) and fresh
  (Tue/Thu). Both are the same área in the app. Carnes is assembled **the same day** and travels in the same truck
  as Fruta y verdura, so its envío file may not exist yet when the truck arrives (§6.2b).
  After choosing the hub the receptor picks the **área**; every file, event, reception and report is keyed by
  `hub + área`. Areas never mix.
- **Fruta y verdura**: on hold — future version.
- **Proveedores directos**: nothing in the file identifies them, so there is **no special handling** — every
  item in the uploaded file is received the same way.

## 6. Users, screens & flows

### 6.0 One role: the receptor
Each hub has **one assigned auxiliar** who does everything: downloads the Envío from the system, uploads it,
scans, counts, types pieces, answers flags in real time, reviews the summary and types it into the system.
**No PIN, no encargado/coordinator split** in v1 (like Sorting Hub: anyone with the link). Jose's
cross-hub view is a later addition (§12).

### 6.1 Inicio
Always starts here, every visit: hub → **área: Abarrotes | Carnes** → receptor **picked from the hub's list**
(managed in Admin; nothing pre-selected). Then the hub+área's **active envío** (§6.7): "Continuar recepción" if one exists,
and always "Subir envío". A hub+área with no file yet can only "Subir envío".

### 6.2 Subir envío
Upload the system export → validate (§5.2) → store raw + projected in
`recibo/envios/…` → `abrir` event → Recibir. The salida is registered at CH the day before, so the file is
normally ready before the truck arrives.

### 6.2b Recibir sin archivo (Carnes arriving before its file)
When the file isn't ready, the receptor taps "**Empezar sin archivo**" and starts scanning immediately.
- Cards still show photo, name, presentation and basket letter (from the image DB + Sorting Hub) and take the
  quantity. Nothing can be flagged yet: there is no expected list.
- When the file is uploaded (same reception, §6.7 "Reemplazar el archivo y conservar lo escaneado"), the app runs
  every check retroactively and shows a "**Revisar ahora**" list: products not in the envío, counts above enviado,
  products with a sibling presentation in the envío. Each one: "Recontar" or "Confirmo".
- Pendientes and the summary appear only once a file is loaded. A reception can't be closed without a file.

### 6.3 Recibir (main screen) — blind
Top: progress as **products received / products expected** (counts of lines, never quantities), offline badge,
hub + área label.
Scan field (`inputmode="none"`, scanner types + Enter or 300 ms pause auto-submit as in Sorting Hub) + 📷 camera
+ "Sin código" (manual search).

On scan → resolve to a product:
1. **In the envío** → product card: big photo, name, **presentation highlighted**, Kg/Pz,
   **basket/aisle letter in huge type** (Pasillo from this hub's sorting; full `B-4-6` below),
   "ya registraste {n}" if scanned before, quantity field (empty, required). **No enviado number.**
2. **Not in the envío** → blocking modal (§7.1).
3. **Unknown barcode** → modal "Código no reconocido — vuelve a escanear o búscalo por nombre".

Confirm → `scan` event → local state + outbox → real-time checks (§7). Flags are answered on the spot.

Below the scan field: **last 10 scans** with "Corregir" (an `ajuste` with a reason; never deletes).
"**Pendientes**" button: products of the envío not scanned yet — photo, name, position, **no quantities** —
so the receptor can hunt for missing boxes without being told how many.

### 6.4 Canastas (pre-sort view)
Received items grouped by aisle letter: `B — 14 productos` … tap → list with photos and full positions. Read-only.

### 6.5 Resumen y cierre
Now the expected quantities are revealed: `Producto · Enviado · Recibido · Diferencia · Estado`
(`Completo · Faltante · Parcial · Sobrante · No esperado`), deltas first and highlighted.
- Each delta must be answered individually: "Recontar" (back to Recibir on that product) or
  "Confirmo la diferencia". No "confirmar todas".
- "Cerrar recepción" → `cerrar` event + report CSV to `recibo/reportes/…`.

### 6.6 Recepciones (registration view — lives in the app, like Armado's "Pedidos armados")
List of this hub+área's closed receptions (last 30 days). Opening one shows the final summary with big Recibido
numbers, tick boxes per row (`localStorage`), and **Descargar CSV**. Default order = the file's row order.
Search box (matches any words in the product name) + filters: solo diferencias / estado / Kg-Pz / pasillo;
sort by archivo, A-Z, pasillo, diferencia. (Whether the system lists products in file order is unknown —
the filters make it irrelevant.) This is what the receptor uses later to type Recepción into the
system — no printing, no Google Sheet.

### 6.7 Lifecycle: active file, stale warning, re-uploads, deletes
- **One active envío per hub+área** = the newest upload. It stays active until a new file is uploaded —
  no automatic expiry, no daily wipe.
- **Already received.** If the active file's reception is already closed, opening the hub+área shows
  "**El archivo cargado ya se recibió el {d} de {mes}.**" → [Ver resumen] / [Subir envío]. No scanning against a
  closed file.
- **Stale warning.** On opening Recibir and again at the first scan of the day, if the active file was uploaded
  on an earlier day (America/Monterrey), a modal: "**Estás trabajando con el archivo cargado el {d} de {mes}.
  Carga el archivo de hoy.**" → [Cargar archivo de hoy] / [Ignorar]. Ignorar is remembered for that file for
  the rest of the day. Also shown at upload time if the file's newest `Actualización envío` is older than
  2 days ("¿Es el envío correcto?").
- **One reception per hub + área per day.** A second upload the same day is always a re-upload of that day's
  reception (it never opens a second one).
- **Re-upload, same reception, nothing scanned yet** → the new file simply replaces the active one.
- **Re-upload while a reception has scans and is open** → modal with two options:
  "Reemplazar el archivo y conservar lo escaneado" (scans are physical counts, so they carry over and are
  re-evaluated against the new file — safe because counting is blind and deltas appear only in the summary) or
  "Primero cerrar la recepción actual" (goes to its Resumen y cierre). No option discards scans.
- **Deletes:** the receptor can't delete anything. Old files and reports stay in storage as history;
  `rec_events` is never deleted. Pruning (e.g. raw envíos older than 90 days) can come later if storage grows.

### 6.8 Admin (safety net, PIN — like Armado's coordinator)
Only for Jose / whoever he gives the PIN. PIN read from `recibo/config/admin_pin.txt` (edited by hand in the
dashboard), cached for the session only.
- **Recepciones**: every hub+área, open and closed, by day.
- **Respaldos / restore**: every replaced envío file (still in storage) can be made active again; a closed
  reception can be **reopened**; a reception can be **rebuilt from `rec_events`** if a phone's local copy is lost.
  Every admin action is itself an event (`tipo='admin'`, with who/what in `detalle`), so it can be undone too.
- **Descargas**: any reception's report CSV.
- **Receptores**: per-hub list of names (`recibo/config/receptores.json`).
- No hard deletes here either in v1.

### 6.9 Admin → Alertas (did each hub check its reception?)
Per **hub × área** switch, so a hub with a day off / permission doesn't generate useless emails.

Config (one row per hub+área, table `rec_alert_config`): `activo` on/off · `dias` (e.g. Abarrotes Mon–Sat;
Carnes Mon–Fri) · `hora_limite` (time by which reception should have started, e.g. 11:00) · `pausado_hasta`
(date — "pausar hasta el viernes" turns itself back on, so nobody forgets) · `email` on/off.

What is checked (all America/Monterrey):
1. **At `hora_limite`** on an expected day: no `abrir` and no `scan` for that hub+área today →
   alert "**MH Contry — Abarrotes: no se ha subido ni escaneado la recepción de hoy.**"
2. **End of day (21:00):** reception opened but not closed → "recepción abierta sin cerrar".
3. **Daily digest (21:00), one email for all active hubs:** each hub+área ✓ recibido (líneas, diferencias,
   "Kg sin variación" badge) / ⚠ abierta sin cerrar / ✗ sin recepción / ⏸ pausado.
- **"Sin envío" guard (Abarrotes):** Abarrotes is assembled the **previous working day** — Monday's reception was
  assembled on **Saturday**. Before alert 1, look in Armado CH (`picks` / `reports/`) for an assembly of that hub
  with `order_date` = previous working day (skip Sunday). None → no alert, digest shows "sin envío".
- **Carnes** is not assembled in Armado CH yet (planned). Until then it relies on the switch / pause; when Carnes
  moves into Armado, the same guard applies (same-day assembly).
- **Irregular hubs (Condesa, Zapopan — one reception every 1–2 weeks):** mode `tras_armado` instead of a daily
  deadline: when Armado shows an assembly finished for them, expect a reception within `dias_gracia` (default 3)
  days; otherwise alert "envío armado el {fecha} sin recepción".

**No schedule is hard-coded.** Every hub+área starts **off** with empty days/times; Jose sets days, `hora_limite`,
mode and email per hub+área himself in Admin → Alertas. An alert can't be switched on until its days and time
(or `tras_armado` mode) are filled in.
Alerts go to **jose.romero@calii.com**.

Channels:
- **In app:** Admin shows an Alertas feed (from `rec_alerts`) with a count badge on entering Admin.
- **Email: from jose.romero@calii.com to jose.romero@calii.com, via Google Apps Script.** A script in Jose's own
  Calii Google account runs on a time trigger every 15 min, reads `rec_alert_config` + `rec_events` from Supabase
  (anon key, read-only use), writes `rec_alerts` through an RPC, and sends with `MailApp`/`GmailApp` — so the email
  really comes from his Calii address, with no third-party service and no DNS changes to calii.com.
  (Rejected: Resend "from @calii.com" needs calii.com DNS records added by whoever runs the domain.)
  Each alert is sent once (`rec_alerts` unique on hub+área+fecha+tipo). Apps Script code lives in
  `alertas/apps-script.gs` in this repo for reference; Jose pastes it into script.google.com.
```sql
create table public.rec_alert_config (
  hub text not null, area text not null, activo boolean not null default false,
  email boolean not null default true, dias int[] not null default '{}', -- 0=Sun
  hora_limite time, pausado_hasta date,
  modo text not null default 'diario',  -- 'diario' | 'tras_armado'
  dias_gracia int not null default 3,
  updated_at timestamptz not null default now(), primary key (hub, area)
);
create table public.rec_alerts (
  id bigserial primary key, hub text not null, area text not null, fecha date not null,
  tipo text not null,            -- 'sin_recepcion'|'sin_cerrar'|'digest'
  mensaje text, enviado_email boolean default false, ts timestamptz not null default now(),
  unique (hub, area, fecha, tipo)
);
alter table public.rec_alert_config enable row level security;
alter table public.rec_alerts enable row level security;
create policy rac_all on public.rec_alert_config for all to anon using (true) with check (true);
create policy ra_select on public.rec_alerts for select to anon using (true);
grant select, insert, update on public.rec_alert_config to anon;
grant select on public.rec_alerts to anon;
grant select, insert, update on public.rec_alerts, public.rec_alert_config to service_role;
grant usage, select on sequence public.rec_alerts_id_seq to service_role;
```

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

### 7.3 Manual entry (no barcode) — type-ahead with photos
"Sin código" opens a text field. As the receptor types, a dropdown shows matching products, **each with its
photo**, name and presentation, matched accent/case-insensitively on every word typed ("almen 100" finds
"Almendras enchiladas Calii 100g"). **Envío products first** (marked "viene en el envío"), then the rest of the
catalog greyed. Tapping one opens the same product card as a scan (method `manual`).
Picking a non-envío product → modal 7.1. Picking a product with a sibling → banner 7.2. Still blind: the
dropdown never shows quantities.

### 7.4 Quantity sanity (real time, still blind)
- Cumulative received for a line would **exceed enviado** → modal "**Esta cantidad es mayor a lo enviado.
  Vuelve a contar.**" (the enviado number is NOT shown) → re-enter the count → if it still exceeds, it is
  stored and flagged Sobrante for the summary.
- Qty > 3× enviado or > 200 pz → extra confirm (typo guard: 120 instead of 12).
- **Kg lines:** see §7.6. Over-count check only above the scale tolerance. Typo guard: > 3× enviado or > 50 kg.
- Shortages can't be judged per scan (more boxes may come); they surface in Pendientes and in §6.5.
- Kg lines: decimals allowed; Pz lines: integers only.

### 7.6 Kg items: weigh everything, and treat "perfect" as suspicious
Every Kg item must be **weighed at the hub**. Not everyone does it today; the app exists partly to guarantee it.
CH and MH scales aren't calibrated the same, so **small variance is expected and healthy** — it's proof the item
was weighed. Because counting is blind, an exact match to two decimals is very unlikely unless the number was
copied from a label.
- Card for a Kg line: "**Pésalo en la báscula**", field labelled `kg (báscula)`, 2 decimals.
- **Scale tolerance** = ±5% of enviado or ±0.10 kg, whichever is larger. Inside it → estado
  **Completo (variación de báscula)**: shown, not a discrepancy, no acknowledgement needed. Outside it →
  Faltante/Sobrante like any other line.
- **Zero-variance check at close.** If the reception has ≥3 Kg lines and **all of them match enviado exactly**
  (or ≥80% do), a modal before closing:
  "**¿Se pesaron todos los artículos correctamente? Este recibo se reportará a gerencia sin discrepancias en kg.**"
  → [Sí, los pesé todos] / [Volver a pesar] (opens a list of the Kg lines to re-weigh).
  "Sí" closes it, records a `confirmacion` event with `{"kg_sin_variacion": true}`, and the reception carries a
  **"Kg sin variación"** badge in Recepciones, Admin and the report CSV.
- Also flagged (badge only, no modal): Kg weights typed as whole numbers on ≥80% of Kg lines (looks like the
  label's nominal weight, not a scale reading).
- Admin keeps the history so a hub/receptor that always reports perfect kg is visible.

### 7.5 Advisory vs blocking
Blocking modals are allowed **only** in 7.1, 7.2-qty, 7.4 and the zero-variance check in 7.6 — they stop a wrong number from being stored. They
never auto-skip, auto-fill or reorder anything.

---

## 8. Persistence, offline, multi-device

- **Source of truth = `rec_events`.** Session state is rebuilt by folding events (`scan` + `ajuste`).
  Lesson from Armado's Sept 2026 partial loss: never depend on a single saved snapshot.
- Local mirror in `localStorage` `mr_session_{slug}_{area}_{fecha}` (events + envío projection), wrapped in try/catch.
- **Outbox** `mr_outbox` for events that didn't land; flush on reconnect/foreground; badge with pending count.
- Multi-device: phones on the same session poll `rec_events?session_id=eq…&id=gt.{last}` every 15 s while
  Recibir is open. Totals = everyone's scans.
- Resume across days allowed (a reception can stay open overnight); Inicio flags it "abierta desde {fecha}".
- Service worker network-first; bump `CACHE_NAME` on every deploy that changes `index.html`.

---

## 9. Report CSV (`reportes/…csv`)
```
Hub, Área, Fecha, Receptor(es), Producto, Código de barras, Kg/Pz, Posición, Armado, Enviado, Recibido,
Diferencia, Estado, Notas (correcciones / confirmaciones), Alertas (e.g. Kg sin variación)
```
All cells quoted, CRLF, BOM only on browser download.

---

## 10. Build phases (each ends with a localhost check; push only when the phase works)

- **Phase 0 — Scaffold.** `index.html` shell, `sw.js`, `manifest.webmanifest`, `netlify.toml` (copy headers
  from sorting-hub), helpers copied from armado-CH. Run §3.1 SQL (Jose, in the dashboard). Verify: anon can
  insert/select `rec_events`; GET `sorting-hub/sorting/{slug}/version.txt` works; image DB loads.
- **Phase 1 — Envío + scan.** Inicio, Cargar envío, Recibir with in-envío cards, photo, position/basket letter,
  qty, events + outbox.
- **Phase 2 — Guards.** §7.1–7.4, manual search, families.
- **Phase 3 — Close.** Revisar y cerrar, report CSV, Resumen para registrar.
- **Phase 4 — Multi-device & resume.** Join session, polling, rebuild from events, overnight sessions.
- **Phase 5 — Canastas + Armado enrichment** (§6.4, §5.3).
- **Phase 5b — Alertas** (§6.9): config UI in Admin, `rec_alerts` writer RPC, Apps Script with a 15-min trigger in Jose's Calii account.
- **Phase 6 — Real-device QA** at one hub (MH Contry suggested) side by side with the Google Sheet for a few days;
  compare deltas.

**Local testing writes to prod Supabase** (shared with Armado). Use `rec_events` rows with
`hub='test-hub'`, or stub `sbUpload`/`pgInsert` in the browser. Never touch armado tables/bucket.

---

## 11. Open questions (defaults in bold until Jose answers)

Answered 2026-10-29: one receptor role does everything (no PIN for receptors) · blind count with real-time flags,
deltas revealed in the summary · the receptor downloads and uploads the envío · same person receives and
registers · Abarrotes and Carnes are separate receptions chosen after the hub · no column identifies Proveedores
directos, so all items are treated alike · lifecycle §6.7 · admin safety net §6.8 · nothing remembered between
visits · type-ahead with photos for barcode-less items · **expected qty = `Envío (kg o pz)` > 0** (checked on the
real Contry file) · scope = Abarrotes + Carnes; Fruta y verdura later · Sorting Hub already in the shared project · one reception per hub+área per day · receptor picked from a list
· summary keeps file order with search/filters/sort · Carnes may arrive before its file → "Empezar sin archivo" ·
Carnes file checked: Kg in decimals, 20% lines without barcode, `Requiere confirmar` unreliable · alert schedule is set by Jose in Admin, nothing hard-coded (§6.9) · alert email sent from his own Calii
account via Apps Script · Kg items are always weighed; variance is expected, zero variance is questioned
(§7.6).

- **Q8 Fresh Carnes (Tue/Thu):** a fresh file would confirm the same columns; not blocking.

## 12. Not in v1
Metrics, Fruta y verdura,
metrics dashboard (scans/min, error rate per hub/receiver), photo evidence on discrepancies, expiry checks,
sorting edits, Retool anything, CH Guadalupe as receiver.
