# Online history and operator-led workflow — October 6, 2026

## Operating it

- Keep the host page open on the recording computer. It takes a durable local job snapshot and attempts an online save every 30 seconds, and sooner after event/settings changes. The status below the header reports success or pending uploads. Viewer sharing does not need to be enabled.
- Starting a new test keeps the existing archive-before-reset safeguard. The previous job is queued for automatic upload. Opening the host page again retries pending uploads, including older local archives. Do not clear the original computer's browser data until online history is confirmed.
- `history.php` is a private, read-only history and replay screen. Sign in using the host password from another device. It never attaches gauges or changes the recording job. Open a snapshot, scrub or play it, choose Entire recording / Official test, expand on phones, or download the full JSON backup.
- A currently recording test is a snapshot, not a second live operator console. Refresh history and reopen the snapshot for newer uploaded readings. The last 30 seconds may not yet be uploaded. Closing the recording browser stops automatic pressure uploads until reopened; the existing local pressure store is retained. The field bridge's existing server-side temperature collection is independent.
- Missing measurements remain missing. Replay leaves gaps larger than three times the estimated typical sampling interval (minimum 30 seconds). It does not invent temperatures/pressures across a dropout. Timestamps are shown in the viewing device's local timezone; workflow epoch timestamps are used for new recordings.
- Timers are advisory, not locks. `Record what happened` can record checkpoints, named hold starts/ends, and official start/end without clicking every preceding stage. Expand/use Event time to enter actual past times. Reentering an official start/end prompts for confirmation and adds a correction entry; previous entries remain in the log. Logical start-before-end validation remains. There is no automatic pass/fail assertion.
- Under Temperatures, `Probes used for this test` controls what viewers can see. Disabled probes have no viewer checkbox, tile, inspector field, or log column. Original logger data is retained for the host/archive. This is a presentation choice, not turning off hardware inputs. The separate global viewer temperature visibility setting still applies.
- Viewer Records shows pressure plus enabled temperatures, latest recorded value per selected interval, newest 2,000 rows. It does not fill missing values from other intervals. Full history is retained separately in the authenticated history page.
- Host sign-in is remembered with a Secure, HttpOnly, SameSite=Strict signed cookie, valid for one year and renewed during continued authenticated use. It restores expired PHP sessions with the same CSRF token. Sign out on shared devices. Clearing cookies, changing the host password, or revoking access still requires authentication; the app does not bypass authentication failures.

## Implementation and installation

New files: `history.php`, `history-api.php`, `inc/job-history.php`, `inc/persistent-auth.php`, `assets/cloud-history.js`, `assets/history.js`, `assets/history.css`.

Changed runtime files: `inc/bootstrap.php`, `host.php`, `viewer.php`, `assets/host.js`, `assets/jobs.js`, `assets/workflow.js`, `assets/workflow-ui.js`, `assets/viewer.js`, `assets/temperature.js`.

Upload new dependencies first; then shared files; then page entrypoints. Existing config and database credentials stay unchanged. The authenticated history endpoint creates `hydro_jobs` and `hydro_job_chunks` with `CREATE TABLE IF NOT EXISTS`. The database user must have CREATE/SELECT/INSERT/UPDATE/DELETE rights. Existing pressure/temperature/session tables are not migrated or cleared.

Pressure and temperature arrays are split into <=2,000-row, SHA-256-addressed JSON chunks. Unchanged chunks are not reuploaded. An atomic manifest update publishes only complete snapshots. A recording-browser writer key and optimistic revision prevent a stale/copying device from silently overwriting a job. A persistent IndexedDB outbox retains retries. Archived jobs cannot be reopened by stale active saves. Demo mode does not participate.

Current committed history has no automatic expiry. Cleanup removes only unreferenced upload fragments older than 24 hours; it preserves every chunk in the current committed manifest. Keep normal hosting/database backups and monitor available database space. Online history is not a substitute for independent backups. Immutable chunk retention allows a replay opened during an upload to finish downloading a consistent snapshot.

## Validation boundaries

Automated tests cover SQLite service validation/transactions, chunk checksums, failed/partial uploads, retries, separate-device replay, phone layouts, workflow timing overrides, old-job isolation, demo isolation, viewer log/probe restrictions and trusted-cookie signatures. Existing serial/bridge protocols were not changed. No new full-duration real-pipeline or physical-phone acceptance test is claimed.
