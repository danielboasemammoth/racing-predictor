$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'run-daily-tasks.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$pipeline = $ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] } | Select-Object -Last 1
$statements = @($pipeline.Body.Statements)
$firstStep = $statements | Where-Object { $_.Extent.Text.StartsWith('Invoke-Step ') } | Select-Object -First 1
$body = ($statements | Where-Object { $_.Extent.StartOffset -ge $firstStep.Extent.StartOffset } | ForEach-Object { $_.Extent.Text }) -join "`n"

function Write-Log { param([string]$Text) }
function Invoke-Step {
    param($BaseUrl, $Path, $Label, $Mode, $BatchLimit, $WebSession, [switch]$ContinueOnError)
    $script:calls.Add($Label)
    if ($Mode -eq 'retrospective' -and $BatchLimit -ne 50) { throw 'Backfill must be bounded' }
    if ($Label -eq $script:failedStep) {
        if (-not $ContinueOnError) { throw 'Simulated critical failure' }
        return @{ Ok = $false }
    }
    return @{ Ok = $true; Response = @{ drained = $true } }
}

foreach ($failedStep in @('', 'Backfill Predictions', 'Run Backtest')) {
    $calls = [System.Collections.Generic.List[string]]::new()
    $anyFailures = $false
    . ([scriptblock]::Create($body)) | Out-Null
    if ($calls.IndexOf('Generate Predictions') -gt $calls.IndexOf('Backfill Predictions')) { throw 'Backfill blocked live predictions' }
    if (-not $calls.Contains('Auto-Place Reliability Bets') -or -not $calls.Contains('Prune Stale PuntersEdge Data')) { throw 'Maintenance failure blocked later steps' }
    if ($anyFailures -ne [bool]$failedStep) { throw 'Incorrect failure status' }
}

$failedStep = 'Sync Upcoming Races'
$calls = [System.Collections.Generic.List[string]]::new()
try {
    . ([scriptblock]::Create($body)) | Out-Null
    throw 'Expected critical failure'
} catch {
    if ($_.Exception.Message -ne 'Simulated critical failure') { throw }
    if ($calls.Contains('Generate Predictions')) { throw 'Generated predictions after failed race sync' }
}
if ($ast.EndBlock.Statements[-1].Extent.Text -notmatch 'if \(\$anyFailures\) \{ exit 1 \}') { throw 'Failures must return a nonzero exit code' }
function New-ScheduledTaskTrigger { param([switch]$Daily, $At) return $At }
foreach ($registration in @('register-task.ps1', 'register-puntersedge-poll-task.ps1')) {
    $registrationAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $registration), [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    $assignments = $registrationAst.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.AssignmentStatementAst] }
    $triggerAssignment = $assignments | Where-Object { $_.Left.Extent.Text -eq '$trigger' }
    $RepetitionIntervalMinutes = 60
    . ([scriptblock]::Create($triggerAssignment.Extent.Text))
    if ($trigger.Count -ne 19 -or ($trigger.Hour -join ',') -ne '0,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23') { throw 'Unexpected hourly triggers' }
    $wrapperAssignment = $assignments | Where-Object { $_.Left.Extent.Text -eq '$vbsContent' }
    $escapedCommand = 'cmd.exe /c exit 7'
    . ([scriptblock]::Create($wrapperAssignment.Extent.Text))
    if (-not $vbsContent.Contains('WScript.Quit objShell.Run("cmd.exe /c exit 7", 0, True)')) { throw 'Launcher drops exit code' }
}
Write-Output 'PASS: pipeline failure isolation, bounded backfill, critical abort, failure exit code, hourly triggers, and launcher exit propagation.'