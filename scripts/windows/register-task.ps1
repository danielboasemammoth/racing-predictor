<#
Registers hourly runs from 6am through midnight (local Windows time). Run this from an elevated
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

$trigger = @(0) + @(6..23) | ForEach-Object {
    New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour $_ -Minute 0 -Second 0)
}

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Hourly 6am through midnight: scrapes races/results, backfills + generates predictions, backtests, settles paper bets, and syncs PuntersEdge odds" `
    -RunLevel Highest `
    -Force

Write-Host "Scheduled task '$TaskName' registered. Run 'Start-ScheduledTask -TaskName $TaskName' to test it now." -ForegroundColor Green