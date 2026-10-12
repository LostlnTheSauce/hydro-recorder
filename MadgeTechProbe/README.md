# MadgeTech live-data connection probe

This is a read-only local connection test. It does not send readings to the website or Google Sheets.

1. In MadgeTech 4, open **File > Options > Interop**.
2. Check **Enable data output** and **Enable named pipes output**. Leave the service name as `MT4Data`.
3. Set an Interop password and remember it. Do not put it in a message or file. Click **OK**.
4. Keep MadgeTech 4 open with the logger running in Real Time mode.
5. On the same laptop, double-click `Run-Probe.cmd` in this folder. If this folder is not on the field laptop, copy the entire `MadgeTechProbe` folder there first.

Enter the Interop username (or press Enter for the default shown in the screenshot), then type the password. The password is not shown while typing. A successful run should list the logger serial number and three sets of channel readings, two seconds apart.

All temperature readings are displayed in °F. The probe uses MadgeTech's own unit conversion and does not convert an already-Fahrenheit reading twice.

If MadgeTech is installed in a different directory, update `$madgeTechDirectory` in `Run-Probe.ps1` first.
