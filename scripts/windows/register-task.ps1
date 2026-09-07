<#
Registers the daily 6am scheduled task. Run this ONCE from an elevated
PowerShell terminal.

Usage:
    .\register-task.ps1
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskName = "RacingPredictor-DailySync"
)

$scriptPath = Join-Path $PSScriptRoot "run-daily-tasks.ps1"

# See register-puntersedge-poll-task.ps1's comment - launching via a generated wscript.exe/.vbs
# wrapper (instead of powershell.exe directly) eliminates the visible console window flash that
# interrupts foreground fullscreen apps.
$vbsPath = Join-Path $PSScriptRoot "run-daily-tasks-hidden.vbs"
$innerCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectRoot `"$ProjectRoot`""
$escapedCommand = $innerCommand -replace '"', '""'
$vbsContent = "Set objShell = CreateObject(""WScript.Shell"")`r`nobjShell.Run ""$escapedCommand"", 0, True`r`n"
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At 6:00AM

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Scrapes races/results, backfills + generates predictions, backtests, settles paper bets, and syncs PuntersEdge odds daily at 6am" `
    -RunLevel Highest `
    -Force

Write-Host "Scheduled task '$TaskName' registered. Run 'Start-ScheduledTask -TaskName $TaskName' to test it now." -ForegroundColor Green