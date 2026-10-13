$ErrorActionPreference = 'Stop'
$planState = Join-Path $PSScriptRoot 'Data\laptop-power-restore.txt'
$powerMutex = New-Object System.Threading.Mutex($false, 'GrantGFieldLaptopPowerMode')
$ownsPowerMutex = $false
$temporaryPlan = $null
$originalPlan = $null
function Invoke-PowerCfg([string[]] $Options) {
    $result = & "$env:SystemRoot\System32\powercfg.exe" @Options 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Windows could not apply this power option: $($Options[0])" }
    return ($result -join "`n")
}
function Get-ActivePlan {
    $result = Invoke-PowerCfg @('/getactivescheme')
    if ($result -notmatch '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}') { throw 'Could not read the current Windows power plan.' }
    return $Matches[0]
}
try {
    try { $ownsPowerMutex = $powerMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsPowerMutex = $true }
    if (-not $ownsPowerMutex) { throw 'Battery-friendly field mode is already open. Use the existing window.' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'MadgeTechFieldBridge.exe'))) { throw 'Extract all update files into the existing field-app folder first.' }
    try {
        # Recover our previous plan after an unclean exit; never infer or delete other plans.
        if (Test-Path -LiteralPath $planState) {
            $saved = @(Get-Content -LiteralPath $planState)
            if ($saved.Count -ne 2 -or $saved[0] -notmatch '^[0-9a-fA-F-]{36}$' -or $saved[1] -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Saved power-plan recovery needs attention. Use Run-Bridge.cmd and Windows Power Options.' }
            if ((Get-ActivePlan) -eq $saved[1]) { Invoke-PowerCfg @('/setactive', $saved[0]) | Out-Null }
            Invoke-PowerCfg @('/delete', $saved[1]) | Out-Null
            Remove-Item -LiteralPath $planState
        }
        $originalPlan = Get-ActivePlan
        $temporaryPlan = [guid]::NewGuid().ToString()
        New-Item -ItemType Directory -Path (Split-Path $planState) -Force | Out-Null
        # Save recovery information before activating anything.
        Invoke-PowerCfg @('/duplicatescheme', $originalPlan, $temporaryPlan) | Out-Null
        Set-Content -LiteralPath $planState -Value @($originalPlan, $temporaryPlan) -Encoding ASCII
        Invoke-PowerCfg @('/changename', $temporaryPlan, 'Grant G - Field recording') | Out-Null
        Invoke-PowerCfg @('/setdcvalueindex', $temporaryPlan, 'SUB_VIDEO', 'VIDEOIDLE', '120') | Out-Null
        Invoke-PowerCfg @('/setacvalueindex', $temporaryPlan, 'SUB_VIDEO', 'VIDEOIDLE', '300') | Out-Null
        Invoke-PowerCfg @('/setdcvalueindex', $temporaryPlan, 'SUB_PROCESSOR', 'PROCTHROTTLEMIN', '5') | Out-Null
        Invoke-PowerCfg @('/setdcvalueindex', $temporaryPlan, 'SUB_PROCESSOR', 'PROCTHROTTLEMAX', '60') | Out-Null
        # Closing the lid does nothing while field mode runs, so the laptop keeps recording
        # with the lid shut (the screen is then fully off). The usual lid action comes back on exit.
        $lidDone = $true
        foreach ($mode in @('/setdcvalueindex', '/setacvalueindex')) {
            try { Invoke-PowerCfg @($mode, $temporaryPlan, 'SUB_BUTTONS', 'LIDACTION', '0') | Out-Null } catch { $lidDone = $false }
        }
        # Turbo boost off on battery: short CPU bursts stay at base speed. Optional; some laptops lack it.
        $turboOff = $true
        try { Invoke-PowerCfg @('/setdcvalueindex', $temporaryPlan, 'SUB_PROCESSOR', 'PERFBOOSTMODE', '0') | Out-Null } catch { $turboOff = $false }
        # Keep the USB logger and Wi-Fi connection powered. These are explicit GUIDs
        # because USB/Wi-Fi aliases are not present on every Windows version.
        foreach ($mode in @('/setdcvalueindex', '/setacvalueindex')) {
            Invoke-PowerCfg @($mode, $temporaryPlan, '2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', '0') | Out-Null
            Invoke-PowerCfg @($mode, $temporaryPlan, '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1', '12bbebe6-58d6-4636-95bb-3217ef867c1a', '0') | Out-Null
        }
        Invoke-PowerCfg @('/setactive', $temporaryPlan) | Out-Null
        Write-Host 'Battery-friendly field mode is on. Display off after 2 minutes on battery / 5 minutes plugged in.'
        Write-Host ('CPU power is reduced on battery' + $(if ($turboOff) { ' (turbo boost off)' } else { '' }) + '; USB and Wi-Fi remain powered.')
        if ($lidDone) { Write-Host 'Closing the lid will NOT sleep the laptop while this window runs.' }
        else { Write-Warning 'Could not change the lid setting. Keep the lid open, or set "When I close the lid" to Do nothing in Windows.' }
    } catch {
        Write-Warning "Battery-friendly profile was not applied: $($_.Exception.Message)"
        Write-Host 'The bridge will still run with its own sleep protection.'
    }
    Write-Host 'Before a long test: finish pending restarts, then pause updates in Windows Settings.'
    Write-Host 'Keep MadgeTech in Real Time mode. Press Ctrl+C to stop the bridge; let this window finish restoring power settings.'
    & (Join-Path $PSScriptRoot 'MadgeTechFieldBridge.exe')
} finally {
    if ($temporaryPlan -and $originalPlan) {
        try {
            if ((Get-ActivePlan) -eq $temporaryPlan) { Invoke-PowerCfg @('/setactive', $originalPlan) | Out-Null }
            Invoke-PowerCfg @('/delete', $temporaryPlan) | Out-Null
            Remove-Item -LiteralPath $planState -ErrorAction SilentlyContinue
            Write-Host 'Original power settings restored.'
        } catch { Write-Warning 'Power settings need recovery. Run this launcher again, or choose your usual plan in Windows Power Options.' }
    }
    if ($ownsPowerMutex) { $powerMutex.ReleaseMutex() }
    $powerMutex.Dispose()
}
