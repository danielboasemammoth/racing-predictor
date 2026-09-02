<#
Registers a scheduled task that runs run-puntersedge-poll.ps1 every RepetitionIntervalMinutes
(default 60), indefinitely. Run this from an elevated PowerShell terminal, separately from
register-task.ps1 (the once-daily 6am pipeline). Safe to re-run - re-registers/updates the
existing task in place rather than erroring if it already exists.

Credit math (measured live against a real free-tier key, 2026-09): next-to-go and results each
cost 2 credits/call regardless of how much they return, and the free tier is 1,500 credits/month
(~50/day sustainable). The original 15-minute interval over a 17h racing-hours window used ~136
credits/day on next-to-go alone (68 calls x 2) - the account's own /v1/usage endpoint measured an
actual burn rate of ~182 credits/day and projected exhausting the whole monthly allowance by day
8. 60 minutes -> 17 calls/day x 2 = 34 credits/day, comfortably sustainable. If you upgrade to the
Hobby plan (`$9/mo, 7,500 credits), 15-minute polling (136/day = ~4,100/month) fits comfortably -
re-run this script with -RepetitionIntervalMinutes 15 at that point.

The trigger uses the standard "-Once, then repeat" idiom rather than "-Daily" because Windows
Task Scheduler's Daily trigger type does not combine with a repetition interval/duration via
these cmdlet parameters - a single Once trigger with a multi-year RepetitionDuration simply keeps
firing every RepetitionIntervalMinutes forever, which is what "every N minutes, every day" means
in practice. The script itself (not the trigger) is what skips work outside AU racing hours, and
now also skips the results() call when nothing is settleable - see run-puntersedge-poll.ps1 and
src/app/api/admin/puntersedge/{sync,settle}/route.ts.

Usage:
    .\register-puntersedge-poll-task.ps1
    .\register-puntersedge-poll-task.ps1 -RepetitionIntervalMinutes 15   # once on a paid plan
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskName = "RacingPredictor-PuntersEdgePoll",
    [int]$RepetitionIntervalMinutes = 60
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
    -RunLevel Highest `
    -Force

Write-Host "Scheduled task '$TaskName' registered. Run 'Start-ScheduledTask -TaskName $TaskName' to test it now." -ForegroundColor Green
