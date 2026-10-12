$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework compiler was not found.' }

# Same places the field app looks, so a build works wherever MadgeTech 4 is installed.
function Test-MadgeTech([string] $directory) {
    if ([string]::IsNullOrWhiteSpace($directory)) { return $false }
    foreach ($name in 'WCFInterop.dll', 'DeviceComm.dll', 'MTCommon.dll') {
        if (-not (Test-Path -LiteralPath (Join-Path $directory $name))) { return $false }
    }
    return $true
}
$savedPath = Join-Path $PSScriptRoot 'madgetech-folder.txt'
$candidates = @($env:MADGETECH_DIR)
if (Test-Path -LiteralPath $savedPath) { $candidates += (Get-Content -LiteralPath $savedPath -Raw).Trim() }
foreach ($pair in @(@($env:LOCALAPPDATA, 'Apps\MadgeTech\MadgeTech 4'), @($env:LOCALAPPDATA, 'MadgeTech\MadgeTech 4'),
        @(${env:ProgramFiles(x86)}, 'MadgeTech\MadgeTech 4'), @($env:ProgramFiles, 'MadgeTech\MadgeTech 4'))) {
    if ($pair[0]) { $candidates += (Join-Path $pair[0] $pair[1]) }
}
$madgeTechDirectory = $candidates | Where-Object { Test-MadgeTech $_ } | Select-Object -First 1
while (-not $madgeTechDirectory) {
    Write-Host 'MadgeTech 4 was not found. In File Explorer, open its installed folder and copy the address bar.'
    $entered = Read-Host 'Paste the MadgeTech folder here (or press Enter to cancel)'
    if ([string]::IsNullOrWhiteSpace($entered)) { throw 'Build cancelled: MadgeTech 4 folder not found.' }
    $entered = [Environment]::ExpandEnvironmentVariables($entered.Trim().Trim('"'))
    if (Test-MadgeTech $entered) { $madgeTechDirectory = $entered; Set-Content -LiteralPath $savedPath -Value $entered }
    else { Write-Host 'WCFInterop.dll, DeviceComm.dll and MTCommon.dll are not in that folder.' }
}
Write-Host "MadgeTech found: $madgeTechDirectory"

& $compiler /nologo /target:exe /optimize+ /out:"$PSScriptRoot\MadgeTechFieldBridge.exe" `
    /reference:System.ServiceModel.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll `
    /reference:"$madgeTechDirectory\WCFInterop.dll" `
    /reference:"$madgeTechDirectory\DeviceComm.dll" `
    /reference:"$madgeTechDirectory\MTCommon.dll" `
    "$PSScriptRoot\Bridge.cs"
if ($LASTEXITCODE -ne 0) { throw 'Bridge compilation failed.' }
Write-Host 'MadgeTechFieldBridge.exe is ready.'
