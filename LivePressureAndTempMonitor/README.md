# Grant G Solutions Hydrotest Field Recorder

The website at `grantgsolutions.com/hydro`. It runs on your own PHP/MySQL hosting.

- `host.php`: the operator page on the trailer laptop. It reads the Crystal XP2i/XP3i gauge over USB once a second, records it, and shows the circular chart, temperatures, field log and paperwork.
- `viewer.php`: a read-only page for remote viewers, behind a per-test password.
- `history.php`: saved tests from any device: replay, logs, rename, folders and Trash.

The physical charts stay the primary paperwork. The site records and helps fill in paperwork; it never passes or fails a test and never operates pumps or valves.

## Screens on the operator page

- **Live test**: a large current-pressure readout with its change over the last five minutes, the gauge connection, inside/outside the pressure window, the circular chart, and the field log ("What happened, and when?"). Log entries can be added in any order, at any time, with the actual event time. Nothing has to be done in sequence and nothing is timed. Tick **Show to remote viewers** to also show an entry on the viewer page; it goes to the Sheet exactly as any other field-log entry. The **log book** below lists pressure, its change since the row before, and the temperatures at the interval you pick (5 sec, 15 sec, 1, 5, 15 or 30 min, 1 hr).
- **Temperatures**: start and stop the website's temperature recording, choose which probes viewers see, the combined pressure and temperature chart, and manual temperature entry.
- **Setup**: job details, Atmos design PDF import, equipment, pressure offset, chart scale and window, probe names, then **Start new test** at the bottom. The equipment library is folded away at the end.
- **Records**: official start and end times (a date box, today until set, and a time box left blank; nothing is saved until a time is typed), the 15-minute official record, Google Sheet buttons, downloads and the field log. Stroke counts and local backups are folded away below.
- **Tools**: the hydrotest calculator and the recorder report. The calculator's formulas are not to be changed.
- **Sharing**: create the viewer link and password. Sharing is optional; recording never depends on it.

Use **Add second test** to run a second, fully independent test on its own gauge.

## Recording and data safety

- Every reading is saved in the laptop browser (IndexedDB) as it arrives, and the whole job is saved online automatically about every 30 seconds. Viewer sharing is not needed for either.
- **Gauge drops out**: if the USB connection drops, the page warns and beeps, then reconnects to the same gauge on its own when it comes back. After a page reload or browser crash, the remembered gauge reconnects without a click. With two identical gauges waiting at once, it asks you to pick so the tests cannot swap. Nothing is recorded while disconnected and the gap stays blank. **Stop reconnecting** cancels it.
- **No reading for 30 seconds** from a connected gauge: one beep and a flashing warning.
- **Gauge not set to PSI**: a warning appears. Readings are recorded exactly as the gauge reports them and are never converted.
- **Laptop storage fails** (disk full, storage cleared): a red banner appears instead of failing silently. Recording continues on screen and online, and the missed readings are saved again once storage works. Download a full backup from Records if you see it.
- The screen is kept awake while a gauge is connected. Keep the laptop plugged in, and set Windows not to sleep during a test.
- Missing data stays missing. Nothing is filled in, carried forward or averaged across a gap.

## Stroke count

**Read out PSI** (Live test, beside Max rate): when on, the browser says the pressure out loud each time it reaches the next step, rising or falling ("435 PSI", "440 PSI"), every 5 psi by default or whatever is set (1, 10, 0.5…). Each level is said once and the gauge must move a full step before the next, so jitter stays quiet; a big jump says only where it landed. With both tests reading out, it says which test. It uses the browser's built-in voice (no internet needed); a browser only talks after the page has been clicked once, and the control shows a reminder until then. Saved with each test.

