# Grant G Solutions Hydrotest Field Console

This package runs on your own PHP/MySQL website. It does not use a ChatGPT Site.

## Guided field workflow (September 22, 2026)

The host now has four workspaces: **Live job**, **Records**, **Setup**, and **Tools**.

1. In Setup, review the design, equipment, pressure window and offset. On Live job, use **Temperature recording & history** to start the logger when pre-test monitoring begins. Temperature Start/Stop controls remain independent of all pressure stages and remote viewing.
2. Configure the pressure steps and hold durations before starting pressure-up. The defaults are 30 minutes at 75%, 15 minutes at full pressure, an 8-hour official test, and a final 15-minute hold. Supported sequences are 0/75/100, 0/50/75/100 and 0/25/50/75/100.
3. **Begin pressure setup**, then **Begin pressurizing at 0** when the physical charts are zeroed and pumping begins. Record each selected checkpoint. Recording 75% starts the minimum hold timer.
4. The 75% hold continues until the operator selects **Continue pressure-up**, however long that takes. Record the cumulative pump-counter baseline before pumping again. The site alerts at each upward 10 PSI checkpoint once, queues missed checkpoints, and accepts actual cumulative counter readings. Enter pump capacity in gallons/stroke; each run freezes its baseline capacity. Counts are never inferred from pressure. Checkpoint counts can also be entered during the full-pressure hold using the actual event time.
5. **Record full pressure** starts the minimum full-pressure hold. The site calculates the next eligible quarter-hour start. Starts are accepted during the :00/:15/:30/:45 minute, using the actual selected timestamp. For example, full pressure at 07:05 gives a minimum-hold finish at 07:20 and earliest test start at 07:30.
6. **Start official test** records the actual start. The timer reaching its duration does not end the test automatically. **End official test** records the actual end and begins the final hold. The final hold continues until the operator selects **Begin depressurizing**.
7. Use **Event time / note** for late entries, issues and general field notes. **Physical charts replaced** starts a visible 24-hour reminder without interrupting electronic temperature recording.
8. Records shows 15-minute official readings, official-period min/max values, stroke counts, events and manual Sheet controls. Export the complete log CSV, stroke CSV or full backup. Temperatures can be viewed for the entire job, pre-test, official test or last six hours.

Each test has independent workflow state. Minimum holds, current stage, settings and events persist in that laptop browser and in the full backup. Timers never operate a pump or valve, advance a stage, end a recording, or certify a test result. Browser audio may require an operator click before it can sound. Keep the host page running and the laptop awake for live gauge acquisition and prompts.

**Abandon / restart attempt** archives the preceding attempt's events, stroke data, timing and Sheet link, then creates a new pressure-setup attempt. Continuous pressure and temperature readings are retained. New official times and a new Sheet link are used for the next attempt. Archived event logs and all-attempt stroke data can be downloaded; the full backup includes every archived attempt. This is a restart within the same job, not a separate job-management database.

The unchanged Sheet template currently allocates 4 pre-test rows, 33 official rows and 26 post-test rows. Exceeding these limits blocks the write and explains the capacity issue; it never silently merges or omits checkpoints. The 0/25/50/75/100 sequence needs 5 pre-test entries, so that sequence requires manual placement using the complete CSV until a template-compatible layout is agreed. Stroke checkpoint values are available in Records and CSV; automatic writing into the stroke-count tab is not included in this update.

This update changes host.php and assets/host.js, assets/temperature.js, and adds assets/workflow.js, assets/workflow-ui.js, assets/workflow.css and assets/demo.js. It needs no database or Apps Script change on an installation already running the September 21 temperature controls. Back up the live files before uploading and refresh the host only between recording runs. Restoring an old backup uses its saved events to infer a stage; verify imported data before continuing.

## Starting a completely new test

On **Live job**, choose the test slot and click **Start new test**. This is different from **Abandon / restart attempt**, which deliberately retains the same job's continuous temperature history.

