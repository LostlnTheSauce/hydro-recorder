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
- **Records**: official start and end times, the 15-minute official record, Google Sheet buttons, downloads and the field log. Stroke counts and local backups are folded away below.
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

## Alerts in the trailer

A red bar under the tabs, with a double ding every 20 seconds, appears when:

- a test's gauge is disconnected, or sends nothing for 30 seconds;
- the field laptop is unplugged, plugged in but not charging (below 95%), or below 75% battery;
- a test's temperature feed has sent nothing for over a minute (longer if the recording interval is long).

**Silence** stops the ding for that alert; the bar stays until the problem is fixed. When it clears and happens again, it dings again. Browsers only play sound after one click on the page, so click anywhere once after opening it.

## Log book

On the Live test page (one per test) and on the viewer's Logbook tab. Each row is the actual reading nearest that time, never an average; hover a value to see exactly when it was recorded. A gap shows "—". The top row is the latest reading. Older rows load with **Show older rows**. Viewers see only the probes ticked under **Probes used for this test** on the Temperatures page, and only once **Show temperatures to viewers** is on.

## Pressure offset

Each test has one pressure series. The offset is applied before the reading is shown, logged, published or exported. Example: gauge 110 psi with deadweight 108 psi uses an offset of −2 and records 108 psi. Near zero (within 0.5 psi) the offset is not applied and the reading is shown exactly as the gauge reports it, so a gauge at 0.0 stays 0.0 and a gauge at 0.1 shows 0.1. Live readings show tenths; the 15-minute record and the Sheet use whole psi. Changing the offset during an official test asks for confirmation.

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

`history.php` signs in with the host password from any device. It is read-only: opening it never touches a running recording. Open a test to replay the graph, read the pressure and temperature log at a chosen interval, and see events and notes. **Rename**, **Move** (folders) and **Delete** (to Trash, restorable) only change how the test is listed. A test that is still recording shows its last upload; refresh for newer readings.

## Google Sheet paperwork

One-time setup: follow `google-apps-script/SETUP.md`, then add `google_apps_script_url` and `google_sheet_sync_secret` to `config.php`.

- **Create Google Sheet** copies the clean master template and fills in the job setup. The master is never changed.
- **Sync to Sheet** writes the current values. It is always a button press with a confirmation; nothing is written automatically.
- Pressures in the Sheet are the offset-adjusted value nearest each row time (within 30 seconds), rounded to whole psi.
- **Official test starts on LOG row** (next to Sync to Sheet) picks where the official test goes. Left on Auto, pre-test entries fill from row 23 and the official test follows right after them. With a row chosen, the official test and post-test entries start on that row, and rows above it that the site's pre-test entries don't use are never touched, so they can be filled in by hand. The LOG has 63 rows (23–48 and 51–87); the site says so before syncing a test that will not fit.
- Temperatures go to the Sheet as whole degrees.
- **Sync these columns** switches let pressure, ambient, pipe, soil or remarks be left out of a sync, for example a probe that is not plugged in. A switched-off column is left exactly as it is in the Sheet. Remarks starts switched off on new tests. The time column is always written.
- Temperatures typed in the Sheet stay with their time, even when rows move. A temperature corrected or cleared in the Sheet stays that way on the next sync.
- Temperatures typed into the Sheet's LOG columns are pulled back into the site on the next sync.
- The template holds 4 pre-test, 33 official and 26 post-test rows. If a test needs more, the sync stops and says so rather than dropping rows.

## Atmos design PDF import

On **Setup**, **Choose PDF** reads the design on the laptop (it is never uploaded) and shows every value for review. Nothing is applied until **Apply reviewed values**. Limiting pipe with the same diameter, wall and grade is combined. A scanned, image-only PDF may not have readable text; the importer warns instead of guessing. Inspector and internal job number stay manual.

## Equipment and calibration

The equipment library holds deadweights, digital gauges, pressure recorders, temperature charts and pumps, each with a default per type. Calibration expiry is the calibration date plus the interval (six months by default). Calibration warnings stay inside the site and never change the Atmos paperwork. Confirm calibration dates on the starter equipment before field use.

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