The **Stroke count** panel on Live test (**Show** / **Hide**; it stays a one-line summary until you show it, and remembers your choice for each test slot). After the hold, enter the start pressure (filled in from the gauge; type over it, e.g. 1300), the start counter (0), the target pressure (e.g. 1740), the spacing (10 psi) and the pump (picked from the equipment list, the test's pump first; **Other rate…** to type a gal/stroke that is not in the list; the pump picked becomes the test's pump), then **Start stroke count**. The box asks for the counter at the next checkpoint (1310, 1320, …): type it and press **Enter**, and it moves straight to the next one with the cursor still in the box. While a count is running the panel sits at the top of the page, says how far the gauge is from the next checkpoint, and dings once when the gauge reaches it. You can type a checkpoint before the gauge gets there. **Skip this point** leaves it blank; **Undo last** removes the latest entry or skip. It finishes at the target, or press **Finish here** to end it at the last entry (**Reopen** undoes that). Used a different pump? Pick it in the panel's **Pump** list (or the Setup pump select) at any time: after you confirm, the gallons are figured again at that pump's gal/stroke; the counter readings and strokes stay as typed. The readings land in the same stroke record as before (Records, downloads, backups). For readings written down and entered later, use **Stroke reading at an earlier time** in the field log.

**Sync to Sheet** also fills the Sheet's **Test Stroke Count** tab: the starting pressure and counter, then the counter at each checkpoint down the five Pressure / Stroke column groups (rows 21–49, 145 readings), with Stroke Count Starts at, Reading Increments, Number of Readings, pump capacity, Total Volume Pumped, Total Pressure Increase and Actual Incremental Volume. The Difference cells keep the Sheet's formulas; Calculated Incremental Volume and Double Deviation stay with the operator. Untick **Sync stroke count** to leave the tab as typed; with no stroke count on the site it is never touched. This needs Sheet script version 4 (Code.gs).

## Recorder chart

The chart header on Live test holds **Chart maximum**, **Pen size** and **Window lines**. Unticking **Window lines** hides the top and bottom pressure test window lines (the same switch as Setup → Chart scale and warning limits → Show pressure test window); the choice is saved with the test and viewers see the same.

## Pressure-up pacing

Type a **Max rate** (psi per minute) next to the Connect button on Live test, for example 10. While pumping, the readout and the log book's blue latest row show **▼ Slow down** in blue above that rate, **▲ Speed up** in green below 80% of it, and **On pace** in between, based on the last 30 seconds. Holding or bleeding off shows plain text, never "Speed up". Older log book rows are not marked. Leave the box empty to turn it off; it is saved with the test.

## Alerts in the trailer

A red bar under the tabs, with a double ding every 20 seconds, appears when:

- a test's gauge is disconnected, or sends nothing for 30 seconds;
- the field laptop is unplugged, plugged in but not charging (below 95%), or below 75% battery;
- a test's temperature feed has sent nothing for over a minute (longer if the recording interval is long).

**Silence** stops the ding for that alert; the bar stays until the problem is fixed. When it clears and happens again, it dings again. Browsers only play sound after one click on the page, so click anywhere once after opening it.

## Log book

On the Live test page (one per test) and on the viewer's Logbook tab. Each row is the actual reading nearest that time, never an average; hover a value to see exactly when it was recorded. A gap shows "—". The top row is the latest reading. Older rows load with **Show older rows**. Viewers see only the probes ticked under **Probes used for this test** on the Temperatures page, and only once **Show temperatures to viewers** is on.

## Temperature smoothing

A laptop charger running off a generator can make the logger readings jitter. **Smoothing** on the Temperatures page (per test) shows each probe as the average of its last 2 minutes of readings (the default), ignoring readings more than 5°F from the window's middle reading (so a loose-connection burst like −330° or +500° shorter than half the window never shows) and then dropping the highest and lowest fifth; 20 seconds, 1 minute and 5 minutes are also available, or Off. Longer settings are smoother but show real changes later (2 min: about 0.3° of leftover wiggle from half-degree noise, a real change shows within about 1½ minutes). It changes what the charts, readouts and log book show, on the host and for viewers (log book columns say "avg"). The saved readings, CSV and backup downloads, history log table and Google Sheet all keep the real readings. History replay has the same switch.

## Pressure offset

