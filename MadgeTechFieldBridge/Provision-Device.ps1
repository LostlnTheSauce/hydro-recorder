param(
    [string]$Serial = 'T88206',
    [string]$Website = 'https://grantgsolutions.com/hydro'
)

$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^[A-Za-z0-9_-]{2,40}$') { throw 'Invalid logger serial.' }
if ($Website -notmatch '^https://[^/?#]+(?:/[^?#]+)?$') { throw 'A valid HTTPS website address is required.' }
$settingsPath = Join-Path $PSScriptRoot 'field-device.settings'
$packagePath = Join-Path (Split-Path $PSScriptRoot -Parent) ('MadgeTechFieldApp-Private-' + $Serial + '.zip')
if ((Test-Path -LiteralPath $settingsPath) -or (Test-Path -LiteralPath $packagePath)) {
    throw 'This logger already has private setup files here. Do not replace them without rotating the website enrollment.'
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$idBytes = New-Object byte[] 8
$tokenBytes = New-Object byte[] 32
try {
    $rng.GetBytes($idBytes)
    $rng.GetBytes($tokenBytes)
} finally { $rng.Dispose() }
$deviceId = [BitConverter]::ToString($idBytes).Replace('-', '').ToLowerInvariant()
$deviceToken = [BitConverter]::ToString($tokenBytes).Replace('-', '').ToLowerInvariant()
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $tokenHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($deviceToken))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }

$settings = [ordered]@{ website = $Website.TrimEnd('/'); device_id = $deviceId; device_token = $deviceToken; serial = $Serial.ToUpperInvariant() }
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($packagePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($name in @('MadgeTechFieldBridge.exe', 'Run-Bridge.cmd', 'README.md', 'field-device.settings')) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $PSScriptRoot $name), $name) | Out-Null
    }
} finally { $archive.Dispose() }

Write-Output ('Device ID: ' + $deviceId)
Write-Output ('Enrollment SQL (contains only a token hash): INSERT INTO temperature_devices (id, serial, token_hash, active, ready, created_at) VALUES (''' + $deviceId + ''', ''' + $Serial.ToUpperInvariant() + ''', ''' + $tokenHash + ''', 1, 0, ROUND(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000));')
Write-Output ('Private field package: ' + $packagePath)
Write-Output 'Keep the package private. Do not upload it to public_html or share its settings file.'
