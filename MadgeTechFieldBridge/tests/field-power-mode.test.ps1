$ErrorActionPreference = 'Stop'
# Execute the launcher against a fake powercfg and fake bridge. Never changes Windows power settings.
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\Field-Power-Mode.ps1') -Raw
$mock = @'
function Invoke-PowerCfg([string[]] $Options) {
    $global:PowerCalls.Add(($Options -join ' '))
    if ($Options[0] -eq '/getactivescheme') { return "Power Scheme GUID: $global:FakeActive" }
    if ($Options[0] -eq '/duplicatescheme') { $global:FakeTemporary = $Options[2] }
    if ($Options[0] -eq '/setactive') { $global:FakeActive = $Options[1] }
    if ($global:FailProfile -and $Options[0] -eq '/setdcvalueindex') { throw 'Mock: unsupported setting' }
    if ($global:FailOptional -and ($Options -join ' ') -match 'PERFBOOSTMODE|LIDACTION') { throw 'Mock: setting missing on this laptop' }
    return ''
}
'@
$source = [regex]::Replace($source, '(?s)function Invoke-PowerCfg\(.*?\r?\n\}', $mock)
$source = $source.Replace('& (Join-Path $PSScriptRoot ''MadgeTechFieldBridge.exe'')', '$global:FakeBridgeRan = $true')
foreach ($case in @('ok','profile','optional')) {
    $failure = $case -eq 'profile'
    $testFolder = Join-Path ([System.IO.Path]::GetTempPath()) ('grantg-power-test-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $testFolder | Out-Null
    New-Item -ItemType File -Path (Join-Path $testFolder 'MadgeTechFieldBridge.exe') | Out-Null
    $global:PowerCalls = New-Object 'System.Collections.Generic.List[string]'
    $global:FakeActive = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    $global:FakeBridgeRan = $false
    $global:FailProfile = $failure
    $global:FailOptional = $case -eq 'optional'
    $testSource = $source.Replace('$PSScriptRoot', "'$testFolder'")
    & ([scriptblock]::Create($testSource))
    if (-not $global:FakeBridgeRan) { throw 'Bridge must run even if profile unsupported' }
    if ($global:FakeActive -ne 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') { throw 'Original plan not restored' }
    if (Test-Path -LiteralPath (Join-Path $testFolder 'Data\laptop-power-restore.txt')) { throw 'Recovery marker not cleared after clean exit' }
    if (-not $failure -and -not ($global:PowerCalls | Where-Object { $_ -match 'PROCTHROTTLEMAX 60$' })) { throw 'Missing battery CPU limit' }
    if ($case -eq 'optional' -and -not ($global:PowerCalls | Where-Object { $_ -eq "/setactive $global:FakeTemporary" })) { throw 'Missing lid/turbo settings must not cancel the field plan' }
    if ($case -eq 'ok') {
        foreach ($mode in @('/setdcvalueindex', '/setacvalueindex')) {
            if (-not ($global:PowerCalls | Where-Object { $_ -eq "$mode $global:FakeTemporary SUB_BUTTONS LIDACTION 0" })) { throw "Missing lid do-nothing ($mode)" }
        }
        if (-not ($global:PowerCalls | Where-Object { $_ -eq "/setdcvalueindex $global:FakeTemporary SUB_PROCESSOR PERFBOOSTMODE 0" })) { throw 'Missing battery turbo off' }
        if ($global:PowerCalls | Where-Object { $_ -match '^/setacvalueindex .* PERFBOOSTMODE' }) { throw 'Turbo must stay unchanged when plugged in' }
        if (-not ($global:PowerCalls | Where-Object { $_ -match '^/setactive ' } | Select-Object -First 1 | Where-Object { $_ -match $global:FakeTemporary })) { throw 'Field plan was not activated' }
    }
}
Write-Host 'Power-mode launcher passed: temporary profile, lid do-nothing, battery turbo off, normal restoration, unsupported-profile fallback, optional settings missing; no real power changes.'