Each test has one pressure series. The offset is applied before the reading is shown, logged, published or exported. Example: gauge 110 psi with deadweight 108 psi uses an offset of −2 and records 108 psi. Near zero (within 0.5 psi) the offset is not applied and the reading is shown exactly as the gauge reports it, so a gauge at 0.0 stays 0.0 and a gauge at 0.1 shows 0.1. Live readings show tenths; the 15-minute record and the Sheet use whole psi. Changing the offset during an official test asks for confirmation. The offset never takes a reading below 0 psi. **Full offset above (psi)** is optional: blank keeps the full offset at every pressure; with a value (e.g. 50) the offset is full above it and fades evenly to 0 at 0 psi, so a blow-down lands cleanly on 0 instead of stepping from the offset to 0. Changing it recalculates the stored readings below that pressure (and back again when cleared); readings above it are unchanged. A new offset shifts the whole series once, when it is entered (Enter or leaving the box); readings that arrive while it is being typed shift with the rest, so the trace has no step or blip and zero stays zero.

## Temperatures (MadgeTech)

The field laptop runs MadgeTech 4 and the field app in `../MadgeTechFieldBridge/`. It is enrolled once; no per-test file or pairing code is needed.

1. Temperature monitoring can start about 48 hours before the pressure test. On **Temperatures**, pick the logger when it shows **Online**, choose a recording interval (2 to 60 seconds) and optionally whole degrees, then **Start recording temps**.
2. **Stop recording temps** ends the website log. Readings from before Start or after Stop are never imported.
3. If the hotspot drops, the field app keeps its own journal and uploads the in-window readings when the connection returns.

Channel order is 1 pipe, 2 soil, 3 ambient, 4 auxiliary, in °F. Temperatures are kept for the life of the test, however long it runs.

## Remote viewing

On **Sharing**, enter a title and a viewer password and press **Start remote viewing**. Give the link and password to viewers. They see pressure, the chart and notes; they see temperatures only after you turn on **Show temperatures to viewers**, and only the probes you leave checked. **Stop publishing** locks out open viewers immediately. The viewer checks the password once and then refreshes every second.

Live readings stay on the server while the test runs, however long. They are cleared once a test has been idle for `retention_hours` (72 by default in `config.php`). Test history is kept separately and never expires.

## Test history

`history.php` signs in with the host password from any device. A saved test also has **Post-test package (PDF)**, digital probes only: job details and GPS, the pressure result and window check with a plain-language summary, the round pressure and temperature recorder charts over the whole recording (pressure up through blow-down, no window lines, like the paper charts), then for the official test only the combined pressure and temperature graph, the pressure chart, one chart per probe in its own colour with start/end/change, pipeline data, equipment with calibration due dates, the stroke count, the 15-minute log and events. When the stroke count's rate differs from the test's pump, it asks which rate to figure the gallons with (the saved test is not changed) and **Digital vs physical report (PDF)** (the same report as Records, built from the saved readings and the Sheet temperatures read back at the last sync) and, when it has one, **Open Google Sheet**. It is read-only: opening it never touches a running recording. Open a test to replay the graph, read the pressure and temperature log at a chosen interval, and see events and notes. **Rename**, **Move** (folders) and **Delete** (to Trash, restorable) only change how the test is listed. A test that is still recording shows its last upload; refresh for newer readings.

## Google Sheet paperwork

One-time setup: follow `google-apps-script/SETUP.md`, then add `google_apps_script_url` and `google_sheet_sync_secret` to `config.php`.

