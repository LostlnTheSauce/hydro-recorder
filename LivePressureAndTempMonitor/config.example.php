<?php
declare(strict_types=1);

return [
    'db_host' => 'localhost',
    'db_name' => 'granvcec_hydrotest',
    'db_user' => 'granvcec_hydrotest',
    'db_password' => 'REDACTED',
    'host_password' => 'REDACTED',
    'base_url' => 'https://grantgsolutions.com/hydro',
    // Live viewer pressure is kept while a test runs; cleared this long after it stops.
    'retention_hours' => 72,
    'google_apps_script_url' => 'REDACTED',
    'google_sheet_sync_secret' => 'REDACTED',
];
