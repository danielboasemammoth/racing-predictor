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
foreach ($scriptName in @('run-daily-tasks.ps1', 'run-puntersedge-poll.ps1')) {
    $jobAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $scriptName), [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    $jobTry = $jobAst.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] } | Select-Object -Last 1
    if ($jobTry.Finally.Extent.Text -notmatch 'refresh-page-cache.ps1') { throw "$scriptName must refresh even after pipeline failure" }
    if ($jobTry.Finally.Extent.Text.IndexOf('refresh-page-cache.ps1') -gt $jobTry.Finally.Extent.Text.IndexOf('taskkill')) { throw 'Cache refresh must precede server cleanup' }
}

function Invoke-RestMethod {
    param($Uri, $Method, $ContentType, $Body, $WebSession, $TimeoutSec)
    $key = ($Body | ConvertFrom-Json).key
    $refreshed.Add($key)
    if ($key -eq 'home') { throw 'Simulated snapshot failure' }
    return @{ success = $true }
}
function Write-Log { param([string]$Text) Write-Output $Text }
$refreshed = [System.Collections.Generic.List[string]]::new()
$result = & (Join-Path $PSScriptRoot 'refresh-page-cache.ps1') -BaseUrl 'http://test' -WebSession @{}
if ($result -isnot [bool] -or $result) { throw 'Refresh logging must not mask failure status' }
if ($refreshed.Count -ne 8 -or -not $refreshed.Contains('analytics')) { throw 'Snapshot failure blocked later refreshes' }
$refreshed.Clear()
$result = & (Join-Path $PSScriptRoot 'refresh-page-cache.ps1') -BaseUrl 'http://test' -WebSession @{} -PollOnly
if ($result -isnot [bool] -or -not $result -or ($refreshed -join ',') -ne 'opportunities,validation,place-shadow') { throw 'Incorrect odds-poll refresh scope' }
Write-Output 'PASS: pipeline failure isolation, bounded backfill, hourly triggers, launcher exit propagation, and after-run snapshot refresh isolation.'
$finderAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'find-or-start-app.ps1'), [ref]$tokens, [ref]$parseErrors)
$probe = $finderAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-AppUrl' }, $false)
. ([scriptblock]::Create($probe.Extent.Text))
function Invoke-RestMethod {
    param($Uri, $Method, $TimeoutSec)
    if ($Uri -ne 'http://test/api/health') { throw 'Health checks must not depend on homepage data' }
    return @{ app = 'racing-predictor'; status = 'ok' }
}
if (-not (Test-AppUrl -Url 'http://test')) { throw 'App health probe failed' }
Write-Output 'PASS: database-independent app detection.'