- **Create Google Sheet** copies the clean master template and fills in the job setup. The master is never changed.
- **Sync to Sheet** writes the current values. It is always a button press with a confirmation; nothing is written automatically.
- Pressures in the Sheet are the offset-adjusted value nearest each row time (within 30 seconds), rounded to whole psi.
- **Official test starts on LOG row** (next to Sync to Sheet) picks where the official test goes. Left on Auto, pre-test entries fill from row 23 and the official test follows right after them. With a row chosen, the official test and post-test entries start on that row, and rows above it that the site's pre-test entries don't use are never touched, so they can be filled in by hand. The LOG has 63 rows (23–48 and 51–87); the site says so before syncing a test that will not fit.
- The temperature chart and the log book show the electronic probes only. Temperatures read back from the Sheet (chart thermometers) are never drawn, so they cannot notch the probe lines; temperatures typed on the site appear only for a probe that recorded nothing (e.g. a dead probe read by hand). The 15-minute record, the Sheet and the probe-vs-Sheet CSV keep the typed values.
- **Digital vs physical temps report (PDF)** (Records) opens a printable page and the print dialog (choose Save as PDF): job details, a per-probe summary of digital (electronic probe) minus physical (recorder chart), in blue and orange, (average, range, share within ±1 °F and ±2 °F), one chart per probe (probe readings as a line, chart entries as dots) and every log row with probe, chart and difference. Sync to Sheet first so the chart values are current. Nothing is adjusted.
- **Download digital vs physical temps CSV** (Records) lists every Sheet log row with the electronic probes' own readings (to 0.1 °F) beside the temperatures in the Sheet as of the last sync, for comparing the probes with the chart thermometers when the Sheet's temperature columns are filled by hand.
- **Test design values** (project and line name, footage, GPS, pipe table, recorder window, fill, duration, medium, target, PO, location) are written only when the site has them: a blank on the site never erases what was typed into the Sheet. Untick **Sync test design values** to leave all of them as typed. When the design PDF is a scan the site cannot read, **Enter or review values** (Import Atmos test design) opens the same form to type the values in by hand. Its **Pipeline data** table (O.D., W.T., Grade, Length, Buried, Exposed, Remarks; up to 6 rows, pre-filled from a readable PDF) fills the Summary page's Pipeline Data and inside diameter, and the Test Stroke Count pipe rows are linked to it, so it is entered once. Needs Sheet script version 6.
- **Sync pre-test entries** (on by default) can be switched off when the pressure-up rows were typed into the Sheet by hand. Sync then writes nothing above the chosen official start row, so a start row is required while it is off. The choice is saved with the test.
- Temperatures go to the Sheet as whole degrees.
- **Sync these columns** switches let pressure, ambient, pipe, soil or remarks be left out of a sync, for example a probe that is not plugged in. A switched-off column is left exactly as it is in the Sheet. Remarks starts switched off on new tests. The time column is always written.
- Temperatures typed in the Sheet stay with their time, even when rows move. A temperature corrected or cleared in the Sheet stays that way on the next sync.
- Temperatures typed into the Sheet's LOG columns are pulled back into the site on the next sync.
- The template holds 4 pre-test, 33 official and 26 post-test rows. If a test needs more, the sync stops and says so rather than dropping rows.

## Atmos design PDF import

On **Setup**, **Choose PDF** reads the design on the laptop (it is never uploaded) and shows every value for review. Nothing is applied until **Apply reviewed values**. Limiting pipe with the same diameter, wall and grade is combined. A scanned, image-only PDF may not have readable text; the importer warns instead of guessing. Inspector and internal job number stay manual.

## Equipment and calibration

The equipment library holds deadweights, digital gauges, pressure recorders, temperature charts and pumps, each with a default per type. Calibration expiry is the calibration date plus the interval (six months by default). Calibration warnings stay inside the site and never change the Atmos paperwork. Confirm calibration dates on the starter equipment before field use.

**Calibration papers.** In the equipment library, **Add paper** attaches each item's calibration certificate: a PDF, or a photo or scan (large photos are shrunk to a sharp JPEG before upload). It is stored on the website (`calibration-api.php`, table `hydro_calibration_papers`, created automatically), so every signed-in device has it; **Replace** swaps in a new one and **Remove** deletes it. Files are checked by content (PDF, JPEG or PNG only) and limited to 8 MB, or less if the server's `post_max_size` is lower. In the equipment library, **Print calibration papers (PDF)** lists the equipment with the test's selections ticked (with two tests running it asks which test); tick what is going out and **Build PDF** makes one file: a cover sheet (job details, each item with serial, range, calibration date, due date and whether its paper is attached; past-due dates in red) followed by every attached paper. It opens in a new tab to print, with a download link too. A password-protected PDF cannot be combined and gets a page saying to print it separately. Equipment is matched to its paper by the library's equipment ID, so add papers from the same computer whose equipment library you use.

