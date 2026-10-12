# MadgeTech field app

The field app reads logger T88206 from MadgeTech 4, converts its four channels to °F, saves every new reading locally, and reports the logger as **Online** to the private Hydrotest host page. The host operator clicks **Start recording temps** for Test 1 or Test 2. No per-test connection file, pairing code, or tunnel is needed.

## Field laptop routine

1. Plug in the RTDTempX4 and start its Real Time recording in MadgeTech 4.
2. In MadgeTech 4, turn on **Interop > Enable data output** and **Enable named pipes output**. Leave the service name `MT4Data`.
3. Double-click `Run-Bridge.cmd`. On the first run only, enter the MadgeTech Interop username and password. The app saves those credentials encrypted for this Windows account; later starts should not ask again.
4. Leave both MadgeTech 4 and the field app open. The app displays current readings, its website connection, and the number waiting to upload.

The updated private field package contains its one-time website enrollment. Keep that folder private. Do not send it, its `field-device.settings` file, or your MadgeTech password in chat. `field-device.example.settings` is only a nonfunctional example; it does not connect a logger.

## Host laptop routine

1. Open the Hydrotest host page. Remote viewing is optional, not required.
2. Open **Temperatures** for the desired test. Once the field app is running with internet access, logger T88206 appears as **Online** automatically.
3. Select it and click **Start recording temps** at the moment the website log should begin. Earlier field readings are **not** imported to the website. The logger can feed only one test at a time.
4. Click **Stop recording temps** at the moment the website log should end. The saved website readings remain.

There is no direct laptop-to-laptop connection. Each laptop talks to the website over its own hotspot. A lost hotspot does not stop local temperature collection; the app resends readings captured **between Start and Stop** when service returns, even if Stop was pressed while the field hotspot was down. Readings outside that window remain local only. With the September 28 website and field-app update, a stopped recording can finish uploading separately while a new recording runs. Its samples remain assigned to their original recording. The field journal is in the `Data` folder beside `Run-Bridge.cmd`; do not delete it during a test. Keep MadgeTech's own dataset as the independent backup.

MadgeTech program libraries are detected under both Program Files locations and the current user's AppData/Local/Apps/MadgeTech/MadgeTech 4. A custom installation folder can be entered once at the startup prompt and is remembered in `madgetech-folder.txt`. Do not rename DLL files. An existing `MADGETECH_DIR` override remains supported.

The four channel positions are 1 = pipe, 2 = soil, 3 = ambient, 4 = extra. Keep the field laptop's clock accurate. The website rejects readings more than 30 seconds in the future. Temperature readings do not auto-write the Google Sheet; **Sync to Sheet** remains a separate manual action.

## One-time administrator setup

The website requires the `temperature_devices` table in `temperature-install.sql`. An authenticated host administrator enrolls the known serial once through `temperature.php?action=enroll_device`, then includes the returned device ID and token in `field-device.settings` inside a private field package. The token is stored only as a hash on the website. Never publish a package containing the token or place it in the website's public folder. This enrollment is not a per-test step.

The old `Run-Bridge.cmd <connection-file.json>` mode remains available for recovery during migration. The no-argument mode is the normal workflow.
