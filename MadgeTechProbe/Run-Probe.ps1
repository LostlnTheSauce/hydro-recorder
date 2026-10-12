$ErrorActionPreference = 'Stop'

$madgeTechDirectory = 'C:\Program Files (x86)\MadgeTech\MadgeTech 4'
$interopAssembly = Join-Path $madgeTechDirectory 'WCFInterop.dll'
$deviceAssembly = Join-Path $madgeTechDirectory 'DeviceComm.dll'
$commonAssembly = Join-Path $madgeTechDirectory 'MTCommon.dll'

if (-not (Test-Path -LiteralPath $interopAssembly)) {
    throw "MadgeTech 4 was not found at $madgeTechDirectory"
}

Add-Type -Path $commonAssembly
Add-Type -Path $deviceAssembly
Add-Type -Path $interopAssembly
Add-Type -Path (Join-Path $PSScriptRoot 'Probe.cs') -ReferencedAssemblies @(
    'System.ServiceModel.dll',
    $interopAssembly,
    $deviceAssembly,
    $commonAssembly
)

$result = [MadgeTechProbe]::Run()
Write-Host "Probe finished with status $result. Press Enter to close."
[void][Console]::ReadLine()
exit $result
