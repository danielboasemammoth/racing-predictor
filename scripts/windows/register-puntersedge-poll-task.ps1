<#
Registers a scheduled task that runs run-puntersedge-poll.ps1 every RepetitionIntervalMinutes
(default 15), indefinitely. Run this from an elevated PowerShell terminal, separately from
register-task.ps1 (the once-daily 6am pipeline). Safe to re-run - re-registers/updates the
existing task in place rather than erroring if it already exists.

Credit math (measured live against a real free-tier key, 2026-09): next-to-go and results each
cost 2 credits/call regardless of how much they return. The original free tier (1,500
credits/month, ~50/day sustainable) forced a 60-minute interval (17 calls/day x 2 = 34
credits/day) after the account's own /v1/usage endpoint measured a 15-minute interval's real burn
rate at ~182 credits/day (would have exhausted the monthly allowance by day 8). User has since
raised the PuntersEdge plan/credit limit, so the default here is back to 15 minutes - if credits
ever get tight again, pass -RepetitionIntervalMinutes 60 (or re-check current usage via
`client.usage()` and pick an interval that keeps burn rate under the plan's daily sustainable
rate) rather than assuming 15 is always safe.

The trigger uses the standard "-Once, then repeat" idiom rather than "-Daily" because Windows
Task Scheduler's Daily trigger type does not combine with a repetition interval/duration via
these cmdlet parameters - a single Once trigger with a multi-year RepetitionDuration simply keeps
firing every RepetitionIntervalMinutes forever, which is what "every N minutes, every day" means
in practice. The script itself (not the trigger) is what skips work outside AU racing hours, and
now also skips the results() call when nothing is settleable - see run-puntersedge-poll.ps1 and
src/app/api/admin/puntersedge/{sync,settle}/route.ts.

Usage:
    .\register-puntersedge-poll-task.ps1
    .\register-puntersedge-poll-task.ps1 -RepetitionIntervalMinutes 60   # back to the free-tier-safe interval
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskName = "RacingPredictor-PuntersEdgePoll",
    [int]$RepetitionIntervalMinutes = 15
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
$vbsContent = "Set objShell = CreateObject(""WScript.Shell"")`r`nobjShell.Run ""$escapedCommand"", 0, True`r`n"
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsPath`""

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
