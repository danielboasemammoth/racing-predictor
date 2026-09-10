<#
Registers a scheduled task that runs run-puntersedge-poll.ps1 -ForceRun exactly ONCE per day, at
CatchupTimeAest. Used for the two single-fire checks outside the main every-15-min polling window
(11am-11pm AEST/AEDT by default, see run-puntersedge-poll.ps1): one at 6am (right before the main
window opens) and one at 11:30pm (30 minutes after it closes). Run this from an elevated
PowerShell terminal, separately from register-puntersedge-poll-task.ps1 (the every-15-min task)
and register-task.ps1 (the once-daily 6am full pipeline). Safe to re-run - re-registers/updates
the existing task in place.

Purpose: the main poll task only runs within the racing-hours window to avoid burning API credits
overnight for nothing - but a race can still jump (and its result land, median 4.9min per
PuntersEdge's own results() latency - see /memories/repo/puntersedge-api.md) just outside that
window on either edge. The 11:30pm run catches anything right after close; the 6am run catches
anything right before the window reopens, and does so faster than waiting for that same morning's
much slower full DailySync pipeline (which also settles/syncs, but only after scraping, backfilling
predictions, backtesting, etc. first - can be tens of minutes into its run before it gets there).

Usage (register both - run once each from an elevated terminal):
    .\register-puntersedge-catchup-task.ps1 -TaskName "RacingPredictor-PuntersEdgePoll-MorningCatchup" -CatchupTimeAest "6:00AM"
    .\register-puntersedge-catchup-task.ps1 -TaskName "RacingPredictor-PuntersEdgePoll-LateCatchup" -CatchupTimeAest "11:30PM"
#>

param(
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$CatchupTimeAest
)
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }

$scriptPath = Join-Path $PSScriptRoot "run-puntersedge-poll.ps1"

# See register-puntersedge-poll-task.ps1's comment - launching via a generated wscript.exe/.vbs
# wrapper (instead of powershell.exe directly) eliminates the visible console window flash that
# interrupts foreground fullscreen apps. Vbs filename is task-specific so the two catchup tasks
# don't clobber each other's wrapper file.
$vbsPath = Join-Path $PSScriptRoot "run-puntersedge-catchup-hidden-$($TaskName -replace '[^a-zA-Z0-9]', '').vbs"
$innerCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectRoot `"$ProjectRoot`" -ForceRun"
$escapedCommand = $innerCommand -replace '"', '""'
$vbsContent = "Set objShell = CreateObject(""WScript.Shell"")`r`nobjShell.Run ""$escapedCommand"", 0, True`r`n"
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At $CatchupTimeAest

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Once daily at ${CatchupTimeAest}: force-runs Settle Paper Bets + Sync PuntersEdge Odds one last time outside the main 11am-11pm polling window" `
    -RunLevel Highest `
    -Force

Write-Host "Scheduled task '$TaskName' registered. Run 'Start-ScheduledTask -TaskName $TaskName' to test it now." -ForegroundColor Green