Before starting a new test, disconnect that slot's pressure gauge, press **Stop recording temps**, and leave the field app online until its pending uploads finish. A busy gauge, active logger, unfinished upload, Sheet operation or failed archive blocks the change; it never silently discards the current recording. The other slot can keep recording.

The button saves the complete available job to **Records → Previous tests on this laptop**, then clears pressure/temperature history, job and PO fields, inspector, design, pressure offset, notes, Sheet link and official workflow. The equipment library, selected equipment, chart maximum and pen size are retained. Use **Start recording temps** again to begin the new job's temperature log; no earlier sources are imported, including after reload. Old pressure records remain stored separately. Server records and existing Google Sheets are not deleted.

Each previous test has a **Download archived backup** button. Backups include recorded pressures, temperatures, manual temperatures, notes, equipment, workflow and prior Sheet reference. Archives live in this browser on this laptop, not a cloud backup: download them before clearing browser data or moving machines. Fresh-job boundaries are also sent to the viewer so old data is removed from its charts without resetting the other slot. Reload an already-open viewer once after installing this update to load that support.

## Practice demo

Click **Open practice demo** in the host header. It opens `host.php?demo=1` in a separate tab, with a fresh simulated test starting at 4 AM. Keep your real host tab open if it is recording.

- Drag the pressure slider or click it and use the arrow keys. Choose 1, 10, 25 or 50 PSI per key press, type an exact pressure, and adjust the slider/chart maximum. The configured pressure offset is applied just as it is to gauge readings.
- Use the normal workflow buttons to record checkpoints, holds, stroke counts, notes and official start/end. Simulated readings arrive every second while the page is running. Temperatures are not simulated; manual temperature entry remains available.
- **Skip to hold / test finish** advances the demo clock to the current minimum (or eligible quarter-hour start). **Advance demo time** allows longer holds and skips up to 48 hours. During a skip, pressures stay at their slider values and samples are generated every 15 simulated seconds. Skipping never advances the workflow stage for you. Both test slots share the demo clock but have separate pressures and workflow state.
- Practice data lives only in memory in that tab. It does not read or write the real test's localStorage or IndexedDB recordings. USB, field logger connections, remote publishing, Google Sheet writes, backup imports and test exports are blocked. Refresh, close the tab or use **Restart demo** to discard practice data; the real host is unchanged.

Upload all seven application files, including `assets/demo.js`. If the demo script is missing, the practice page stops rather than opening real test data.

## What goes where

- Upload this folder to `public_html/live` in cPanel.
- Open `https://grantgsolutions.com/live/host.php` on the laptop connected to the gauges.
- Remote viewers use a password-protected link created by the host page.
- The console opens with one active test. Use **Add second test** only when two isolated tests need to run at the same time.
- Each connected XP2i/XP3i is read once per second.
- The remote viewer is read-only and cannot send commands to a gauge.
- The existing hydrotest calculator and pressure-recorder report tool are available from the same console.
- A separate MadgeTech field laptop can send four live temperatures to Test 1 or Test 2 over its hotspot. Pressure recording remains on the gauge host laptop.

## Requirements

- PHP 8.0 or newer with PDO MySQL and cURL.
- A MySQL/MariaDB database.
- HTTPS on `grantgsolutions.com`.
- Desktop Chrome or Microsoft Edge on the host laptop.
- XP2i/XP3i visible in Windows as a COM port.

## Installation

1. In cPanel, create a MySQL database and database user. Give the user all privileges on that database.
2. Open phpMyAdmin, select the database, choose **Import**, and import `install.sql`.
3. Rename `config.example.php` to `config.php`.
4. Edit `config.php` and enter the database name, username, password, your desired host-page password, and the final base URL.
5. Upload the entire folder as `public_html/live`.
6. Visit `https://grantgsolutions.com/live/host.php` and sign in with the host password from `config.php`.
7. Delete `install.sql` and this README from the web server after setup. The included `.htaccess` blocks them, but deletion is cleaner.

