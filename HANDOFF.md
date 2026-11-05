# MH Recibo — handoff

## 2026-11-05 — no photo beats a wrong photo
- `getImgUrl` is now barcode (`pickEntry` with the hub's city), then exact name, then the no-photo box. The first-word and prefix
  guesses are gone: products missing from Masterview got another product's photo. Same change as Armado CH commit `10c87ee`.
- A barcode entry is skipped when its Masterview name shares no word with the product's (`nameClash`; sizes, units and `IMG_FILLER` don't
  count, a shared brand does), since a reused barcode is another product. The check runs on the entry the city picked.
- No name means nothing to compare, so the barcode photo stays. That covers calls with an empty `producto` and the sin-archivo
  placeholder "Código {n}" (`codigo` is in `IMG_FILLER`, which Armado's list doesn't have). Armado's `doUpload` console count wasn't ported.
- Old vs new, bundled `imagedb.json` (same version as the live bucket): both envío fixtures unchanged (3,747 abarrotes rows, 987 carnes rows,
  all resolve by barcode or exact name). 19/10 Contry order: 3 of 451 rows lost a photo, all reserva, same in the 4 cities: Nachos Tostitos
  400g (showed Doritos), Totopos de maíz lemon pepper Nūbe 300g (showed Charras), Totopos de maíz enchilados Nūbe 300g (showed Chips de
  camote). No row changed to a different photo. Real `envios/` files in Supabase were not read.
- Browser check on a copy that blocked every non-GET: `imgTag` gives the no-photo box for those three and keeps the photo for a normal row,
  an empty name and "Código {n}". 0 writes attempted, nothing to clean up. The Recibir flow itself was not run. **Not tested:** real phones.
- **To know:** a shared brand counts as a match, so a barcode reused between two Calii products isn't caught. In `alt` today: Huevo rojo /
  Galleta cookies and cream, and Galleta brownie / Gelato de Lotus. Those only show if such a product reaches a hub in the other city.

## 2026-11-05 — shared Masterview (plan Phases 4.2 and 6)
- `loadImageDB` reads `masterview/`, then the last cached copy, then the bundled `imagedb.json`. The two-bucket "newest of"
  logic is gone, and so is the `mr_imgdb_cache` localStorage entry (removed on every load). The cache is now Cache Storage
  `calii-masterview`, which `sw.js` keeps across deploys.
- Barcodes use `pickEntry` with the hub's city (`map` first, then `alt`). test-hub borrows MH Contry's city.
- The not-in-envío modal adds "Este producto no se vende en {Ciudad}" when Masterview knows the code and the hub's city isn't in
  its `c`. Nothing else in the flow changes. It isn't in "Código no reconocido": a code Masterview knows never reaches that modal.
- `imagedb.json` is now a full copy of `latest.json` (version `0e330dae`, 1.3 MB to 2.0 MB).
- Tested on localhost in headless Chrome against the live bucket, with `recibo` / `rec_*` faked in memory: 0 writes reached
  Supabase, so there's nothing to clean up. Results are in `unifyMasterview-plan.md` (4.2 result).
- **Not tested:** real phones (Android Chrome, iPhone Safari).
- **To know:** `netlify.toml` caches `/imagedb.json` for 30 days, so a phone can keep the old flat file for a while. The loader still
  reads it, without city logic. This only matters offline on a phone with no cached Masterview. Sorting Hub has the same header.

## 2026-10-30 — entregas parciales
For hubs that receive a big shipment once every week or two (Condesa, Zapopan; available to every hub).
- Recibir has **📦 Cerrar entrega parcial (sigo después)** above **✅ Terminé todo: revisar y cerrar**. It lists what
  was scanned in this tarima (quantities only, still blind), then saves a report for that tarima and keeps the
  reception open.
- Next visit (same day or later): Inicio shows "Recepción parcial · N entregas cerradas" → Continuar. No old-file
  warning. Totals carry over: 5 of 9 received means 4 left, and scanning a product that already arrived complete
  triggers "mayor a lo enviado".
- Scans from a closed tarima can't be edited with Corregir; the final summary's Recontar still fixes a total.
- Final close works as before (each difference answered one by one); the report adds one column per tarima.
- Recepciones and Admin list each entrega parcial so it can be registered in the system as it arrives.
- Alert script: an open reception with a partial close doesn't trigger the nightly "sin cerrar" alert until its
  last entrega is older than the hub's grace days; the digest shows "◐ parcial". **Re-paste
  `alertas/apps-script.gs` if you already installed it.**
- Tested on test-hub with the Abarrotes file: tarima 1 = 40 products (aceite 4 of 6, frijoles 30 of 48), closed;
  next day (simulated) tarima 2 = the rest minus 7 products, plus a duplicate guayaba (blocked) and a Corregir.
  Final report: aceite 4+2 and frijoles 30+18 Completo, 7 Faltante, every row's tarima columns add up to Recibido.
  Not tested: two phones closing a tarima at once, the Admin view (no PIN file yet), the Apps Script run.

