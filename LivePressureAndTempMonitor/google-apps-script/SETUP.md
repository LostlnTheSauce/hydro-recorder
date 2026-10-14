# One-time Google Sheet connection

The field console never edits the clean `Test Template` master. The Apps Script bridge copies it and only writes to copies created by the bridge.

1. Open the clean `Test Template` Google Sheet: `https://docs.google.com/spreadsheets/d/REDACTED/edit`.
2. Choose **Extensions → Apps Script**.
3. Replace the editor contents with `Code.gs` from this folder and save.
4. Select `setupHydroAutomation` at the top of the Apps Script editor and press **Run**. Approve Google's requested access. Open the execution log and copy the generated secret.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to yourself and **Who has access** to **Anyone**. Deploy and copy the `/exec` URL.
6. Add the following two entries inside the array in the website's private `config.php`:

```php
'google_apps_script_url' => 'PASTE_THE_EXEC_URL_HERE',
'google_sheet_sync_secret' => 'PASTE_THE_GENERATED_SECRET_HERE',
```

7. Upload the updated website files. Sign in to the field console, open **Test Setup**, and press **Create Google Sheet** for the desired test.

When updating an existing installation, first copy your own `HYDRO_TEMPLATE_ID` line (the repository copy says `REDACTED`), paste the new `Code.gs`, put your template ID line back, save it, then choose **Deploy → Manage deployments → Edit**, select **New version**, and deploy. Keep the existing web-app URL and secret; you do not need to run `setupHydroAutomation` again.

Keep the web-app URL and secret private. If either is exposed, run `setupHydroAutomation` again and update `config.php` with the replacement secret.