For an **existing installation**, leave `config.php` and the existing database in place. Import `temperature-install.sql` in phpMyAdmin, then upload the updated `.htaccess`, `host.php`, `viewer.php`, `temperature.php`, `assets/host.js`, `assets/viewer.js`, and `assets/console-v3.css`. Do not upload the field bridge or SQL file to the public website.

## Starting a live test

1. Sign in to `host.php` on the gauge laptop.
2. Open **Test Setup**. Choose the Atmos test-design PDF, review the extracted values, then apply them. Confirm the remaining job information, equipment, calibration dates, pump and recorded-pressure offset for each active test.
3. Connect Test 1 to the appropriate COM device in Chrome/Edge. Use **Add second test** when another test is needed, then connect its gauge separately.
4. Use the guided Live job workflow to record zero, intermediate checkpoints and full pressure. The zero entry is created when **Begin pressurizing at 0** is pressed, not when the gauge first reads zero.
5. Press **Start official test** and **End official test** at the actual test boundaries.
6. Enter ambient, pipe and ground readings manually if the electronic probe bridge is not running or a reading needs correction. Choose the actual date and time if entering it later.
7. Enter the chart scale and test window information.
8. Open **Remote viewer**, enter a title and viewer password, then press **Start remote viewing**.
9. Copy the generated viewer link and give the link and password to authorized viewers.

The viewer temperature workspace is hidden by default. Turn on **Show temperatures to viewers** in the host's Remote viewer panel only when the temperature presentation is ready; the host can continue using and refining temperatures while it remains hidden remotely.

## MadgeTech live temperatures

After starting remote viewing, open the temperature workspace for the correct test and download its private field connection file. Copy that file and the separate `MadgeTechFieldBridge` folder to the laptop connected to the RTDTempX4. Follow `MadgeTechFieldBridge/README.md` to enable MadgeTech Interop and run the bridge. The default channel order is pipe, soil, ambient and auxiliary, with values converted to °F. Each active test needs its own connection file and bridge process.

The field bridge journals readings locally before sending them, retries after hotspot outages, and the website rejects a file paired to the wrong logger serial. The host and viewer display a delayed status after 30 seconds without a new temperature. New live readings are retained in the database rather than being limited to the former 2,000-point viewer snapshot. The viewer still only shows its temperature workspace when the host enables that toggle.

Start the bridge when the 48-hour pre-test temperature monitoring begins. It can resend locally journaled readings after an outage, but it cannot retrieve readings from before the bridge was started through MadgeTech's latest-reading Interop call.

The pressure screen also has a **Chart maximum** field beside the current-pressure display. Changing it redraws the local chart immediately, saves the scale for that test, and sends the same scale to the remote viewer. The active range is printed in the center of the circular chart.

Pressure rings use recorder-style intervals instead of dividing every scale into ten arbitrary sections. A 1,500 psi chart uses labeled 100 psi rings with 10 psi minor divisions, matching the common physical 1,500 psi chart pattern.

The **Pen size** slider beside the live chart adjusts the pressure trace from 0.1 to 5.0 in 0.1 increments. The selected thickness is saved separately for each test and is also used on the remote viewer.

## Atmos test-design PDF import

- The PDF is read locally in the browser and is not uploaded to the website or database.
- The importer reviews project/AFE, line, location, desired MAOP, recorder minimum/maximum/target, duration, estimated fill, section length, test medium and the Limiting Pipe Determination data.
- Limiting-pipe entries with the same outside diameter, wall thickness and grade are combined, and their individual lengths are added together. Distinct specifications remain separate.
- Pipe grade is displayed from SMYS (for example, 42,000 psi is X42 and 52,000 psi is X52).
- Nothing is applied until **Apply reviewed values** is pressed. The owner representative/inspector and internal job number remain manual because they are not reliably supplied by the test design.
- Applying a design fills PO/AFE, location and the chart's recorder test window. It also raises the chart maximum when necessary and stores the complete reviewed design with that test's local setup and backup.
- A scanned image-only PDF may not contain readable text. If expected fields are missing, the importer warns the operator instead of guessing.

