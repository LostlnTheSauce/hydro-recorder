# Python recorder (archived)

An earlier rebuild of the hydrotest recorder as a small Python program for the trailer computer. It is **not** the code behind `grantgsolutions.com/hydro`; that is `LivePressureAndTempMonitor/` at the top of this repository. It is kept here for reference.

The root `.cpanel.yml` still deploys this version's viewer (`site/`) to `public_html/watch` when cPanel's Git deploy runs.

## What it does

It reads the Crystal gauges over USB, saves every reading to disk the moment it arrives, and shows the test in a browser page on the same computer.

- Run it: double-click `Start Hydro Recorder.bat` in this folder. The screen opens at `http://localhost:8731`.
- Records live in `data/recorder.db` in this folder. Back that file up to keep everything.
- Tests: from this folder, `.venv\Scripts\python -m unittest discover -s tests`

## Layout

| Path | What it is |
| --- | --- |
| `recorder/gauges.py` | Serial reader, one per test. Sends `?PRE` once a second at 9600 baud, reconnects by itself. Port `DEMO` is the practice gauge. |
| `recorder/db.py` | SQLite. The untouched gauge reading is stored; the offset is applied when shown or exported. |
| `recorder/app.py` | Tests, notes, stroke counts, the 15-minute record, CSV downloads. |
| `recorder/share.py` | Uploads shared tests to the website. |
| `recorder/server.py` | Local-only web server (127.0.0.1). |
| `recorder/web/` | The screen. `chart.js` is the circular chart. `calculator.html` is the old calculator, unchanged. |
| `site/` | The `/watch` viewer: one PHP file with its own SQLite database, plus the viewer page. |

## Live viewing

`Share live` on a test gives a link anyone can open to watch it. The recorder pushes readings to the website every couple of seconds; if the internet drops, recording carries on and the backlog uploads by itself afterwards. `Stop sharing` kills the link.

- Host password: the first time a computer shares, it asks for the host password and the site remembers that computer from then on. The first password ever entered becomes the host password. It is stored only as a hash in `~/hydro-live-data/live.db` on the host; delete that file to start over.
- Try it without the real site: serve a folder holding `site/*` plus `recorder/web/chart.js` and `style.css` with `php -S 127.0.0.1:8750`, and share to `http://localhost:8750`.

## Never built in this version

Temperatures from the MadgeTech field laptop, Atmos design PDF import, Google Sheet fill-in and a single installer. The first three exist in the current website.
