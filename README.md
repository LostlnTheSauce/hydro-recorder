# Hydro Recorder

## Current deployed website and UI work

The current `grantgsolutions.com/hydro` website is in **`LivePressureAndTempMonitor/`**. It was added on October 11, 2026, with the Control Room UI, online test history, replay, and selectable pressure and temperature logs. Start with [CURRENT_PROJECT.md](CURRENT_PROJECT.md) when redesigning that site.

**Two implementations are preserved here.** The pre-existing Python recorder in `recorder/` and its `site/` viewer are a separate rebuild. They are not the code serving `/hydro`. Their original instructions follow below. The existing `.cpanel.yml` still targets `/watch`; it has not been changed to deploy the current PHP website.

Actual recorded test data is included in `recordings/` with the owner's explicit approval to publish it in this public repository. Passwords, device credentials, publishing tokens and private connection settings are not included. Historical workspace ZIPs, duplicate backups and machine-specific development runtimes are not part of this current-source import.

For local UI development, run `npm install` followed by `npm run preview`. Open `http://127.0.0.1:49328` for the practice host or `/history.php` for replay of the included recordings. This preview cannot write to production, operate real instruments, or sync a Google Sheet.

## Existing Python recorder rebuild

The following sections describe the separate Python implementation originally in this repository. They do not describe the current PHP website's feature completeness.

## What is here now

A small program for the trailer computer. It reads the Crystal gauges over USB, saves every reading to disk the moment it arrives, and shows the test in a browser page on the same computer.

- Run it: double-click `Start Hydro Recorder.bat`. The screen opens at `http://localhost:8731`.
- Records live in `data/recorder.db`. Back that file up to keep everything.
- Tests: `.venv\Scripts\python -m unittest discover -s tests`

## Layout

| Path | What it is |
| --- | --- |
| `recorder/gauges.py` | Serial reader, one per test. Sends `?PRE` once a second at 9600 baud, reconnects by itself. Port `DEMO` is the practice gauge. |
| `recorder/db.py` | SQLite. The untouched gauge reading is stored; the offset is applied when shown or exported. |
| `recorder/app.py` | Tests, notes, stroke counts, the 15-minute record, CSV downloads. |
| `recorder/share.py` | Uploads shared tests to the website. |
| `recorder/server.py` | Local-only web server (127.0.0.1). |
| `recorder/web/` | The screen. `chart.js` is the circular chart. `calculator.html` is the old calculator, unchanged. |

## Decisions carried over from the old app

- One recorded pressure series: gauge reading plus deadweight offset, and a gauge at zero stays zero.
- Official log is every 15 minutes in whole psi. A row with no reading within 30 seconds stays blank; nothing is filled in.
- Gauges must be set to PSI. The screen warns if a gauge reports anything else.
- The calculator's formulas are not to be changed.
- Google Sheet layout stays as it is, and writing to a Sheet only ever happens on a button press.

## Live viewing

`Share live` on a test gives a link anyone can open to watch it. The recorder pushes readings to the website every couple of seconds; if the internet drops, recording carries on and the backlog uploads by itself afterwards. `Stop sharing` kills the link.

- Website side: `site/` (one PHP file with its own SQLite database, plus the viewer page). cPanel's Git deploy runs `.cpanel.yml`, which copies it to `public_html/watch`.
- Host password: the first time a computer shares, it asks for the host password and the site remembers that computer from then on. The first password ever entered becomes the host password. It is stored only as a hash in `~/hydro-live-data/live.db` on the host; delete that file to start over.
- Try it without the real site: serve a folder holding `site/*` plus `recorder/web/chart.js` and `style.css` with `php -S 127.0.0.1:8750`, and share to `http://localhost:8750`.

## Not built yet

1. Temperatures from the MadgeTech field laptop (with a multi-day history).
2. Atmos design PDF import.
3. Google Sheet fill-in.
4. A single installer so the trailer laptop does not need Python.