## 2026-10-30 — full QA run with the real files (commit `de6bcb5`)
Two full receptions on `test-hub` with your two fixtures (not your MH Contry test reception, to keep the real hub's
history clean). Deliberate errors, with a separate record of what should be received, checked against the app.
- **Abarrotes (105 lines, 732 pz):**
  - Errors put in on purpose: 5 lines missing; 2 short by one; 2 with an extra piece (counted twice); a 720-for-72
    typo; a 200-for-20 confirmed then recounted; the wrong jam flavor scanned and moved with "Era este otro"; an
    Oreo that's not in the envío recorded as No esperado; an unknown code; a 2-digit code; the barcodeless
    Hojarascas found by search; a double trigger; a scanner burst into the quantity field; a found box recounted
    in the summary.
  - Result: Recibido matched on all 106 rows of the report.
- **Carnes (132 lines, 26 Kg, 26 without barcode):**
  - Errors put in on purpose: every Kg line weighed with ±1–3% scale variance; one 15% short; one 12% over
    (counted twice); a 10× typo; a comma decimal; a 3-decimal entry; a decimal typed for a Pz item; 3 Pz lines
    missing; two weighings for one line.
  - Result: matched on all 132 rows. 19 lines came out "Completo (variación de báscula)", 5 exact, 1 Parcial,
    1 Sobrante.
- Every barcodeless Carnes product is in the top 5 search results after typing 2 words.

**Fixed:**
- 40 for 4: the "mayor a lo enviado" check ran before the typo check, so "¿Seguro que son 40?" never showed.
  The typo check now runs first, and its primary button is Corregir.
- "Empezar sin archivo" is off (`SIN_ARCHIVO_ENABLED = false`). The code is kept for emergencies.
- "Primero cerrar" opened the summary under the old-file pop-up (a loop) and dropped the chosen file. After
  closing it now offers "Ahora carga el archivo nuevo".
- Summary: answered rows moved away, so tapping one spot over and over confirmed everything (rule 2). The order
  now stays fixed while the summary is open.
- Hermanos: the plan's rule (same name, other size) found **0** pairs in the real Abarrotes file. It now also
  catches variants and flavors of the same product type (same first word): frijoles normal vs bajos en grasa,
  mermelada higo/fresa, molida 95/5 vs 98/2, camarón 41/50 vs 16/20, tortillas azul/amarillo, tamal carne/frijol…
  That's 4 pairs in Abarrotes and 16 in Carnes, all real mix-up risks.
- A 65.11 kg line triggered "¿Seguro?" on a correct 63.81 kg weighing. The 50 kg / 200 pz limits now apply only
  when the number is also more than 1.5× what was sent.
- Armado explanation for a Sobrante said "pérdida física". It now says "llegó de más".
- Corregir only reached the last 10 scans. A "Ver todos los escaneos" link was added.
- A scanner burst into the quantity field now warns "No se registró «X»" for the product left open.

**Still not tested:** a real phone, a Bluetooth scanner, the camera, the Apps Script.

---

# Overnight handoff (2026-10-29 → 30)

Phases 2, 3, 4, 5 and 5b are built, each tested on `test-hub` at localhost (phone width) and committed.
**Nothing is pushed** — push from GitHub Desktop when you're happy (Netlify deploys `main`).

| Commit | What |
|---|---|
| `6b62f76` | Phase 2 — guards (§7.1–7.4), families, stale-file warning, Empezar sin archivo |
| `f92c537` | Phase 3 — Resumen y cierre, report CSV, Recepciones (registration view) |
| `9acf57c` | Phase 4 — 15 s polling between phones, remote close / file replace |
| `a3d5928` | Phase 5 — Canastas, Armado enrichment from `picks` |
| `f3290fa` | Phase 5b — Admin + alert RPC SQL + Apps Script |
| `e929001` | Review fixes (no corrections after close, Armado reset per reception) |

## You need to do (before real use)
1. **Run `sql/v1-alerts-rpc.sql`** in the Supabase SQL editor. It only creates two `rec_*` functions the Apps
   Script uses to write alerts; until then the script can't record alerts.
2. **Create `recibo/config/admin_pin.txt`** (Storage → recibo → config) with the PIN. Admin shows
   "Todavía no hay PIN" until it exists.
3. **Admin → Receptores**: type each hub's names (one per line) → Guardar. Until then Inicio asks for a free-text name.
4. **Apps Script**: script.google.com from your Calii account → paste `alertas/apps-script.gs` → set `APP_URL`
   to the real Netlify URL → run `probar` (authorize) → run `instalar` (15-min trigger).
5. **Admin → Alertas**: every hub+área starts **off**. Set days, hora límite (or "Tras armado" for Condesa/Zapopan)
   and switch on.

## What each phase does
**Phase 2 — guards**
- §7.1: "Este producto no viene en el envío" shows up to 3 look-alikes from the envío (same family first, then
  shared words), with photo and position. "Era este otro" moves the scan to that line, and the scan's detalle keeps
  what was actually scanned.
- §7.2: the card shows a yellow "Ojo: también vienen {hermano}. Cuenta por separado" banner with photos. For more
  than 1 piece it asks "¿Revisaste pieza por pieza que las {n} son {presentación}?".
