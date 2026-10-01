<#
Manual, opt-in registration of the local real-betting DRY-RUN runner.

The task is registered DISABLED. Nothing runs until you review it and enable it yourself with
Enable-ScheduledTask. The runner itself refuses any mode except disabled/dry-run, never contacts
TAB and never places real bets. Registering a new task usually needs an elevated terminal.

Usage (elevated PowerShell):
    .\register-real-betting-task.ps1 -IUnderstandDryRunOnly
#>

param(
    [string]$ProjectRoot,
    [string]$ConfigPath,
    [string]$TaskName = 'RacingPredictor-RealBettingDryRun',
    [ValidateRange(15, 60)]
    [int]$IntervalMinutes = 15,
    [switch]$IUnderstandDryRunOnly
)

if (-not $IUnderstandDryRunOnly) { throw 'Refusing to register: pass -IUnderstandDryRunOnly to confirm this schedules a dry-run runner that never places real bets.' }
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:LOCALAPPDATA 'RacingPredictor\real-betting-runner.json' }

$runnerPath = Join-Path $PSScriptRoot 'run-real-betting.ps1'
& $runnerPath -ProjectRoot $ProjectRoot -ConfigPath $ConfigPath -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw "Runner config at $ConfigPath failed validation; task not registered." }

$wrapperDir = Join-Path $env:LOCALAPPDATA 'RacingPredictor'
New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null
$vbsPath = Join-Path $wrapperDir 'run-real-betting-hidden.vbs'
$innerCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`" -ProjectRoot `"$ProjectRoot`" -ConfigPath `"$ConfigPath`""
$escapedCommand = $innerCommand -replace '"', '""'
$vbsContent = "Set objShell = CreateObject(""WScript.Shell"")`r`nWScript.Quit objShell.Run(""$escapedCommand"", 0, True)`r`n"
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 365)
$settings = New-ScheduledTaskSettingsSet -Disable -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "DISABLED by default. Every $IntervalMinutes min: local real-betting runner (dry-run only, never places TAB bets)." `
    -RunLevel Limited -Force -ErrorAction Stop | Out-Null

Write-Host "Registered '$TaskName' in a DISABLED state. Review it, then enable manually with: Enable-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Yellow
