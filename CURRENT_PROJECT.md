# Current hydrotest website

This is the October 11, 2026 source of the PHP website used at `https://grantgsolutions.com/hydro/`, plus its Windows temperature bridge and recorded test examples. The operator wants to explore a simpler, polished UI while keeping the live site stable for field use. Work locally; changing this repository is not permission to replace the live site.

## Where to work

- `LivePressureAndTempMonitor/host.php`: operator page. One pressure test by default, optional second independent test.
- `LivePressureAndTempMonitor/viewer.php`: password-protected, read-only remote viewing.
- `LivePressureAndTempMonitor/history.php`: online saved tests, rename/move/Trash/restore, graph replay, interval pressure/temperature log and event notes.
- `LivePressureAndTempMonitor/assets/control-room.css`: shared current design overrides. `workspace.css`, `workspace.js` and `viewer-workspace.css` supply underlying presentation. Preserve element selectors and device event handlers when redesigning.
- `assets/host.js`: gauge connection, acquisition, offset, local state, cloud publication, temperature controls and exports. `assets/viewer.js` consumes the read-only live feeds.
- `assets/history.js`, `history-log.js`, `history.css`: current history UI and read-only interval sampling. `assets/temperature.js` handles graph rendering, replay, zoom and expansion.
- `assets/cloud-history.js`, `jobs.js`, `inc/job-history.php`, `history-api.php`: durable local snapshots, incremental online saves, immutable reading chunks and independent history organization.
- `MadgeTechFieldBridge/`: current C# source, built bridge, launchers and power helpers. Real installed MadgeTech 4 libraries are needed on Windows; not bundled. The current `MadgeTechFieldBridge.exe` is included. Device settings and encrypted Interop credentials are excluded.
- `LandingPageUpdate/index.html`: main landing-page source, separate from the recorder.
- `recordings/index.json`: catalog of ten exported online snapshots with names, folders and sample counts. `recordings/online/*.json` are complete JSON backups; `recordings/field/*.jsonl` contains the local temperature journal. These are snapshots, not ongoing GitHub synchronization.

Paths abbreviated as `assets/` above are under `LivePressureAndTempMonitor/`. The older Python recorder is in `archive/python-recorder/`; it is a different implementation. The root `.cpanel.yml` deploys only that version's `/watch` viewer.

## Local UI preview

Install Node.js and run `npm install`, then `npm run preview` from the repository root. The preview binds only to `127.0.0.1:49328`.

- `/host.php?demo=1`: current operator UI with simulated pressure controls. The demo cannot record from a real gauge or change real jobs.
- `/history.php`: actual current history UI backed by the included JSON recordings. Rename, Move, Trash and Restore work in memory only and reset when the preview restarts. Recordings on disk are never changed.
- No PHP server, database, real password or production connection is needed for these previews. They use the project's existing HTML fixture generator; they are not a substitute for PHP/authentication/instrument integration tests.
- Viewer behavior is covered by `LivePressureAndTempMonitor/tests/workflow-browser.test.cjs`. Its fixture feeds both test slots and verifies probe visibility without production access.

`npm run test:log` runs interval-sampling checks. Browser tests need installed Chrome and Playwright; for example `node LivePressureAndTempMonitor/tests/cloud-history-browser.test.cjs` and `node LivePressureAndTempMonitor/tests/workspace-browser.test.cjs`. Other tests live beside them. The original Python tests are separate.

For a real PHP installation, create `config.php` from `config.example.php`, set independent development credentials and database, and follow the SQL/install instructions in the app README. `REDACTED` values are not working production credentials. Do not connect a redesign preview to the real database or Google Sheet.

## User decisions to preserve

- Physical charts remain the primary field paperwork. The app does not certify pass/fail or operate pumps and valves.
- No required stage sequence or time gates. Operators may enter actual times and notes later; 25%, 50% and 75% holds can have arbitrary lengths. The current UI has no mandatory timed advance buttons.
- One pressure series on paperwork, with a configurable deadweight offset. Keep zero-pressure behavior intact. Record-book PSI rounds to whole numbers; original stored values remain available.
- Temperature monitoring may start about 48 hours before the pressure test. The field PC runs MadgeTech and the bridge; the trailer host starts and stops the website's temperature recording. Do not require viewer sharing to record temperatures. Do not import unrelated pre-start backlog into a new recording.
- Host can disable unused probes for viewers. The saved-history graph/log also has view-only probe selections; these are remembered per test on that browser, not a cross-device edit to the original data.
- History is stored online and accessible from another device. Local copies remain important during connection loss. Opening history must not affect live recording.
- Every Google Sheet write is an explicit manual button action. Preserve the exact existing Atmos sheet layout, columns, signatures and template. Do not introduce automatic Sheet writes.
- Preserve the calculator, design-PDF review/import, equipment serial/calibration selection, editable note times, chart scale/pen settings and field laptop battery indication.
- Missing data stays missing, never invented zero or interpolation. The history log samples recorded values at selected intervals and exposes each value's actual timestamp; it is not an average.
- Keep mobile charts expandable and touch-friendly. Keep live viewers read-only. History Delete moves to recoverable Trash.

## Data and secrets

The owner explicitly approved a public repository including real test recordings. Credentials and private Google document identifiers were removed from exported copies; original local files and production records were not changed. `config.example.php` retains configuration keys but redacts credential values. Set your own `HYDRO_TEMPLATE_ID` in the Apps Script before using a separate development Sheet. Do not commit a populated `config.php`, field-device settings, browser storage dump, cookies, encrypted credentials or hosting account profiles.

This is the current source and data import, not an exhaustive copy of every historical ZIP, screenshot, old backup, installed manufacturer library or local development runtime. It includes all ten online snapshots returned by the authenticated history list at export time, including empty snapshots. Tests available only in some other browser or vendor application are not automatically included.

## Verification and limits

The public design-parser test uses fictional projects, coordinates and job numbers instead of the local production-derived PDF examples. Its assertions pass. This replacement is confined to the GitHub copy; the live parser and original local regression fixtures are unchanged.

The Control Room and history-log changes passed browser fixtures for saved-test playback, management, interval selection, whole-PSI display, probe choices, pagination, phone layout and data preservation. Sampling tests cover missing values, outage gaps, manual samples, official/pretest bounds and 60-hour ranges. Deployed assets were checked against local files. These are software checks, not new real-gauge or 48-hour hardware qualification.

The operator has reported working pressure and temperature acquisition and laptop-charger-related temperature noise. Exact electrical isolation performance, unattended runtime, USB/network dropout recovery and all supported gauge model/firmware combinations still need controlled field validation. Preserve acquisition behavior during a visual redesign.
