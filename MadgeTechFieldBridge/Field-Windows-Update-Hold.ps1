# Keeps Windows Update from restarting the field laptop during a test.
#   (no switch)  Pause updates for 7 days from now (a longer pause already set is kept), set
#                active hours to 5 AM - 11 PM, and ask Windows not to restart on its own while
#                someone is signed in. Start-Field-Mode.cmd runs this each time, so every start
#                extends the pause.
#   -Resume      Undo all of that, so updates can install between jobs.
# Changing Windows Update needs administrator rights: this asks with the Windows prompt.
# Exit code 0 = done, 1 = not done (prompt declined or Windows refused).
param([switch] $Resume, [int] $Days = 7)
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-Days', $Days)
    if ($Resume) { $arguments += '-Resume' }
    try {
        $elevated = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -Verb RunAs -Wait -PassThru
        exit $elevated.ExitCode
    } catch {
        Write-Warning 'Windows Update was not changed: the administrator prompt was declined.'
        exit 1
    }
}

$ux = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
$pauseNames = @('PauseUpdatesStartTime', 'PauseUpdatesExpiryTime', 'PauseFeatureUpdatesStartTime', 'PauseFeatureUpdatesEndTime', 'PauseQualityUpdatesStartTime', 'PauseQualityUpdatesEndTime')
try {
    if ($Resume) {
        foreach ($name in $pauseNames) { Remove-ItemProperty -Path $ux -Name $name -ErrorAction SilentlyContinue }
        Remove-ItemProperty -Path $au -Name 'NoAutoRebootWithLoggedOnUsers' -ErrorAction SilentlyContinue
        Write-Host 'Windows updates resumed. Install them and restart while no test is running.'
        Start-Sleep -Seconds 5
        exit 0
    }
    if (-not (Test-Path -LiteralPath $ux)) { New-Item -Path $ux -Force | Out-Null }
    $format = 'yyyy-MM-ddTHH:mm:ssZ'
    $now = (Get-Date).ToUniversalTime()
    $until = $now.AddDays($Days)
    # Keep a longer pause that is already set (for example one chosen in Settings).
    $existing = (Get-ItemProperty -Path $ux -Name 'PauseUpdatesExpiryTime' -ErrorAction SilentlyContinue).PauseUpdatesExpiryTime
    if ($existing) {
        try {
            $current = [datetime]::Parse($existing, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
            if ($current -gt $until) { $until = $current }
        } catch { }
    }
    $start = $now.ToString($format, [Globalization.CultureInfo]::InvariantCulture)
    $end = $until.ToString($format, [Globalization.CultureInfo]::InvariantCulture)
    Set-ItemProperty -Path $ux -Name 'PauseUpdatesStartTime' -Value $start
    Set-ItemProperty -Path $ux -Name 'PauseUpdatesExpiryTime' -Value $end
    Set-ItemProperty -Path $ux -Name 'PauseFeatureUpdatesStartTime' -Value $start
    Set-ItemProperty -Path $ux -Name 'PauseFeatureUpdatesEndTime' -Value $end
    Set-ItemProperty -Path $ux -Name 'PauseQualityUpdatesStartTime' -Value $start
    Set-ItemProperty -Path $ux -Name 'PauseQualityUpdatesEndTime' -Value $end
    # Active hours 5 AM to 11 PM (18 hours, the most Windows allows): no update restarts during them.
    Set-ItemProperty -Path $ux -Name 'ActiveHoursStart' -Value 5 -Type DWord
    Set-ItemProperty -Path $ux -Name 'ActiveHoursEnd' -Value 23 -Type DWord
    Set-ItemProperty -Path $ux -Name 'SmartActiveHoursState' -Value 0 -Type DWord
    # Do not restart on its own while someone is signed in (honored by Windows Pro; Home may ignore it).
    if (-not (Test-Path -LiteralPath $au)) { New-Item -Path $au -Force | Out-Null }
    Set-ItemProperty -Path $au -Name 'NoAutoRebootWithLoggedOnUsers' -Value 1 -Type DWord
    exit 0
} catch {
    Write-Warning ('Windows Update could not be changed: ' + $_.Exception.Message)
    Start-Sleep -Seconds 5
    exit 1
}