- §7.4: if the running total exceeds enviado, "Vuelve a contar" clears the field. A second count that is still
  over is stored and flagged Sobrante. Kg only counts as over beyond ±max(5%, 0.10 kg). Typo guard above 3× or
  200 pz / 50 kg. Enviado is never shown.
- §6.7 stale-file modal, on opening Recibir and at the first scan. Ignorar lasts for that file for the rest of the day.
- §6.2b **Empezar sin archivo** (switched off on 2026-10-30, see above). Cards still show photo and basket. Products are named from the previous file's
  catalog; an unknown code can be counted as "Código {n}"; the unit (Pz/Kg) is picked on the card when unknown.
  Uploading the file later reuses the same reception and opens **Revisar ahora** (not in the envío / above
  enviado / has a sibling), where each item is "Recontar" or "Confirmo".
- Recontar = the receptor types the total → stored as an `ajuste` with the difference.

**Phase 3 — close**
- Resumen y cierre: Enviado · Recibido · Diferencia · Estado, differences first. Each one needs its own
  "Recontar" or "Confirmo la diferencia". A confirmation stops counting if the number changes later.
- §7.6: with at least 3 Kg lines and 80% or more matching exactly, closing asks "¿Se pesaron todos…?"
  [Sí / Volver a pesar]. "Sí" adds the **Kg sin variación** badge. 80% or more whole kilograms gives the
  "Kg en números enteros" badge.
- Closing first uploads anything left in the outbox and pulls in other phones' scans. It then writes
  `reportes/{hub}/{area}/{fecha}_{HH-MM}_{receptor}.csv` (§9 columns, quoted, CRLF) and adds the `cerrar` event.
- **Recepciones cerradas** (link on Inicio, and "Ver resumen" when the file was already received) lists the last
  30 days. Each one opens with big Recibido numbers, tick boxes, search, filters (solo diferencias, estado, Kg/Pz,
  pasillo) and sort (archivo, A-Z, pasillo, diferencia). "Descargar CSV" adds the BOM for Excel.

**Phase 4 — several phones.** Every 15 s while Recibir or Resumen is open, the app reads only new `rec_events`.
- Scans from other phones show up in the totals and in the recent list.
- If another phone closes the reception, scanning locks and a "Ver resumen" link appears.
- If another phone replaces the file, the new file is loaded.

**Phase 5**
- 🧺 Canastas lists what was received grouped by aisle letter.
- For Abarrotes, Resumen and the report add the **Armado** number from Armado's `picks`, and say where each
  difference came from (§5.3).
- Real-data check: for MH Contry 29 Oct, Armado matched the envío file on all 105 lines.

**Phase 5b — Admin** (🔒 link at the bottom of Inicio)
- Recepciones: every hub, last 14 days, open or closed, with Ver, CSV and Reabrir.
- Respaldos: make an old envío file active again.
- Receptores and Alertas: the alert schedule per hub+área, plus a feed of recent alerts.
- Every admin action on a reception is a `tipo='admin'` event. There are no deletes anywhere.

## Bugs found and fixed during testing
- The close button stayed disabled after the pending events finished uploading. The summary now redraws when the
  upload finishes.
- In the Recepciones filter, the aisle came out as "J · 8" for positions without estante/nivel; it now shows "J".
- The recent list showed "Código 76…" for scans made without a file even after the file named the product.

## Things to know / decide
- **I saw a real reception open on prod:** "MH Contry · Abarrotes, abierta desde 23:28, receptor *jose*". It wasn't
  me, and I didn't touch it. It's probably you trying the deployed Phase 1.
- **Assembly-date guard in the alert script:** the plan says Abarrotes is assembled the previous working day, but
  `picks` for MH Contry has `fecha = order_date = 2026-10-29`, the same date as that day's envío file. The script
  accepts any assembly from the previous working day through today. Check against a real Monday.
- Starting "sin archivo" is offered when there's no reception open today. A closed reception from today doesn't
  block a second sin-archivo one; the plan's "one reception per day" didn't cover that case.
- "Abierta desde" in Admin uses the first event of the reception.
- The app is live at https://mh-recibo.joseromero.co (Netlify site `mh-recibo`); the Apps Script `APP_URL` points there.

## Not tested (needs Phase 6)
- A real phone, a Bluetooth scanner, the camera, two physical phones at once (simulated by inserting another
  device's rows), Apps Script runs (needs the SQL + your Google account), real email delivery.

## Test data written to prod (all `test-hub`, harmless)
- `rec_events` rows with `hub='test-hub'`.
- `recibo/envios/test-hub/…` and `recibo/reportes/test-hub/…`.
- One `rec_alert_config` row for test-hub, switched off.
- Nothing was written outside `recibo` / `rec_*`; Armado and Sorting Hub were only read.

## Next: Phase 6
1. Push, then open the Netlify URL on the MH Contry receptor's phone.
2. Do the setup steps above.
3. Run one real Abarrotes reception next to the Google Sheet for a few days and compare the differences.
