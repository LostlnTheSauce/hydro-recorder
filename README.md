# Hydro Recorder

Grant G Solutions' hydrotest field recorder: the website at `grantgsolutions.com/hydro`, the Windows app that sends MadgeTech temperatures to it, and saved test recordings.

Start with [CURRENT_PROJECT.md](CURRENT_PROJECT.md). It lists the decisions the software must keep (physical charts stay primary, missing data stays blank, Sheet writes are manual only, and so on).

## What is where

| Folder | What it is |
| --- | --- |
| `LivePressureAndTempMonitor/` | The website: operator page, read-only viewer, test history and replay. PHP and MySQL on cPanel. See its [README](LivePressureAndTempMonitor/README.md). |
| `MadgeTechFieldBridge/` | The field-laptop app that reads the RTDTempX4 through MadgeTech 4 and uploads temperatures. See its [README](MadgeTechFieldBridge/README.md). |
| `LandingPageUpdate/` | The main `grantgsolutions.com` landing page. |
| `recordings/` | Ten exported online test snapshots and a field temperature journal, published with the owner's approval. Snapshots, not a live sync. |
| `dev/preview.cjs` | Offline preview of the website. |

## Deploying to the live site

Merging into `main` publishes the website. A cPanel cron job runs `deploy/cron-deploy.sh` every 5 minutes: it pulls `main` from GitHub and, when there is a new commit, runs cPanel's **Deploy HEAD Commit**, which follows `.cpanel.yml` and copies `LivePressureAndTempMonitor/` into `public_html/hydro`. It never overwrites `config.php`, and every deploy stamps new `?v=` numbers so Cloudflare and browsers load the new scripts. Work happens on other branches and goes live only when its pull request is merged. No passwords or tokens are stored on GitHub; the repository is public, so cPanel can read it directly.

Deploy between tests. An operator page that is already open keeps running the version it loaded; it picks up the new one when it is reloaded.

One-time setup, after this deploy setup is merged into `main`:

1. **cPanel → Git Version Control.** If `hydro-recorder` is not listed, choose **Create**, turn on **Clone a Repository**, use `https://github.com/LostlnTheSauce/hydro-recorder.git`, and keep the suggested Repository Path (`/home/<user>/repositories/hydro-recorder`). If it is already listed, open **Manage → Pull or Deploy → Update from Remote**.
2. **cPanel → Cron Jobs → Add New Cron Job.** Common setting: *Once Per Five Minutes*. Command:

   ```
   /bin/bash $HOME/repositories/hydro-recorder/deploy/cron-deploy.sh >> $HOME/hydro-deploy.log 2>&1
   ```

   If step 1 showed a different Repository Path, use that path instead of `$HOME/repositories/hydro-recorder`. The first run (within five minutes) deploys the current `main`.

`hydro-deploy.log` in your cPanel home folder lists each deploy and any problem; nothing is written when there is nothing new. To deploy by hand instead: cPanel → Git Version Control → Manage → Pull or Deploy → **Update from Remote**, then **Deploy HEAD Commit**.

## Try the website locally

Install Node.js, then from this folder:

```
npm install
npm run preview
```

Open `http://127.0.0.1:49328` for the practice operator page, or `/history.php` to replay the included recordings. The preview has no USB, no field logger, no Google Sheet and no connection to the live site.

## Tests

- `npm run test:log`: interval-sampling checks.
- `node LivePressureAndTempMonitor/tests/<name>.test.js` and `.test.cjs`: browser and logic tests. Browser tests need Chrome and Playwright.
- `php LivePressureAndTempMonitor/tests/<name>.test.php`: server tests against SQLite.

## Secrets

Passwords, device tokens, the Apps Script URL and the Google template ID are not in this repository. `config.example.php` and `field-device.example.settings` show the keys with `REDACTED` values. Never commit a filled-in `config.php`, `field-device.settings` or `interop-credentials.bin`; `.gitignore` already excludes them.