## Equipment and calibration

- The equipment library stores reusable deadweights, digital gauges, pressure recorders, temperature charts and pumps.
- Each equipment type can have a default while remaining selectable per test.
- Calibration expiration is calculated from the calibration date and interval. The default interval is six months.
- The included starter records are the known deadweights 5496 and 5492, pressure recorder 13045, digital gauge 021863 and the PDQ pump at 0.0043 gal/stroke. Enter or confirm their current calibration dates before field use.

## Recorded-pressure offset

- Each test has one pressure series. The program applies the entered offset before displaying, logging, publishing or exporting a reading.
- Example: gauge 110 psi and deadweight 108 psi uses an offset of -2 psi and records 108 psi.
- Changing an offset adjusts the one stored local series by the difference while preserving the zero-pressure baseline as 0 PSI. Changing it during an active official test requires confirmation.
- CSV exports intentionally do not contain a second raw or deadweight pressure column.

## Google Sheet paperwork

- Press **Create Google Sheet** on a test to make a complete copy of the approved clean `Test Template` master. The master is never edited.
- The copied workbook keeps the original LOG, Summary and Test Stroke Count tabs, formatting and formulas. Job setup, selected equipment, serial numbers, calibration dates and imported test-design values fill their matching cells.
- The Sheet receives the same offset-adjusted pressure shown by the console. It never writes a second raw-gauge pressure series.
- The site never updates an existing Google Sheet automatically. Press **Sync to Sheet** only when you want to write the current test values; it asks for confirmation because generated times, pressures and comments may replace manual edits. Pressures are taken from the closest recorded gauge value within 30 seconds and rounded to the nearest whole PSI.
- Ambient, pipe and ground temperatures can be entered directly in the copied Sheet's existing LOG columns. **Sync to Sheet** also imports them into the site. No automatic temperature import runs. The bridge preserves Sheet-entered temperatures when no site value is present, including future rows whose pressure timestamp has not been generated yet.
- Test 1 and Test 2 each create and maintain their own copied workbook. If Google or the internet is unavailable, the one-second local recording continues. You can manually sync the Sheet later.
- One-time setup is required before the first Sheet is created. Follow `google-apps-script/SETUP.md`, then add `google_apps_script_url` and `google_sheet_sync_secret` to `config.php`.

## MadgeTech field temperatures

- The updated private field app is enrolled once for the known logger. Start MadgeTech Real Time recording and double-click the field app; no connection file or pairing code is required for each test.
- On the host page, open the test's Temperatures panel and click **Start recording temps** when the logger appears Online. Remote viewing is optional and can be started or stopped independently. Click **Stop recording temps** to end the website log. A logger feeds only one test at a time.
- Before starting, choose a website recording interval from 2 to 60 seconds and optionally enable whole-degree readings. These settings are locked for that Start/Stop run. MadgeTech and the field app continue retaining the original two-second readings locally.
- The field app journals locally while the hotspot is down and uploads readings captured inside the Start/Stop window after reconnection, including if Stop occurred while offline. It never imports readings outside that window.
- Deploy the new `temperature_devices` table in `temperature-install.sql` before using automatic discovery. Existing installations must also run `temperature-upgrade-2026-09-21.sql` once. Keep the one-time field-app enrollment private; never publish its credential file.

## Important behavior

