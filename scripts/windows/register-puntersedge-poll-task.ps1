<#
Registers hourly polling from 6am through midnight inclusive (local Windows time).
Run from an elevated PowerShell terminal. Safe to re-run; replaces the existing schedule
and disables the obsolete morning/late catchups. Hourly polling can miss markets priced
only 15-25 minutes before jump. Monitor API usage when changing the interval.

Usage:
    .\register-puntersedge-poll-task.ps1
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskName = "RacingPredictor-PuntersEdgePoll",
    [ValidateRange(15, 60)]
    [int]$RepetitionIntervalMinutes = 60
)

$scriptPath = Join-Path $PSScriptRoot "run-puntersedge-poll.ps1"

# Launch via a generated wscript.exe/.vbs wrapper instead of powershell.exe directly - Task
# Scheduler always flashes a visible console window for a direct powershell.exe action (briefly,
# even with -WindowStyle Hidden, since conhost.exe allocates a window before the style applies).
# wscript.exe is a GUI-subsystem host that never shows a window itself, and WScript.Shell.Run's
# window-style 0 launches the real command fully hidden - this is what actually eliminates the
# flicker that was interrupting foreground fullscreen apps (e.g. games) every poll interval.
$vbsPath = Join-Path $PSScriptRoot "run-puntersedge-poll-hidden.vbs"
$innerCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectRoot `"$ProjectRoot`""
$escapedCommand = $innerCommand -replace '"', '""'
$vbsContent = "Set objShell = CreateObject(""WScript.Shell"")`r`nWScript.Quit objShell.Run(""$escapedCommand"", 0, True)`r`n"
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsPath`""

$trigger = @(
    New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 0 -Minute 0 -Second 0)
    for ($minute = 360; $minute -lt 1440; $minute += $RepetitionIntervalMinutes) {
        New-ScheduledTaskTrigger -Daily -At ((Get-Date).Date.AddMinutes($minute))
    }
)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Every $RepetitionIntervalMinutes min, 6am through midnight: settles paper bets and syncs PuntersEdge odds/recommendations" `
    -RunLevel Highest `
    -Force -ErrorAction Stop

foreach ($catchupName in @("$TaskName-MorningCatchup", "$TaskName-LateCatchup")) {
    Get-ScheduledTask -TaskName $catchupName -ErrorAction SilentlyContinue | Disable-ScheduledTask -ErrorAction Stop | Out-Null
}

Write-Host "Scheduled task '$TaskName' registered. Run 'Start-ScheduledTask -TaskName $TaskName' to test it now." -ForegroundColor Green
