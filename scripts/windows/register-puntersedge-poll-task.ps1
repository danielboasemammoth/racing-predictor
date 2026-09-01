<#
Registers a scheduled task that runs run-puntersedge-poll.ps1 every 15 minutes, indefinitely.
Run this ONCE from an elevated PowerShell terminal, separately from register-task.ps1 (the
once-daily 6am pipeline).

The trigger uses the standard "-Once, then repeat" idiom rather than "-Daily" because Windows
Task Scheduler's Daily trigger type does not combine with a repetition interval/duration via
these cmdlet parameters - a single Once trigger with a multi-year RepetitionDuration simply keeps
firing every RepetitionIntervalMinutes forever, which is what "every 15 minutes, every day" means
in practice. The script itself (not the trigger) is what skips work outside AU racing hours to
conserve PuntersEdge API credits - see run-puntersedge-poll.ps1.

Usage:
    .\register-puntersedge-poll-task.ps1
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskName = "RacingPredictor-PuntersEdgePoll",
    [int]$RepetitionIntervalMinutes = 15
)

$scriptPath = Join-Path $PSScriptRoot "run-puntersedge-poll.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectRoot `"$ProjectRoot`""

$trigger = New-ScheduledTaskTrigger `
    -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $RepetitionIntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

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
    -Description "Every $RepetitionIntervalMinutes min (AU racing hours only): settles paper bets and syncs PuntersEdge odds/recommendations" `
    -RunLevel Highest

Write-Host "Scheduled task '$TaskName' registered. Run 'Start-ScheduledTask -TaskName $TaskName' to test it now." -ForegroundColor Green