- Full one-second recorded-pressure readings are kept in the laptop browser's IndexedDB and can be downloaded as CSV.
- Test 1 and Test 2 have separate job setup, equipment, offsets, events and notes.
- Logbook and guided-workflow entries use the operator-selected event date and time, so an event can be entered accurately after field work is complete.
- Manual ambient, pipe and ground temperatures are stored separately for Test 1 and Test 2, included in the test backup, shown on the temperature chart, and used in the matching 15-minute Google Sheet rows. Entering the same date and time again updates that reading. A missing interval stays blank instead of silently carrying an old temperature forward.
- The Google Sheet Summary calculates temperature maximums and minimums from the official-test rows; a channel stays blank until it has a numeric reading.
- The website receives live adjusted readings approximately every second.
- If the internet drops, the local chart continues. Remote publishing retries automatically when the connection returns.
- A connected gauge that does not update for 30 seconds triggers an audible ding and a flashing local warning.
- Use **Download test backup** to save the job setup and full local readings as a restorable JSON file.
- After ending the official test, **Download Atmos log rows** creates the existing Time, Pressure, Ambient, Pipe, Ground and Comments columns at 15-minute intervals. It refuses to omit extra rows or substitute across a gauge gap longer than 30 seconds.
- Closing or refreshing the host page interrupts live USB collection. The publishing session itself is remembered by that browser.

## Nitrogen estimator

The nitrogen estimator is preserved as the supervisor-provided field method. It is unverified and its wall-thickness input is not currently used. Do not change its calculation without approval.

## Security notes

- Use a unique, strong `host_password` in `config.php`.
- Use a different viewer password for each test.
- Do not share `host.php` credentials with remote viewers.
- Keep `config.php` private and never email or post it.
- The package requires HTTPS because browser USB access and password transport should not be used over plain HTTP.

## Folder contents

- `host.php` — operator/laptop dashboard.
- `viewer.php` — password-protected remote chart.
- `api.php` — same-origin JSON API.
- `config.example.php` — database and host configuration template.
- `install.sql` — database schema.
- `inc/bootstrap.php` — shared server setup and security helpers.
- `assets/chart.js` — circular chart renderer.
- `assets/host.js` — dual USB gauge host.
- `assets/console-v3.css` — polished operator-console interface shared by the host and viewer.
- `assets/viewer-v3.css` — remote-viewer layout refinements.
- `assets/grant-g-logo.png` — Grant G poker-chip logo used in the host and viewer headers.
- `assets/test-design.js` and `assets/test-design-parser.js` — local Atmos PDF reader and field mapping.
- `assets/pdf.min.mjs` and `assets/pdf.worker.min.mjs` — bundled Mozilla PDF.js runtime; license is included in `assets/PDFJS-LICENSE.txt`.
- `assets/viewer.js` — remote read-only viewer.
- `assets/style.css` — interface styling.
- `google-apps-script/Code.gs` — private Google Apps Script bridge that copies and fills the approved master Sheet.
- `google-apps-script/SETUP.md` — one-time Google Sheet connection instructions.
# September 28 — Field Recorder rebuild

The host now uses `assets/workspace.css` and `assets/workspace.js` instead of stacking the old style/v2/console/workflow stylesheets. Six explicit screens separate Live test, Temperatures, Setup, Records, Tools and Sharing. The workflow, chart renderer, design parser and printed template contracts are retained; the layout is rebuilt around them.

Temperature Start/Stop controls are visible on the Temperatures page. An occupied logger can be transferred with an explicit confirmation and expected-source check; repeated starts in the same session/slot are idempotent. Stopped recordings do not block new starts. The updated field bridge drains stopped windows separately, using per-window acknowledgement and completion files; it must be distributed alongside the website update. Device-authenticated uploads are authorized by run ownership, not just the current assignment, and still enforce exact Start/Stop bounds. No database schema migration is introduced.

See `../FieldRecorderRebuild-2026-09-28/START-HERE.md` for deployment and the required real-logger smoke test. Tests include browser integration, a local HTTP field-bridge fixture and `tests/temperature-service.test.php`, which runs the real endpoint against SQLite with MySQL locking/upsert syntax adapted. Production MySQL concurrency and actual logger/hotspot behavior remain separate verification steps.