**Scanning papers with a phone.** The recording computer shares its equipment library with the website whenever it loads or the library changes (lists are merged and never dropped: a browser that has not shared yet keeps its own list and adds the website's; once it has shared, a newer list saved from another device replaces it; the previous list is always kept in `grantg-hydro-equipment-previous`). Every saved test also keeps a copy of the library: **Restore from saved tests** in the equipment library puts back anything missing (and real details over untouched starter entries) without removing anything, and runs once by itself in each browser. Open **Calibration papers** (`calibration.php`, also linked in the header and by the QR code in the equipment library) on the phone and sign in with the host password. Each piece of equipment shows whether its paper is on file and when calibration is due. **Scan** opens the camera: take a picture of each page (or **Choose from photos**), turn ↻ or remove ✕ any page, and **Save**. The pages are saved as one PDF (letter pages, black & white scan look by default) and replace that item's paper. **Upload file** takes a PDF or picture already on the phone.

## Starting a new test

On **Setup**, **Start new test** saves the current job to the laptop's previous tests and to online history, then clears the job, readings, notes and Sheet link. Equipment, chart scale and pen size are kept. Disconnect the gauge and stop temperature recording first; the button refuses while anything is still running.

## Practice demo

**Practice demo** in the header opens `host.php?demo=1` in a new tab. Drag the pressure slider (or use the arrow keys), and use **Advance demo time** to skip ahead. Practice data lives only in that tab. USB, field logger, publishing, Sheet writes and exports are blocked, and the real test is never touched. **Restart demo** starts over.

## Installing

Requirements: PHP 8.0+ with PDO MySQL and cURL, MySQL or MariaDB, HTTPS, and desktop Chrome or Edge on the trailer laptop (USB access needs them).

1. In cPanel, create a MySQL database and user with all privileges on it.
2. In phpMyAdmin, import `install.sql`, then `temperature-install.sql`. The history tables create themselves on first use.
3. Copy `config.example.php` to `config.php` and fill in the database, host password and `base_url`.
4. Upload this folder to `public_html/hydro`.
5. Open `https://grantgsolutions.com/hydro/host.php` and sign in.

`.htaccess` blocks `config.php`, the SQL files, this README and `templates/`. Do not upload `tests/` or the field app.

**Updating an existing site:** merging into `main` on GitHub deploys automatically within about five minutes (see the root README). To update by hand instead, keep `config.php` and the database, upload the changed files, and bump the `?v=` number on any changed script or stylesheet in `host.php`, `viewer.php` and `history.php`. Refresh the host page between recordings, not during one. Older databases that predate the temperature interval settings need `temperature-upgrade-2026-09-21.sql` run once.

## Security

- Use a strong, unique `host_password`. Sign in is remembered on that browser until you press **Sign out**.
- Use a new viewer password for each test.
- Keep `config.php`, the field app's settings and its saved MadgeTech login private.

## Folder contents

| File | What it is |
| --- | --- |
| `host.php`, `viewer.php`, `history.php` | The three pages. |
| `api.php` | Live sessions, publishing, viewer feed and Sheet requests. |
| `temperature.php` | Logger enrollment, Start/Stop and temperature uploads. |
| `history-api.php`, `inc/job-history.php` | Online test history. |
| `inc/bootstrap.php`, `inc/persistent-auth.php` | Settings, database, sign-in and security helpers. |
| `inc/field-power.php` | Field laptop battery status. |
| `assets/host.js` | Operator page: gauges, recording, publishing, paperwork. |
| `assets/viewer.js` | Viewer page. |
| `assets/history.js`, `history-log.js`, `cloud-history.js`, `jobs.js` | History screens, interval log, online saving, job boundaries. |
| `assets/chart.js` | Circular pressure chart. |
| `assets/temperature.js` | Pressure and temperature line chart, replay and zoom. |
| `assets/workflow.js`, `workflow-ui.js`, `workspace.js` | Field log and screen layout. |
| `assets/test-design.js`, `test-design-parser.js`, `pdf*.mjs` | Atmos PDF import (PDF.js, license in `PDFJS-LICENSE.txt`). |
| `assets/demo.js` | Practice demo. |
| `assets/*.css` | `workspace.css` is the base design; the others add to it. |
| `calculator.html`, `recorder-report.html` | Tools tab. |
| `google-apps-script/` | The Sheet bridge and its setup steps. |
| `templates/Atmos_Hydrotest_Template.xlsx` | Copy of the Atmos template. |
| `tests/` | Automated tests. |
