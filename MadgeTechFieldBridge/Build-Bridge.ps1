$ErrorActionPreference = 'Stop'
$madgeTechDirectory = 'C:\Program Files (x86)\MadgeTech\MadgeTech 4'
$compiler = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath (Join-Path $madgeTechDirectory 'WCFInterop.dll'))) {
    throw 'MadgeTech 4 is not installed in the expected location.'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework compiler was not found.' }

& $compiler /nologo /target:exe /optimize+ /out:"$PSScriptRoot\MadgeTechFieldBridge.exe" `
    /reference:System.ServiceModel.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll `
    /reference:"$madgeTechDirectory\WCFInterop.dll" `
    /reference:"$madgeTechDirectory\DeviceComm.dll" `
    /reference:"$madgeTechDirectory\MTCommon.dll" `
    "$PSScriptRoot\Bridge.cs"
if ($LASTEXITCODE -ne 0) { throw 'Bridge compilation failed.' }
Write-Host 'MadgeTechFieldBridge.exe is ready.'
